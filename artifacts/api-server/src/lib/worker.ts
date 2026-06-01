import { and, eq, gte, lte, sql, inArray, asc, desc } from "drizzle-orm";
import {
  db,
  emailSendJobsTable,
  emailAccountsTable,
  leadsTable,
  leadLabelsTable,
  sequenceStepsTable,
  sequenceStepVariantsTable,
  campaignsTable,
  dailyStatsTable,
  unsubscribesTable,
  type EmailSendJob,
} from "@workspace/db";
import { classifyBounce, sendEmail, renderMergeFields, generateTrackingToken, getPublicBaseUrl, buildMessageId } from "./mailer";
import { logger } from "./logger";
import { getSendableAccounts } from "./account-rotation";
import { effectiveWarmupLimit } from "./warmup";
import { isInsideSendWindow, nextSendWindowAt } from "./sending-window";
import { customFieldsForLead } from "./contact-import";

const POLL_INTERVAL_MS = 10_000;
const BATCH_SIZE = 5;
const STALE_CLAIM_MS = 5 * 60 * 1000;

function envInt(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const ACCOUNT_CAMPAIGN_COOLDOWN_MS = envInt("ACCOUNT_CAMPAIGN_COOLDOWN_MINUTES", 180) * 60 * 1000;
const ACCOUNT_CAMPAIGN_COOLDOWN_JITTER_MS = envInt("ACCOUNT_CAMPAIGN_COOLDOWN_JITTER_MINUTES", 30) * 60 * 1000;
const ACCOUNT_CAMPAIGN_DAILY_LIMIT = envInt("ACCOUNT_CAMPAIGN_DAILY_LIMIT", 5);

let running = false;
let timer: NodeJS.Timeout | null = null;

async function claimJobs(now: Date): Promise<EmailSendJob[]> {
  return db.transaction((tx) => {
    const candidates = tx
      .select({ id: emailSendJobsTable.id })
      .from(emailSendJobsTable)
      .where(and(eq(emailSendJobsTable.status, "pending"), lte(emailSendJobsTable.scheduledAt, now)))
      .orderBy(asc(emailSendJobsTable.scheduledAt))
      .limit(BATCH_SIZE)
      .all();

    if (candidates.length === 0) return [];
    const ids = candidates.map((c: { id: number }) => c.id);
    const claimed = tx
      .update(emailSendJobsTable)
      .set({ status: "in_progress", attempts: sql`${emailSendJobsTable.attempts} + 1` })
      .where(inArray(emailSendJobsTable.id, ids))
      .returning()
      .all();
    return claimed;
  });
}

async function reclaimStale(now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - STALE_CLAIM_MS);
  await db
    .update(emailSendJobsTable)
    .set({ status: "pending" })
    .where(and(eq(emailSendJobsTable.status, "in_progress"), lte(emailSendJobsTable.scheduledAt, cutoff)));
}

function todayKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function startOfToday(now: Date): Date {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return start;
}

function nextSendDay(now: Date): Date {
  const next = new Date(now);
  next.setHours(24, 1, 0, 0);
  return next;
}

function effectiveAccountLimit(account: typeof emailAccountsTable.$inferSelect, now: Date): number {
  const configured = Math.max(1, account.dailySendLimit || 1);
  if (!account.warmupEnabled && account.status !== "warming") return configured;
  return effectiveWarmupLimit(configured, account.createdAt, now);
}

async function getCampaignSentToday(campaignId: number, now: Date): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(emailSendJobsTable)
    .where(and(
      eq(emailSendJobsTable.campaignId, campaignId),
      eq(emailSendJobsTable.status, "sent"),
      gte(emailSendJobsTable.sentAt, startOfToday(now)),
    ));
  return Number(row?.count ?? 0);
}

async function deferJob(job: EmailSendJob, scheduledAt: Date, reason: string): Promise<void> {
  await db
    .update(emailSendJobsTable)
    .set({ status: "pending", scheduledAt, errorMessage: reason })
    .where(eq(emailSendJobsTable.id, job.id));
}

async function currentAccountSentToday(account: typeof emailAccountsTable.$inferSelect, now: Date): Promise<number> {
  const currentDay = todayKey(now);
  if (account.sentTodayDate === currentDay) return account.sentToday;
  await db
    .update(emailAccountsTable)
    .set({ sentToday: 0, sentTodayDate: currentDay })
    .where(eq(emailAccountsTable.id, account.id));
  return 0;
}

async function accountHasCapacity(account: typeof emailAccountsTable.$inferSelect, now: Date): Promise<boolean> {
  const sentToday = await currentAccountSentToday(account, now);
  return sentToday < effectiveAccountLimit(account, now);
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

async function getAccountCampaignPacing(
  accountId: number,
  campaignId: number,
  now: Date,
): Promise<{ eligible: boolean; nextAt: Date | null; reason: string | null }> {
  const [sentToday] = await db
    .select({ count: sql<number>`count(*)` })
    .from(emailSendJobsTable)
    .where(and(
      eq(emailSendJobsTable.accountId, accountId),
      eq(emailSendJobsTable.campaignId, campaignId),
      eq(emailSendJobsTable.status, "sent"),
      gte(emailSendJobsTable.sentAt, startOfToday(now)),
    ));
  const sentCount = Number(sentToday?.count ?? 0);
  if (sentCount >= ACCOUNT_CAMPAIGN_DAILY_LIMIT) {
    return {
      eligible: false,
      nextAt: nextSendDay(now),
      reason: `Account already sent ${ACCOUNT_CAMPAIGN_DAILY_LIMIT} emails for this campaign today`,
    };
  }

  const [lastSent] = await db
    .select({ sentAt: emailSendJobsTable.sentAt })
    .from(emailSendJobsTable)
    .where(and(
      eq(emailSendJobsTable.accountId, accountId),
      eq(emailSendJobsTable.campaignId, campaignId),
      eq(emailSendJobsTable.status, "sent"),
    ))
    .orderBy(desc(emailSendJobsTable.sentAt))
    .limit(1);
  if (!lastSent?.sentAt) {
    return { eligible: true, nextAt: null, reason: null };
  }

  const nextAt = new Date(
    lastSent.sentAt.getTime()
    + ACCOUNT_CAMPAIGN_COOLDOWN_MS
    + stableJitterMs(accountId, campaignId, lastSent.sentAt),
  );
  if (nextAt > now) {
    return {
      eligible: false,
      nextAt,
      reason: `Account/campaign cooldown active until ${nextAt.toISOString()}`,
    };
  }

  return { eligible: true, nextAt: null, reason: null };
}

async function replacementAccount(currentAccountId: number | null, now: Date): Promise<typeof emailAccountsTable.$inferSelect | null> {
  const accounts = await getSendableAccounts(currentAccountId ?? undefined);
  for (const account of accounts) {
    if (await accountHasCapacity(account, now)) return account;
  }
  return null;
}

async function eligibleAccountForCampaign(
  preferredAccount: typeof emailAccountsTable.$inferSelect,
  campaignId: number,
  now: Date,
): Promise<{ account: typeof emailAccountsTable.$inferSelect | null; nextAt: Date; reason: string }> {
  const allAccounts = await getSendableAccounts();
  const ordered = [
    preferredAccount,
    ...allAccounts.filter((account) => account.id !== preferredAccount.id),
  ];
  let nextAt: Date | null = null;
  let reason = "No account currently satisfies campaign rotation rules";

  for (const account of ordered) {
    if (!(await accountHasCapacity(account, now))) {
      const fallback = nextSendDay(now);
      if (!nextAt || fallback < nextAt) nextAt = fallback;
      reason = `Account ${account.email} reached daily or warmup limit`;
      continue;
    }

    const pacing = await getAccountCampaignPacing(account.id, campaignId, now);
    if (pacing.eligible) return { account, nextAt: now, reason: "" };
    if (pacing.nextAt && (!nextAt || pacing.nextAt < nextAt)) nextAt = pacing.nextAt;
    if (pacing.reason) reason = pacing.reason;
  }

  return { account: null, nextAt: nextAt ?? new Date(now.getTime() + 30 * 60 * 1000), reason };
}

async function contentForLeadStep(
  step: typeof sequenceStepsTable.$inferSelect,
  leadId: number,
): Promise<{
  subject: string;
  previewText: string | null;
  body: string;
  bodyType: string;
  attachmentsJson: string | null;
  variantId: number | null;
  variantName: string | null;
}> {
  const variants = await db
    .select({ variant: sequenceStepVariantsTable })
    .from(sequenceStepVariantsTable)
    .innerJoin(leadLabelsTable, eq(sequenceStepVariantsTable.labelId, leadLabelsTable.labelId))
    .where(and(
      eq(sequenceStepVariantsTable.stepId, step.id),
      eq(leadLabelsTable.leadId, leadId),
    ))
    .orderBy(desc(sequenceStepVariantsTable.priority), asc(sequenceStepVariantsTable.id))
    .limit(1);

  const variant = variants[0]?.variant;
  if (!variant) {
    return {
      subject: step.subject,
      previewText: step.previewText ?? null,
      body: step.body,
      bodyType: step.bodyType,
      attachmentsJson: step.attachmentsJson ?? null,
      variantId: null,
      variantName: null,
    };
  }

  return {
    subject: variant.subject,
    previewText: variant.previewText ?? null,
    body: variant.body,
    bodyType: variant.bodyType,
    attachmentsJson: variant.attachmentsJson ?? null,
    variantId: variant.id,
    variantName: variant.name,
  };
}

async function processOnce(): Promise<void> {
  const now = new Date();
  await reclaimStale(now);
  const jobs = await claimJobs(now);
  if (jobs.length === 0) return;

  for (const job of jobs) {
    try {
      const [campaign] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, job.campaignId));
      if (!campaign || campaign.status !== "active") {
        await db
          .update(emailSendJobsTable)
          .set({ status: "skipped", errorMessage: `Campaign not active (status: ${campaign?.status ?? "missing"})` })
          .where(eq(emailSendJobsTable.id, job.id));
        continue;
      }

      if (!isInsideSendWindow(now, campaign)) {
        await deferJob(job, nextSendWindowAt(now, campaign), "Outside campaign send window");
        continue;
      }

      let [account] = await db.select().from(emailAccountsTable).where(eq(emailAccountsTable.id, job.accountId));
      const [lead] = await db.select().from(leadsTable).where(eq(leadsTable.id, job.leadId));
      const [step] = await db.select().from(sequenceStepsTable).where(eq(sequenceStepsTable.id, job.stepId));

      if (!lead || !step) {
        await db
          .update(emailSendJobsTable)
          .set({ status: "skipped", errorMessage: "Missing lead or step" })
          .where(eq(emailSendJobsTable.id, job.id));
        continue;
      }

      if (!account || account.status !== "connected" && account.status !== "warming" || !account.smtpPasswordEnc) {
        const replacement = await replacementAccount(account?.id ?? null, now);
        if (!replacement) {
          await deferJob(
            job,
            new Date(now.getTime() + 30 * 60 * 1000),
            !account ? "Assigned account no longer exists and no replacement account is available"
              : !account.smtpPasswordEnc ? "Account is missing SMTP credentials and no replacement account is available"
                : `Account not sendable (status: ${account.status}) and no replacement account is available`,
          );
          continue;
        }
        account = replacement;
        await db
          .update(emailSendJobsTable)
          .set({ accountId: account.id, errorMessage: null })
          .where(eq(emailSendJobsTable.id, job.id));
      }

      if (campaign.dailyLimit) {
        const campaignSentToday = await getCampaignSentToday(campaign.id, now);
        if (campaignSentToday >= campaign.dailyLimit) {
          await deferJob(job, nextSendDay(now), `Campaign daily limit reached (${campaign.dailyLimit})`);
          continue;
        }
      }

      const currentDay = todayKey(now);
      let accountSentToday = await currentAccountSentToday(account, now);
      const accountLimit = effectiveAccountLimit(account, now);
      if (accountSentToday >= accountLimit) {
        const replacement = await replacementAccount(account.id, now);
        if (!replacement) {
          await deferJob(job, nextSendDay(now), `All sendable accounts reached daily or warmup limits`);
          continue;
        }
        account = replacement;
        await db
          .update(emailSendJobsTable)
          .set({ accountId: account.id, errorMessage: null })
          .where(eq(emailSendJobsTable.id, job.id));
      }

      const campaignAccountSlot = await eligibleAccountForCampaign(account, campaign.id, now);
      if (!campaignAccountSlot.account) {
        await deferJob(job, campaignAccountSlot.nextAt, campaignAccountSlot.reason);
        continue;
      }
      if (campaignAccountSlot.account.id !== account.id) {
        account = campaignAccountSlot.account;
        await db
          .update(emailSendJobsTable)
          .set({ accountId: account.id, scheduledAt: now, errorMessage: null })
          .where(eq(emailSendJobsTable.id, job.id));
      }

      if (lead.status !== "active") {
        await db
          .update(emailSendJobsTable)
          .set({ status: "skipped", errorMessage: `Lead status is ${lead.status}` })
          .where(eq(emailSendJobsTable.id, job.id));
        continue;
      }

      const customFields = customFieldsForLead(lead);
      const vars = {
        firstName: lead.firstName ?? "",
        lastName: lead.lastName ?? "",
        company: lead.company ?? "",
        title: lead.title ?? "",
        role_title: lead.roleTitle ?? "",
        roleTitle: lead.roleTitle ?? "",
        email: lead.email,
        linkedinUrl: lead.linkedinUrl ?? "",
        customFields,
        ...customFields,
      };
      const stepContent = await contentForLeadStep(step, lead.id);
      const isHtmlBody = stepContent.bodyType === "html";
      const subject = renderMergeFields(stepContent.subject, vars);
      const body = renderMergeFields(stepContent.body, vars, { htmlEscape: isHtmlBody });
      const previewText = stepContent.previewText ? renderMergeFields(stepContent.previewText, vars) : null;

      const publicBaseUrl = getPublicBaseUrl();
      const trackingToken = campaign.trackOpens || campaign.trackClicks ? (job.trackingToken ?? generateTrackingToken()) : null;

      let unsubscribeToken: string | null = null;
      if (campaign.includeUnsubscribe) {
        const existing = await db
          .select()
          .from(unsubscribesTable)
          .where(and(eq(unsubscribesTable.leadId, lead.id), eq(unsubscribesTable.campaignId, campaign.id)))
          .limit(1);
        if (existing.length > 0 && existing[0]) {
          unsubscribeToken = existing[0].token;
        } else {
          const token = generateTrackingToken();
          const [inserted] = await db
            .insert(unsubscribesTable)
            .values({ leadId: lead.id, campaignId: campaign.id, token })
            .returning();
          unsubscribeToken = inserted?.token ?? token;
        }
      }

      const outboundMessageId = buildMessageId(account);

      const { messageId } = await sendEmail(account, {
        to: lead.email,
        toName: [lead.firstName, lead.lastName].filter(Boolean).join(" ") || null,
        fromName: campaign.fromName,
        replyTo: campaign.replyTo,
        subject,
        previewText,
        body,
        bodyType: stepContent.bodyType,
        attachmentsJson: stepContent.attachmentsJson,
        trackingToken: trackingToken ?? undefined,
        unsubscribeToken: unsubscribeToken ?? undefined,
        publicBaseUrl,
        messageId: outboundMessageId,
        trackClicks: campaign.trackClicks,
      });

      await db
        .update(emailSendJobsTable)
        .set({
          status: "sent",
          sentAt: new Date(),
          messageId,
          trackingToken: trackingToken ?? undefined,
          unsubscribeToken: unsubscribeToken ?? undefined,
        })
        .where(eq(emailSendJobsTable.id, job.id));

      await db
        .update(campaignsTable)
        .set({ sentCount: sql`${campaignsTable.sentCount} + 1` })
        .where(eq(campaignsTable.id, job.campaignId));

      await db
        .update(emailAccountsTable)
        .set({
          sentToday: sql`${emailAccountsTable.sentToday} + 1`,
          sentTodayDate: currentDay,
          status: account.warmupEnabled || account.status === "warming" ? "warming" : "connected",
          lastError: null,
        })
        .where(eq(emailAccountsTable.id, account.id));

      const today = new Date().toISOString().slice(0, 10);
      const [existing] = await db.select().from(dailyStatsTable).where(eq(dailyStatsTable.date, today));
      if (existing) {
        await db
          .update(dailyStatsTable)
          .set({ sent: sql`${dailyStatsTable.sent} + 1` })
          .where(eq(dailyStatsTable.date, today));
      } else {
        await db.insert(dailyStatsTable).values({ date: today, sent: 1 }).onConflictDoNothing();
      }

      logger.info({ jobId: job.id, to: lead.email, campaignId: job.campaignId, variantId: stepContent.variantId, variantName: stepContent.variantName }, "Sent campaign email");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const bounceKind = classifyBounce(err);
      logger.error({ jobId: job.id, err: message }, "Failed to send campaign email");
      await db
        .update(emailSendJobsTable)
        .set({ status: "failed", errorMessage: message, bounceKind: bounceKind ?? undefined })
        .where(eq(emailSendJobsTable.id, job.id));
      if (bounceKind) {
        await db.update(campaignsTable).set({ bounceCount: sql`${campaignsTable.bounceCount} + 1` }).where(eq(campaignsTable.id, job.campaignId));
        await db.update(leadsTable).set({ status: "bounced" }).where(eq(leadsTable.id, job.leadId));
      }
      await db
        .update(emailAccountsTable)
        .set({ status: "error", lastError: message })
        .where(eq(emailAccountsTable.id, job.accountId));
    }
  }
}

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    await processOnce();
  } catch (err) {
    logger.error({ err }, "Worker tick failed");
  } finally {
    running = false;
  }
}

export function startSendWorker(): void {
  if (timer) return;
  logger.info({ intervalMs: POLL_INTERVAL_MS }, "Starting email send worker");
  timer = setInterval(() => {
    void tick();
  }, POLL_INTERVAL_MS);
  void tick();
}
