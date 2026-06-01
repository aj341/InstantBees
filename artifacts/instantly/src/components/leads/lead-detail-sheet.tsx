import { useEffect, useMemo, useState } from "react";
import {
  useUpdateLead,
  useSetLeadLabels,
  useGetLeadActivity,
  getListLeadsQueryKey,
  getGetLeadActivityQueryKey,
  type Lead,
  type Label,
  type LeadCampaignActivity,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label as UILabel } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tag, CheckCircle2, ExternalLink, Mail, MousePointerClick, Reply, AlertTriangle, Send, Loader2, Clock } from "lucide-react";
import { toast } from "@/hooks/use-toast";

type LabelLite = Pick<Label, "id" | "name" | "color">;

interface Props {
  lead: Lead | null;
  labels: Label[] | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const STATUS_OPTIONS = ["active", "unsubscribed", "bounced", "replied"] as const;

const STATUS_BADGE: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  active: "default",
  unsubscribed: "secondary",
  bounced: "destructive",
  replied: "outline",
};

const CAMPAIGN_BADGE: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  active: "default",
  draft: "secondary",
  paused: "outline",
  completed: "secondary",
};

interface LeadTimelineEvent {
  campaignId: number | null;
  campaignName: string;
  stepNumber: number | null;
  subject: string;
  eventType: string;
  occurredAt: string | null;
  detail: string;
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleString();
  } catch {
    return "—";
  }
}

export function LeadDetailSheet({ lead, labels, open, onOpenChange }: Props) {
  const queryClient = useQueryClient();

  const [form, setForm] = useState({
    email: "", firstName: "", lastName: "", company: "", title: "", website: "", phone: "",
    status: "active" as (typeof STATUS_OPTIONS)[number],
  });
  const [selectedLabelIds, setSelectedLabelIds] = useState<number[]>([]);

  // Reset state whenever a new lead is opened.
  useEffect(() => {
    if (!lead) return;
    setForm({
      email: lead.email ?? "",
      firstName: lead.firstName ?? "",
      lastName: lead.lastName ?? "",
      company: lead.company ?? "",
      title: lead.title ?? "",
      website: lead.website ?? "",
      phone: lead.phone ?? "",
      status: (lead.status ?? "active") as (typeof STATUS_OPTIONS)[number],
    });
    setSelectedLabelIds((lead.labels ?? []).map((l: LabelLite) => l.id));
  }, [lead]);

  const invalidateLeads = () => queryClient.invalidateQueries({ queryKey: getListLeadsQueryKey() });

  // Locally-tracked latest snapshot of the lead so the header stays fresh
  // after a save without waiting for the list to refetch.
  const [liveLead, setLiveLead] = useState<Lead | null>(null);
  useEffect(() => { setLiveLead(lead); }, [lead]);
  const displayLead = liveLead ?? lead;

  const updateLead = useUpdateLead({
    mutation: {
      onSuccess: (updated) => {
        toast({ title: "Lead updated" });
        if (updated) setLiveLead(updated);
        invalidateLeads();
      },
      onError: () => toast({ title: "Failed to update lead", variant: "destructive" }),
    },
  });

  const setLeadLabels = useSetLeadLabels({
    mutation: {
      onSuccess: () => {
        invalidateLeads();
        toast({ title: "Labels updated" });
      },
      onError: () => toast({ title: "Failed to update labels", variant: "destructive" }),
    },
  });

  const activity = useGetLeadActivity(lead?.id ?? 0, {
    query: {
      enabled: open && !!lead?.id,
      queryKey: lead?.id ? getGetLeadActivityQueryKey(lead.id) : ["lead-activity-disabled"],
    },
  });

  const fullName = useMemo(() => {
    if (!displayLead) return "";
    return [displayLead.firstName, displayLead.lastName].filter(Boolean).join(" ") || displayLead.email;
  }, [displayLead]);

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!lead) return;
    updateLead.mutate({
      id: lead.id,
      data: {
        email: form.email.trim(),
        firstName: form.firstName.trim() || undefined,
        lastName: form.lastName.trim() || undefined,
        company: form.company.trim() || undefined,
        title: form.title.trim() || undefined,
        website: form.website.trim() || undefined,
        phone: form.phone.trim() || undefined,
        status: form.status,
      },
    });
  }

  function toggleLabel(labelId: number) {
    if (!lead) return;
    const next = selectedLabelIds.includes(labelId)
      ? selectedLabelIds.filter((id) => id !== labelId)
      : [...selectedLabelIds, labelId];
    setSelectedLabelIds(next);
    setLeadLabels.mutate({ id: lead.id, data: { labelIds: next } });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto" data-testid="sheet-lead-detail">
        {!displayLead ? null : (
          <>
            <SheetHeader>
              <SheetTitle data-testid="text-lead-name">{fullName}</SheetTitle>
              <SheetDescription className="flex items-center gap-2">
                <span data-testid="text-lead-email">{displayLead.email}</span>
                <Badge variant={STATUS_BADGE[displayLead.status ?? "active"] ?? "secondary"} data-testid="badge-lead-status">
                  {displayLead.status}
                </Badge>
              </SheetDescription>
            </SheetHeader>

            <Tabs defaultValue="details" className="mt-6">
              <TabsList className="w-full grid grid-cols-2">
                <TabsTrigger value="details" data-testid="tab-details">Details</TabsTrigger>
                <TabsTrigger value="activity" data-testid="tab-activity">
                  Activity{activity.data?.campaigns?.length ? ` (${activity.data.campaigns.length})` : ""}
                </TabsTrigger>
              </TabsList>

              {/* ─── DETAILS ─────────────────────────────────────────────── */}
              <TabsContent value="details" className="space-y-6 mt-4">
                <form onSubmit={handleSave} className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="col-span-2 space-y-1.5">
                      <UILabel htmlFor="ld-email">Email</UILabel>
                      <Input id="ld-email" type="email" value={form.email}
                        onChange={(e) => setForm({ ...form, email: e.target.value })}
                        data-testid="input-detail-email" />
                    </div>
                    <div className="space-y-1.5">
                      <UILabel htmlFor="ld-first">First name</UILabel>
                      <Input id="ld-first" value={form.firstName}
                        onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                        data-testid="input-detail-firstname" />
                    </div>
                    <div className="space-y-1.5">
                      <UILabel htmlFor="ld-last">Last name</UILabel>
                      <Input id="ld-last" value={form.lastName}
                        onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                        data-testid="input-detail-lastname" />
                    </div>
                    <div className="space-y-1.5">
                      <UILabel htmlFor="ld-company">Company</UILabel>
                      <Input id="ld-company" value={form.company}
                        onChange={(e) => setForm({ ...form, company: e.target.value })}
                        data-testid="input-detail-company" />
                    </div>
                    <div className="space-y-1.5">
                      <UILabel htmlFor="ld-title">Title</UILabel>
                      <Input id="ld-title" value={form.title}
                        onChange={(e) => setForm({ ...form, title: e.target.value })}
                        data-testid="input-detail-title" />
                    </div>
                    <div className="space-y-1.5">
                      <UILabel htmlFor="ld-website">Website</UILabel>
                      <Input id="ld-website" value={form.website}
                        onChange={(e) => setForm({ ...form, website: e.target.value })}
                        data-testid="input-detail-website" />
                    </div>
                    <div className="space-y-1.5">
                      <UILabel htmlFor="ld-phone">Phone</UILabel>
                      <Input id="ld-phone" value={form.phone}
                        onChange={(e) => setForm({ ...form, phone: e.target.value })}
                        data-testid="input-detail-phone" />
                    </div>
                    <div className="col-span-2 space-y-1.5">
                      <UILabel htmlFor="ld-status">Status</UILabel>
                      <Select
                        value={form.status}
                        onValueChange={(v) => setForm({ ...form, status: v as (typeof STATUS_OPTIONS)[number] })}
                      >
                        <SelectTrigger id="ld-status" data-testid="select-detail-status">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {STATUS_OPTIONS.map((s) => (
                            <SelectItem key={s} value={s} data-testid={`select-status-${s}`}>{s}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="flex justify-end">
                    <Button type="submit" disabled={updateLead.isPending} data-testid="button-save-lead">
                      {updateLead.isPending ? "Saving..." : "Save changes"}
                    </Button>
                  </div>
                </form>

                {/* Labels picker */}
                <div className="space-y-2 pt-2 border-t border-border">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Tag className="h-4 w-4" /> Labels
                  </div>
                  {!labels?.length ? (
                    <p className="text-xs text-muted-foreground">
                      No labels yet. Create one from <span className="font-medium">Manage Labels</span>.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {labels.map((lbl) => {
                        const selected = selectedLabelIds.includes(lbl.id);
                        const color = lbl.color || "#06b6d4";
                        return (
                          <button
                            key={lbl.id}
                            type="button"
                            onClick={() => toggleLabel(lbl.id)}
                            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium border transition-opacity"
                            style={{
                              backgroundColor: selected ? `${color}33` : "transparent",
                              borderColor: `${color}66`,
                              color,
                              opacity: selected ? 1 : 0.6,
                            }}
                            data-testid={`detail-toggle-label-${lbl.id}`}
                          >
                            <Tag className="h-2.5 w-2.5" />
                            {lbl.name}
                            {selected && <CheckCircle2 className="h-3 w-3" />}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </TabsContent>

              {/* ─── ACTIVITY ────────────────────────────────────────────── */}
              <TabsContent value="activity" className="mt-4 space-y-3">
                {activity.isLoading ? (
                  <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Loading activity...
                  </div>
                ) : !activity.data?.campaigns?.length ? (
                  <div className="flex flex-col items-center justify-center py-12 text-muted-foreground text-sm gap-2">
                    <Mail className="h-8 w-8 opacity-30" />
                    This lead hasn't been added to any campaigns yet.
                  </div>
                ) : (
                  <>
                    {activity.data.campaigns.map((c: LeadCampaignActivity) => (
                      <CampaignActivityCard key={c.campaignId} c={c} />
                    ))}
                    <LeadTimeline events={(activity.data as { timeline?: LeadTimelineEvent[] }).timeline ?? []} />
                  </>
                )}
              </TabsContent>
            </Tabs>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function LeadTimeline({ events }: { events: LeadTimelineEvent[] }) {
  if (!events.length) return null;

  return (
    <div className="rounded-md border border-border bg-card p-4 space-y-3" data-testid="lead-activity-timeline">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Clock className="h-4 w-4" /> Timeline
      </div>
      <div className="space-y-2">
        {events.slice(0, 30).map((event, index) => (
          <div key={`${event.eventType}-${event.occurredAt}-${index}`} className="flex gap-3 rounded-md bg-muted/30 p-3">
            <Badge variant="secondary" className="h-fit capitalize">{event.eventType.replaceAll("_", " ")}</Badge>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium truncate">
                  {event.campaignId ? (
                    <Link href={`/campaigns/${event.campaignId}`} className="hover:underline">
                      {event.campaignName}
                    </Link>
                  ) : event.campaignName}
                </p>
                <span className="text-[11px] text-muted-foreground whitespace-nowrap">{fmtDate(event.occurredAt)}</span>
              </div>
              <p className="text-xs text-muted-foreground truncate">
                {event.stepNumber ? `Step ${event.stepNumber} · ` : ""}{event.detail || event.subject}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CampaignActivityCard({ c }: { c: LeadCampaignActivity }) {
  const progressPct = c.totalSteps > 0 ? Math.min(100, (c.currentStep / c.totalSteps) * 100) : 0;
  return (
    <div className="rounded-md border border-border bg-card p-4 space-y-3" data-testid={`activity-campaign-${c.campaignId}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Link
              href={`/campaigns/${c.campaignId}`}
              className="font-medium text-sm hover:underline truncate inline-flex items-center gap-1"
              data-testid={`link-campaign-${c.campaignId}`}
            >
              {c.campaignName}
              <ExternalLink className="h-3 w-3 opacity-60" />
            </Link>
            <Badge variant={CAMPAIGN_BADGE[c.campaignStatus] ?? "secondary"} className="text-[10px]">
              {c.campaignStatus}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Step {c.currentStep} of {c.totalSteps || "—"}
            {c.nextStepNumber != null && (
              <> · next step #{c.nextStepNumber} {c.nextScheduledAt && `· ${fmtDate(c.nextScheduledAt)}`}</>
            )}
          </p>
        </div>
      </div>

      {/* Sequence progress bar */}
      {c.totalSteps > 0 && (
        <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
          <div className="h-full bg-primary transition-all" style={{ width: `${progressPct}%` }} />
        </div>
      )}

      {/* Stat grid */}
      <div className="grid grid-cols-4 gap-2 text-center">
        <Stat icon={<Send className="h-3 w-3" />} label="Sent" value={c.sent} />
        <Stat icon={<Mail className="h-3 w-3" />} label="Opens" value={c.opened} rate={c.openRate} />
        <Stat icon={<MousePointerClick className="h-3 w-3" />} label="Clicks" value={c.clicked} rate={c.clickRate} />
        <Stat icon={<Reply className="h-3 w-3" />} label="Replies" value={c.replied} rate={c.replyRate} />
      </div>

      {c.bounced > 0 && (
        <div className="flex items-center gap-1.5 text-xs text-destructive">
          <AlertTriangle className="h-3 w-3" />
          {c.bounced} bounce{c.bounced > 1 ? "s" : ""} ({c.bounceRate}%)
        </div>
      )}

      {(c.lastSentAt || c.lastOpenedAt || c.lastClickedAt || c.lastRepliedAt) && (
        <div className="text-[11px] text-muted-foreground space-y-0.5 pt-1 border-t border-border">
          {c.lastSentAt && <div>Last sent: {fmtDate(c.lastSentAt)}</div>}
          {c.lastOpenedAt && <div>Last opened: {fmtDate(c.lastOpenedAt)}</div>}
          {c.lastClickedAt && <div>Last clicked: {fmtDate(c.lastClickedAt)}</div>}
          {c.lastRepliedAt && <div>Replied: {fmtDate(c.lastRepliedAt)}</div>}
        </div>
      )}
    </div>
  );
}

function Stat({ icon, label, value, rate }: { icon: React.ReactNode; label: string; value: number; rate?: number }) {
  return (
    <div className="rounded-md bg-muted/40 px-2 py-1.5">
      <div className="flex items-center justify-center gap-1 text-[10px] text-muted-foreground uppercase tracking-wider">
        {icon} {label}
      </div>
      <div className="text-base font-semibold leading-tight">{value}</div>
      {rate != null && rate > 0 && (
        <div className="text-[10px] text-muted-foreground">{rate}%</div>
      )}
    </div>
  );
}
