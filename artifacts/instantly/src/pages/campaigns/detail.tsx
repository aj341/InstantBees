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
  useDeleteCampaign,
  useListTemplates,
  useListAccounts,
  useSendTestStep,
  getGetCampaignQueryKey,
  getGetCampaignAnalyticsQueryKey,
  getListSequencesQueryKey,
  getListCampaignLeadsQueryKey,
  getListCampaignsQueryKey,
  getGetCampaignStatsQueryKey,
  getListTemplatesQueryKey,
  getListAccountsQueryKey,
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Play, Pause, Plus, Trash2, Pencil, UserPlus, Mail, TrendingUp, MessageSquare, Users, Code2, AlignLeft, Type, FileText, Send, Braces } from "lucide-react";
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
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<"text" | "rich" | "source">("text");
  const [testDialog, setTestDialog] = useState<{ stepId: number; subject: string } | null>(null);
  const [testAccountId, setTestAccountId] = useState<number | null>(null);
  const [testToEmail, setTestToEmail] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { data: templates } = useListTemplates({ query: { queryKey: getListTemplatesQueryKey() } });
  const { data: accounts } = useListAccounts({ query: { queryKey: getListAccountsQueryKey() } });

  const sendTest = useSendTestStep({
    mutation: {
      onSuccess: (data: { ok: boolean; error?: string }) => {
        if (data.ok) {
          toast({ title: "Test sent", description: `Email sent to ${testToEmail}` });
          setTestDialog(null);
        } else {
          toast({ title: "Test send failed", description: data.error ?? "Unknown error", variant: "destructive" });
        }
      },
      onError: (err: Error) => toast({ title: "Test send failed", description: err.message, variant: "destructive" }),
    },
  });

  function openTestDialog(step: { id: number; subject: string }) {
    const firstSendable = accounts?.find(a => a.hasSmtpPassword);
    if (firstSendable) {
      setTestAccountId(firstSendable.id);
      setTestToEmail(firstSendable.email);
    }
    setTestDialog({ stepId: step.id, subject: step.subject });
  }

  function submitTest() {
    if (!testDialog || !testAccountId || !testToEmail) return;
    sendTest.mutate({ id, stepId: testDialog.stepId, data: { accountId: testAccountId, toEmail: testToEmail } });
  }

  function inferEditorMode(body: string, bodyType: string): "text" | "rich" | "source" {
    if (bodyType !== "html") return "text";
    if (/<!doctype|<html|<head|<style|<body/i.test(body)) return "source";
    return "rich";
  }

  function setMode(mode: "text" | "rich" | "source") {
    setEditorMode(mode);
    seqForm.setValue("bodyType", mode === "text" ? "text" : "html");
  }

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

  const remove = useDeleteCampaign({
    mutation: {
      onSuccess: () => {
        toast({ title: "Campaign deleted" });
        queryClient.invalidateQueries({ queryKey: getListCampaignsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetCampaignStatsQueryKey() });
        setLocation("/campaigns");
      },
      onError: () => toast({ title: "Failed to delete campaign", variant: "destructive" }),
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

  function onSeqSubmit(values: SeqForm) {
    if (editStep) {
      updateSeq.mutate({ id, stepId: editStep.id, data: values });
    } else {
      createSeq.mutate({ id, data: values });
    }
  }

  function openEdit(step: { id: number; subject: string; body: string; bodyType: "text" | "html"; delayDays: number }) {
    setEditStep(step);
    const bt = step.bodyType ?? "text";
    seqForm.reset({ subject: step.subject, body: step.body, bodyType: bt, delayDays: step.delayDays });
    setEditorMode(inferEditorMode(step.body, bt));
    setSeqDialogOpen(true);
  }

  function openCreate() {
    setEditStep(null);
    seqForm.reset({ subject: "", body: "", bodyType: "text", delayDays: 0 });
    setEditorMode("text");
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
          <Button
            variant="outline"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => setConfirmDelete(true)}
            data-testid="button-delete-campaign"
          >
            <Trash2 className="mr-2 h-4 w-4" /> Delete
          </Button>
        </div>
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this campaign?</AlertDialogTitle>
            <AlertDialogDescription>
              Permanently deletes <span className="font-medium">{campaign.name}</span> along with its sequence steps,
              send jobs, lead assignments, replies, and unsubscribe tokens. Leads themselves stay in your database.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-campaign">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => remove.mutate({ id })}
              data-testid="button-confirm-delete-campaign"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
                <div>
                  <dt className="text-muted-foreground">Unsubscribe Link</dt>
                  <dd className="font-medium">{campaign.includeUnsubscribe ? "Included" : "Off"}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Sequence Tab */}
        <TabsContent value="sequence" className="mt-4 space-y-4">
          <div className="flex justify-end">
            <Button onClick={openCreate} data-testid="button-add-step">
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
                        <Button variant="ghost" size="icon" onClick={() => openTestDialog({ id: step.id, subject: step.subject })} title="Send test to me" data-testid={`button-test-step-${step.id}`}>
                          <Send className="h-4 w-4" />
                        </Button>
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

      {/* Template picker dialog */}
      <Dialog open={templatePickerOpen} onOpenChange={setTemplatePickerOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Load from Template</DialogTitle>
          </DialogHeader>
          <div className="max-h-96 overflow-y-auto space-y-2">
            {!templates?.length ? (
              <p className="text-sm text-muted-foreground text-center py-6">
                No templates saved yet. Go to <span className="font-medium">Templates</span> in the sidebar to create some.
              </p>
            ) : templates.map(t => (
              <button
                key={t.id}
                type="button"
                className="w-full text-left p-3 rounded-md border border-border hover:bg-accent transition-colors"
                onClick={() => {
                  seqForm.setValue("subject", t.subject);
                  seqForm.setValue("body", t.body);
                  const bt = (t.bodyType as "text" | "html") ?? "text";
                  seqForm.setValue("bodyType", bt);
                  setEditorMode(inferEditorMode(t.body, bt));
                  setTemplatePickerOpen(false);
                }}
                data-testid={`pick-template-${t.id}`}
              >
                <div className="flex items-center gap-2 mb-0.5">
                  <p className="text-sm font-medium">{t.name}</p>
                  <span className="text-[10px] text-muted-foreground border border-border rounded px-1">{t.bodyType}</span>
                </div>
                <p className="text-xs text-muted-foreground truncate">{t.subject}</p>
              </button>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTemplatePickerOpen(false)}>Cancel</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Sequence step dialog */}
      <Dialog open={seqDialogOpen} onOpenChange={v => { setSeqDialogOpen(v); if (!v) { setEditStep(null); seqForm.reset(); } }}>
        <DialogContent className="max-w-2xl flex flex-col max-h-[90vh]">
          <DialogHeader className="shrink-0">
            <div className="flex items-center justify-between">
              <DialogTitle>{editStep ? "Edit Step" : "Add Sequence Step"}</DialogTitle>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setTemplatePickerOpen(true)}
                className="mr-6"
                data-testid="button-load-template"
              >
                <FileText className="mr-1.5 h-3.5 w-3.5" /> Load template
              </Button>
            </div>
          </DialogHeader>
          <Form {...seqForm}>
            <form onSubmit={seqForm.handleSubmit(onSeqSubmit)} className="flex flex-col flex-1 min-h-0">
              <div className="overflow-y-auto flex-1 space-y-4 pr-1">
              <FormField control={seqForm.control} name="subject" render={({ field }) => (
                <FormItem>
                  <FormLabel>Subject</FormLabel>
                  <FormControl><Input placeholder="Re: Quick question about {{company}}" data-testid="input-step-subject" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              {/* Body type toggle */}
              <FormItem>
                <div className="flex items-center justify-between">
                  <FormLabel>Body</FormLabel>
                  <div className="flex items-center gap-1 rounded-md border border-border bg-muted/30 p-0.5">
                    <button
                      type="button"
                      onClick={() => setMode("text")}
                      className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors ${editorMode === "text" ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                      data-testid="toggle-body-text"
                    >
                      <Type className="h-3 w-3" /> Plain Text
                    </button>
                    <button
                      type="button"
                      onClick={() => setMode("rich")}
                      className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors ${editorMode === "rich" ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                      data-testid="toggle-body-html"
                    >
                      <Code2 className="h-3 w-3" /> Rich HTML
                    </button>
                    <button
                      type="button"
                      onClick={() => setMode("source")}
                      className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors ${editorMode === "source" ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                      data-testid="toggle-body-source"
                    >
                      <Braces className="h-3 w-3" /> HTML Source
                    </button>
                  </div>
                </div>
              </FormItem>

              <FormField control={seqForm.control} name="body" render={({ field }) => (
                <FormItem>
                  <FormControl>
                    {editorMode === "rich" ? (
                      <RichTextEditor
                        value={field.value}
                        onChange={field.onChange}
                        placeholder="Write your HTML email here..."
                        data-testid="input-step-body"
                      />
                    ) : editorMode === "source" ? (
                      <Textarea
                        placeholder={"<!DOCTYPE html>\n<html>\n  <body>\n    Hi {{firstName}}, ...\n  </body>\n</html>"}
                        rows={12}
                        className="font-mono text-xs"
                        data-testid="input-step-body"
                        {...field}
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
                  {editorMode === "source" && (
                    <FormDescription>Paste raw HTML. It will be sent exactly as written. Use {"{{firstName}}"}, {"{{company}}"}, etc. for personalization.</FormDescription>
                  )}
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
              </div>
              <DialogFooter className="shrink-0 pt-4 border-t border-border mt-2">
                <Button type="button" variant="outline" onClick={() => setSeqDialogOpen(false)} data-testid="button-cancel-step">Cancel</Button>
                <Button type="submit" disabled={createSeq.isPending || updateSeq.isPending} data-testid="button-submit-step">
                  {editStep ? "Save Changes" : "Add Step"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Send Test dialog */}
      <Dialog open={!!testDialog} onOpenChange={v => { if (!v) setTestDialog(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Send Test Email</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="text-sm text-muted-foreground">
              Step: <span className="font-medium text-foreground">{testDialog?.subject}</span>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">From account</label>
              <Select value={testAccountId ? String(testAccountId) : ""} onValueChange={v => setTestAccountId(parseInt(v, 10))}>
                <SelectTrigger data-testid="select-test-account"><SelectValue placeholder="Choose an account" /></SelectTrigger>
                <SelectContent>
                  {(accounts ?? []).filter(a => a.hasSmtpPassword).map(a => (
                    <SelectItem key={a.id} value={String(a.id)}>{a.email}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!accounts?.some(a => a.hasSmtpPassword) && (
                <p className="text-xs text-destructive">No accounts with SMTP credentials. Add an account first.</p>
              )}
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Send to</label>
              <Input
                type="email"
                value={testToEmail}
                onChange={e => setTestToEmail(e.target.value)}
                placeholder="you@example.com"
                data-testid="input-test-to"
              />
              <p className="text-xs text-muted-foreground">Sample merge values (Alex Smith / Acme Inc.) will be used.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTestDialog(null)} data-testid="button-cancel-test">Cancel</Button>
            <Button
              onClick={submitTest}
              disabled={!testAccountId || !testToEmail || sendTest.isPending}
              data-testid="button-submit-test"
            >
              <Send className="mr-2 h-4 w-4" />
              {sendTest.isPending ? "Sending..." : "Send Test"}
            </Button>
          </DialogFooter>
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
