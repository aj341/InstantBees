import dns from "node:dns/promises";
import {
  campaignsTable,
  clickEventsTable,
  emailAccountsTable,
  emailSendJobsTable,
  inboxMessagesTable,
  leadsTable,
  sequenceStepsTable,
  unsubscribesTable,
} from "@workspace/db";
import { getPublicBaseUrl } from "./mailer";
import { effectiveWarmupLimit, warmupDay } from "./warmup";
import { isExcludedAnalyticsEmail } from "./analytics-exclusions";

type Job = typeof emailSendJobsTable.$inferSelect;
type Lead = typeof leadsTable.$inferSelect;
type Account = typeof emailAccountsTable.$inferSelect;
type Campaign = typeof campaignsTable.$inferSelect;
type Step = typeof sequenceStepsTable.$inferSelect;
type Click = typeof clickEventsTable.$inferSelect;
type Reply = typeof inboxMessagesTable.$inferSelect;
type Unsubscribe = typeof unsubscribesTable.$inferSelect;

export type DeliverabilitySeverity = "good" | "watch" | "risk";

export function rate(part: number, total: number): number {
  return total > 0 ? Number(((part / total) * 100).toFixed(1)) : 0;
}

export function domainFromEmail(email: string | null | undefined): string {
  return (email?.split("@")[1] ?? "").trim().toLowerCase();
}

export function providerFromEmail(email: string | null | undefined): string {
  const domain = domainFromEmail(email);
  if (!domain) return "unknown";
  if (domain === "gmail.com" || domain === "googlemail.com") return "Gmail";
  if (domain.includes("outlook.") || domain.includes("hotmail.") || domain.includes("live.") || domain.includes("msn.")) return "Microsoft";
  if (domain.includes("yahoo.") || domain.includes("ymail.") || domain.includes("aol.")) return "Yahoo/AOL";
  if (domain.includes("icloud.") || domain.includes("me.com") || domain.includes("mac.com")) return "Apple";
  return "Business domains";
}

function sentLike(job: Job): boolean {
  return job.status === "sent" || !!job.sentAt;
}

function confirmedOpen(job: Job): boolean {
  return !!job.firstOpenedAt || !!job.firstClickedAt || !!job.repliedAt;
}

function riskForRates(bounceRate: number, replyRate: number, errorRate = 0): DeliverabilitySeverity {
  if (bounceRate >= 5 || errorRate >= 10) return "risk";
  if (bounceRate >= 2 || replyRate === 0 || errorRate >= 4) return "watch";
  return "good";
}

function toIso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function dateKey(value: Date | null | undefined): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

function extractUrls(text: string): string[] {
  return Array.from(text.matchAll(/https?:\/\/[^\s<>"']+|(?:www\.)[^\s<>"']+/gi)).map((match) => match[0]);
}

function parseAttachments(value: string | null): unknown[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function contentRiskForStep(step: Step): {
  score: number;
  severity: DeliverabilitySeverity;
  issues: string[];
  linkCount: number;
  attachmentCount: number;
} {
  const body = step.body ?? "";
  const subject = step.subject ?? "";
  const lower = `${subject}\n${body}`.toLowerCase();
  const urls = extractUrls(`${subject}\n${body}`);
  const attachments = parseAttachments(step.attachmentsJson ?? null);
  const issues: string[] = [];
  let score = 0;

  if (step.bodyType === "html") {
    score += 12;
    issues.push("HTML body");
  }
  if (urls.length > 1) {
    score += 10 + (urls.length - 1) * 5;
    issues.push(`${urls.length} links`);
  }
  if (attachments.length > 0) {
    score += 15 + Math.max(0, attachments.length - 1) * 8;
    issues.push(`${attachments.length} attachment${attachments.length === 1 ? "" : "s"}`);
  }
  if (body.length > 1800) {
    score += 8;
    issues.push("Long body");
  }
  if (subject.length > 70) {
    score += 5;
    issues.push("Long subject");
  }
  const riskyTerms = ["free trial", "no commitment", "limited time", "guaranteed", "urgent", "act now", "click here"];
  const matchedTerms = riskyTerms.filter((term) => lower.includes(term));
  if (matchedTerms.length > 0) {
    score += matchedTerms.length * 5;
    issues.push(`Risk terms: ${matchedTerms.slice(0, 3).join(", ")}`);
  }

  const severity: DeliverabilitySeverity = score >= 35 ? "risk" : score >= 15 ? "watch" : "good";
  return { score, severity, issues, linkCount: urls.length, attachmentCount: attachments.length };
}

async function txtExists(name: string, predicate: (joined: string) => boolean): Promise<{ ok: boolean; value: string | null }> {
  try {
    const records = await Promise.race([
      dns.resolveTxt(name),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("DNS timeout")), 1800)),
    ]);
    const joinedRecords = records.map((record) => record.join("")).join("\n");
    return { ok: predicate(joinedRecords), value: joinedRecords || null };
  } catch {
    return { ok: false, value: null };
  }
}

export async function domainHealth(domains: string[]): Promise<Array<{
  domain: string;
  spf: boolean;
  dmarc: boolean;
  dkim: boolean;
  severity: DeliverabilitySeverity;
  notes: string[];
}>> {
  const uniqueDomains = Array.from(new Set(domains.filter(Boolean)));
  return Promise.all(uniqueDomains.map(async (domain) => {
    const [spf, dmarc, ...dkimChecks] = await Promise.all([
      txtExists(domain, (value) => /v=spf1/i.test(value)),
      txtExists(`_dmarc.${domain}`, (value) => /v=dmarc1/i.test(value)),
      txtExists(`google._domainkey.${domain}`, (value) => /v=dkim1|p=/i.test(value)),
      txtExists(`selector1._domainkey.${domain}`, (value) => /v=dkim1|p=/i.test(value)),
      txtExists(`selector2._domainkey.${domain}`, (value) => /v=dkim1|p=/i.test(value)),
      txtExists(`default._domainkey.${domain}`, (value) => /v=dkim1|p=/i.test(value)),
    ]);
    const dkim = dkimChecks.some((check) => check.ok);
    const notes = [
      spf.ok ? null : "SPF not detected",
      dmarc.ok ? null : "DMARC not detected",
      dkim ? null : "Common DKIM selector not detected",
    ].filter((note): note is string => !!note);
    return {
      domain,
      spf: spf.ok,
      dmarc: dmarc.ok,
      dkim,
      severity: !spf.ok || !dmarc.ok ? "risk" : !dkim ? "watch" : "good",
      notes,
    };
  }));
}

export function buildDeliverabilityOverview(input: {
  campaigns: Campaign[];
  leads: Lead[];
  accounts: Account[];
  steps: Step[];
  jobs: Job[];
  clicks: Click[];
  replies: Reply[];
  unsubscribes: Unsubscribe[];
  domains: Awaited<ReturnType<typeof domainHealth>>;
}) {
  const { campaigns, leads, accounts, steps, jobs, clicks, replies, unsubscribes, domains } = input;
  const leadsById = new Map(leads.map((lead) => [lead.id, lead]));
  const campaignsById = new Map(campaigns.map((campaign) => [campaign.id, campaign]));
  const stepsByCampaignId = new Map<number, Step[]>();
  for (const step of steps) {
    const list = stepsByCampaignId.get(step.campaignId) ?? [];
    list.push(step);
    stepsByCampaignId.set(step.campaignId, list);
  }

  const analyticsJobs = jobs.filter((job) => !isExcludedAnalyticsEmail(leadsById.get(job.leadId)?.email));
  const analyticsClicks = clicks.filter((click) => !isExcludedAnalyticsEmail(leadsById.get(click.leadId)?.email));
  const sentJobs = analyticsJobs.filter(sentLike);
  const clickedJobIds = new Set(analyticsClicks.map((click) => click.sendJobId));
  const repliedJobIds = new Set(analyticsJobs.filter((job) => !!job.repliedAt).map((job) => job.id));
  const unsubscribedLeadIds = new Set(unsubscribes.map((unsub) => unsub.leadId));
  const publicBaseUrl = getPublicBaseUrl();
  const publicTrackingUrl = !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/i.test(publicBaseUrl);

  const providerRows = new Map<string, { provider: string; sent: number; opened: number; clicked: number; replied: number; bounced: number; unsubscribed: number }>();
  const ensureProvider = (provider: string) => {
    const existing = providerRows.get(provider);
    if (existing) return existing;
    const next = { provider, sent: 0, opened: 0, clicked: 0, replied: 0, bounced: 0, unsubscribed: 0 };
    providerRows.set(provider, next);
    return next;
  };
  for (const job of analyticsJobs) {
    const lead = leadsById.get(job.leadId);
    const row = ensureProvider(providerFromEmail(lead?.email));
    if (sentLike(job)) row.sent += 1;
    if (confirmedOpen(job)) row.opened += 1;
    if (clickedJobIds.has(job.id) || !!job.firstClickedAt) row.clicked += 1;
    if (repliedJobIds.has(job.id)) row.replied += 1;
    if (job.bounceKind) row.bounced += 1;
    if (unsubscribedLeadIds.has(job.leadId)) row.unsubscribed += 1;
  }

  const providerMetrics = Array.from(providerRows.values()).map((row) => ({
    ...row,
    openRate: rate(row.opened, row.sent),
    clickRate: rate(row.clicked, row.sent),
    replyRate: rate(row.replied, row.sent),
    bounceRate: rate(row.bounced, row.sent),
    unsubscribeRate: rate(row.unsubscribed, row.sent),
    severity: riskForRates(rate(row.bounced, row.sent), rate(row.replied, row.sent)),
  })).sort((a, b) => b.sent - a.sent);

  const mailboxMetrics = accounts.map((account) => {
    const accountJobs = analyticsJobs.filter((job) => job.accountId === account.id);
    const accountSent = accountJobs.filter(sentLike);
    const sent = accountSent.length;
    const opened = accountJobs.filter(confirmedOpen).length;
    const clicked = accountJobs.filter((job) => clickedJobIds.has(job.id) || !!job.firstClickedAt).length;
    const replied = accountJobs.filter((job) => !!job.repliedAt).length;
    const bounced = accountJobs.filter((job) => !!job.bounceKind).length;
    const failed = accountJobs.filter((job) => job.status === "failed").length;
    const dailyLimit = Math.max(1, account.dailySendLimit ?? 50);
    const effectiveLimit = effectiveWarmupLimit(dailyLimit, account.createdAt);
    const todayKey = new Date().toISOString().slice(0, 10);
    const sentToday = accountJobs.filter((job) => dateKey(job.sentAt) === todayKey).length;
    const bounceRate = rate(bounced, sent);
    const replyRate = rate(replied, sent);
    const errorRate = rate(failed, Math.max(1, accountJobs.length));
    const lastSuccessfulSendAt = accountJobs
      .filter((job) => sentLike(job) && job.sentAt)
      .map((job) => job.sentAt as Date)
      .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
    const hasRecentSuccessfulSend = !!lastSuccessfulSendAt && Date.now() - lastSuccessfulSendAt.getTime() < 7 * 24 * 60 * 60 * 1000;
    const activeLastError = account.lastError && !hasRecentSuccessfulSend ? account.lastError : null;
    const mailboxAtRisk = account.status === "error" || !!activeLastError || bounceRate >= 5;
    return {
      id: account.id,
      email: account.email,
      domain: domainFromEmail(account.email),
      provider: account.provider,
      status: account.status,
      warmupEnabled: account.warmupEnabled || account.status === "warming",
      warmupDay: warmupDay(account.createdAt),
      dailyLimit,
      effectiveLimit,
      sentToday,
      remainingToday: Math.max(0, effectiveLimit - sentToday),
      sent,
      opened,
      clicked,
      replied,
      bounced,
      failed,
      openRate: rate(opened, sent),
      clickRate: rate(clicked, sent),
      replyRate,
      bounceRate,
      errorRate,
      lastPolledAt: toIso(account.lastPolledAt),
      lastError: activeLastError,
      hasSmtp: !!account.smtpPasswordEnc,
      hasImap: !!account.imapHost,
      severity: mailboxAtRisk ? "risk" : riskForRates(bounceRate, replyRate, errorRate),
    };
  });

  const contentRisks = steps.map((step) => {
    const campaign = campaignsById.get(step.campaignId);
    return {
      campaignId: step.campaignId,
      campaignName: campaign?.name ?? "Unknown campaign",
      stepId: step.id,
      stepNumber: step.stepNumber,
      subject: step.subject,
      ...contentRiskForStep(step),
    };
  }).sort((a, b) => b.score - a.score);

  const campaignReadiness = campaigns.map((campaign) => {
    const campaignJobs = analyticsJobs.filter((job) => job.campaignId === campaign.id);
    const campaignSent = campaignJobs.filter(sentLike);
    const campaignSteps = stepsByCampaignId.get(campaign.id) ?? [];
    const campaignLeads = campaign.leadsCount ?? 0;
    const campaignRiskSteps = contentRisks.filter((risk) => risk.campaignId === campaign.id && risk.severity === "risk");
    const checks = [
      { label: "Sequence steps", ok: campaignSteps.length > 0, detail: `${campaignSteps.length} steps` },
      { label: "Active leads", ok: campaignLeads > 0, detail: `${campaignLeads} leads` },
      { label: "Sendable mailboxes", ok: mailboxMetrics.some((mailbox) => mailbox.hasSmtp && (mailbox.status === "connected" || mailbox.status === "warming")), detail: `${mailboxMetrics.filter((mailbox) => mailbox.hasSmtp && (mailbox.status === "connected" || mailbox.status === "warming")).length} available` },
      { label: "Public tracking URL", ok: publicTrackingUrl, detail: publicBaseUrl },
      { label: "Unsubscribe enabled", ok: campaign.includeUnsubscribe, detail: campaign.includeUnsubscribe ? "enabled" : "disabled" },
      { label: "Content risk", ok: campaignRiskSteps.length === 0, detail: campaignRiskSteps.length === 0 ? "clean" : `${campaignRiskSteps.length} steps need review` },
    ];
    const okCount = checks.filter((check) => check.ok).length;
    const sent = campaignSent.length;
    const bounced = campaignJobs.filter((job) => !!job.bounceKind).length;
    return {
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      score: Math.round((okCount / checks.length) * 100),
      severity: okCount === checks.length ? "good" : okCount >= checks.length - 1 ? "watch" : "risk",
      sent,
      bounceRate: rate(bounced, sent),
      checks,
    };
  });

  const totalSent = sentJobs.length;
  const totalBounced = analyticsJobs.filter((job) => !!job.bounceKind).length;
  const totalReplied = analyticsJobs.filter((job) => !!job.repliedAt).length;
  const totalUnsubscribed = unsubscribes.filter((unsub) => {
    const lead = leadsById.get(unsub.leadId);
    return !isExcludedAnalyticsEmail(lead?.email);
  }).length;
  const suppressedLeads = leads.filter((lead) => lead.status === "bounced" || lead.status === "unsubscribed" || unsubscribedLeadIds.has(lead.id));

  const recommendations = [
    publicTrackingUrl ? null : { severity: "risk", title: "Public tracking URL is not live", detail: "Set PUBLIC_BASE_URL to the Railway URL before relying on open tracking." },
    domains.some((domain) => domain.severity === "risk") ? { severity: "risk", title: "Domain authentication needs review", detail: "At least one sending domain is missing SPF or DMARC." } : null,
    mailboxMetrics.some((mailbox) => mailbox.severity === "risk") ? { severity: "risk", title: "Mailbox health issue", detail: "One or more mailboxes has errors, high bounce rate, or IMAP/SMTP risk." } : null,
    rate(totalBounced, totalSent) >= 2 ? { severity: "watch", title: "Bounce rate is above 2%", detail: "Slow sending and tighten verification until bounce rate stabilises." } : null,
    contentRisks.some((risk) => risk.severity === "risk") ? { severity: "watch", title: "High-risk email content detected", detail: "Review steps with multiple links, HTML, attachments, or risky phrasing." } : null,
    totalSent > 0 && rate(totalReplied, totalSent) === 0 ? { severity: "watch", title: "No replies recorded", detail: "Check IMAP polling and confirm replies are being matched to sent jobs." } : null,
  ].filter((item): item is { severity: string; title: string; detail: string } => !!item);

  return {
    generatedAt: new Date().toISOString(),
    tracking: { publicBaseUrl, publicTrackingUrl },
    overview: {
      totalSent,
      totalOpened: analyticsJobs.filter(confirmedOpen).length,
      totalClicked: new Set(analyticsClicks.map((click) => click.sendJobId)).size,
      totalReplied,
      totalBounced,
      totalUnsubscribed,
      suppressedLeads: suppressedLeads.length,
      bounceRate: rate(totalBounced, totalSent),
      replyRate: rate(totalReplied, totalSent),
      unsubscribeRate: rate(totalUnsubscribed, totalSent),
      activeCampaigns: campaigns.filter((campaign) => campaign.status === "active").length,
      sendableMailboxes: mailboxMetrics.filter((mailbox) => mailbox.hasSmtp && (mailbox.status === "connected" || mailbox.status === "warming")).length,
    },
    domains,
    providerMetrics,
    mailboxMetrics,
    contentRisks,
    campaignReadiness,
    suppression: {
      bounced: leads.filter((lead) => lead.status === "bounced").length,
      unsubscribed: leads.filter((lead) => lead.status === "unsubscribed" || unsubscribedLeadIds.has(lead.id)).length,
      replied: leads.filter((lead) => lead.status === "replied").length,
      total: suppressedLeads.length,
    },
    integrations: {
      googlePostmaster: { connected: false, status: "not_configured", note: "OAuth/API connection not configured yet." },
      microsoftSNDS: { connected: false, status: "not_configured", note: "Microsoft reputation feed not configured yet." },
      seedTesting: { connected: false, status: "not_configured", note: "Seed inbox list and placement runner not configured yet." },
    },
    recommendations,
  };
}
