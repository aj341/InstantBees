import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, campaignsTable, dailyStatsTable, sequenceStepsTable } from "@workspace/db";

const router: IRouter = Router();

// GET /api/v1/analytics/campaigns/:id — per-campaign stats
router.get("/analytics/campaigns/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const rows = await db.select().from(campaignsTable).where(eq(campaignsTable.id, id));
  if (!rows[0]) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Campaign not found" } }); return; }
  const c = rows[0];
  const openRate = c.sentCount > 0 ? parseFloat(((c.openCount / c.sentCount) * 100).toFixed(1)) : 0;
  const replyRate = c.sentCount > 0 ? parseFloat(((c.replyCount / c.sentCount) * 100).toFixed(1)) : 0;
  const bounceRate = c.sentCount > 0 ? parseFloat(((c.bounceCount / c.sentCount) * 100).toFixed(1)) : 0;

  const steps = await db.select().from(sequenceStepsTable).where(eq(sequenceStepsTable.campaignId, id)).orderBy(sequenceStepsTable.stepNumber);

  res.json({
    campaignId: c.id,
    name: c.name,
    status: c.status,
    leads: c.leadsCount,
    sent: c.sentCount,
    opened: c.openCount,
    replied: c.replyCount,
    bounced: c.bounceCount,
    openRate,
    replyRate,
    bounceRate,
    steps: steps.map((s, i) => ({
      stepNumber: s.stepNumber,
      subject: s.subject,
      delayDays: s.delayDays,
      note: `Step ${i + 1} of ${steps.length}`,
    })),
  });
});

// GET /api/v1/analytics/overview — global stats
router.get("/analytics/overview", async (_req, res): Promise<void> => {
  const campaigns = await db.select().from(campaignsTable);
  const sent = campaigns.reduce((s, c) => s + c.sentCount, 0);
  const opened = campaigns.reduce((s, c) => s + c.openCount, 0);
  const replied = campaigns.reduce((s, c) => s + c.replyCount, 0);
  const bounced = campaigns.reduce((s, c) => s + c.bounceCount, 0);
  res.json({
    campaigns: { total: campaigns.length, active: campaigns.filter(c => c.status === "active").length, draft: campaigns.filter(c => c.status === "draft").length, paused: campaigns.filter(c => c.status === "paused").length, completed: campaigns.filter(c => c.status === "completed").length },
    emails: { sent, opened, replied, bounced, openRate: sent > 0 ? parseFloat(((opened / sent) * 100).toFixed(1)) : 0, replyRate: sent > 0 ? parseFloat(((replied / sent) * 100).toFixed(1)) : 0, bounceRate: sent > 0 ? parseFloat(((bounced / sent) * 100).toFixed(1)) : 0 },
  });
});

export default router;
