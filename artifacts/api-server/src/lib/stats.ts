import { db, campaignsTable, clickEventsTable, emailSendJobsTable, leadsTable } from "@workspace/db";
import { isExcludedAnalyticsEmail } from "./analytics-exclusions";

export type CampaignMetrics = {
  sentCount: number;
  openCount: number;
  clickCount: number;
  uniqueClickedLeads: number;
  replyCount: number;
  bounceCount: number;
};

export type GlobalMetrics = CampaignMetrics & {
  activeCampaigns: number;
  totalCampaigns: number;
  totalLeads: number;
};

export async function getCampaignMetrics(campaignId: number): Promise<CampaignMetrics> {
  const [jobs, clicks, leads] = await Promise.all([
    db.select().from(emailSendJobsTable),
    db.select().from(clickEventsTable),
    db.select().from(leadsTable),
  ]);
  const leadsById = new Map(leads.map((lead) => [lead.id, lead]));
  const isExcludedLead = (leadId: number | null | undefined): boolean => isExcludedAnalyticsEmail(leadsById.get(Number(leadId))?.email);
  const campaignJobs = jobs.filter((job) => job.campaignId === campaignId && !isExcludedLead(job.leadId));
  const campaignClicks = clicks.filter((click) => click.campaignId === campaignId && !isExcludedLead(click.leadId));
  const sentJobs = campaignJobs.filter((job) => job.status === "sent");

  return {
    sentCount: sentJobs.length,
    openCount: campaignJobs.filter((job) => !!job.firstOpenedAt || !!job.firstClickedAt || !!job.repliedAt).length,
    clickCount: campaignClicks.length,
    uniqueClickedLeads: new Set(campaignClicks.map((click) => click.leadId)).size,
    replyCount: campaignJobs.filter((job) => !!job.repliedAt).length,
    bounceCount: campaignJobs.filter((job) => !!job.bounceKind).length,
  };
}

export async function getGlobalMetrics(): Promise<GlobalMetrics> {
  const [campaigns, jobs, clicks, leads] = await Promise.all([
    db.select().from(campaignsTable),
    db.select().from(emailSendJobsTable),
    db.select().from(clickEventsTable),
    db.select().from(leadsTable),
  ]);
  const leadsById = new Map(leads.map((lead) => [lead.id, lead]));
  const isExcludedLead = (leadId: number | null | undefined): boolean => isExcludedAnalyticsEmail(leadsById.get(Number(leadId))?.email);
  const analyticsJobs = jobs.filter((job) => !isExcludedLead(job.leadId));
  const analyticsClicks = clicks.filter((click) => !isExcludedLead(click.leadId));
  const sentJobs = analyticsJobs.filter((job) => job.status === "sent");

  return {
    sentCount: sentJobs.length,
    openCount: analyticsJobs.filter((job) => !!job.firstOpenedAt || !!job.firstClickedAt || !!job.repliedAt).length,
    clickCount: analyticsClicks.length,
    uniqueClickedLeads: new Set(analyticsClicks.map((click) => click.leadId)).size,
    replyCount: analyticsJobs.filter((job) => !!job.repliedAt).length,
    bounceCount: analyticsJobs.filter((job) => !!job.bounceKind).length,
    activeCampaigns: campaigns.filter((campaign) => campaign.status === "active").length,
    totalCampaigns: campaigns.length,
    totalLeads: campaigns.reduce((sum, campaign) => sum + campaign.leadsCount, 0),
  };
}

export function rate(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 1000) / 10 : 0;
}
