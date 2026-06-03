import { Router, type IRouter } from "express";
import { eq, sql, and, asc, desc } from "drizzle-orm";
import { db, campaignsTable, campaignLeadsTable, sequenceStepsTable, sequenceStepVariantsTable, dailyStatsTable, leadsTable, leadLabelsTable, emailAccountsTable, emailSendJobsTable, unsubscribesTable, inboxMessagesTable, clickEventsTable } from "@workspace/db";
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
import { prioritizeCampaignLeads } from "../lib/queue-priority";
import { enqueueMissingCampaignJobs } from "../lib/campaign-enqueue";
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
    batchSize: clampPositiveInt(campaign.batchSize, 16),
    batchIntervalMs: clampPositiveInt(campaign.batchIntervalMinutes, 65, 24 * 60) * 60 * 1000,
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
  const slotIndex = leadIndex % batchSize;
  const slotOffsetMs = Math.floor((batchIntervalMs / batchSize) * slotIndex);
  return nextSendWindowAt(new Date(baseTime + batchIndex * batchIntervalMs + slotOffsetMs), campaign);
}

function followUpScheduledTime(previousStepAt: Date, delayDays: number, campaign: CampaignScheduleSettings): Date {
  return nextSendWindowAt(new Date(previousStepAt.getTime() + delayDays * DAY_MS), campaign);
}

function percent(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 1000) / 10 : 0;
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
    batchSize: clampPositiveInt(rest.batchSize, 16),
    batchIntervalMinutes: clampPositiveInt(rest.batchIntervalMinutes, 65, 24 * 60),
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
  let enqueueResult: Awaited<ReturnType<typeof enqueueMissingCampaignJobs>>;
  try {
    enqueueResult = await enqueueMissingCampaignJobs(id);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Failed to queue campaign" });
    return;
  }

  const [campaign] = await db
    .update(campaignsTable)
    .set({ status: "active", leadsCount: enqueueResult.activeLeadCount })
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

router.post("/campaigns/:id/prioritize", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid campaign id" });
    return;
  }
  const result = await prioritizeCampaignLeads(id, {
    leadIds: Array.isArray(req.body?.leadIds) ? req.body.leadIds : undefined,
    emails: Array.isArray(req.body?.emails) ? req.body.emails : undefined,
    limit: req.body?.limit,
  });
  if (!result) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }
  res.json(result);
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
      variantId: emailSendJobsTable.variantId,
      variantName: emailSendJobsTable.variantName,
    })
    .from(clickEventsTable)
    .leftJoin(emailSendJobsTable, eq(clickEventsTable.sendJobId, emailSendJobsTable.id))
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
        variantId: click.variantId,
        variantName: click.variantName,
        clickedAt: click.clickedAt ? new Date(click.clickedAt).toISOString() : null,
      })),
    })),
  );
});

router.get("/campaigns/:id/variants", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const cid = parseInt(raw, 10);
  if (!Number.isFinite(cid)) {
    res.status(400).json({ error: "Invalid campaign id" });
    return;
  }

  const [campaign] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, cid));
  if (!campaign) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }

  const [steps, variants, jobs, clicks, messages, leadLabels] = await Promise.all([
    db.select().from(sequenceStepsTable).where(eq(sequenceStepsTable.campaignId, cid)).orderBy(asc(sequenceStepsTable.stepNumber)),
    db
      .select({ variant: sequenceStepVariantsTable })
      .from(sequenceStepVariantsTable)
      .innerJoin(sequenceStepsTable, eq(sequenceStepVariantsTable.stepId, sequenceStepsTable.id))
      .where(eq(sequenceStepsTable.campaignId, cid))
      .orderBy(asc(sequenceStepsTable.stepNumber), desc(sequenceStepVariantsTable.priority), asc(sequenceStepVariantsTable.id)),
    db.select().from(emailSendJobsTable).where(eq(emailSendJobsTable.campaignId, cid)),
    db.select().from(clickEventsTable).where(eq(clickEventsTable.campaignId, cid)),
    db.select().from(inboxMessagesTable).where(eq(inboxMessagesTable.campaignId, cid)),
    db
      .select({ leadId: leadLabelsTable.leadId, labelId: leadLabelsTable.labelId })
      .from(leadLabelsTable)
      .innerJoin(campaignLeadsTable, eq(leadLabelsTable.leadId, campaignLeadsTable.leadId))
      .where(eq(campaignLeadsTable.campaignId, cid)),
  ]);

  const clicksByJobId = new Map<number, number>();
  for (const click of clicks) {
    clicksByJobId.set(click.sendJobId, (clicksByJobId.get(click.sendJobId) ?? 0) + 1);
  }

  const messagesByLeadId = new Map<number, typeof messages[number][]>();
  for (const message of messages) {
    if (!message.leadId) continue;
    const list = messagesByLeadId.get(message.leadId) ?? [];
    list.push(message);
    messagesByLeadId.set(message.leadId, list);
  }

  const leadLabelKeys = new Set(leadLabels.map((label) => `${label.leadId}:${label.labelId}`));
  const stepVariantLabels = new Map<number, Set<number>>();
  for (const { variant } of variants) {
    const labels = stepVariantLabels.get(variant.stepId) ?? new Set<number>();
    labels.add(variant.labelId);
    stepVariantLabels.set(variant.stepId, labels);
  }

  const pendingJobMatchesVariant = (job: typeof jobs[number], stepId: number, labelId: number): boolean => (
    job.stepId === stepId
    && !job.variantId
    && (job.status === "pending" || job.status === "in_progress")
    && leadLabelKeys.has(`${job.leadId}:${labelId}`)
  );

  const pendingJobMatchesAnyVariant = (job: typeof jobs[number], stepId: number): boolean => {
    if (job.stepId !== stepId || job.variantId || (job.status !== "pending" && job.status !== "in_progress")) return false;
    const labelIds = stepVariantLabels.get(stepId);
    if (!labelIds) return false;
    return Array.from(labelIds).some((labelId) => leadLabelKeys.has(`${job.leadId}:${labelId}`));
  };

  const statsForJobs = (variantJobs: typeof jobs): {
    sent: number;
    pending: number;
    failed: number;
    skipped: number;
    opened: number;
    clicked: number;
    totalClicks: number;
    replied: number;
    bounced: number;
    positiveReplies: number;
    openRate: number;
    clickRate: number;
    replyRate: number;
    bounceRate: number;
  } => {
    const sent = variantJobs.filter((job) => job.status === "sent").length;
    const clickedLeadIds = new Set<number>();
    let totalClicks = 0;
    let positiveReplies = 0;
    for (const job of variantJobs) {
      const jobClicks = clicksByJobId.get(job.id) ?? 0;
      totalClicks += jobClicks;
      if (jobClicks > 0 || job.firstClickedAt) clickedLeadIds.add(job.leadId);
      const replies = messagesByLeadId.get(job.leadId) ?? [];
      if (replies.some((reply) => reply.sentiment === "positive")) positiveReplies += 1;
    }
    return {
      sent,
      pending: variantJobs.filter((job) => job.status === "pending" || job.status === "in_progress").length,
      failed: variantJobs.filter((job) => job.status === "failed").length,
      skipped: variantJobs.filter((job) => job.status === "skipped").length,
      opened: variantJobs.filter((job) => !!job.firstOpenedAt || !!job.firstClickedAt || !!job.repliedAt).length,
      clicked: clickedLeadIds.size,
      totalClicks,
      replied: variantJobs.filter((job) => !!job.repliedAt).length,
      bounced: variantJobs.filter((job) => !!job.bounceKind).length,
      positiveReplies,
      openRate: percent(variantJobs.filter((job) => !!job.firstOpenedAt || !!job.firstClickedAt || !!job.repliedAt).length, sent),
      clickRate: percent(clickedLeadIds.size, sent),
      replyRate: percent(variantJobs.filter((job) => !!job.repliedAt).length, sent),
      bounceRate: percent(variantJobs.filter((job) => !!job.bounceKind).length, sent),
    };
  };

  const variantRows = variants.map(({ variant }) => {
    const variantJobs = jobs.filter((job) => (
      (job.stepId === variant.stepId && job.variantId === variant.id)
      || pendingJobMatchesVariant(job, variant.stepId, variant.labelId)
    ));
    return {
      id: variant.id,
      stepId: variant.stepId,
      labelId: variant.labelId,
      name: variant.name,
      subject: variant.subject,
      previewText: variant.previewText,
      body: variant.body,
      bodyType: variant.bodyType,
      attachmentsJson: variant.attachmentsJson,
      priority: variant.priority,
      ...statsForJobs(variantJobs),
    };
  });

  const stepsOut = steps.map((step) => {
    const stepJobs = jobs.filter((job) => job.stepId === step.id);
    const defaultJobs = stepJobs.filter((job) => !job.variantId && !pendingJobMatchesAnyVariant(job, step.id));
    return {
      id: step.id,
      stepNumber: step.stepNumber,
      subject: step.subject,
      body: step.body,
      bodyType: step.bodyType,
      previewText: step.previewText,
      defaultStats: statsForJobs(defaultJobs),
      variants: variantRows.filter((variant) => variant.stepId === step.id),
    };
  });

  res.json({ campaignId: cid, steps: stepsOut });
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
      variantId: emailSendJobsTable.variantId,
      variantName: emailSendJobsTable.variantName,
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
        variantId: row.variantId,
        variantName: row.variantName,
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
      variantId: emailSendJobsTable.variantId,
      variantName: emailSendJobsTable.variantName,
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
        variantId: job.variantId,
        variantName: job.variantName,
        repliedAt: job.repliedAt ? job.repliedAt.toISOString() : null,
        subject: message?.subject ?? null,
        body: message?.body ?? null,
        sentiment: message?.sentiment ?? null,
        category: message?.category ?? null,
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
