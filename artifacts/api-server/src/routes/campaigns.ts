import { Router, type IRouter } from "express";
import { eq, sql, and, asc } from "drizzle-orm";
import { db, campaignsTable, campaignLeadsTable, sequenceStepsTable, dailyStatsTable, leadsTable, emailAccountsTable, emailSendJobsTable, unsubscribesTable, inboxMessagesTable, clickEventsTable } from "@workspace/db";
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

const router: IRouter = Router();

router.get("/campaigns", async (_req, res): Promise<void> => {
  const campaigns = await db.select().from(campaignsTable).orderBy(campaignsTable.createdAt);
  res.json(campaigns);
});

router.get("/campaigns/stats", async (_req, res): Promise<void> => {
  const campaigns = await db.select().from(campaignsTable);
  const totalSent = campaigns.reduce((s, c) => s + c.sentCount, 0);
  const totalReplies = campaigns.reduce((s, c) => s + c.replyCount, 0);
  const totalBounces = campaigns.reduce((s, c) => s + c.bounceCount, 0);
  const totalOpens = campaigns.reduce((s, c) => s + c.openCount, 0);
  const activeCampaigns = campaigns.filter(c => c.status === "active").length;
  const totalLeads = campaigns.reduce((s, c) => s + c.leadsCount, 0);
  const avgOpenRate = totalSent > 0 ? (totalOpens / totalSent) * 100 : 0;
  const avgReplyRate = totalSent > 0 ? (totalReplies / totalSent) * 100 : 0;
  res.json({
    totalCampaigns: campaigns.length,
    activeCampaigns,
    totalLeads,
    totalSent,
    avgOpenRate: Math.round(avgOpenRate * 10) / 10,
    avgReplyRate: Math.round(avgReplyRate * 10) / 10,
    totalReplies,
    totalBounces,
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
  res.json(campaign);
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
  const updateValues = {
    ...rest,
    ...(scheduledStartAt !== undefined
      ? { scheduledStartAt: scheduledStartAt === null ? null : new Date(scheduledStartAt) }
      : {}),
  };
  const [campaign] = await db.update(campaignsTable).set(updateValues).where(eq(campaignsTable.id, params.data.id)).returning();
  if (!campaign) {
    res.status(404).json({ error: "Campaign not found" });
    return;
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
  const campaign = await db.transaction(async (tx) => {
    await tx.delete(emailSendJobsTable).where(eq(emailSendJobsTable.campaignId, cid));
    await tx.delete(sequenceStepsTable).where(eq(sequenceStepsTable.campaignId, cid));
    await tx.delete(campaignLeadsTable).where(eq(campaignLeadsTable.campaignId, cid));
    await tx.delete(unsubscribesTable).where(eq(unsubscribesTable.campaignId, cid));
    await tx.delete(inboxMessagesTable).where(eq(inboxMessagesTable.campaignId, cid));
    const [row] = await tx.delete(campaignsTable).where(eq(campaignsTable.id, cid)).returning();
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

  const accounts = await db
    .select()
    .from(emailAccountsTable)
    .where(eq(emailAccountsTable.status, "connected"));
  const sendable = accounts.filter((a) => !!a.smtpPasswordEnc);
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
  for (const lead of leads) {
    const account = sendable[acctIdx % sendable.length]!;
    acctIdx++;
    let cumulativeDelayMs = 0;
    for (const step of steps) {
      cumulativeDelayMs += step.delayDays * 24 * 60 * 60 * 1000;
      const key = `${lead.id}:${step.id}`;
      if (existingKeys.has(key)) continue;
      jobs.push({
        campaignId: id,
        leadId: lead.id,
        stepId: step.id,
        accountId: account.id,
        scheduledAt: new Date(now + cumulativeDelayMs),
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
      totalClicks: sql<number>`count(*)::int`,
      uniqueClicks: sql<number>`count(distinct ${clickEventsTable.leadId})::int`,
      lastClickedAt: sql<Date>`max(${clickEventsTable.clickedAt})`,
    })
    .from(clickEventsTable)
    .where(eq(clickEventsTable.campaignId, cid))
    .groupBy(clickEventsTable.url)
    .orderBy(sql`count(*) desc`);
  res.json(
    rows.map((r) => ({
      url: r.url,
      totalClicks: r.totalClicks,
      uniqueClicks: r.uniqueClicks,
      lastClickedAt: r.lastClickedAt ? new Date(r.lastClickedAt).toISOString() : null,
    })),
  );
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
  const openRate = campaign.sentCount > 0 ? (campaign.openCount / campaign.sentCount) * 100 : 0;
  const clickRate = campaign.sentCount > 0 ? (campaign.clickCount / campaign.sentCount) * 100 : 0;
  const replyRate = campaign.sentCount > 0 ? (campaign.replyCount / campaign.sentCount) * 100 : 0;
  const bounceRate = campaign.sentCount > 0 ? (campaign.bounceCount / campaign.sentCount) * 100 : 0;
  res.json({
    campaignId: campaign.id,
    sent: campaign.sentCount,
    opened: campaign.openCount,
    clicked: campaign.clickCount,
    replied: campaign.replyCount,
    bounced: campaign.bounceCount,
    openRate: Math.round(openRate * 10) / 10,
    clickRate: Math.round(clickRate * 10) / 10,
    replyRate: Math.round(replyRate * 10) / 10,
    bounceRate: Math.round(bounceRate * 10) / 10,
  });
});

export default router;
