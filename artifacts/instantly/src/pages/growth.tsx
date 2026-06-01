import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  CalendarClock,
  CheckCircle2,
  Flame,
  Gauge,
  TimerReset,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface GrowthOverview {
  overview: {
    totalSent: number;
    activeCampaigns: number;
    warmupAccounts: number;
    templateMatches: number;
    throttledJobs: number;
    uniqueSentLeads: number;
    openRate: number;
    clickRate: number;
    replyRate: number;
    bounceRate: number;
  };
  queueSummary: {
    queuedCount: number;
    clearsAt: string | null;
    nextBatchCount: number;
    nextBatchAt: string | null;
    currentBatchClearsAt: string | null;
    futureQueuedCount: number;
    readyForMoreAt: string | null;
    capacityPerSlot: number;
    dailyCapacity: number;
    capacityIntervalMinutes: number;
    capacitySlotMinutes: number;
  };
  sendCalendar: CalendarRow[];
  timeline: TimelineRow[];
  replyClassifications: ReplyRow[];
  deliverability: DeliverabilityRow[];
  campaignFunnels: CampaignFunnelRow[];
  labelPerformance: LabelPerformanceRow[];
  sendHourPerformance: TimingPerformanceRow[];
  sendDayPerformance: TimingPerformanceRow[];
  linkPerformance: LinkPerformanceRow[];
  abPerformance: PerformanceRow[];
  templatePerformance: TemplatePerformanceRow[];
  throttling: ThrottleRow[];
  segments: SegmentRow[];
}

interface CalendarRow {
  jobId: number;
  campaignId: number;
  campaignName: string;
  leadId: number;
  leadEmail: string;
  leadName: string;
  company: string | null;
  accountEmail: string | null;
  accountStatus: string | null;
  warmupEnabled: boolean;
  stepNumber: number | null;
  subject: string;
  scheduledAt: string | null;
  status: string;
  attempts: number;
  errorMessage: string | null;
}

interface TimelineRow {
  leadId: number | null;
  leadEmail: string;
  leadName: string;
  campaignId: number | null;
  campaignName: string;
  eventType: string;
  occurredAt: string | null;
  detail: string;
}

interface ReplyRow {
  id: number;
  leadId: number | null;
  leadEmail: string;
  leadName: string;
  campaignId: number | null;
  campaignName: string | null;
  subject: string;
  snippet: string;
  category: string;
  sentiment: string;
  receivedAt: string | null;
}

interface DeliverabilityRow {
  accountId: number;
  email: string;
  status: string;
  warmupEnabled: boolean;
  warmupDay: number | null;
  sentToday: number;
  effectiveDailyLimit: number;
  remainingToday: number;
  healthScore: number;
  risk: string;
  lastError: string | null;
  sent: number;
  openRate: number;
  clickRate: number;
  replyRate: number;
  bounceRate: number;
}

interface PerformanceRow {
  variant?: string;
  preview?: string;
  sent: number;
  opened: number;
  clicked: number;
  replied: number;
  bounced: number;
  openRate: number;
  clickRate: number;
  replyRate: number;
  bounceRate: number;
}

interface CampaignFunnelRow extends PerformanceRow {
  campaignId: number;
  campaignName: string;
  status: string;
  leads: number;
  pending: number;
  failed: number;
  noResponse: number;
}

interface LabelPerformanceRow extends PerformanceRow {
  labelId: number;
  labelName: string;
  color: string;
  leads: number;
  campaigns: number;
}

interface TimingPerformanceRow extends PerformanceRow {
  hour?: number;
  label?: string;
  day?: string;
}

interface LinkPerformanceRow {
  url: string;
  totalClicks: number;
  uniqueLeads: number;
  repliedLeads: number;
  clickToReplyRate: number;
  lastClickedAt: string | null;
  campaigns: string[];
}

interface TemplatePerformanceRow extends PerformanceRow {
  templateId: number;
  templateName: string;
  subject: string;
  matchedSteps: number;
  updatedAt: string | null;
}

interface ThrottleRow {
  jobId: number;
  campaignId: number;
  campaignName: string;
  leadId: number;
  leadEmail: string;
  accountEmail: string | null;
  reason: string | null;
  scheduledAt: string | null;
}

interface SegmentRow {
  id: string;
  name: string;
  description: string;
  count: number;
  leads: Array<{
    leadId: number;
    email: string;
    name: string;
    company: string | null;
    campaignId: number;
    campaignName: string;
    lastActivityAt: string | null;
  }>;
}

async function fetchGrowthOverview(): Promise<GrowthOverview> {
  const response = await fetch("/api/growth/overview");
  if (!response.ok) throw new Error("Failed to load Growth Center data");
  return response.json();
}

function fmtDate(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : "-";
}

function fmtPct(value: number | undefined): string {
  return `${Number(value ?? 0).toFixed(1)}%`;
}

function fmtQueueFinish(value: string | null | undefined): string {
  if (!value) return "Now";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Now";
  return date.toLocaleString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function compactReason(value: string): string {
  return value.replaceAll("_", " ");
}

function StatCard({ label, value, sub, icon: Icon }: { label: string; value: string; sub: string; icon: React.ElementType }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        <p className="text-xs text-muted-foreground mt-1">{sub}</p>
      </CardContent>
    </Card>
  );
}

function EmptyState({ label }: { label: string }) {
  return <div className="py-10 text-center text-sm text-muted-foreground">{label}</div>;
}

export default function Growth() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["growth-overview"],
    queryFn: fetchGrowthOverview,
    refetchInterval: 60_000,
  });

  if (isLoading) return <div className="p-8">Loading Growth Center...</div>;
  if (error || !data) return <div className="p-8 text-destructive">Growth Center failed to load.</div>;

  const queueClearsValue = fmtQueueFinish(data.queueSummary.readyForMoreAt);
  const queueClearsSub = data.queueSummary.queuedCount > 0
    ? `${data.queueSummary.queuedCount.toLocaleString()}/${data.queueSummary.dailyCapacity.toLocaleString()} daily capacity; ${data.queueSummary.capacityPerSlot.toLocaleString()} every ${data.queueSummary.capacitySlotMinutes || data.queueSummary.capacityIntervalMinutes} min`
    : "No due sends waiting";

  return (
    <div className="p-8 max-w-[1500px] mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Growth Center</h1>
        <p className="text-sm text-muted-foreground mt-1">Send planning, lead intent, reply handling, deliverability, and performance insights.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Upcoming Sends" value={data.sendCalendar.length.toLocaleString()} sub={`${data.overview.activeCampaigns} active campaigns`} icon={CalendarClock} />
        <StatCard label="Warmup" value={data.overview.warmupAccounts.toLocaleString()} sub="Accounts warming or warmup-enabled" icon={Flame} />
        <StatCard label="Ready For More" value={queueClearsValue} sub={queueClearsSub} icon={TimerReset} />
        <StatCard label="Reply Rate" value={fmtPct(data.overview.replyRate)} sub={`${fmtPct(data.overview.openRate)} opens, ${fmtPct(data.overview.clickRate)} clicks`} icon={Gauge} />
      </div>

      <Tabs defaultValue="calendar" className="space-y-4">
        <TabsList className="flex h-auto flex-wrap justify-start">
          <TabsTrigger value="calendar">Calendar</TabsTrigger>
          <TabsTrigger value="funnels">Funnels</TabsTrigger>
          <TabsTrigger value="icp">ICP/Labels</TabsTrigger>
          <TabsTrigger value="timing">Timing</TabsTrigger>
          <TabsTrigger value="links">Links</TabsTrigger>
          <TabsTrigger value="segments">Segments</TabsTrigger>
          <TabsTrigger value="replies">Replies</TabsTrigger>
          <TabsTrigger value="templates">Templates</TabsTrigger>
          <TabsTrigger value="testing">A/B Tests</TabsTrigger>
          <TabsTrigger value="deliverability">Deliverability</TabsTrigger>
          <TabsTrigger value="throttling">Throttling</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
        </TabsList>

        <TabsContent value="calendar">
          <Card>
            <CardHeader><CardTitle>Campaign Send Calendar</CardTitle></CardHeader>
            <CardContent>
              {data.sendCalendar.length === 0 ? <EmptyState label="No pending sends are currently scheduled." /> : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Scheduled</TableHead>
                      <TableHead>Campaign</TableHead>
                      <TableHead>Lead</TableHead>
                      <TableHead>Step</TableHead>
                      <TableHead>Account</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.sendCalendar.map((row) => (
                      <TableRow key={row.jobId}>
                        <TableCell className="whitespace-nowrap">{fmtDate(row.scheduledAt)}</TableCell>
                        <TableCell><Link href={`/campaigns/${row.campaignId}`} className="hover:underline">{row.campaignName}</Link></TableCell>
                        <TableCell>
                          <div className="font-medium">{row.leadName}</div>
                          <div className="text-xs text-muted-foreground">{row.leadEmail}</div>
                        </TableCell>
                        <TableCell>
                          <div>Step {row.stepNumber ?? "-"}</div>
                          <div className="text-xs text-muted-foreground max-w-[320px] truncate">{row.subject}</div>
                        </TableCell>
                        <TableCell>
                          <div>{row.accountEmail ?? "-"}</div>
                          {row.warmupEnabled && <Badge variant="outline" className="mt-1">warmup</Badge>}
                        </TableCell>
                        <TableCell><Badge variant="secondary">{row.status}</Badge></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="funnels">
          <Card>
            <CardHeader><CardTitle>Campaign Funnel</CardTitle></CardHeader>
            <CardContent>
              {data.campaignFunnels.length === 0 ? <EmptyState label="No campaign funnel data yet." /> : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Campaign</TableHead>
                      <TableHead>Leads</TableHead>
                      <TableHead>Sent</TableHead>
                      <TableHead>Open</TableHead>
                      <TableHead>Click</TableHead>
                      <TableHead>Reply</TableHead>
                      <TableHead>Bounce</TableHead>
                      <TableHead>No Response</TableHead>
                      <TableHead>Pending</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.campaignFunnels.map((row) => (
                      <TableRow key={row.campaignId}>
                        <TableCell>
                          <Link href={`/campaigns/${row.campaignId}`} className="font-medium hover:underline">{row.campaignName}</Link>
                          <div className="text-xs text-muted-foreground">{row.status}</div>
                        </TableCell>
                        <TableCell>{row.leads}</TableCell>
                        <TableCell>{row.sent}</TableCell>
                        <TableCell>{fmtPct(row.openRate)}</TableCell>
                        <TableCell>{fmtPct(row.clickRate)}</TableCell>
                        <TableCell>{fmtPct(row.replyRate)}</TableCell>
                        <TableCell>{fmtPct(row.bounceRate)}</TableCell>
                        <TableCell>{row.noResponse}</TableCell>
                        <TableCell>{row.pending}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="icp">
          <Card>
            <CardHeader><CardTitle>ICP / Label Performance</CardTitle></CardHeader>
            <CardContent>
              {data.labelPerformance.length === 0 ? <EmptyState label="No labelled performance data yet." /> : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Label</TableHead>
                      <TableHead>Leads</TableHead>
                      <TableHead>Campaigns</TableHead>
                      <TableHead>Sent</TableHead>
                      <TableHead>Open</TableHead>
                      <TableHead>Click</TableHead>
                      <TableHead>Reply</TableHead>
                      <TableHead>Bounce</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.labelPerformance.map((row) => (
                      <TableRow key={row.labelId}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: row.color }} />
                            <span className="font-medium">{row.labelName}</span>
                          </div>
                        </TableCell>
                        <TableCell>{row.leads}</TableCell>
                        <TableCell>{row.campaigns}</TableCell>
                        <TableCell>{row.sent}</TableCell>
                        <TableCell>{fmtPct(row.openRate)}</TableCell>
                        <TableCell>{fmtPct(row.clickRate)}</TableCell>
                        <TableCell>{fmtPct(row.replyRate)}</TableCell>
                        <TableCell>{fmtPct(row.bounceRate)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="timing">
          <div className="grid gap-4 xl:grid-cols-2">
            <TimingTable title="Best Send Hours" rows={data.sendHourPerformance.map((row) => ({ ...row, name: row.label ?? `${row.hour}:00` }))} />
            <TimingTable title="Best Send Days" rows={data.sendDayPerformance.map((row) => ({ ...row, name: row.day ?? "" }))} />
          </div>
        </TabsContent>

        <TabsContent value="links">
          <Card>
            <CardHeader><CardTitle>Link Performance</CardTitle></CardHeader>
            <CardContent>
              {data.linkPerformance.length === 0 ? <EmptyState label="No tracked link clicks yet." /> : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Link</TableHead>
                      <TableHead>Total Clicks</TableHead>
                      <TableHead>Unique Leads</TableHead>
                      <TableHead>Clicked → Replied</TableHead>
                      <TableHead>Last Clicked</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.linkPerformance.map((row) => (
                      <TableRow key={row.url}>
                        <TableCell>
                          <a href={row.url} target="_blank" rel="noreferrer" className="font-medium text-primary hover:underline break-all">{row.url}</a>
                          {row.campaigns.length > 0 && <div className="text-xs text-muted-foreground">{row.campaigns.join(", ")}</div>}
                        </TableCell>
                        <TableCell>{row.totalClicks}</TableCell>
                        <TableCell>{row.uniqueLeads}</TableCell>
                        <TableCell>{row.repliedLeads} ({fmtPct(row.clickToReplyRate)})</TableCell>
                        <TableCell className="whitespace-nowrap">{fmtDate(row.lastClickedAt)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="segments">
          <div className="grid gap-4 xl:grid-cols-2">
            {data.segments.map((segment) => (
              <Card key={segment.id}>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center justify-between text-base">
                    <span>{segment.name}</span>
                    <Badge variant="secondary">{segment.count}</Badge>
                  </CardTitle>
                  <p className="text-xs text-muted-foreground">{segment.description}</p>
                </CardHeader>
                <CardContent>
                  {segment.leads.length === 0 ? <EmptyState label="No leads in this segment." /> : (
                    <div className="space-y-2">
                      {segment.leads.slice(0, 6).map((lead) => (
                        <div key={`${segment.id}-${lead.leadId}-${lead.campaignId}`} className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
                          <div className="min-w-0">
                            <div className="font-medium truncate">{lead.name}</div>
                            <div className="text-xs text-muted-foreground truncate">{lead.email} · {lead.campaignName}</div>
                          </div>
                          <div className="text-xs text-muted-foreground whitespace-nowrap">{fmtDate(lead.lastActivityAt)}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="replies">
          <Card>
            <CardHeader><CardTitle>Reply Classification</CardTitle></CardHeader>
            <CardContent>
              {data.replyClassifications.length === 0 ? <EmptyState label="No replies have been captured yet." /> : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Received</TableHead>
                      <TableHead>Lead</TableHead>
                      <TableHead>Campaign</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Snippet</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.replyClassifications.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="whitespace-nowrap">{fmtDate(row.receivedAt)}</TableCell>
                        <TableCell>
                          <div className="font-medium">{row.leadName}</div>
                          <div className="text-xs text-muted-foreground">{row.leadEmail}</div>
                        </TableCell>
                        <TableCell>{row.campaignId ? <Link href={`/campaigns/${row.campaignId}`} className="hover:underline">{row.campaignName}</Link> : "-"}</TableCell>
                        <TableCell><Badge variant={row.sentiment === "negative" ? "destructive" : row.sentiment === "positive" ? "default" : "secondary"}>{compactReason(row.category)}</Badge></TableCell>
                        <TableCell className="max-w-[520px]">{row.snippet}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="templates">
          <PerformanceTable
            title="Template Performance Library"
            rows={data.templatePerformance.map((row) => ({
              id: row.templateId,
              name: row.templateName,
              detail: `${row.matchedSteps} matched campaign step${row.matchedSteps === 1 ? "" : "s"} · ${row.subject}`,
              ...row,
            }))}
          />
        </TabsContent>

        <TabsContent value="testing">
          <PerformanceTable
            title="A/B Subject and Step Performance"
            rows={data.abPerformance.map((row, index) => ({
              id: index,
              name: row.variant ?? `Variant ${index + 1}`,
              detail: row.preview ?? "",
              ...row,
            }))}
          />
        </TabsContent>

        <TabsContent value="deliverability">
          <Card>
            <CardHeader><CardTitle>Deliverability Health</CardTitle></CardHeader>
            <CardContent>
              {data.deliverability.length === 0 ? <EmptyState label="No sending accounts are connected yet." /> : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Account</TableHead>
                      <TableHead>Health</TableHead>
                      <TableHead>Warmup</TableHead>
                      <TableHead>Today</TableHead>
                      <TableHead>Performance</TableHead>
                      <TableHead>Risk</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.deliverability.map((row) => (
                      <TableRow key={row.accountId}>
                        <TableCell>
                          <div className="font-medium">{row.email}</div>
                          <div className="text-xs text-muted-foreground">{row.status}</div>
                        </TableCell>
                        <TableCell>
                          <div className="font-bold">{row.healthScore}</div>
                          <div className="text-xs text-muted-foreground">health score</div>
                        </TableCell>
                        <TableCell>{row.warmupEnabled ? `Day ${row.warmupDay ?? 1}` : "Off"}</TableCell>
                        <TableCell>{row.sentToday} / {row.effectiveDailyLimit}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {fmtPct(row.openRate)} opens · {fmtPct(row.replyRate)} replies · {fmtPct(row.bounceRate)} bounces
                        </TableCell>
                        <TableCell>
                          <Badge variant={row.risk === "healthy" ? "secondary" : "destructive"}>{compactReason(row.risk)}</Badge>
                          {row.lastError && <div className="text-xs text-destructive mt-1 max-w-[360px] truncate">{row.lastError}</div>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="throttling">
          <Card>
            <CardHeader><CardTitle>Smart Throttling</CardTitle></CardHeader>
            <CardContent>
              {data.throttling.length === 0 ? (
                <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                  <CheckCircle2 className="h-4 w-4" /> No jobs are currently deferred by throttle limits.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Rescheduled</TableHead>
                      <TableHead>Campaign</TableHead>
                      <TableHead>Lead</TableHead>
                      <TableHead>Account</TableHead>
                      <TableHead>Reason</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.throttling.map((row) => (
                      <TableRow key={row.jobId}>
                        <TableCell className="whitespace-nowrap">{fmtDate(row.scheduledAt)}</TableCell>
                        <TableCell><Link href={`/campaigns/${row.campaignId}`} className="hover:underline">{row.campaignName}</Link></TableCell>
                        <TableCell>{row.leadEmail}</TableCell>
                        <TableCell>{row.accountEmail ?? "-"}</TableCell>
                        <TableCell>{row.reason ?? "-"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="timeline">
          <Card>
            <CardHeader><CardTitle>Lead Activity Timeline</CardTitle></CardHeader>
            <CardContent>
              {data.timeline.length === 0 ? <EmptyState label="No activity has been recorded yet." /> : (
                <div className="space-y-2">
                  {data.timeline.slice(0, 120).map((row, index) => (
                    <div key={`${row.eventType}-${row.occurredAt}-${index}`} className="grid gap-3 rounded-md border border-border p-3 md:grid-cols-[180px_220px_220px_1fr]">
                      <div className="text-xs text-muted-foreground">{fmtDate(row.occurredAt)}</div>
                      <div>
                        <Badge variant="secondary" className="capitalize">{compactReason(row.eventType)}</Badge>
                      </div>
                      <div className="min-w-0">
                        <div className="font-medium truncate">{row.leadName}</div>
                        <div className="text-xs text-muted-foreground truncate">{row.leadEmail}</div>
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm truncate">{row.campaignId ? <Link href={`/campaigns/${row.campaignId}`} className="hover:underline">{row.campaignName}</Link> : row.campaignName}</div>
                        <div className="text-xs text-muted-foreground truncate">{row.detail}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function PerformanceTable({ title, rows }: { title: string; rows: Array<PerformanceRow & { id: number; name: string; detail: string }> }) {
  return (
    <Card>
      <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
      <CardContent>
        {rows.length === 0 ? <EmptyState label="No performance data is available yet." /> : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Sent</TableHead>
                <TableHead>Open</TableHead>
                <TableHead>Click</TableHead>
                <TableHead>Reply</TableHead>
                <TableHead>Bounce</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <div className="font-medium">{row.name}</div>
                    <div className="text-xs text-muted-foreground max-w-[600px] truncate">{row.detail}</div>
                  </TableCell>
                  <TableCell>{row.sent}</TableCell>
                  <TableCell>{fmtPct(row.openRate)}</TableCell>
                  <TableCell>{fmtPct(row.clickRate)}</TableCell>
                  <TableCell>{fmtPct(row.replyRate)}</TableCell>
                  <TableCell>{fmtPct(row.bounceRate)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function TimingTable({ title, rows }: { title: string; rows: Array<TimingPerformanceRow & { name: string }> }) {
  return (
    <Card>
      <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
      <CardContent>
        {rows.length === 0 ? <EmptyState label="No timing data yet." /> : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Sent</TableHead>
                <TableHead>Open</TableHead>
                <TableHead>Click</TableHead>
                <TableHead>Reply</TableHead>
                <TableHead>Bounce</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.name}>
                  <TableCell className="font-medium">{row.name}</TableCell>
                  <TableCell>{row.sent}</TableCell>
                  <TableCell>{fmtPct(row.openRate)}</TableCell>
                  <TableCell>{fmtPct(row.clickRate)}</TableCell>
                  <TableCell>{fmtPct(row.replyRate)}</TableCell>
                  <TableCell>{fmtPct(row.bounceRate)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
