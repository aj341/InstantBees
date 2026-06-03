import { Router, type IRouter } from "express";
import { eq, inArray } from "drizzle-orm";
import {
  campaignLeadsTable,
  campaignsTable,
  clickEventsTable,
  db,
  emailAccountsTable,
  emailSendJobsTable,
  emailTemplatesTable,
  inboxMessagesTable,
  labelsTable,
  leadLabelsTable,
  leadsTable,
  sequenceStepsTable,
} from "@workspace/db";
import { classifyReply } from "../lib/reply-classifier";
import { nextSendWindowAt } from "../lib/sending-window";
import { effectiveWarmupLimit, warmupDay } from "../lib/warmup";
import { isExcludedAnalyticsEmail } from "../lib/analytics-exclusions";

const router: IRouter = Router();

function envInt(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const ACCOUNT_CAMPAIGN_COOLDOWN_MS = envInt("ACCOUNT_CAMPAIGN_COOLDOWN_MINUTES", 180) * 60_000;
const ACCOUNT_CAMPAIGN_COOLDOWN_JITTER_MS = envInt("ACCOUNT_CAMPAIGN_COOLDOWN_JITTER_MINUTES", 30) * 60_000;
const ACCOUNT_CAMPAIGN_DAILY_LIMIT = envInt("ACCOUNT_CAMPAIGN_DAILY_LIMIT", 5);
const DEFAULT_RUNWAY_THRESHOLD_DAYS = envInt("CAMPAIGN_RUNWAY_THRESHOLD_DAYS", 5);
const DEFAULT_RUNWAY_COMFORTABLE_DAYS = envInt("CAMPAIGN_RUNWAY_COMFORTABLE_DAYS", 10);

type CampaignRunwayHealth = "healthy" | "watch" | "needs_top_up" | "no_capacity" | "inactive";

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function rate(part: number, whole: number): number {
  return whole > 0 ? Number(((part / whole) * 100).toFixed(1)) : 0;
}

function leadName(lead: typeof leadsTable.$inferSelect): string {
  return [lead.firstName, lead.lastName].filter(Boolean).join(" ") || lead.email;
}

function sentLike(job: typeof emailSendJobsTable.$inferSelect): boolean {
  return job.status === "sent" || !!job.sentAt;
}

function daysSince(value: Date | null | undefined): number {
  if (!value) return 0;
  return Math.max(0, Math.floor((Date.now() - value.getTime()) / 86_400_000));
}

function effectiveDailyLimit(account: typeof emailAccountsTable.$inferSelect): number {
  const daily = Math.max(1, account.dailySendLimit ?? 50);
  if (!account.warmupEnabled && account.status !== "warming") return daily;
  return effectiveWarmupLimit(daily, account.createdAt);
}

function clampPositiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function campaignBatchSettings(campaign: Pick<typeof campaignsTable.$inferSelect, "batchSize" | "batchIntervalMinutes">): { batchSize: number; batchIntervalMs: number; slotIntervalMs: number } {
  const batchSize = clampPositiveInt(campaign.batchSize, 16);
  const batchIntervalMs = clampPositiveInt(campaign.batchIntervalMinutes, 65) * 60_000;
  return {
    batchSize,
    batchIntervalMs,
    slotIntervalMs: Math.max(1_000, Math.floor(batchIntervalMs / batchSize)),
  };
}

function stableJitterMs(accountId: number, campaignId: number, sentAt: Date): number {
  const basis = `${accountId}:${campaignId}:${sentAt.getTime()}`;
  let hash = 0;
  for (let i = 0; i < basis.length; i += 1) {
    hash = ((hash << 5) - hash + basis.charCodeAt(i)) | 0;
  }
  const range = ACCOUNT_CAMPAIGN_COOLDOWN_JITTER_MS * 2;
  return Math.abs(hash) % (range + 1) - ACCOUNT_CAMPAIGN_COOLDOWN_JITTER_MS;
}

function localDateKey(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function estimateReadyForMoreAt(
  start: Date,
  queuedCount: number,
  campaign: typeof campaignsTable.$inferSelect | null,
  accounts: Array<typeof emailAccountsTable.$inferSelect>,
  jobs: Array<typeof emailSendJobsTable.$inferSelect>,
): { readyAt: Date | null; capacityPerSlot: number; dailyCapacity: number; capacityIntervalMinutes: number; capacitySlotMinutes: number } {
  if (queuedCount <= 0 || !campaign) return { readyAt: null, capacityPerSlot: 0, dailyCapacity: 0, capacityIntervalMinutes: 0, capacitySlotMinutes: 0 };

  const timezone = campaign.sendWindowTimezone || "Australia/Sydney";
  const sendableAccounts = accounts.filter((account) => (
    (account.status === "connected" || account.status === "warming") && !!account.smtpPasswordEnc
  ));
  const { batchSize, batchIntervalMs, slotIntervalMs } = campaignBatchSettings(campaign);
  const capacityIntervalMinutes = Math.round(batchIntervalMs / 60_000);
  const capacitySlotMinutes = Number((slotIntervalMs / 60_000).toFixed(1));
  if (sendableAccounts.length === 0) return { readyAt: null, capacityPerSlot: 0, dailyCapacity: 0, capacityIntervalMinutes, capacitySlotMinutes };

  const initialSentByAccountDay = new Map<string, number>();
  const initialSentByCampaignDay = new Map<string, number>();
  const initialSentByAccountCampaignDay = new Map<string, number>();
  const initialLastSentByAccountCampaign = new Map<string, Date>();
  for (const job of jobs) {
    if (!sentLike(job) || !job.sentAt) continue;
    const day = localDateKey(job.sentAt, timezone);
    if (job.accountId) {
      const accountKey = `${job.accountId}:${day}`;
      initialSentByAccountDay.set(accountKey, (initialSentByAccountDay.get(accountKey) ?? 0) + 1);
      const accountCampaignDayKey = `${job.accountId}:${job.campaignId}:${day}`;
      initialSentByAccountCampaignDay.set(accountCampaignDayKey, (initialSentByAccountCampaignDay.get(accountCampaignDayKey) ?? 0) + 1);
      const accountCampaignKey = `${job.accountId}:${job.campaignId}`;
      const existingLast = initialLastSentByAccountCampaign.get(accountCampaignKey);
      if (!existingLast || job.sentAt > existingLast) initialLastSentByAccountCampaign.set(accountCampaignKey, job.sentAt);
    }
    const campaignKey = `${job.campaignId}:${day}`;
    initialSentByCampaignDay.set(campaignKey, (initialSentByCampaignDay.get(campaignKey) ?? 0) + 1);
  }

  const simulatedByAccountDay = new Map<string, number>();
  const simulatedByCampaignDay = new Map<string, number>();
  const simulatedByAccountCampaignDay = new Map<string, number>();
  const simulatedLastSentByAccountCampaign = new Map<string, Date>();
  const effectiveLimitForAccountAt = (account: typeof emailAccountsTable.$inferSelect, at: Date): number => {
    const daily = Math.max(1, account.dailySendLimit ?? 50);
    if (!account.warmupEnabled && account.status !== "warming") return daily;
    return effectiveWarmupLimit(daily, account.createdAt, at);
  };
  const remainingForAccount = (account: typeof emailAccountsTable.$inferSelect, at: Date): number => {
    const day = localDateKey(at, timezone);
    const key = `${account.id}:${day}`;
    const alreadySent = (initialSentByAccountDay.get(key) ?? 0) + (simulatedByAccountDay.get(key) ?? 0);
    return Math.max(0, effectiveLimitForAccountAt(account, at) - alreadySent);
  };
  const remainingForCampaign = (at: Date): number => {
    if (!campaign.dailyLimit) return Number.POSITIVE_INFINITY;
    const day = localDateKey(at, timezone);
    const key = `${campaign.id}:${day}`;
    const alreadySent = (initialSentByCampaignDay.get(key) ?? 0) + (simulatedByCampaignDay.get(key) ?? 0);
    return Math.max(0, campaign.dailyLimit - alreadySent);
  };
  const accountCampaignHasCapacity = (account: typeof emailAccountsTable.$inferSelect, at: Date): boolean => {
    const day = localDateKey(at, timezone);
    const dayKey = `${account.id}:${campaign.id}:${day}`;
    const sentToday = (initialSentByAccountCampaignDay.get(dayKey) ?? 0) + (simulatedByAccountCampaignDay.get(dayKey) ?? 0);
    if (sentToday >= ACCOUNT_CAMPAIGN_DAILY_LIMIT) return false;

    const key = `${account.id}:${campaign.id}`;
    const lastSent = simulatedLastSentByAccountCampaign.get(key) ?? initialLastSentByAccountCampaign.get(key);
    if (!lastSent) return true;
    const nextAt = new Date(lastSent.getTime() + ACCOUNT_CAMPAIGN_COOLDOWN_MS + stableJitterMs(account.id, campaign.id, lastSent));
    return nextAt <= at;
  };

  let remainingQueued = queuedCount;
  let cursor = nextSendWindowAt(start, campaign);
  let lastCapacityPerSlot = 0;
  let dailyCapacity = 0;

  for (let guard = 0; guard < 60 * 24 * 90 && remainingQueued > 0; guard += 1) {
    cursor = nextSendWindowAt(cursor, campaign);
    const day = localDateKey(cursor, timezone);
    const accountsWithCapacity = sendableAccounts.filter((account) => (
      remainingForAccount(account, cursor) > 0 && accountCampaignHasCapacity(account, cursor)
    ));
    const campaignRemaining = remainingForCampaign(cursor);
    const slotCapacity = Math.max(0, Math.min(1, accountsWithCapacity.length, campaignRemaining, remainingQueued));
    lastCapacityPerSlot = slotCapacity > 0 ? 1 : 0;
    const accountDailyCapacity = sendableAccounts.reduce((total, account) => total + effectiveLimitForAccountAt(account, cursor), 0);
    dailyCapacity = Math.min(accountDailyCapacity, campaign.dailyLimit || accountDailyCapacity);

    if (slotCapacity > 0) {
      const account = accountsWithCapacity[guard % accountsWithCapacity.length] ?? accountsWithCapacity[0];
      const key = `${account.id}:${day}`;
      simulatedByAccountDay.set(key, (simulatedByAccountDay.get(key) ?? 0) + 1);
      const accountCampaignDayKey = `${account.id}:${campaign.id}:${day}`;
      simulatedByAccountCampaignDay.set(accountCampaignDayKey, (simulatedByAccountCampaignDay.get(accountCampaignDayKey) ?? 0) + 1);
      simulatedLastSentByAccountCampaign.set(`${account.id}:${campaign.id}`, cursor);
      const campaignKey = `${campaign.id}:${day}`;
      simulatedByCampaignDay.set(campaignKey, (simulatedByCampaignDay.get(campaignKey) ?? 0) + slotCapacity);
      remainingQueued -= slotCapacity;
    }

    const nextCursor = new Date(cursor.getTime() + slotIntervalMs);
    cursor = nextSendWindowAt(nextCursor, campaign);
  }

  return {
    readyAt: remainingQueued <= 0 ? cursor : null,
    capacityPerSlot: lastCapacityPerSlot,
    dailyCapacity,
    capacityIntervalMinutes,
    capacitySlotMinutes,
  };
}

function plainSnippet(value: string | null | undefined, max = 160): string {
  const text = (value ?? "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function roundOne(value: number): number {
  return Number(value.toFixed(1));
}

function runwayDays(queueSize: number, dailyRate: number): number | null {
  if (queueSize <= 0) return 0;
  if (dailyRate <= 0) return null;
  return roundOne(queueSize / dailyRate);
}

function keyForTemplate(subject: string, body: string): string {
  return `${subject.trim().toLowerCase()}::${body.trim().toLowerCase()}`;
}

router.get("/growth/overview", async (_req, res): Promise<void> => {
  const [campaigns, leads, accounts, steps, templates, jobs, clickEvents, replies, enrollments] = await Promise.all([
    db.select().from(campaignsTable),
    db.select().from(leadsTable),
    db.select().from(emailAccountsTable),
    db.select().from(sequenceStepsTable),
    db.select().from(emailTemplatesTable),
    db.select().from(emailSendJobsTable),
    db.select().from(clickEventsTable),
    db.select().from(inboxMessagesTable),
    db.select().from(campaignLeadsTable),
  ]);

  const campaignsById = new Map(campaigns.map((campaign) => [campaign.id, campaign]));
  const leadsById = new Map(leads.map((lead) => [lead.id, lead]));
  const accountsById = new Map(accounts.map((account) => [account.id, account]));
  const stepsById = new Map(steps.map((step) => [step.id, step]));
  const isExcludedAnalyticsLead = (leadId: number | null | undefined): boolean => isExcludedAnalyticsEmail(leadsById.get(Number(leadId))?.email);
  const analyticsJobs = jobs.filter((job) => !isExcludedAnalyticsLead(job.leadId));
  const analyticsClickEvents = clickEvents.filter((click) => !isExcludedAnalyticsLead(click.leadId));
  const analyticsReplies = replies.filter((reply) => !isExcludedAnalyticsLead(reply.leadId));
  const [labels, leadLabels] = await Promise.all([
    db.select().from(labelsTable),
    db.select().from(leadLabelsTable),
  ]);
  const clicksByJob = new Map<number, typeof analyticsClickEvents>();
  for (const click of analyticsClickEvents) {
    const list = clicksByJob.get(click.sendJobId) ?? [];
    list.push(click);
    clicksByJob.set(click.sendJobId, list);
  }
  const repliesByLeadCampaign = new Map<string, typeof analyticsReplies>();
  for (const reply of analyticsReplies) {
    if (!reply.leadId || !reply.campaignId) continue;
    const key = `${reply.leadId}:${reply.campaignId}`;
    const list = repliesByLeadCampaign.get(key) ?? [];
    list.push(reply);
    repliesByLeadCampaign.set(key, list);
  }

  const queuedJobs = jobs
    .filter((job) => job.status === "pending" || job.status === "in_progress")
    .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
  const queueClearsAt = queuedJobs.length > 0 ? queuedJobs[queuedJobs.length - 1]?.scheduledAt ?? null : null;
  const nextSendableQueue = queuedJobs
    .map((job) => {
      const campaign = campaignsById.get(job.campaignId);
      const candidateAt = new Date(Math.max(job.scheduledAt.getTime(), Date.now()));
      return {
        job,
        deliverableAt: campaign ? nextSendWindowAt(candidateAt, campaign) : candidateAt,
      };
    })
    .sort((a, b) => a.deliverableAt.getTime() - b.deliverableAt.getTime());
  const nextBatchAt = nextSendableQueue[0]?.deliverableAt ?? null;
  const nextBatchJobs = nextBatchAt
    ? nextSendableQueue.filter((row) => Math.abs(row.deliverableAt.getTime() - nextBatchAt.getTime()) < 60_000)
    : [];
  const currentBatchClearsAt = nextBatchAt
    ? new Date(nextBatchAt.getTime() + Math.max(0, Math.ceil(nextBatchJobs.length / 5) - 1) * 10_000)
    : null;
  const activeQueuedCampaigns = Array.from(new Set(queuedJobs.map((job) => job.campaignId)))
    .map((campaignId) => campaignsById.get(campaignId))
    .filter((campaign): campaign is typeof campaignsTable.$inferSelect => !!campaign && campaign.status === "active");
  const queueCapacityCampaign = activeQueuedCampaigns[0] ?? campaigns.find((campaign) => campaign.status === "active") ?? null;
  const readyForMore = estimateReadyForMoreAt(
    new Date(),
    queuedJobs.length,
    queueCapacityCampaign,
    accounts,
    jobs,
  );

  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000);
  const leadIdsByCampaign = new Map<number, Set<number>>();
  for (const enrollment of enrollments) {
    const lead = leadsById.get(enrollment.leadId);
    if (!lead || lead.status !== "active" || isExcludedAnalyticsEmail(lead.email)) continue;
    const set = leadIdsByCampaign.get(enrollment.campaignId) ?? new Set<number>();
    set.add(enrollment.leadId);
    leadIdsByCampaign.set(enrollment.campaignId, set);
  }

  const campaignRunway = campaigns.map((campaign) => {
    const campaignJobs = analyticsJobs.filter((job) => job.campaignId === campaign.id);
    const pendingJobs = campaignJobs.filter((job) => job.status === "pending" || job.status === "in_progress");
    const pendingLeadTouches = new Set(pendingJobs.map((job) => job.leadId)).size;
    const firstTouchPendingLeads = new Set(
      pendingJobs
        .filter((job) => stepsById.get(job.stepId)?.stepNumber === 1)
        .map((job) => job.leadId),
    ).size;
    const sentLast7Days = campaignJobs.filter((job) => sentLike(job) && job.sentAt && job.sentAt >= sevenDaysAgo).length;
    const totalSent = campaignJobs.filter(sentLike).length;
    const actualDailySendRate = roundOne(sentLast7Days / 7);
    const capacity = estimateReadyForMoreAt(now, Math.max(1, pendingJobs.length || firstTouchPendingLeads || 1), campaign, accounts, jobs);
    const capacityDailySendRate = capacity.dailyCapacity;
    const hasSendHistory = totalSent > 0 || sentLast7Days > 0;
    const fallbackDailySendRate = hasSendHistory && capacityDailySendRate > 0
      ? Math.min(capacityDailySendRate, Math.max(1, clampPositiveInt(campaign.batchSize, 16)))
      : 0;
    const runwayDailySendRate = campaign.status === "active"
      ? (actualDailySendRate > 0 ? actualDailySendRate : fallbackDailySendRate)
      : 0;
    const thresholdDays = DEFAULT_RUNWAY_THRESHOLD_DAYS;
    const comfortableDays = DEFAULT_RUNWAY_COMFORTABLE_DAYS;
    const firstTouchRunwayDays = runwayDays(firstTouchPendingLeads, runwayDailySendRate);
    const allQueuedRunwayDays = runwayDays(pendingJobs.length, runwayDailySendRate);
    const topUpNeeded = campaign.status === "active" && hasSendHistory && runwayDailySendRate > 0
      ? Math.max(0, Math.ceil(thresholdDays * runwayDailySendRate) - firstTouchPendingLeads)
      : 0;
    let health: CampaignRunwayHealth = "healthy";
    if (campaign.status !== "active") {
      health = "inactive";
    } else if (capacityDailySendRate <= 0) {
      health = "no_capacity";
    } else if (!hasSendHistory) {
      health = "watch";
    } else if ((firstTouchRunwayDays ?? 0) < thresholdDays) {
      health = "needs_top_up";
    } else if ((firstTouchRunwayDays ?? 0) < comfortableDays) {
      health = "watch";
    }

    return {
      campaignId: campaign.id,
      campaignName: campaign.name,
      status: campaign.status,
      activeLeads: leadIdsByCampaign.get(campaign.id)?.size ?? 0,
      pendingJobs: pendingJobs.length,
      pendingLeadTouches,
      firstTouchPendingLeads,
      totalSent,
      sentLast7Days,
      actualDailySendRate,
      capacityDailySendRate,
      runwayDailySendRate,
      runwayDays: allQueuedRunwayDays,
      firstTouchRunwayDays,
      topUpNeeded,
      thresholdDays,
      comfortableDays,
      health,
    };
  }).sort((a, b) => {
    const rank: Record<CampaignRunwayHealth, number> = { needs_top_up: 0, no_capacity: 1, watch: 2, healthy: 3, inactive: 4 };
    return rank[a.health] - rank[b.health] || (a.firstTouchRunwayDays ?? 9999) - (b.firstTouchRunwayDays ?? 9999);
  });

  const sendCalendar = queuedJobs
    .slice(0, 100)
    .map((job) => {
      const campaign = campaignsById.get(job.campaignId);
      const lead = leadsById.get(job.leadId);
      const account = accountsById.get(job.accountId);
      const step = stepsById.get(job.stepId);
      return {
        jobId: job.id,
        campaignId: job.campaignId,
        campaignName: campaign?.name ?? `Campaign #${job.campaignId}`,
        campaignStatus: campaign?.status ?? "draft",
        leadId: job.leadId,
        leadEmail: lead?.email ?? "",
        leadName: lead ? leadName(lead) : "",
        company: lead?.company ?? null,
        accountId: job.accountId,
        accountEmail: account?.email ?? null,
        accountStatus: account?.status ?? null,
        warmupEnabled: Boolean(account?.warmupEnabled),
        stepNumber: step?.stepNumber ?? null,
        subject: step?.subject ?? "",
        scheduledAt: toIso(job.scheduledAt),
        status: job.status,
        attempts: job.attempts,
        errorMessage: job.errorMessage,
      };
    });

  const timelineEvents = [
    ...jobs.flatMap((job) => {
      const campaign = campaignsById.get(job.campaignId);
      const lead = leadsById.get(job.leadId);
      const step = stepsById.get(job.stepId);
      const base = {
        leadId: job.leadId,
        leadEmail: lead?.email ?? "",
        leadName: lead ? leadName(lead) : "",
        campaignId: job.campaignId,
        campaignName: campaign?.name ?? `Campaign #${job.campaignId}`,
        stepNumber: step?.stepNumber ?? null,
        subject: step?.subject ?? "",
      };
      const events = [{
        ...base,
        eventType: job.status === "failed" ? "failed" : job.status === "skipped" ? "skipped" : "scheduled",
        occurredAt: toIso(job.scheduledAt),
        detail: job.errorMessage ?? `Step ${step?.stepNumber ?? "?"} queued`,
      }];
      if (job.sentAt) events.push({ ...base, eventType: "sent", occurredAt: toIso(job.sentAt), detail: step?.subject ?? "" });
      if (job.firstOpenedAt) events.push({ ...base, eventType: "opened", occurredAt: toIso(job.firstOpenedAt), detail: `${job.openCount} open${job.openCount === 1 ? "" : "s"}` });
      if (job.firstClickedAt) events.push({ ...base, eventType: "clicked", occurredAt: toIso(job.firstClickedAt), detail: `${job.clickCount} click${job.clickCount === 1 ? "" : "s"}` });
      if (job.repliedAt) events.push({ ...base, eventType: "replied", occurredAt: toIso(job.repliedAt), detail: "Reply received" });
      if (job.bounceKind) events.push({ ...base, eventType: "bounced", occurredAt: toIso(job.sentAt ?? job.scheduledAt), detail: `${job.bounceKind} bounce` });
      return events;
    }),
    ...analyticsClickEvents.map((click) => {
      const lead = leadsById.get(click.leadId);
      const campaign = campaignsById.get(click.campaignId);
      return {
        leadId: click.leadId,
        leadEmail: lead?.email ?? "",
        leadName: lead ? leadName(lead) : "",
        campaignId: click.campaignId,
        campaignName: campaign?.name ?? `Campaign #${click.campaignId}`,
        stepNumber: null,
        subject: "",
        eventType: "link_click",
        occurredAt: toIso(click.clickedAt),
        detail: click.url,
      };
    }),
    ...analyticsReplies.map((reply) => {
      const lead = reply.leadId ? leadsById.get(reply.leadId) : null;
      const campaign = reply.campaignId ? campaignsById.get(reply.campaignId) : null;
      const classification = classifyReply(reply);
      return {
        leadId: reply.leadId,
        leadEmail: lead?.email ?? reply.fromEmail,
        leadName: lead ? leadName(lead) : reply.fromName ?? reply.fromEmail,
        campaignId: reply.campaignId,
        campaignName: campaign?.name ?? (reply.campaignId ? `Campaign #${reply.campaignId}` : ""),
        stepNumber: null,
        subject: reply.subject,
        eventType: classification.category === "bounce" ? "bounce_reply" : "reply",
        occurredAt: toIso(reply.receivedAt),
        detail: `${classification.category}: ${plainSnippet(reply.body)}`,
      };
    }),
  ].filter((event) => event.occurredAt).sort((a, b) => new Date(b.occurredAt!).getTime() - new Date(a.occurredAt!).getTime()).slice(0, 250);

  const replyClassifications = analyticsReplies
    .sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime())
    .slice(0, 100)
    .map((reply) => {
      const lead = reply.leadId ? leadsById.get(reply.leadId) : null;
      const campaign = reply.campaignId ? campaignsById.get(reply.campaignId) : null;
      const classification = classifyReply(reply);
      return {
        id: reply.id,
        leadId: reply.leadId,
        leadEmail: lead?.email ?? reply.fromEmail,
        leadName: lead ? leadName(lead) : reply.fromName ?? reply.fromEmail,
        campaignId: reply.campaignId,
        campaignName: campaign?.name ?? null,
        subject: reply.subject,
        snippet: plainSnippet(reply.body),
        category: classification.category,
        sentiment: reply.sentiment ?? classification.sentiment,
        receivedAt: toIso(reply.receivedAt),
      };
    });

  const uniqueLeadJobs = new Map<string, typeof jobs[number]>();
  for (const job of [...analyticsJobs].sort((a, b) => (b.sentAt?.getTime() ?? b.scheduledAt.getTime()) - (a.sentAt?.getTime() ?? a.scheduledAt.getTime()))) {
    if (!sentLike(job)) continue;
    uniqueLeadJobs.set(`${job.campaignId}:${job.leadId}`, job);
  }

  const followUpCandidates = Array.from(uniqueLeadJobs.values()).flatMap((job) => {
    const lead = leadsById.get(job.leadId);
    const campaign = campaignsById.get(job.campaignId);
    if (!lead || !campaign) return [];
    const repliesForLead = repliesByLeadCampaign.get(`${job.leadId}:${job.campaignId}`) ?? [];
    const firstReply = repliesForLead.sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime())[0];
    const base = {
      campaignId: campaign.id,
      campaignName: campaign.name,
      leadId: lead.id,
      leadEmail: lead.email,
      leadName: leadName(lead),
      company: lead.company,
    };
    if (firstReply) {
      const classification = classifyReply(firstReply);
      if (classification.category === "interested" || classification.category === "referral" || classification.category === "objection") {
        return [{
          ...base,
          reason: classification.category,
          priority: classification.category === "interested" ? "high" : "medium",
          lastActivityAt: toIso(firstReply.receivedAt),
          recommendedAction: classification.category === "objection" ? "Send objection-handling follow-up" : "Reply manually within the same thread",
        }];
      }
      return [];
    }
    if (job.firstClickedAt) {
      return [{
        ...base,
        reason: "clicked_no_reply",
        priority: "high",
        lastActivityAt: toIso(job.firstClickedAt),
        recommendedAction: "Send a short value follow-up referencing the clicked link",
      }];
    }
    if (job.firstOpenedAt) {
      return [{
        ...base,
        reason: "opened_no_reply",
        priority: "medium",
        lastActivityAt: toIso(job.firstOpenedAt),
        recommendedAction: "Send a lightweight bump after 1-2 days",
      }];
    }
    const sentAt = job.sentAt ?? job.scheduledAt;
    if (sentAt && daysSince(sentAt) >= 3) {
      return [{
        ...base,
        reason: "no_activity_3_days",
        priority: "low",
        lastActivityAt: toIso(sentAt),
        recommendedAction: "Queue a new angle or final polite bump",
      }];
    }
    return [];
  }).sort((a, b) => new Date(b.lastActivityAt ?? 0).getTime() - new Date(a.lastActivityAt ?? 0).getTime());

  const performanceForJobs = (subset: typeof jobs) => {
    const sent = subset.filter(sentLike).length;
    const opened = subset.filter((job) => (job.openCount ?? 0) > 0 || !!job.firstOpenedAt).length;
    const clicked = subset.filter((job) => (job.clickCount ?? 0) > 0 || !!job.firstClickedAt).length;
    const replied = subset.filter((job) => !!job.repliedAt).length;
    const bounced = subset.filter((job) => !!job.bounceKind).length;
    return {
      sent,
      opened,
      clicked,
      replied,
      bounced,
      openRate: rate(opened, sent),
      clickRate: rate(clicked, sent),
      replyRate: rate(replied, sent),
      bounceRate: rate(bounced, sent),
    };
  };

  const stepGroups = new Map<string, typeof jobs>();
  for (const job of analyticsJobs) {
    const step = stepsById.get(job.stepId);
    if (!step) continue;
    const key = `${step.stepNumber}. ${step.subject}`;
    const list = stepGroups.get(key) ?? [];
    list.push(job);
    stepGroups.set(key, list);
  }
  const abPerformance = Array.from(stepGroups.entries()).map(([variant, variantJobs]) => ({
    variant,
    preview: plainSnippet(stepsById.get(variantJobs[0]?.stepId ?? 0)?.body, 120),
    ...performanceForJobs(variantJobs),
  })).sort((a, b) => b.sent - a.sent);

  const jobsByStep = new Map<number, typeof jobs>();
  for (const job of analyticsJobs) {
    const list = jobsByStep.get(job.stepId) ?? [];
    list.push(job);
    jobsByStep.set(job.stepId, list);
  }
  const templatePerformance = templates.map((template) => {
    const matchingSteps = steps.filter((step) => keyForTemplate(step.subject, step.body) === keyForTemplate(template.subject, template.body));
    const templateJobs = matchingSteps.flatMap((step) => jobsByStep.get(step.id) ?? []);
    return {
      templateId: template.id,
      templateName: template.name,
      subject: template.subject,
      matchedSteps: matchingSteps.length,
      ...performanceForJobs(templateJobs),
      updatedAt: toIso(template.updatedAt),
    };
  }).sort((a, b) => b.sent - a.sent);

  const campaignFunnels = campaigns.map((campaign) => {
    const campaignJobs = analyticsJobs.filter((job) => job.campaignId === campaign.id);
    const perf = performanceForJobs(campaignJobs);
    return {
      campaignId: campaign.id,
      campaignName: campaign.name,
      status: campaign.status,
      leads: campaign.leadsCount,
      pending: campaignJobs.filter((job) => job.status === "pending" || job.status === "in_progress").length,
      failed: campaignJobs.filter((job) => job.status === "failed").length,
      noResponse: campaignJobs.filter((job) => sentLike(job) && !job.firstOpenedAt && !job.firstClickedAt && !job.repliedAt && !job.bounceKind).length,
      ...perf,
    };
  }).sort((a, b) => b.sent - a.sent);

  const labelPerformance = labels.map((label) => {
    const leadIds = new Set(leadLabels.filter((row) => row.labelId === label.id).map((row) => row.leadId));
    const labelJobs = analyticsJobs.filter((job) => leadIds.has(job.leadId));
    return {
      labelId: label.id,
      labelName: label.name,
      color: label.color,
      leads: leadIds.size,
      campaigns: new Set(labelJobs.map((job) => job.campaignId)).size,
      ...performanceForJobs(labelJobs),
    };
  }).filter((row) => row.leads > 0 || row.sent > 0).sort((a, b) => b.sent - a.sent || b.replyRate - a.replyRate);

  function localDateParts(value: Date | null | undefined): { hour: number; day: string } | null {
    if (!value) return null;
    const parts = new Intl.DateTimeFormat("en-AU", {
      timeZone: "Australia/Sydney",
      weekday: "short",
      hour: "2-digit",
      hour12: false,
    }).formatToParts(value);
    const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
    const day = parts.find((part) => part.type === "weekday")?.value ?? "";
    return Number.isFinite(hour) ? { hour, day } : null;
  }

  const timingGroups = new Map<string, typeof jobs>();
  for (const job of analyticsJobs.filter(sentLike)) {
    const parts = localDateParts(job.sentAt ?? job.scheduledAt);
    if (!parts) continue;
    for (const key of [`hour:${parts.hour}`, `day:${parts.day}`]) {
      const list = timingGroups.get(key) ?? [];
      list.push(job);
      timingGroups.set(key, list);
    }
  }
  const sendHourPerformance = Array.from({ length: 24 }, (_, hour) => {
    const hourJobs = timingGroups.get(`hour:${hour}`) ?? [];
    return {
      hour,
      label: `${String(hour).padStart(2, "0")}:00`,
      ...performanceForJobs(hourJobs),
    };
  }).filter((row) => row.sent > 0).sort((a, b) => b.replyRate - a.replyRate || b.sent - a.sent);
  const sendDayPerformance = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => {
    const dayJobs = timingGroups.get(`day:${day}`) ?? [];
    return {
      day,
      ...performanceForJobs(dayJobs),
    };
  }).filter((row) => row.sent > 0).sort((a, b) => b.replyRate - a.replyRate || b.sent - a.sent);

  const linkGroups = new Map<string, typeof analyticsClickEvents>();
  for (const click of analyticsClickEvents) {
    const list = linkGroups.get(click.url) ?? [];
    list.push(click);
    linkGroups.set(click.url, list);
  }
  const linkPerformance = Array.from(linkGroups.entries()).map(([url, clicks]) => {
    const uniqueLeadIds = new Set(clicks.map((click) => click.leadId));
    const clickedJobs = analyticsJobs.filter((job) => uniqueLeadIds.has(job.leadId));
    const repliedLeads = new Set(clickedJobs.filter((job) => !!job.repliedAt).map((job) => job.leadId));
    const campaignNames = Array.from(new Set(clicks.map((click) => campaignsById.get(click.campaignId)?.name).filter(Boolean))).slice(0, 3);
    return {
      url,
      totalClicks: clicks.length,
      uniqueLeads: uniqueLeadIds.size,
      repliedLeads: repliedLeads.size,
      clickToReplyRate: rate(repliedLeads.size, uniqueLeadIds.size),
      lastClickedAt: toIso(clicks.sort((a, b) => b.clickedAt.getTime() - a.clickedAt.getTime())[0]?.clickedAt),
      campaigns: campaignNames,
    };
  }).sort((a, b) => b.totalClicks - a.totalClicks || b.clickToReplyRate - a.clickToReplyRate);

  const deliverability = accounts.map((account) => {
    const accountJobs = analyticsJobs.filter((job) => job.accountId === account.id);
    const perf = performanceForJobs(accountJobs);
    const limit = effectiveDailyLimit(account);
    const used = account.sentToday ?? 0;
    const score = account.healthScore ?? Math.max(0, 100 - (perf.bounceRate * 4) - (account.lastError ? 20 : 0) - (used >= limit ? 10 : 0));
    return {
      accountId: account.id,
      email: account.email,
      status: account.status,
      warmupEnabled: Boolean(account.warmupEnabled),
      warmupDay: account.warmupEnabled || account.status === "warming" ? warmupDay(account.createdAt) : null,
      sentToday: used,
      dailySendLimit: account.dailySendLimit,
      effectiveDailyLimit: limit,
      remainingToday: Math.max(0, limit - used),
      healthScore: Math.round(score),
      risk: account.lastError ? "attention" : perf.bounceRate >= 5 ? "high_bounce_rate" : used >= limit ? "limit_reached" : "healthy",
      lastError: account.lastError,
      ...perf,
    };
  }).sort((a, b) => a.healthScore - b.healthScore);

  const throttling = jobs
    .filter((job) => job.status === "pending" && job.errorMessage)
    .map((job) => {
      const account = accountsById.get(job.accountId);
      const campaign = campaignsById.get(job.campaignId);
      const lead = leadsById.get(job.leadId);
      return {
        jobId: job.id,
        campaignId: job.campaignId,
        campaignName: campaign?.name ?? `Campaign #${job.campaignId}`,
        leadId: job.leadId,
        leadEmail: lead?.email ?? "",
        accountEmail: account?.email ?? null,
        reason: job.errorMessage,
        scheduledAt: toIso(job.scheduledAt),
      };
    })
    .slice(0, 100);

  const leadRows = Array.from(uniqueLeadJobs.values()).map((job) => ({
    job,
    lead: leadsById.get(job.leadId),
    campaign: campaignsById.get(job.campaignId),
    replies: repliesByLeadCampaign.get(`${job.leadId}:${job.campaignId}`) ?? [],
  })).filter((row): row is typeof row & { lead: NonNullable<typeof row.lead>; campaign: NonNullable<typeof row.campaign> } => !!row.lead && !!row.campaign);

  const makeSegment = (id: string, name: string, rows: typeof leadRows, description: string) => ({
    id,
    name,
    description,
    count: rows.length,
    leads: rows.slice(0, 50).map(({ job, lead, campaign, replies: rowReplies }) => ({
      leadId: lead.id,
      email: lead.email,
      name: leadName(lead),
      company: lead.company,
      campaignId: campaign.id,
      campaignName: campaign.name,
      lastActivityAt: toIso(rowReplies[0]?.receivedAt ?? job.firstClickedAt ?? job.firstOpenedAt ?? job.sentAt ?? job.scheduledAt),
    })),
  });

  const clickedNoReply = leadRows.filter(({ job, replies: rowReplies }) => !!job.firstClickedAt && rowReplies.length === 0 && !job.repliedAt);
  const openedNoReply = leadRows.filter(({ job, replies: rowReplies }) => (!!job.firstOpenedAt || !!job.firstClickedAt) && rowReplies.length === 0 && !job.repliedAt);
  const positiveReplies = leadRows.filter(({ replies: rowReplies }) => rowReplies.some((reply) => ["interested", "referral"].includes(classifyReply(reply).category)));
  const noActivity = leadRows.filter(({ job, replies: rowReplies }) => !job.firstOpenedAt && !job.firstClickedAt && !job.repliedAt && rowReplies.length === 0 && daysSince(job.sentAt ?? job.scheduledAt) >= 3);
  const bounced = leadRows.filter(({ job, lead }) => !!job.bounceKind || lead.status === "bounced");
  const unsubscribed = leadRows.filter(({ lead }) => lead.status === "unsubscribed");

  const segments = [
    makeSegment("clicked_no_reply", "Clicked but not replied", clickedNoReply, "Leads showing intent through a click with no reply yet."),
    makeSegment("opened_no_reply", "Opened but not replied", openedNoReply, "Leads that opened or clicked without replying."),
    makeSegment("positive_replies", "Positive replies", positiveReplies, "Replies classified as interested or referral."),
    makeSegment("no_activity_3_days", "No activity after 3 days", noActivity, "Sent leads with no open, click, reply, or bounce after 3 days."),
    makeSegment("bounced", "Bounced", bounced, "Leads with hard or soft bounce activity."),
    makeSegment("unsubscribed", "Unsubscribed", unsubscribed, "Leads marked as unsubscribed."),
  ];

  const sentJobs = analyticsJobs.filter(sentLike);
  const uniqueSentLeads = new Set(sentJobs.map((job) => job.leadId));
  const overview = {
    totalSent: sentJobs.length,
    activeCampaigns: campaigns.filter((campaign) => campaign.status === "active").length,
    warmupAccounts: accounts.filter((account) => account.warmupEnabled || account.status === "warming").length,
    followUpCandidates: followUpCandidates.length,
    templateMatches: templatePerformance.filter((template) => template.matchedSteps > 0).length,
    throttledJobs: throttling.length,
    uniqueSentLeads: uniqueSentLeads.size,
    openRate: rate(sentJobs.filter((job) => job.openCount > 0 || job.firstOpenedAt).length, sentJobs.length),
    clickRate: rate(sentJobs.filter((job) => job.clickCount > 0 || job.firstClickedAt).length, sentJobs.length),
    replyRate: rate(sentJobs.filter((job) => job.repliedAt).length, sentJobs.length),
    bounceRate: rate(sentJobs.filter((job) => job.bounceKind).length, sentJobs.length),
  };

  res.json({
    overview,
    queueSummary: {
      queuedCount: queuedJobs.length,
      clearsAt: toIso(queueClearsAt),
      nextBatchCount: nextBatchJobs.length,
      nextBatchAt: toIso(nextBatchAt),
      currentBatchClearsAt: toIso(currentBatchClearsAt),
      futureQueuedCount: Math.max(0, queuedJobs.length - nextBatchJobs.length),
      readyForMoreAt: toIso(readyForMore.readyAt),
      capacityPerSlot: readyForMore.capacityPerSlot,
      dailyCapacity: readyForMore.dailyCapacity,
      capacityIntervalMinutes: readyForMore.capacityIntervalMinutes,
      capacitySlotMinutes: readyForMore.capacitySlotMinutes,
    },
    sendCalendar,
    campaignRunway,
    timeline: timelineEvents,
    replyClassifications,
    followUpCandidates: followUpCandidates.slice(0, 100),
    deliverability,
    campaignFunnels,
    labelPerformance,
    sendHourPerformance,
    sendDayPerformance,
    linkPerformance,
    abPerformance,
    templatePerformance,
    throttling,
    segments,
    enrollmentSummary: {
      totalEnrollments: enrollments.length,
      campaignsWithLeads: new Set(enrollments.map((row) => row.campaignId)).size,
    },
  });
});

router.get("/growth/segments/:id/leads", async (req, res): Promise<void> => {
  const segmentId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (!segmentId) {
    res.status(400).json({ error: "Missing segment id" });
    return;
  }

  const jobs = await db.select().from(emailSendJobsTable);
  const relevantLeadIds = Array.from(new Set(jobs.map((job) => job.leadId)));
  if (relevantLeadIds.length === 0) {
    res.json([]);
    return;
  }

  const leads = (await db.select().from(leadsTable).where(inArray(leadsTable.id, relevantLeadIds)))
    .filter((lead) => !isExcludedAnalyticsEmail(lead.email));
  const allowedLeadIds = new Set(leads.map((lead) => lead.id));
  const analyticsJobs = jobs.filter((job) => allowedLeadIds.has(job.leadId));
  const replies = (await db.select().from(inboxMessagesTable))
    .filter((reply) => !reply.leadId || allowedLeadIds.has(reply.leadId));
  const repliesByLead = new Map<number, typeof replies>();
  for (const reply of replies) {
    if (!reply.leadId) continue;
    const list = repliesByLead.get(reply.leadId) ?? [];
    list.push(reply);
    repliesByLead.set(reply.leadId, list);
  }

  const matched = leads.filter((lead) => {
    const leadJobs = analyticsJobs.filter((job) => job.leadId === lead.id && sentLike(job));
    const leadReplies = repliesByLead.get(lead.id) ?? [];
    if (segmentId === "clicked_no_reply") return leadJobs.some((job) => !!job.firstClickedAt && !job.repliedAt) && leadReplies.length === 0;
    if (segmentId === "opened_no_reply") return leadJobs.some((job) => (!!job.firstOpenedAt || !!job.firstClickedAt) && !job.repliedAt) && leadReplies.length === 0;
    if (segmentId === "positive_replies") return leadReplies.some((reply) => ["interested", "referral"].includes(classifyReply(reply).category));
    if (segmentId === "no_activity_3_days") return leadJobs.some((job) => !job.firstOpenedAt && !job.firstClickedAt && !job.repliedAt && daysSince(job.sentAt ?? job.scheduledAt) >= 3) && leadReplies.length === 0;
    if (segmentId === "bounced") return lead.status === "bounced" || leadJobs.some((job) => !!job.bounceKind);
    if (segmentId === "unsubscribed") return lead.status === "unsubscribed";
    return false;
  });

  res.json(matched);
});

export default router;
