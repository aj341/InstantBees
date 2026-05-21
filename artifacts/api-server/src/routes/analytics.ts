import { Router, type IRouter } from "express";
import { db, campaignsTable, emailAccountsTable, dailyStatsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

router.get("/analytics/summary", async (_req, res): Promise<void> => {
  const campaigns = await db.select().from(campaignsTable);
  const accounts = await db.select().from(emailAccountsTable);

  const totalSent = campaigns.reduce((s, c) => s + c.sentCount, 0);
  const totalOpened = campaigns.reduce((s, c) => s + c.openCount, 0);
  const totalReplied = campaigns.reduce((s, c) => s + c.replyCount, 0);
  const totalBounced = campaigns.reduce((s, c) => s + c.bounceCount, 0);
  const totalClicked = 0;
  const activeCampaigns = campaigns.filter(c => c.status === "active").length;
  const activeAccounts = accounts.filter(a => a.status === "connected" || a.status === "warming").length;

  const openRate = totalSent > 0 ? (totalOpened / totalSent) * 100 : 0;
  const clickRate = 0;
  const replyRate = totalSent > 0 ? (totalReplied / totalSent) * 100 : 0;
  const bounceRate = totalSent > 0 ? (totalBounced / totalSent) * 100 : 0;

  res.json({
    totalSent,
    totalOpened,
    totalClicked,
    totalReplied,
    totalBounced,
    openRate: Math.round(openRate * 10) / 10,
    clickRate: Math.round(clickRate * 10) / 10,
    replyRate: Math.round(replyRate * 10) / 10,
    bounceRate: Math.round(bounceRate * 10) / 10,
    activeAccounts,
    activeCampaigns,
  });
});

router.get("/analytics/daily", async (_req, res): Promise<void> => {
  const stats = await db.select().from(dailyStatsTable).orderBy(dailyStatsTable.date);
  res.json(stats);
});

export default router;
