import { useGetAnalyticsSummary, useGetDailyAnalytics, useListCampaigns } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { AlertCircle, AlertTriangle, CheckCircle2, Mail, MessageSquare, MousePointer, TrendingUp } from "lucide-react";

function StatCard({ label, value, sub, detail, icon: Icon }: { label: string; value: string; sub?: string; detail?: string; icon: React.ElementType }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold" data-testid={`stat-${label.toLowerCase().replace(/\s+/g, '-')}`}>{value}</div>
        {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
        {detail && <p className="text-[11px] text-muted-foreground/80 mt-2 leading-relaxed">{detail}</p>}
      </CardContent>
    </Card>
  );
}

function SetupRow({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  const Icon = ok ? CheckCircle2 : AlertCircle;
  return (
    <div className="flex items-start gap-2 rounded-md border border-border bg-muted/20 p-3">
      <Icon className={`mt-0.5 h-4 w-4 ${ok ? "text-emerald-400" : "text-amber-400"}`} />
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{detail}</p>
      </div>
    </div>
  );
}

export default function Analytics() {
  const { data: summary, isLoading: isLoadingSummary, error: summaryError } = useGetAnalyticsSummary();
  const { data: daily, isLoading: isLoadingDaily, error: dailyError } = useGetDailyAnalytics();
  const { data: campaigns } = useListCampaigns();
  const activeCampaignNames = summary?.activeCampaignNames ?? [];
  const hasPublicTrackingUrl = summary?.publicTrackingUrl ?? false;
  const inboxPollingOk = (summary?.activeAccounts ?? 0) > 0 && (summary?.inboxPollingErrors ?? 0) === 0;

  const topCampaigns = campaigns
    ?.filter(c => (c.sentCount ?? 0) > 0)
    .map(c => ({
      ...c,
      replyRate: (c.sentCount ?? 0) > 0 ? (((c.replyCount ?? 0) / (c.sentCount ?? 1)) * 100).toFixed(1) : "0",
      openRate: (c.sentCount ?? 0) > 0 ? (((c.openCount ?? 0) / (c.sentCount ?? 1)) * 100).toFixed(1) : "0",
    }))
    .sort((a, b) => parseFloat(b.replyRate) - parseFloat(a.replyRate))
    .slice(0, 5);

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Analytics</h1>
        <p className="text-sm text-muted-foreground mt-1">Overall performance across all campaigns</p>
      </div>

      {isLoadingSummary ? (
        <div className="text-center py-8 text-muted-foreground">Loading analytics...</div>
      ) : summaryError ? (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-5 w-5" />
              Analytics API is not reachable
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>The dashboard could not load `/api/analytics/summary`, so stats are not being displayed.</p>
            <p>{summaryError instanceof Error ? summaryError.message : "Check that the API server is running and the frontend proxy points to it."}</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Total Sent"
              value={(summary?.totalSent ?? 0).toLocaleString()}
              sub="Sent email jobs"
              detail="Source: sent email jobs, not campaign setup counts."
              icon={Mail}
            />
            <StatCard
              label="Open Rate"
              value={`${summary?.openRate ?? 0}%`}
              sub={`${summary?.totalOpened ?? 0} opened of ${summary?.totalSent ?? 0} sent`}
              detail="Source: tracking pixel opens, plus clicks and replies that prove the email was opened."
              icon={TrendingUp}
            />
            <StatCard
              label="Reply Rate"
              value={`${summary?.replyRate ?? 0}%`}
              sub={`${summary?.totalReplied ?? 0} replied of ${summary?.totalSent ?? 0} sent`}
              detail="Source: inbox polling matched replies back to sent messages."
              icon={MessageSquare}
            />
            <StatCard
              label="Bounce Rate"
              value={`${summary?.bounceRate ?? 0}%`}
              sub={`${summary?.totalBounced ?? 0} bounced of ${summary?.totalSent ?? 0} sent`}
              detail="Source: SMTP send failures and delivery failure replies."
              icon={AlertTriangle}
            />
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader><CardTitle className="text-sm font-medium text-muted-foreground">Active Campaigns</CardTitle></CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{summary?.activeCampaigns ?? 0}</div>
                <p className="text-xs text-muted-foreground mt-1">
                  {(summary?.activeCampaigns ?? 0) > 0
                    ? activeCampaignNames.join(", ")
                    : "No campaigns currently have Active status."}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-sm font-medium text-muted-foreground">Active Accounts</CardTitle></CardHeader>
              <CardContent><div className="text-2xl font-bold">{summary?.activeAccounts ?? 0}</div></CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-sm font-medium text-muted-foreground">Total Replies</CardTitle></CardHeader>
              <CardContent><div className="text-2xl font-bold">{(summary?.totalReplied ?? 0).toLocaleString()}</div></CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Tracking Setup</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2">
              <SetupRow
                label="Open tracking"
                ok={hasPublicTrackingUrl}
                detail={hasPublicTrackingUrl
                  ? `Pixels use ${summary?.publicBaseUrl}, which should be reachable by recipients. Clicks and replies also count as confirmed opens.`
                  : `Pixels currently use ${summary?.publicBaseUrl ?? "the local app URL"}. Recipients outside this machine cannot report pixel opens until PUBLIC_BASE_URL is public, but clicks and replies still count as confirmed opens.`}
              />
              <SetupRow
                label="Reply and bounce tracking"
                ok={inboxPollingOk}
                detail={inboxPollingOk
                  ? `Inbox polling is active${summary?.lastInboxPollAt ? `; last checked ${new Date(summary.lastInboxPollAt).toLocaleString()}` : ""}.`
                  : "Connect an account with working IMAP credentials; replies and delivery failure notices are matched from the inbox."}
              />
              <SetupRow
                label="Active campaign count"
                ok={(summary?.activeCampaigns ?? 0) > 0}
                detail={`Counts campaigns where status is Active. Current active: ${activeCampaignNames.length ? activeCampaignNames.join(", ") : "none"}.`}
              />
              <SetupRow
                label="Bounce rate"
                ok={(summary?.totalBounced ?? 0) > 0 || inboxPollingOk}
                detail="Bounces are counted when SMTP rejects a send or when a delivery failure email is matched back to a sent message."
              />
            </CardContent>
          </Card>
        </>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Daily Activity (Last 30 Days)</CardTitle>
        </CardHeader>
        <CardContent className="h-72">
          {isLoadingDaily ? (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">Loading chart...</div>
          ) : dailyError ? (
            <div className="flex items-center justify-center h-full text-destructive text-sm">
              Daily analytics could not be loaded.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={daily ?? []} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorSent" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="colorOpened" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--chart-2))" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="hsl(var(--chart-2))" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="colorReplied" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--chart-3))" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="hsl(var(--chart-3))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "6px" }}
                />
                <Legend />
                <Area type="monotone" dataKey="sent" stroke="hsl(var(--primary))" fill="url(#colorSent)" strokeWidth={2} name="Sent" />
                <Area type="monotone" dataKey="opened" stroke="hsl(var(--chart-2))" fill="url(#colorOpened)" strokeWidth={2} name="Opened" />
                <Area type="monotone" dataKey="replied" stroke="hsl(var(--chart-3))" fill="url(#colorReplied)" strokeWidth={2} name="Replied" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {topCampaigns && topCampaigns.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Top Campaigns by Reply Rate</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {topCampaigns.map(c => (
                <div key={c.id} className="flex items-center justify-between py-2 border-b border-border last:border-0" data-testid={`row-top-campaign-${c.id}`}>
                  <div>
                    <p className="font-medium text-sm">{c.name}</p>
                    <p className="text-xs text-muted-foreground">{c.sentCount} sent · {c.openRate}% opens</p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-sm">{c.replyRate}%</p>
                    <p className="text-xs text-muted-foreground">reply rate</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
