import { useGetAnalyticsSummary, useGetDailyAnalytics, useListCampaigns } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { AlertCircle, AlertTriangle, Mail, MessageSquare, MousePointer, Send, TrendingUp } from "lucide-react";

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

export default function Analytics() {
  const { data: summary, isLoading: isLoadingSummary, error: summaryError } = useGetAnalyticsSummary();
  const { data: daily, isLoading: isLoadingDaily, error: dailyError } = useGetDailyAnalytics();
  const { data: campaigns } = useListCampaigns();
  const activeCampaignNames = summary?.activeCampaignNames ?? [];
  const totalSent = summary?.totalSent ?? 0;
  const totalOpened = summary?.totalOpened ?? 0;
  const totalReplied = summary?.totalReplied ?? 0;
  const totalBounced = summary?.totalBounced ?? 0;
  const totalClicked = campaigns?.reduce((sum, campaign) => sum + (campaign.clickCount ?? 0), 0) ?? 0;

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
    <div className="p-8 max-w-[1500px] mx-auto space-y-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Analytics</h1>
          <p className="text-sm text-muted-foreground mt-1">Overall performance across all campaigns</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">{summary?.activeCampaigns ?? 0} active campaigns</Badge>
          <Badge variant="outline">{summary?.activeAccounts ?? 0} sendable accounts</Badge>
          <Badge variant="outline">{totalClicked.toLocaleString()} tracked clicks</Badge>
        </div>
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
              value={totalSent.toLocaleString()}
              sub="Sent email jobs"
              detail="Source: sent email jobs, not campaign setup counts."
              icon={Mail}
            />
            <StatCard
              label="Open Rate"
              value={`${summary?.openRate ?? 0}%`}
              sub={`${totalOpened} opened of ${totalSent} sent`}
              detail="Source: tracking pixel opens, plus clicks and replies that prove the email was opened."
              icon={TrendingUp}
            />
            <StatCard
              label="Reply Rate"
              value={`${summary?.replyRate ?? 0}%`}
              sub={`${totalReplied} replied of ${totalSent} sent`}
              detail="Source: inbox polling matched replies back to sent messages."
              icon={MessageSquare}
            />
            <StatCard
              label="Bounce Rate"
              value={`${summary?.bounceRate ?? 0}%`}
              sub={`${totalBounced} bounced of ${totalSent} sent`}
              detail="Source: SMTP send failures and delivery failure replies."
              icon={AlertTriangle}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-[1fr_1fr_1.3fr]">
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
              <CardContent>
                <div className="flex items-center gap-3">
                  <Send className="h-5 w-5 text-primary" />
                  <div className="text-2xl font-bold">{summary?.activeAccounts ?? 0}</div>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">Mailboxes currently eligible to send.</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-sm font-medium text-muted-foreground">Funnel Snapshot</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {[
                  { label: "Sent", value: totalSent, icon: Mail },
                  { label: "Opened", value: totalOpened, icon: TrendingUp },
                  { label: "Clicked", value: totalClicked, icon: MousePointer },
                  { label: "Replied", value: totalReplied, icon: MessageSquare },
                ].map((item) => {
                  const Icon = item.icon;
                  const width = totalSent > 0 ? Math.max(6, Math.min(100, (item.value / totalSent) * 100)) : 0;
                  return (
                    <div key={item.label} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="flex items-center gap-2 text-muted-foreground"><Icon className="h-3.5 w-3.5" />{item.label}</span>
                        <span className="font-semibold">{item.value.toLocaleString()}</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${width}%` }} />
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          </div>

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

      <div className="grid gap-4 lg:grid-cols-[1.3fr_0.7fr]">
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
        <Card>
          <CardHeader>
            <CardTitle>Tracking Notes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>Clicks and replies count as confirmed opens, so open rate should never sit below confirmed engagement.</p>
            <p>Bounces are counted from SMTP failures and inbox delivery-failure replies.</p>
            <p>Test activity can skew best-hour and best-day insights until excluded at the source.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
