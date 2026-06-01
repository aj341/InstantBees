import { Router, type IRouter } from "express";
import { db, campaignsTable, emailAccountsTable, emailSendJobsTable, leadsTable } from "@workspace/db";
import { getGlobalMetrics, rate } from "../lib/stats";
import { getPublicBaseUrl } from "../lib/mailer";
import { isExcludedAnalyticsEmail } from "../lib/analytics-exclusions";

const router: IRouter = Router();

router.get("/analytics/summary", async (_req, res): Promise<void> => {
  const metrics = await getGlobalMetrics();
  const accounts = await db.select().from(emailAccountsTable);
  const campaigns = await db.select().from(campaignsTable);
  const activeAccounts = accounts.filter(a => a.status === "connected" || a.status === "warming").length;
  const activeCampaignNames = campaigns.filter((campaign) => campaign.status === "active").map((campaign) => campaign.name);
  const publicBaseUrl = getPublicBaseUrl();
  const publicTrackingUrl = !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/i.test(publicBaseUrl);
  const lastInboxPollAt = accounts
    .map((account) => account.lastPolledAt)
    .filter((value): value is Date => value instanceof Date)
    .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  const inboxPollingErrors = accounts.filter((account) => !!account.lastError).length;

  res.json({
    totalSent: metrics.sentCount,
    totalOpened: metrics.openCount,
    totalClicked: metrics.clickCount,
    totalReplied: metrics.replyCount,
    totalBounced: metrics.bounceCount,
    openRate: rate(metrics.openCount, metrics.sentCount),
    clickRate: rate(metrics.uniqueClickedLeads, metrics.sentCount),
    replyRate: rate(metrics.replyCount, metrics.sentCount),
    bounceRate: rate(metrics.bounceCount, metrics.sentCount),
    activeAccounts,
    activeCampaigns: metrics.activeCampaigns,
    totalCampaigns: metrics.totalCampaigns,
    activeCampaignNames,
    publicBaseUrl,
    publicTrackingUrl,
    lastInboxPollAt: lastInboxPollAt ? lastInboxPollAt.toISOString() : null,
    inboxPollingErrors,
  });
});

router.get("/analytics/daily", async (_req, res): Promise<void> => {
  const [jobs, leads] = await Promise.all([
    db.select().from(emailSendJobsTable),
    db.select().from(leadsTable),
  ]);
  const leadsById = new Map(leads.map((lead) => [lead.id, lead]));
  const analyticsJobs = jobs.filter((job) => !isExcludedAnalyticsEmail(leadsById.get(job.leadId)?.email));
  const byDate = new Map<string, { date: string; sent: number; opened: number; replied: number; bounced: number }>();
  const ensure = (date: string) => {
    const existing = byDate.get(date);
    if (existing) return existing;
    const next = { date, sent: 0, opened: 0, replied: 0, bounced: 0 };
    byDate.set(date, next);
    return next;
  };

  for (const job of analyticsJobs) {
    if (job.sentAt) ensure(job.sentAt.toISOString().slice(0, 10)).sent += 1;
    const openedAt = job.firstOpenedAt ?? job.firstClickedAt ?? job.repliedAt;
    if (openedAt) ensure(openedAt.toISOString().slice(0, 10)).opened += 1;
    if (job.repliedAt) ensure(job.repliedAt.toISOString().slice(0, 10)).replied += 1;
    if (job.bounceKind) ensure((job.sentAt ?? job.createdAt).toISOString().slice(0, 10)).bounced += 1;
  }

  res.json(Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date)));
});

export default router;
