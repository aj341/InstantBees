import { Router, type IRouter } from "express";
import { eq, sql, and, asc, desc } from "drizzle-orm";
import { db, campaignsTable, campaignLeadsTable, sequenceStepsTable, sequenceStepVariantsTable, dailyStatsTable, leadsTable, emailAccountsTable, emailSendJobsTable, unsubscribesTable, inboxMessagesTable, clickEventsTable } from "@workspace/db";
import {
  CreateCampaignBody,
  UpdateCampaignBody,
  GetCampaignParams,
  UpdateCampaignParams,
  DeleteCampaignParams,
  LaunchCampaignParams,
  PauseCampaignParams,
  GetCampaignAnalyticsParams,
} from "@workspace/api-zod";
import { getCampaignMetrics, getGlobalMetrics, rate } from "../lib/stats";
import { getSendableAccounts } from "../lib/account-rotation";
import { nextSendWindowAt } from "../lib/sending-window";

const router: IRouter = Router();

const DAY_MS = 24 * 60 * 60 * 1000;

function clampPositiveInt(value: unknown, fallback: number, max = 10_000): number {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.min(Math.max(1, Math.floor(numberValue)), max);
}

function campaignBatchSettings(campaign: Pick<typeof campaignsTable.$inferSelect, "batchSize" | "batchIntervalMinutes">): { batchSize: number; batchIntervalMs: number } {
  return {
    batchSize: clampPositiveInt(campaign.batchSize, 25),
    batchIntervalMs: clampPositiveInt(campaign.batchIntervalMinutes, 60, 24 * 60) * 60 * 1000,
  };
}

type CampaignScheduleSettings = Pick<
  typeof campaignsTable.$inferSelect,
  "batchSize" | "batchIntervalMinutes" | "sendWindowStart" | "sendWindowEnd" | "sendWindowTimezone" | "sendWindowDays"
>;

function firstScheduledTimeForLead(
  baseTime: number,
  leadIndex: number,
  campaign: CampaignScheduleSettings,
): Date {
  const { batchSize, batchIntervalMs } = campaignBatchSettings(campaign);
  const batchIndex = Math.floor(leadIndex / batchSize);
  return nextSendWindowAt(new Date(baseTime + batchIndex * batchIntervalMs), campaign);
}

function followUpScheduledTime(previousStepAt: Date, delayDays: number, campaign: CampaignScheduleSettings): Date {
  return nextSendWindowAt(new Date(previousStepAt.getTime() + delayDays * DAY_MS), campaign);
}

function scheduledTimesForLead(
  baseTime: number,
  leadIndex: number,
  steps: Array<typeof sequenceStepsTable.$inferSelect>,
  campaign: CampaignScheduleSettings,
): Map<number, Date> {
  const scheduledByStepId = new Map<number, Date>();
  let previousStepAt: Date | null = null;
  for (const [stepIndex, step] of steps.entries()) {
    const scheduledAt: Date = stepIndex === 0
      ? firstScheduledTimeForLead(baseTime, leadIndex, campaign)
      : followUpScheduledTime(previousStepAt!, step.delayDays, campaign);
    scheduledByStepId.set(step.id, scheduledAt);
    previousStepAt = scheduledAt;
  }
  return scheduledByStepId;
}

router.get("/campaigns", async (_req, res): Promise<void> => {
  const campaigns = await db.select().from(campaignsTable).orderBy(campaignsTable.createdAt);
  const withMetrics = await Promise.all(campaigns.map(async (campaign) => ({
    ...campaign,
    ...(await getCampaignMetrics(campaign.id)),
  })));
  res.json(withMetrics);
});

router.get("/campaigns/stats", async (_req, res): Promise<void> => {
  const metrics = await getGlobalMetrics();
  res.json({
    totalCampaigns: metrics.totalCampaigns,
    activeCampaigns: metrics.activeCampaigns,
    totalLeads: metrics.totalLeads,
    totalSent: metrics.sentCount,
    avgOpenRate: rate(metrics.openCount, metrics.sentCount),
    avgReplyRate: rate(metrics.replyCount, metrics.sentCount),
    totalReplies: metrics.replyCount,
    totalBounces: metrics.bounceCount,
  });
});

router.post("/campaigns", async (req, res): Promise<void> => {
  const parsed = CreateCampaignBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { scheduledStartAt, ...rest } = parsed.data as typeof parsed.data & { scheduledStartAt?: string | null };
  const values = {
    ...rest,
    batchSize: clampPositiveInt(rest.batchSize, 25),
    batchIntervalMinutes: clampPositiveInt(rest.batchIntervalMinutes, 60, 24 * 60),
    ...(scheduledStartAt ? { scheduledStartAt: new Date(scheduledStartAt) } : {}),
  };
  const [campaign] = await db.insert(campaignsTable).values(values).returning();
  res.status(201).json(campaign);
});

router.get("/campaigns/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = GetCampaignParams.safeParse({ id: parseInt(raw, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [campaign] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, params.data.id));
  if (!campaign) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }
  res.json({ ...campaign, ...(await getCampaignMetrics(campaign.id)) });
});

router.patch("/campaigns/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = UpdateCampaignParams.safeParse({ id: parseInt(raw, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateCampaignBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { scheduledStartAt, ...rest } = parsed.data as typeof parsed.data & { scheduledStartAt?: string | null };
  const [existing] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, params.data.id));
  if (!existing) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }
  const updateValues = {
    ...rest,
    ...(rest.batchSize !== undefined ? { batchSize: clampPositiveInt(rest.batchSize, existing.batchSize) } : {}),
    ...(rest.batchIntervalMinutes !== undefined ? { batchIntervalMinutes: clampPositiveInt(rest.batchIntervalMinutes, existing.batchIntervalMinutes, 24 * 60) } : {}),
    ...(scheduledStartAt !== undefined
      ? { scheduledStartAt: scheduledStartAt === null ? null : new Date(scheduledStartAt) }
      : {}),
  };
  const [campaign] = await db.update(campaignsTable).set(updateValues).where(eq(campaignsTable.id, params.data.id)).returning();

  if (
    scheduledStartAt !== undefined
    || rest.batchSize !== undefined
    || rest.batchIntervalMinutes !== undefined
    || rest.sendWindowStart !== undefined
    || rest.sendWindowEnd !== undefined
    || rest.sendWindowTimezone !== undefined
    || rest.sendWindowDays !== undefined
  ) {
    const baseTime = scheduledStartAt === null
      ? Date.now()
      : scheduledStartAt !== undefined
        ? new Date(scheduledStartAt).getTime()
        : (existing.scheduledStartAt?.getTime() ?? Date.now());
    if (Number.isFinite(baseTime)) {
      const steps = await db
        .select()
        .from(sequenceStepsTable)
        .where(eq(sequenceStepsTable.campaignId, params.data.id))
        .orderBy(asc(sequenceStepsTable.stepNumber));
      const campaignForScheduling = campaign ?? existing;
      const activeLeads = await db
        .select({ leadId: campaignLeadsTable.leadId })
        .from(campaignLeadsTable)
        .where(eq(campaignLeadsTable.campaignId, params.data.id));
      const leadIndexById = new Map(activeLeads.map((lead, index) => [lead.leadId, index]));
      const campaignJobs = await db
        .select()
        .from(emailSendJobsTable)
        .where(eq(emailSendJobsTable.campaignId, params.data.id));
      const jobsByLeadStep = new Map(campaignJobs.map((job) => [`${job.leadId}:${job.stepId}`, job]));

      for (const [leadId, leadIndex] of leadIndexById.entries()) {
        let previousStepAt: Date | null = null;
        for (const [stepIndex, step] of steps.entries()) {
          const desiredScheduledAt: Date = stepIndex === 0
            ? firstScheduledTimeForLead(baseTime, leadIndex, campaignForScheduling)
            : followUpScheduledTime(previousStepAt!, step.delayDays, campaignForScheduling);
          const job = jobsByLeadStep.get(`${leadId}:${step.id}`);
          if (job?.status === "pending" || job?.status === "in_progress") {
            await db
              .update(emailSendJobsTable)
              .set({ scheduledAt: desiredScheduledAt })
              .where(eq(emailSendJobsTable.id, job.id));
          }
          previousStepAt = job?.status === "sent" && job.sentAt ? job.sentAt : desiredScheduledAt;
        }
      }
    }
  }
  res.json(campaign);
});

router.delete("/campaigns/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = DeleteCampaignParams.safeParse({ id: parseInt(raw, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const cid = params.data.id;
  // Cascade — these tables don't have FK constraints declared in Drizzle, so we clean up by hand.
  // Wrap in a transaction so concurrent worker activity can't leave orphans.
  const campaign = db.transaction((tx) => {
    tx.delete(emailSendJobsTable).where(eq(emailSendJobsTable.campaignId, cid)).run();
    const steps = tx.select({ id: sequenceStepsTable.id }).from(sequenceStepsTable).where(eq(sequenceStepsTable.campaignId, cid)).all();
    for (const step of steps) {
      tx.delete(sequenceStepVariantsTable).where(eq(sequenceStepVariantsTable.stepId, step.id)).run();
    }
    tx.delete(sequenceStepsTable).where(eq(sequenceStepsTable.campaignId, cid)).run();
    tx.delete(campaignLeadsTable).where(eq(campaignLeadsTable.campaignId, cid)).run();
    tx.delete(unsubscribesTable).where(eq(unsubscribesTable.campaignId, cid)).run();
    tx.delete(inboxMessagesTable).where(eq(inboxMessagesTable.campaignId, cid)).run();
    const [row] = tx.delete(campaignsTable).where(eq(campaignsTable.id, cid)).returning().all();
    return row;
  });
  if (!campaign) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }
  res.sendStatus(204);
});

router.post("/campaigns/:id/launch", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = LaunchCampaignParams.safeParse({ id: parseInt(raw, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const id = params.data.id;

  const [existing] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }

  const steps = await db
    .select()
    .from(sequenceStepsTable)
    .where(eq(sequenceStepsTable.campaignId, id))
    .orderBy(asc(sequenceStepsTable.stepNumber));
  if (steps.length === 0) {
    res.status(400).json({ error: "Add at least one sequence step before launching" });
    return;
  }

  const leadRows = await db
    .select({ lead: leadsTable })
    .from(campaignLeadsTable)
    .innerJoin(leadsTable, eq(campaignLeadsTable.leadId, leadsTable.id))
    .where(eq(campaignLeadsTable.campaignId, id));
  const leads = leadRows.map((r) => r.lead).filter((l) => l.status === "active");
  if (leads.length === 0) {
    res.status(400).json({ error: "Add at least one active lead before launching" });
    return;
  }

  const sendable = await getSendableAccounts();
  if (sendable.length === 0) {
    res.status(400).json({ error: "Connect at least one email account with SMTP credentials before launching" });
    return;
  }

  const existingJobs = await db
    .select({ leadId: emailSendJobsTable.leadId, stepId: emailSendJobsTable.stepId, status: emailSendJobsTable.status })
    .from(emailSendJobsTable)
    .where(eq(emailSendJobsTable.campaignId, id));
  const existingKeys = new Set(
    existingJobs
      .filter((j) => j.status !== "failed" && j.status !== "skipped")
      .map((j) => `${j.leadId}:${j.stepId}`),
  );

  // If the campaign has a future scheduledStartAt, use that as the base time
  // for every queued job. The worker only sends jobs where scheduledAt <= now
  // AND campaign.status === "active", so jobs sit dormant until that moment.
  const wallNow = Date.now();
  const scheduledStart = existing.scheduledStartAt ? existing.scheduledStartAt.getTime() : 0;
  const now = scheduledStart > wallNow ? scheduledStart : wallNow;
  const jobs: Array<typeof emailSendJobsTable.$inferInsert> = [];
  let acctIdx = 0;
  for (const [leadIndex, lead] of leads.entries()) {
    const account = sendable[acctIdx % sendable.length]!;
    acctIdx++;
    const scheduledByStepId = scheduledTimesForLead(now, leadIndex, steps, existing);
    for (const step of steps) {
      const key = `${lead.id}:${step.id}`;
      if (existingKeys.has(key)) continue;
      jobs.push({
        campaignId: id,
        leadId: lead.id,
        stepId: step.id,
        accountId: account.id,
        scheduledAt: scheduledByStepId.get(step.id)!,
        status: "pending",
      });
    }
  }
  if (jobs.length > 0) {
    await db.insert(emailSendJobsTable).values(jobs);
  }

  const [campaign] = await db
    .update(campaignsTable)
    .set({ status: "active", leadsCount: leads.length })
    .where(eq(campaignsTable.id, id))
    .returning();
  res.json(campaign);
});

router.post("/campaigns/:id/pause", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = PauseCampaignParams.safeParse({ id: parseInt(raw, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [campaign] = await db.update(campaignsTable).set({ status: "paused" }).where(eq(campaignsTable.id, params.data.id)).returning();
  if (!campaign) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }
  res.json(campaign);
});

router.get("/campaigns/:id/link-clicks", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const cid = parseInt(raw, 10);
  if (!Number.isFinite(cid)) {
    res.status(400).json({ error: "Invalid campaign id" });
    return;
  }
  const rows = await db
    .select({
      url: clickEventsTable.url,
      totalClicks: sql<number>`count(*)`,
      uniqueClicks: sql<number>`count(distinct ${clickEventsTable.leadId})`,
      lastClickedAt: sql<number>`max(${clickEventsTable.clickedAt})`,
    })
    .from(clickEventsTable)
    .where(eq(clickEventsTable.campaignId, cid))
    .groupBy(clickEventsTable.url)
    .orderBy(sql`count(*) desc`);
  const clickDetails = await db
    .select({
      url: clickEventsTable.url,
      leadId: clickEventsTable.leadId,
      leadEmail: leadsTable.email,
      firstName: leadsTable.firstName,
      lastName: leadsTable.lastName,
      company: leadsTable.company,
      clickedAt: clickEventsTable.clickedAt,
    })
    .from(clickEventsTable)
    .leftJoin(leadsTable, eq(clickEventsTable.leadId, leadsTable.id))
    .where(eq(clickEventsTable.campaignId, cid))
    .orderBy(desc(clickEventsTable.clickedAt));
  const clicksByUrl = new Map<string, typeof clickDetails>();
  for (const click of clickDetails) {
    const clicks = clicksByUrl.get(click.url) ?? [];
    clicks.push(click);
    clicksByUrl.set(click.url, clicks);
  }
  res.json(
    rows.map((r) => ({
      url: r.url,
      totalClicks: Number(r.totalClicks),
      uniqueClicks: Number(r.uniqueClicks),
      lastClickedAt: r.lastClickedAt ? new Date(Number(r.lastClickedAt)).toISOString() : null,
      clicks: (clicksByUrl.get(r.url) ?? []).map((click) => ({
        leadId: click.leadId,
        email: click.leadEmail,
        name: [click.firstName, click.lastName].filter(Boolean).join(" ") || null,
        company: click.company,
        clickedAt: click.clickedAt ? new Date(click.clickedAt).toISOString() : null,
      })),
    })),
  );
});

router.get("/campaigns/:id/opens", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const cid = parseInt(raw, 10);
  if (!Number.isFinite(cid)) {
    res.status(400).json({ error: "Invalid campaign id" });
    return;
  }

  const rows = await db
    .select({
      leadId: emailSendJobsTable.leadId,
      email: leadsTable.email,
      firstName: leadsTable.firstName,
      lastName: leadsTable.lastName,
      company: leadsTable.company,
      openCount: emailSendJobsTable.openCount,
      firstOpenedAt: emailSendJobsTable.firstOpenedAt,
      firstClickedAt: emailSendJobsTable.firstClickedAt,
      repliedAt: emailSendJobsTable.repliedAt,
    })
    .from(emailSendJobsTable)
    .leftJoin(leadsTable, eq(emailSendJobsTable.leadId, leadsTable.id))
    .where(and(eq(emailSendJobsTable.campaignId, cid), eq(emailSendJobsTable.status, "sent")));

  const opened = rows
    .map((row) => {
      const openedAt = row.firstOpenedAt ?? row.firstClickedAt ?? row.repliedAt;
      if (!openedAt) return null;
      const source = row.openCount > 0 ? "pixel" : row.firstClickedAt ? "click" : "reply";
      return {
        leadId: row.leadId,
        email: row.email,
        name: [row.firstName, row.lastName].filter(Boolean).join(" ") || null,
        company: row.company,
        openedAt: openedAt.toISOString(),
        source,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null)
    .sort((a, b) => new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime());

  res.json(opened);
});

router.get("/campaigns/:id/replies", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const cid = parseInt(raw, 10);
  if (!Number.isFinite(cid)) {
    res.status(400).json({ error: "Invalid campaign id" });
    return;
  }

  const jobs = await db
    .select({
      leadId: emailSendJobsTable.leadId,
      email: leadsTable.email,
      firstName: leadsTable.firstName,
      lastName: leadsTable.lastName,
      company: leadsTable.company,
      repliedAt: emailSendJobsTable.repliedAt,
    })
    .from(emailSendJobsTable)
    .leftJoin(leadsTable, eq(emailSendJobsTable.leadId, leadsTable.id))
    .where(and(eq(emailSendJobsTable.campaignId, cid), eq(emailSendJobsTable.status, "sent")));

  const messages = await db
    .select()
    .from(inboxMessagesTable)
    .where(eq(inboxMessagesTable.campaignId, cid))
    .orderBy(desc(inboxMessagesTable.receivedAt));

  const latestMessageByLeadId = new Map<number, typeof messages[number]>();
  for (const message of messages) {
    if (!message.leadId || latestMessageByLeadId.has(message.leadId)) continue;
    latestMessageByLeadId.set(message.leadId, message);
  }

  const replies = jobs
    .filter((job) => !!job.repliedAt)
    .map((job) => {
      const message = latestMessageByLeadId.get(job.leadId);
      return {
        leadId: job.leadId,
        email: job.email,
        name: [job.firstName, job.lastName].filter(Boolean).join(" ") || null,
        company: job.company,
        repliedAt: job.repliedAt ? job.repliedAt.toISOString() : null,
        subject: message?.subject ?? null,
        body: message?.body ?? null,
      };
    })
    .sort((a, b) => new Date(b.repliedAt ?? 0).getTime() - new Date(a.repliedAt ?? 0).getTime());

  res.json(replies);
});

router.get("/campaigns/:id/analytics", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = GetCampaignAnalyticsParams.safeParse({ id: parseInt(raw, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [campaign] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, params.data.id));
  if (!campaign) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }
  const metrics = await getCampaignMetrics(params.data.id);
  res.json({
    campaignId: campaign.id,
    sent: metrics.sentCount,
    opened: metrics.openCount,
    clicked: metrics.clickCount,
    uniqueClickedLeads: metrics.uniqueClickedLeads,
    replied: metrics.replyCount,
    bounced: metrics.bounceCount,
    openRate: rate(metrics.openCount, metrics.sentCount),
    clickRate: rate(metrics.uniqueClickedLeads, metrics.sentCount),
    replyRate: rate(metrics.replyCount, metrics.sentCount),
    bounceRate: rate(metrics.bounceCount, metrics.sentCount),
  });
});

export default router;
