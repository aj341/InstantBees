import { useGetAnalyticsSummary, useGetDailyAnalytics, useListCampaigns } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { TrendingUp, Mail, MessageSquare, MousePointer, AlertTriangle } from "lucide-react";

function StatCard({ label, value, sub, icon: Icon }: { label: string; value: string; sub?: string; icon: React.ElementType }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold" data-testid={`stat-${label.toLowerCase().replace(/\s+/g, '-')}`}>{value}</div>
        {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
      </CardContent>
    </Card>
  );
}

export default function Analytics() {
  const { data: summary, isLoading: isLoadingSummary } = useGetAnalyticsSummary();
  const { data: daily, isLoading: isLoadingDaily } = useGetDailyAnalytics();
  const { data: campaigns } = useListCampaigns();

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
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Total Sent" value={(summary?.totalSent ?? 0).toLocaleString()} icon={Mail} />
            <StatCard
              label="Open Rate"
              value={`${summary?.openRate ?? 0}%`}
              sub={`${summary?.totalOpened ?? 0} opens`}
              icon={TrendingUp}
            />
            <StatCard
              label="Reply Rate"
              value={`${summary?.replyRate ?? 0}%`}
              sub={`${summary?.totalReplied ?? 0} replies`}
              icon={MessageSquare}
            />
            <StatCard
              label="Bounce Rate"
              value={`${summary?.bounceRate ?? 0}%`}
              sub={`${summary?.totalBounced ?? 0} bounced`}
              icon={AlertTriangle}
            />
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader><CardTitle className="text-sm font-medium text-muted-foreground">Active Campaigns</CardTitle></CardHeader>
              <CardContent><div className="text-2xl font-bold">{summary?.activeCampaigns ?? 0}</div></CardContent>
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
        </>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Daily Activity (Last 30 Days)</CardTitle>
        </CardHeader>
        <CardContent className="h-72">
          {isLoadingDaily ? (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">Loading chart...</div>
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
