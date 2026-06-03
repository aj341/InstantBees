export type Severity = "good" | "watch" | "risk";

export interface DeliverabilityOverview {
  generatedAt: string;
  tracking: {
    publicBaseUrl: string;
    publicTrackingUrl: boolean;
  };
  overview: {
    totalSent: number;
    totalOpened: number;
    totalClicked: number;
    totalReplied: number;
    totalBounced: number;
    totalUnsubscribed: number;
    suppressedLeads: number;
    bounceRate: number;
    replyRate: number;
    unsubscribeRate: number;
    activeCampaigns: number;
    sendableMailboxes: number;
  };
  domains: Array<{
    domain: string;
    spf: boolean;
    dmarc: boolean;
    dkim: boolean;
    severity: Severity;
    notes: string[];
  }>;
  providerMetrics: Array<{
    provider: string;
    sent: number;
    opened: number;
    clicked: number;
    replied: number;
    bounced: number;
    unsubscribed: number;
    openRate: number;
    clickRate: number;
    replyRate: number;
    bounceRate: number;
    unsubscribeRate: number;
    severity: Severity;
  }>;
  mailboxMetrics: Array<{
    id: number;
    email: string;
    domain: string;
    provider: string;
    status: string;
    warmupEnabled: boolean;
    warmupDay: number;
    dailyLimit: number;
    effectiveLimit: number;
    sentToday: number;
    remainingToday: number;
    sent: number;
    opened: number;
    clicked: number;
    replied: number;
    bounced: number;
    failed: number;
    openRate: number;
    clickRate: number;
    replyRate: number;
    bounceRate: number;
    errorRate: number;
    lastPolledAt: string | null;
    lastError: string | null;
    hasSmtp: boolean;
    hasImap: boolean;
    severity: Severity;
  }>;
  contentRisks: Array<{
    campaignId: number;
    campaignName: string;
    stepId: number;
    stepNumber: number;
    subject: string;
    score: number;
    severity: Severity;
    originalSeverity?: Severity;
    reviewed?: boolean;
    reviewedAt?: string | null;
    issues: string[];
    linkCount: number;
    attachmentCount: number;
  }>;
  campaignReadiness: Array<{
    id: number;
    name: string;
    status: string;
    score: number;
    severity: Severity;
    sent: number;
    bounceRate: number;
    checks: Array<{ label: string; ok: boolean; detail: string }>;
  }>;
  suppression: {
    bounced: number;
    unsubscribed: number;
    replied: number;
    total: number;
  };
  integrations: Record<string, { connected: boolean; status: string; note: string }>;
  recommendations: Array<{ severity: string; title: string; detail: string }>;
}

export async function fetchDeliverabilityOverview(): Promise<DeliverabilityOverview> {
  const response = await fetch("/api/deliverability/overview");
  if (!response.ok) throw new Error("Failed to load deliverability overview");
  return response.json();
}

export function severityVariant(severity: Severity): "default" | "secondary" | "destructive" | "outline" {
  if (severity === "risk") return "destructive";
  if (severity === "watch") return "secondary";
  return "default";
}

export function severityLabel(severity: Severity): string {
  if (severity === "risk") return "Risk";
  if (severity === "watch") return "Watch";
  return "Good";
}
