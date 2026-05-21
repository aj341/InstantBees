import { useState } from "react";
import { useParams, useLocation } from "wouter";
import {
  useGetCampaign,
  useGetCampaignAnalytics,
  useListSequences,
  useListCampaignLeads,
  useListLeads,
  useCreateSequence,
  useUpdateSequence,
  useDeleteSequence,
  useAddLeadsToCampaign,
  useRemoveLeadFromCampaign,
  useLaunchCampaign,
  usePauseCampaign,
  getGetCampaignQueryKey,
  getGetCampaignAnalyticsQueryKey,
  getListSequencesQueryKey,
  getListCampaignLeadsQueryKey,
  getListCampaignsQueryKey,
  getGetCampaignStatsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Play, Pause, Plus, Trash2, Pencil, UserPlus, Mail, TrendingUp, MessageSquare, Users, Code2, AlignLeft, Type } from "lucide-react";
import { Link } from "wouter";
import { toast } from "@/hooks/use-toast";
import { RichTextEditor } from "@/components/email-editor/rich-text-editor";

const seqSchema = z.object({
  subject: z.string().min(1, "Subject required"),
  body: z.string().min(1, "Body required"),
  bodyType: z.enum(["text", "html"]).default("text"),
  delayDays: z.coerce.number().min(0).default(0),
});

type SeqForm = z.infer<typeof seqSchema>;

const STATUS_COLORS: Record<string, string> = {
  draft: "secondary",
  active: "default",
  paused: "outline",
  completed: "secondary",
};

export default function CampaignDetail() {
  const params = useParams<{ id: string }>();
  const id = parseInt(params.id, 10);
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const [seqDialogOpen, setSeqDialogOpen] = useState(false);
  const [editStep, setEditStep] = useState<{ id: number; subject: string; body: string; bodyType: "text" | "html"; delayDays: number } | null>(null);
  const [addLeadOpen, setAddLeadOpen] = useState(false);
  const [selectedLeadIds, setSelectedLeadIds] = useState<number[]>([]);

  const { data: campaign, isLoading } = useGetCampaign(id, { query: { enabled: !!id, queryKey: getGetCampaignQueryKey(id) } });
  const { data: analytics } = useGetCampaignAnalytics(id, { query: { enabled: !!id, queryKey: getGetCampaignAnalyticsQueryKey(id) } });
  const { data: steps } = useListSequences(id, { query: { enabled: !!id, queryKey: getListSequencesQueryKey(id) } });
  const { data: campaignLeads } = useListCampaignLeads(id, { query: { enabled: !!id, queryKey: getListCampaignLeadsQueryKey(id) } });
  const { data: allLeads } = useListLeads();

  const launch = useLaunchCampaign({
    mutation: {
      onSuccess: () => {
        toast({ title: "Campaign launched" });
        queryClient.invalidateQueries({ queryKey: getGetCampaignQueryKey(id) });
        queryClient.invalidateQueries({ queryKey: getListCampaignsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetCampaignStatsQueryKey() });
      },
      onError: () => toast({ title: "Failed to launch", variant: "destructive" }),
    },
  });

  const pause = usePauseCampaign({
    mutation: {
      onSuccess: () => {
        toast({ title: "Campaign paused" });
        queryClient.invalidateQueries({ queryKey: getGetCampaignQueryKey(id) });
        queryClient.invalidateQueries({ queryKey: getListCampaignsQueryKey() });
      },
      onError: () => toast({ title: "Failed to pause", variant: "destructive" }),
    },
  });

  const createSeq = useCreateSequence({
    mutation: {
      onSuccess: () => {
        toast({ title: "Step added" });
        queryClient.invalidateQueries({ queryKey: getListSequencesQueryKey(id) });
        setSeqDialogOpen(false);
        seqForm.reset();
      },
      onError: () => toast({ title: "Failed to add step", variant: "destructive" }),
    },
  });

  const updateSeq = useUpdateSequence({
    mutation: {
      onSuccess: () => {
        toast({ title: "Step updated" });
        queryClient.invalidateQueries({ queryKey: getListSequencesQueryKey(id) });
        setEditStep(null);
        seqForm.reset();
      },
      onError: () => toast({ title: "Failed to update step", variant: "destructive" }),
    },
  });

  const deleteSeq = useDeleteSequence({
    mutation: {
      onSuccess: () => {
        toast({ title: "Step deleted" });
        queryClient.invalidateQueries({ queryKey: getListSequencesQueryKey(id) });
      },
      onError: () => toast({ title: "Failed to delete step", variant: "destructive" }),
    },
  });

  const addLeads = useAddLeadsToCampaign({
    mutation: {
      onSuccess: () => {
        toast({ title: "Leads added to campaign" });
        queryClient.invalidateQueries({ queryKey: getListCampaignLeadsQueryKey(id) });
        queryClient.invalidateQueries({ queryKey: getGetCampaignQueryKey(id) });
        setAddLeadOpen(false);
        setSelectedLeadIds([]);
      },
      onError: () => toast({ title: "Failed to add leads", variant: "destructive" }),
    },
  });

  const removeLead = useRemoveLeadFromCampaign({
    mutation: {
      onSuccess: () => {
        toast({ title: "Lead removed" });
        queryClient.invalidateQueries({ queryKey: getListCampaignLeadsQueryKey(id) });
        queryClient.invalidateQueries({ queryKey: getGetCampaignQueryKey(id) });
      },
      onError: () => toast({ title: "Failed to remove lead", variant: "destructive" }),
    },
  });

  const seqForm = useForm<SeqForm>({
    resolver: zodResolver(seqSchema),
    defaultValues: { subject: "", body: "", bodyType: "text", delayDays: 0 },
  });

  const watchedBodyType = seqForm.watch("bodyType");

  function onSeqSubmit(values: SeqForm) {
    if (editStep) {
      updateSeq.mutate({ id, stepId: editStep.id, data: values });
    } else {
      createSeq.mutate({ id, data: values });
    }
  }

  function openEdit(step: { id: number; subject: string; body: string; bodyType: "text" | "html"; delayDays: number }) {
    setEditStep(step);
    seqForm.reset({ subject: step.subject, body: step.body, bodyType: step.bodyType ?? "text", delayDays: step.delayDays });
    setSeqDialogOpen(true);
  }

  const campaignLeadIds = new Set(campaignLeads?.map(l => l.id));
  const availableLeads = allLeads?.filter(l => !campaignLeadIds.has(l.id)) ?? [];

  if (isLoading) return <div className="p-8 text-muted-foreground">Loading campaign...</div>;
  if (!campaign) return <div className="p-8 text-muted-foreground">Campaign not found.</div>;

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <Link href="/campaigns">
            <Button variant="ghost" size="icon" data-testid="button-back">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold truncate">{campaign.name}</h1>
              <Badge variant={STATUS_COLORS[campaign.status] as any} className="capitalize shrink-0">
                {campaign.status}
              </Badge>
            </div>
            {campaign.fromName && <p className="text-sm text-muted-foreground">From: {campaign.fromName}</p>}
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          {campaign.status === "active" ? (
            <Button variant="outline" onClick={() => pause.mutate({ id })} disabled={pause.isPending} data-testid="button-pause-campaign">
              <Pause className="mr-2 h-4 w-4" /> Pause
            </Button>
          ) : (
            <Button onClick={() => launch.mutate({ id })} disabled={launch.isPending} data-testid="button-launch-campaign">
              <Play className="mr-2 h-4 w-4" /> Launch
            </Button>
          )}
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview" data-testid="tab-overview">Overview</TabsTrigger>
          <TabsTrigger value="sequence" data-testid="tab-sequence">Sequence ({steps?.length ?? 0})</TabsTrigger>
          <TabsTrigger value="leads" data-testid="tab-leads">Leads ({campaign.leadsCount})</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-4 mt-4">
          <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
            {[
              { label: "Sent", value: campaign.sentCount, icon: Mail },
              { label: "Open Rate", value: `${analytics?.openRate ?? 0}%`, icon: TrendingUp },
              { label: "Reply Rate", value: `${analytics?.replyRate ?? 0}%`, icon: MessageSquare },
              { label: "Leads", value: campaign.leadsCount, icon: Users },
            ].map(stat => (
              <Card key={stat.label}>
                <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                  <CardTitle className="text-sm font-medium text-muted-foreground">{stat.label}</CardTitle>
                  <stat.icon className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold" data-testid={`stat-${stat.label.toLowerCase()}`}>{stat.value}</div>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader><CardTitle>Campaign Settings</CardTitle></CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <dt className="text-muted-foreground">Daily Limit</dt>
                  <dd className="font-medium">{campaign.dailyLimit ?? "No limit"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Reply-To</dt>
                  <dd className="font-medium">{campaign.replyTo ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Track Opens</dt>
                  <dd className="font-medium">{campaign.trackOpens ? "Yes" : "No"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Track Clicks</dt>
                  <dd className="font-medium">{campaign.trackClicks ? "Yes" : "No"}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Sequence Tab */}
        <TabsContent value="sequence" className="mt-4 space-y-4">
          <div className="flex justify-end">
            <Button onClick={() => { setEditStep(null); seqForm.reset(); setSeqDialogOpen(true); }} data-testid="button-add-step">
              <Plus className="mr-2 h-4 w-4" /> Add Step
            </Button>
          </div>

          {steps?.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground">
              <Mail className="h-8 w-8 opacity-30" />
              <p className="text-sm">No sequence steps yet. Add your first email step.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {steps?.map((step, idx) => (
                <Card key={step.id} data-testid={`card-step-${step.id}`}>
                  <CardContent className="pt-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-3 min-w-0">
                        <div className="h-7 w-7 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold shrink-0">
                          {idx + 1}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="font-medium truncate">{step.subject}</p>
                            {step.bodyType === "html" && (
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0">HTML</Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {idx === 0 ? "Day 0 (initial)" : `+${step.delayDays} day${step.delayDays !== 1 ? "s" : ""} after previous step`}
                          </p>
                          <p className="text-sm text-muted-foreground mt-2 line-clamp-2">
                            {step.bodyType === "html"
                              ? step.body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
                              : step.body}
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <Button variant="ghost" size="icon" onClick={() => openEdit({ ...step, bodyType: (step.bodyType ?? "text") as "text" | "html" })} data-testid={`button-edit-step-${step.id}`}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => deleteSeq.mutate({ id, stepId: step.id })} data-testid={`button-delete-step-${step.id}`}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Leads Tab */}
        <TabsContent value="leads" className="mt-4 space-y-4">
          <div className="flex justify-end">
            <Button onClick={() => setAddLeadOpen(true)} disabled={availableLeads.length === 0} data-testid="button-add-leads">
              <UserPlus className="mr-2 h-4 w-4" /> Add Leads
            </Button>
          </div>

          <div className="rounded-md border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {campaignLeads?.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-12 text-center text-muted-foreground text-sm">
                      No leads in this campaign yet.
                    </TableCell>
                  </TableRow>
                ) : campaignLeads?.map(lead => (
                  <TableRow key={lead.id} data-testid={`row-campaign-lead-${lead.id}`}>
                    <TableCell className="font-medium">{lead.email}</TableCell>
                    <TableCell>{[lead.firstName, lead.lastName].filter(Boolean).join(" ") || "—"}</TableCell>
                    <TableCell>{lead.company || "—"}</TableCell>
                    <TableCell><Badge variant="secondary">{lead.status}</Badge></TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" onClick={() => removeLead.mutate({ id, leadId: lead.id })} data-testid={`button-remove-lead-${lead.id}`}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>

      {/* Sequence step dialog */}
      <Dialog open={seqDialogOpen} onOpenChange={v => { setSeqDialogOpen(v); if (!v) { setEditStep(null); seqForm.reset(); } }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editStep ? "Edit Step" : "Add Sequence Step"}</DialogTitle>
          </DialogHeader>
          <Form {...seqForm}>
            <form onSubmit={seqForm.handleSubmit(onSeqSubmit)} className="space-y-4">
              <FormField control={seqForm.control} name="subject" render={({ field }) => (
                <FormItem>
                  <FormLabel>Subject</FormLabel>
                  <FormControl><Input placeholder="Re: Quick question about {{company}}" data-testid="input-step-subject" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              {/* Body type toggle */}
              <FormField control={seqForm.control} name="bodyType" render={({ field }) => (
                <FormItem>
                  <div className="flex items-center justify-between">
                    <FormLabel>Body</FormLabel>
                    <div className="flex items-center gap-1 rounded-md border border-border bg-muted/30 p-0.5">
                      <button
                        type="button"
                        onClick={() => field.onChange("text")}
                        className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors ${field.value === "text" ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                        data-testid="toggle-body-text"
                      >
                        <Type className="h-3 w-3" /> Plain Text
                      </button>
                      <button
                        type="button"
                        onClick={() => field.onChange("html")}
                        className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors ${field.value === "html" ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                        data-testid="toggle-body-html"
                      >
                        <Code2 className="h-3 w-3" /> Rich HTML
                      </button>
                    </div>
                  </div>
                </FormItem>
              )} />

              <FormField control={seqForm.control} name="body" render={({ field }) => (
                <FormItem>
                  <FormControl>
                    {watchedBodyType === "html" ? (
                      <RichTextEditor
                        value={field.value}
                        onChange={field.onChange}
                        placeholder="Write your HTML email here..."
                        data-testid="input-step-body"
                      />
                    ) : (
                      <Textarea
                        placeholder={"Hi {{firstName}},\n\n..."}
                        rows={7}
                        data-testid="input-step-body"
                        {...field}
                      />
                    )}
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={seqForm.control} name="delayDays" render={({ field }) => (
                <FormItem>
                  <FormLabel>Delay (days after previous step)</FormLabel>
                  <FormControl><Input type="number" min={0} data-testid="input-step-delay" {...field} /></FormControl>
                  <FormDescription>0 = same day as previous step or campaign launch</FormDescription>
                </FormItem>
              )} />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setSeqDialogOpen(false)} data-testid="button-cancel-step">Cancel</Button>
                <Button type="submit" disabled={createSeq.isPending || updateSeq.isPending} data-testid="button-submit-step">
                  {editStep ? "Save Changes" : "Add Step"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Add leads dialog */}
      <Dialog open={addLeadOpen} onOpenChange={setAddLeadOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Leads to Campaign</DialogTitle>
          </DialogHeader>
          <div className="max-h-80 overflow-y-auto space-y-2">
            {availableLeads.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">All leads are already in this campaign</p>
            ) : availableLeads.map(lead => (
              <label
                key={lead.id}
                className="flex items-center gap-3 p-2 rounded hover:bg-accent cursor-pointer"
                data-testid={`label-lead-select-${lead.id}`}
              >
                <input
                  type="checkbox"
                  checked={selectedLeadIds.includes(lead.id)}
                  onChange={e => {
                    setSelectedLeadIds(prev =>
                      e.target.checked ? [...prev, lead.id] : prev.filter(x => x !== lead.id)
                    );
                  }}
                  className="rounded border-border"
                />
                <div>
                  <p className="text-sm font-medium">{lead.email}</p>
                  {lead.company && <p className="text-xs text-muted-foreground">{lead.company}</p>}
                </div>
              </label>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setAddLeadOpen(false); setSelectedLeadIds([]); }} data-testid="button-cancel-add-leads">Cancel</Button>
            <Button
              disabled={selectedLeadIds.length === 0 || addLeads.isPending}
              onClick={() => addLeads.mutate({ id, data: { leadIds: selectedLeadIds } })}
              data-testid="button-submit-add-leads"
            >
              {addLeads.isPending ? "Adding..." : `Add ${selectedLeadIds.length} Lead${selectedLeadIds.length !== 1 ? "s" : ""}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
