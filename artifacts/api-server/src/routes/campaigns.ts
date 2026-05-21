import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { db, campaignsTable, campaignLeadsTable, sequenceStepsTable, dailyStatsTable } from "@workspace/db";
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
  const [campaign] = await db.insert(campaignsTable).values(parsed.data).returning();
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
  const [campaign] = await db.update(campaignsTable).set(parsed.data).where(eq(campaignsTable.id, params.data.id)).returning();
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
  const [campaign] = await db.delete(campaignsTable).where(eq(campaignsTable.id, params.data.id)).returning();
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
  const [campaign] = await db.update(campaignsTable).set({ status: "active" }).where(eq(campaignsTable.id, params.data.id)).returning();
  if (!campaign) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }
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
  const replyRate = campaign.sentCount > 0 ? (campaign.replyCount / campaign.sentCount) * 100 : 0;
  const bounceRate = campaign.sentCount > 0 ? (campaign.bounceCount / campaign.sentCount) * 100 : 0;
  res.json({
    campaignId: campaign.id,
    sent: campaign.sentCount,
    opened: campaign.openCount,
    clicked: 0,
    replied: campaign.replyCount,
    bounced: campaign.bounceCount,
    openRate: Math.round(openRate * 10) / 10,
    clickRate: 0,
    replyRate: Math.round(replyRate * 10) / 10,
    bounceRate: Math.round(bounceRate * 10) / 10,
  });
});

export default router;
