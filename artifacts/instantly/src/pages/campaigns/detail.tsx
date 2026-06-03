import { Fragment, useEffect, useState } from "react";
import { useParams, useLocation } from "wouter";
import {
  useGetCampaign,
  useGetCampaignAnalytics,
  useGetCampaignLinkClicks,
  useGetCampaignOpens,
  useGetCampaignReplies,
  getGetCampaignLinkClicksQueryKey,
  getGetCampaignOpensQueryKey,
  getGetCampaignRepliesQueryKey,
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
  useUpdateCampaign,
  useListTemplates,
  useListAccounts,
  useListLabels,
  useSendTestStep,
  getGetCampaignQueryKey,
  getGetCampaignAnalyticsQueryKey,
  getListSequencesQueryKey,
  getListCampaignLeadsQueryKey,
  getListCampaignsQueryKey,
  getGetCampaignStatsQueryKey,
  getListTemplatesQueryKey,
  getListAccountsQueryKey,
  getListLabelsQueryKey,
} from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import { Switch } from "@/components/ui/switch";
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
import { ArrowLeft, ChevronLeft, ChevronRight, Play, Pause, Plus, Trash2, Pencil, UserPlus, Mail, TrendingUp, MessageSquare, Users, Code2, AlignLeft, Type, FileText, Send, Braces, MousePointerClick, Clock, AlertTriangle, CheckCircle2, CalendarClock, ShieldCheck } from "lucide-react";
import { Link } from "wouter";
import { toast } from "@/hooks/use-toast";
import { RichTextEditor } from "@/components/email-editor/rich-text-editor";
import { EmailPreview } from "@/components/email-editor/email-preview";
import { fetchDeliverabilityOverview, severityVariant } from "@/lib/deliverability";

const seqSchema = z.object({
  subject: z.string().min(1, "Subject required"),
  previewText: z.string().optional(),
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

type SequenceProgress = {
  status: "not_queued" | "waiting" | "scheduled" | "sending" | "completed" | "replied" | "bounced" | "failed";
  currentStepNumber: number;
  currentStepSubject?: string | null;
  nextStepNumber?: number | null;
  nextStepSubject?: string | null;
  nextScheduledAt?: string | null;
  totalSteps: number;
  sentSteps: number;
  queuedSteps: number;
  opened: boolean;
  clicked: boolean;
  replied: boolean;
  bounced: boolean;
  failed: boolean;
  lastSentAt?: string | null;
  lastOpenedAt?: string | null;
  lastClickedAt?: string | null;
  lastRepliedAt?: string | null;
  lastEventAt?: string | null;
};

type CampaignLeadWithProgress = {
  id: number;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
  status?: string;
  sequenceProgress?: SequenceProgress | null;
};

type StepVariantStats = {
  id: number;
  stepId: number;
  labelId?: number | null;
  name: string;
  subject: string;
  previewText?: string | null;
  body: string;
  bodyType: "text" | "html";
  attachmentsJson?: string | null;
  sent: number;
  pending: number;
  failed: number;
  skipped: number;
  opened: number;
  clicked: number;
  totalClicks: number;
  replied: number;
  bounced: number;
  positiveReplies: number;
  openRate: number;
  clickRate: number;
  replyRate: number;
  bounceRate: number;
};

type CampaignVariantStep = {
  id: number;
  stepNumber: number;
  subject: string;
  previewText?: string | null;
  body: string;
  bodyType: "text" | "html";
  defaultStats: Omit<StepVariantStats, "id" | "stepId" | "labelId" | "name" | "subject" | "previewText" | "body" | "bodyType" | "attachmentsJson">;
  variants: StepVariantStats[];
};

type CampaignVariantReport = {
  campaignId: number;
  steps: CampaignVariantStep[];
};

const SEQUENCE_STATUS_LABELS: Record<SequenceProgress["status"], string> = {
  not_queued: "Not queued",
  waiting: "Waiting",
  scheduled: "Scheduled",
  sending: "Sending",
  completed: "Completed",
  replied: "Replied",
  bounced: "Bounced",
  failed: "Failed",
};

const SEQUENCE_STATUS_VARIANTS: Record<SequenceProgress["status"], "default" | "secondary" | "destructive" | "outline"> = {
  not_queued: "outline",
  waiting: "secondary",
  scheduled: "secondary",
  sending: "default",
  completed: "outline",
  replied: "default",
  bounced: "destructive",
  failed: "destructive",
};

function sequenceProgressLabel(progress?: SequenceProgress | null): string {
  if (!progress) return "Not queued";
  if (progress.status === "not_queued") return "Not queued";
  if (progress.status === "completed" || progress.status === "replied" || progress.status === "bounced") {
    return `${progress.sentSteps}/${progress.totalSteps || progress.sentSteps}`;
  }
  if (progress.nextStepNumber) return `Next: step ${progress.nextStepNumber}/${progress.totalSteps || progress.nextStepNumber}`;
  if (progress.currentStepNumber) return `Step ${progress.currentStepNumber}/${progress.totalSteps || progress.currentStepNumber}`;
  return `${progress.sentSteps}/${progress.totalSteps || progress.queuedSteps || 0}`;
}

function toDateTimeLocal(value?: string | Date | null): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

export default function CampaignDetail() {
  const params = useParams<{ id: string }>();
  const id = parseInt(params.id, 10);
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const [seqDialogOpen, setSeqDialogOpen] = useState(false);
  const [editStep, setEditStep] = useState<{ id: number; subject: string; previewText?: string | null; body: string; bodyType: "text" | "html"; delayDays: number } | null>(null);
  const [addLeadOpen, setAddLeadOpen] = useState(false);
  const [selectedLeadIds, setSelectedLeadIds] = useState<number[]>([]);
  const [selectedAddLabelIds, setSelectedAddLabelIds] = useState<number[]>([]);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<"text" | "rich" | "source">("text");
  const [testDialog, setTestDialog] = useState<{ stepId: number; subject: string } | null>(null);
  const [testAccountId, setTestAccountId] = useState<number | null>(null);
  const [testToEmail, setTestToEmail] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [scheduledStartInput, setScheduledStartInput] = useState("");
  const [batchSizeInput, setBatchSizeInput] = useState("25");
  const [batchIntervalInput, setBatchIntervalInput] = useState("60");
  const [activeTab, setActiveTab] = useState("overview");
  const [sequencePreviewIndex, setSequencePreviewIndex] = useState(0);
  const [activeVariantByStepId, setActiveVariantByStepId] = useState<Record<number, number | "default">>({});

  const { data: templates } = useListTemplates({ query: { queryKey: getListTemplatesQueryKey() } });
  const { data: accounts } = useListAccounts({ query: { queryKey: getListAccountsQueryKey() } });
  const { data: labels } = useListLabels({ query: { queryKey: getListLabelsQueryKey() } });

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
  const { data: linkClicks } = useGetCampaignLinkClicks(id, { query: { enabled: !!id, queryKey: getGetCampaignLinkClicksQueryKey(id) } });
  const { data: opens } = useGetCampaignOpens(id, { query: { enabled: !!id, queryKey: getGetCampaignOpensQueryKey(id) } });
  const { data: replies } = useGetCampaignReplies(id, { query: { enabled: !!id, queryKey: getGetCampaignRepliesQueryKey(id) } });
  const { data: steps } = useListSequences(id, { query: { enabled: !!id, queryKey: getListSequencesQueryKey(id) } });
  const { data: campaignLeads } = useListCampaignLeads(id, { query: { enabled: !!id, queryKey: getListCampaignLeadsQueryKey(id) } });
  const { data: allLeads } = useListLeads();
  const { data: deliverability } = useQuery({ queryKey: ["deliverability-overview"], queryFn: fetchDeliverabilityOverview });
  const { data: variantReport } = useQuery<CampaignVariantReport>({
    queryKey: ["campaign-variants", id],
    enabled: !!id,
    queryFn: async () => {
      const response = await fetch(`/api/campaigns/${id}/variants`);
      if (!response.ok) throw new Error("Failed to load campaign variants");
      return response.json();
    },
  });

  useEffect(() => {
    setScheduledStartInput(toDateTimeLocal(campaign?.scheduledStartAt ?? null));
  }, [campaign?.scheduledStartAt]);

  useEffect(() => {
    if (!campaign) return;
    setBatchSizeInput(String(campaign.batchSize ?? 25));
    setBatchIntervalInput(String(campaign.batchIntervalMinutes ?? 60));
  }, [campaign]);

  useEffect(() => {
    setSequencePreviewIndex((current) => Math.min(current, Math.max(0, (steps?.length ?? 1) - 1)));
  }, [steps?.length]);

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

  const updateCampaign = useUpdateCampaign({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetCampaignQueryKey(id) });
        queryClient.invalidateQueries({ queryKey: getListCampaignsQueryKey() });
      },
      onError: () => toast({ title: "Failed to update campaign settings", variant: "destructive" }),
    },
  });

  function updateTracking(data: { trackOpens?: boolean; trackClicks?: boolean; includeUnsubscribe?: boolean }) {
    updateCampaign.mutate({ id, data });
  }

  function saveScheduledStart() {
    updateCampaign.mutate({
      id,
      data: { scheduledStartAt: scheduledStartInput ? new Date(scheduledStartInput).toISOString() : null },
    });
  }

  function saveBatchSettings() {
    updateCampaign.mutate({
      id,
      data: {
        batchSize: Number(batchSizeInput) || 25,
        batchIntervalMinutes: Number(batchIntervalInput) || 60,
      },
    });
  }

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
        setSelectedAddLabelIds([]);
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
    defaultValues: { subject: "", previewText: "", body: "", bodyType: "text", delayDays: 0 },
  });

  function onSeqSubmit(values: SeqForm) {
    if (editStep) {
      updateSeq.mutate({ id, stepId: editStep.id, data: values });
    } else {
      createSeq.mutate({ id, data: values });
    }
  }

  function openEdit(step: { id: number; subject: string; previewText?: string | null; body: string; bodyType: "text" | "html"; delayDays: number }) {
    setEditStep(step);
    const bt = step.bodyType ?? "text";
    seqForm.reset({ subject: step.subject, previewText: step.previewText ?? "", body: step.body, bodyType: bt, delayDays: step.delayDays });
    setEditorMode(inferEditorMode(step.body, bt));
    setSeqDialogOpen(true);
  }

  function openCreate() {
    setEditStep(null);
    seqForm.reset({ subject: "", previewText: "", body: "", bodyType: "text", delayDays: 0 });
    setEditorMode("text");
    setSeqDialogOpen(true);
  }

  const campaignLeadIds = new Set(campaignLeads?.map(l => l.id));
  const campaignLeadsWithProgress = (campaignLeads ?? []) as CampaignLeadWithProgress[];
  const availableLeads = allLeads?.filter(l => !campaignLeadIds.has(l.id)) ?? [];
  const totalLinkClicks = (linkClicks ?? []).reduce((sum, row) => sum + row.totalClicks, 0);
  const uniqueClickedLeadIds = new Set((linkClicks ?? []).flatMap((row) => (row.clicks ?? []).map((click) => click.leadId)));
  const uniqueClickedLeads = uniqueClickedLeadIds.size || analytics?.uniqueClickedLeads || 0;
  const availableLeadsByLabel = selectedAddLabelIds.length === 0
    ? availableLeads
    : availableLeads.filter((lead) => {
        const leadLabelIds = new Set((lead.labels ?? []).map((label) => label.id));
        return selectedAddLabelIds.every((labelId) => leadLabelIds.has(labelId));
      });

  function toggleLeadSelection(leadId: number, checked: boolean) {
    setSelectedLeadIds(prev => checked ? Array.from(new Set([...prev, leadId])) : prev.filter(x => x !== leadId));
  }

  function selectVisibleAvailableLeads() {
    setSelectedLeadIds(prev => Array.from(new Set([...prev, ...availableLeadsByLabel.map((lead) => lead.id)])));
  }

  if (isLoading) return <div className="p-8 text-muted-foreground">Loading campaign...</div>;
  if (!campaign) return <div className="p-8 text-muted-foreground">Campaign not found.</div>;

  const sendableAccounts = accounts?.filter((account) => account.status === "connected" || account.status === "warming") ?? [];
  const launchChecklist = [
    {
      label: "Sequence ready",
      detail: `${steps?.length ?? 0} email step${(steps?.length ?? 0) === 1 ? "" : "s"}`,
      ok: (steps?.length ?? 0) > 0,
    },
    {
      label: "Audience attached",
      detail: `${campaign.leadsCount ?? 0} lead${campaign.leadsCount === 1 ? "" : "s"}`,
      ok: (campaign.leadsCount ?? 0) > 0,
    },
    {
      label: "Mailbox pool online",
      detail: `${sendableAccounts.length} sendable mailbox${sendableAccounts.length === 1 ? "" : "es"}`,
      ok: sendableAccounts.length > 0,
    },
    {
      label: "Tracking configured",
      detail: [campaign.trackOpens ? "opens" : null, campaign.trackClicks ? "clicks" : null].filter(Boolean).join(" + ") || "off",
      ok: campaign.trackOpens || campaign.trackClicks,
    },
    {
      label: "Send cadence set",
      detail: `${campaign.batchSize ?? 25} over ${campaign.batchIntervalMinutes ?? 60} min`,
      ok: (campaign.batchSize ?? 0) > 0 && (campaign.batchIntervalMinutes ?? 0) > 0,
    },
  ];
  const launchReadyCount = launchChecklist.filter((item) => item.ok).length;
  const slotMinutes = Number((((campaign.batchIntervalMinutes ?? 60) / Math.max(1, campaign.batchSize ?? 25))).toFixed(1));
  const campaignWindow = campaign as typeof campaign & { sendWindowStart?: string | null; sendWindowEnd?: string | null };
  const sequencePreviewSteps = (steps ?? []).map((step, index) => {
    const stepNumber = index + 1;
    const sentLeadCount = campaignLeadsWithProgress.filter((lead) => (lead.sequenceProgress?.sentSteps ?? 0) >= stepNumber).length;
    const queuedLeadCount = campaignLeadsWithProgress.filter((lead) => lead.sequenceProgress?.nextStepNumber === stepNumber).length;
    const activeLeadCount = campaignLeadsWithProgress.filter((lead) => lead.sequenceProgress?.currentStepNumber === stepNumber).length;
    return { ...step, stepNumber, sentLeadCount, queuedLeadCount, activeLeadCount };
  });
  const activePreviewStep = sequencePreviewSteps[sequencePreviewIndex] ?? sequencePreviewSteps[0];
  const variantStep = activePreviewStep
    ? variantReport?.steps.find((step) => step.id === activePreviewStep.id)
    : undefined;
  const activeVariantKey = activePreviewStep ? activeVariantByStepId[activePreviewStep.id] ?? "default" : "default";
  const activeVariant = typeof activeVariantKey === "number"
    ? variantStep?.variants.find((variant) => variant.id === activeVariantKey)
    : undefined;
  const activePreviewContent = activeVariant
    ? {
        subject: activeVariant.subject,
        previewText: activeVariant.previewText,
        body: activeVariant.body,
        bodyType: activeVariant.bodyType,
        label: activeVariant.name,
        stats: activeVariant,
      }
    : activePreviewStep
      ? {
          subject: activePreviewStep.subject,
          previewText: activePreviewStep.previewText,
          body: activePreviewStep.body,
          bodyType: (activePreviewStep.bodyType ?? "text") as "text" | "html",
          label: variantStep?.variants.length ? "Default / fallback" : "Default",
          stats: variantStep?.defaultStats,
        }
      : null;
  const firstAbStep = variantReport?.steps.find((step) => step.variants.length > 0);
  const activeStats = activePreviewContent?.stats;
  const campaignReadiness = deliverability?.campaignReadiness.find((item) => item.id === Number(id));
  const campaignContentRisks = deliverability?.contentRisks.filter((risk) => risk.campaignId === Number(id)) ?? [];
  const variantBadge = (name?: string | null) => (
    name ? <Badge variant="outline" className="whitespace-nowrap text-[10px]">{name}</Badge> : null
  );

  return (
    <div className="p-8 max-w-[1500px] mx-auto space-y-6">
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
            {campaign.scheduledStartAt && new Date(campaign.scheduledStartAt).getTime() > Date.now() && (
              <p className="text-sm text-cyan-400" data-testid="text-scheduled-start">
                Scheduled to start {new Date(campaign.scheduledStartAt).toLocaleString()}
              </p>
            )}
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

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="overview" data-testid="tab-overview">Overview</TabsTrigger>
          <TabsTrigger value="sequence" data-testid="tab-sequence">Sequence ({steps?.length ?? 0})</TabsTrigger>
          <TabsTrigger value="leads" data-testid="tab-leads">Leads ({campaign.leadsCount})</TabsTrigger>
          <TabsTrigger value="opens" data-testid="tab-opens">Opens ({opens?.length ?? analytics?.opened ?? 0})</TabsTrigger>
          <TabsTrigger value="replies" data-testid="tab-replies">Replies ({replies?.length ?? analytics?.replied ?? 0})</TabsTrigger>
          <TabsTrigger value="links" data-testid="tab-links">Links</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-4 mt-4">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(360px,0.75fr)]">
            <Card className="overflow-hidden">
              <CardHeader className="border-b border-border bg-muted/20">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <ShieldCheck className="h-5 w-5 text-primary" />
                      Launch Readiness
                    </CardTitle>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {launchReadyCount}/{launchChecklist.length} checks passing before this campaign sends.
                    </p>
                  </div>
                  <Badge variant={launchReadyCount === launchChecklist.length ? "default" : "secondary"}>
                    {launchReadyCount === launchChecklist.length ? "Ready" : "Needs review"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="grid gap-3 pt-4 sm:grid-cols-2 xl:grid-cols-5">
                {launchChecklist.map((item) => (
                  <div key={item.label} className="rounded-md border border-border bg-card p-3">
                    <div className="flex items-center gap-2">
                      {item.ok ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <AlertTriangle className="h-4 w-4 text-amber-400" />}
                      <span className="text-sm font-medium">{item.label}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{item.detail}</p>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CalendarClock className="h-5 w-5 text-primary" />
                  Send Forecast
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">Cadence</span>
                  <span className="font-medium">{campaign.batchSize ?? 25} leads over {campaign.batchIntervalMinutes ?? 60} min</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">Stagger</span>
                  <span className="font-medium">about 1 send every {slotMinutes} min</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">Send window</span>
                  <span className="font-medium">{campaignWindow.sendWindowStart ?? "07:00"}-{campaignWindow.sendWindowEnd ?? "19:00"}</span>
                </div>
                <Link href="/growth" className="inline-flex text-primary hover:underline">
                  Open full queue forecast
                </Link>
              </CardContent>
            </Card>
          </div>

          {campaignReadiness && (
            <Card className="border-primary/20">
              <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <ShieldCheck className="h-5 w-5 text-primary" />
                    Deliverability Readiness
                  </CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Infrastructure, tracking, mailbox, suppression, and content checks for this campaign.
                  </p>
                </div>
                <Badge variant={severityVariant(campaignReadiness.severity)}>{campaignReadiness.score}% ready</Badge>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {campaignReadiness.checks.map((check) => (
                    <div key={check.label} className="rounded-md border border-border bg-muted/20 p-3">
                      <div className="flex items-center gap-2">
                        {check.ok ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <AlertTriangle className="h-4 w-4 text-amber-400" />}
                        <p className="font-medium">{check.label}</p>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{check.detail}</p>
                    </div>
                  ))}
                </div>
                {campaignContentRisks.some((risk) => risk.severity === "risk") && (
                  <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
                    <p className="text-sm font-medium">Content items to review</p>
                    <div className="mt-2 grid gap-2 md:grid-cols-2">
                      {campaignContentRisks.filter((risk) => risk.severity === "risk").map((risk) => (
                        <div key={risk.stepId} className="rounded border border-border bg-background/60 p-2 text-xs">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium">Step {risk.stepNumber}</span>
                            <Badge variant={severityVariant(risk.severity)}>{risk.score}</Badge>
                          </div>
                          <p className="mt-1 text-muted-foreground">{risk.issues.join(" · ")}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <div className="grid gap-4 grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
            {[
              { label: "Sent", value: campaign.sentCount, icon: Mail },
              { label: "Open Rate", value: `${analytics?.openRate ?? 0}%`, icon: TrendingUp, tab: "opens" },
              {
                label: "Click Rate",
                value: `${analytics?.clickRate ?? 0}%`,
                icon: MousePointerClick,
                sub: `${totalLinkClicks || analytics?.clicked || campaign.clickCount || 0} total clicks` +
                  (uniqueClickedLeads > 0 ? ` • ${uniqueClickedLeads} clicked ${uniqueClickedLeads === 1 ? "lead" : "leads"}` : ""),
              },
              { label: "Reply Rate", value: `${analytics?.replyRate ?? 0}%`, icon: MessageSquare, tab: "replies" },
              {
                label: "Bounce Rate",
                value: `${analytics?.bounceRate ?? 0}%`,
                icon: AlertTriangle,
                sub: `${analytics?.bounced ?? campaign.bounceCount ?? 0} bounced`,
              },
              { label: "Leads", value: campaign.leadsCount, icon: Users },
            ].map(stat => (
              <Card
                key={stat.label}
                role={"tab" in stat ? "button" : undefined}
                tabIndex={"tab" in stat ? 0 : undefined}
                onClick={() => { if ("tab" in stat && stat.tab) setActiveTab(stat.tab); }}
                onKeyDown={(event) => {
                  if (!("tab" in stat) || !stat.tab) return;
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setActiveTab(stat.tab);
                  }
                }}
                className={"tab" in stat ? "cursor-pointer transition-colors hover:border-primary/60 hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" : undefined}
                data-testid={"tab" in stat ? `card-jump-${stat.tab}` : undefined}
              >
                <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                  <CardTitle className="text-sm font-medium text-muted-foreground">{stat.label}</CardTitle>
                  <stat.icon className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold" data-testid={`stat-${stat.label.toLowerCase().replace(/\s+/g, "-")}`}>{stat.value}</div>
                  {"sub" in stat && stat.sub && (
                    <div className="text-xs text-muted-foreground mt-0.5">{stat.sub}</div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          <Card className="overflow-hidden">
            <CardHeader className="border-b border-border bg-muted/20">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Mail className="h-5 w-5 text-primary" />
                    Sequence Preview & Progress
                  </CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">
                    A full-width view of each email in the campaign and where leads are currently sitting.
                  </p>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={() => setActiveTab("sequence")}>
                  Edit sequence
                </Button>
              </div>
            </CardHeader>
            <CardContent className="pt-4">
              {sequencePreviewSteps.length === 0 ? (
                <div className="flex flex-col items-center gap-3 py-12 text-muted-foreground">
                  <Mail className="h-8 w-8 opacity-30" />
                  <p className="text-sm">No sequence steps yet. Add the first email to preview the campaign.</p>
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="flex gap-3 overflow-x-auto pb-2">
                    {sequencePreviewSteps.map((step, index) => {
                      const reportStep = variantReport?.steps.find((item) => item.id === step.id);
                      return (
                        <button
                          key={step.id}
                          type="button"
                          onClick={() => setSequencePreviewIndex(index)}
                          className={`min-w-[280px] rounded-lg border bg-card p-4 text-left transition-colors ${
                            sequencePreviewIndex === index
                              ? "border-primary bg-primary/5"
                              : "border-border hover:border-primary/50 hover:bg-accent/30"
                          }`}
                          data-testid={`button-sequence-preview-step-${step.id}`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-xs uppercase tracking-wide text-muted-foreground">Step {step.stepNumber}</p>
                              <p className="mt-1 line-clamp-2 font-semibold">{step.subject}</p>
                            </div>
                            <Badge variant={step.queuedLeadCount > 0 ? "default" : "secondary"}>
                              {step.queuedLeadCount > 0 ? "Next up" : "Ready"}
                            </Badge>
                          </div>
                          {reportStep?.variants.length ? (
                            <div className="mt-3 flex flex-wrap gap-1">
                              <Badge variant="outline" className="text-[10px]">A/B: {reportStep.variants.length}</Badge>
                              {reportStep.variants.map((variant) => (
                                <Badge key={variant.id} variant="secondary" className="text-[10px]">
                                  {variant.name}: {variant.sent} sent
                                </Badge>
                              ))}
                            </div>
                          ) : null}
                          <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
                            <div className="rounded-md bg-muted/40 p-2">
                              <div className="text-base font-bold">{step.sentLeadCount}</div>
                              <div className="text-muted-foreground">sent</div>
                            </div>
                            <div className="rounded-md bg-muted/40 p-2">
                              <div className="text-base font-bold">{step.queuedLeadCount}</div>
                              <div className="text-muted-foreground">queued</div>
                            </div>
                            <div className="rounded-md bg-muted/40 p-2">
                              <div className="text-base font-bold">{step.activeLeadCount}</div>
                              <div className="text-muted-foreground">active</div>
                            </div>
                          </div>
                          <p className="mt-3 text-xs text-muted-foreground">
                            {index === 0
                              ? "Day 0: sent when the campaign launches."
                              : `Delay: ${step.delayDays} day${step.delayDays === 1 ? "" : "s"} after step ${index}.`}
                          </p>
                        </button>
                      );
                    })}
                  </div>

                  {activePreviewStep && (
                    <div className="overflow-hidden rounded-lg border border-border bg-card">
                      <div className="grid gap-0 xl:grid-cols-[minmax(0,1fr)_360px]">
                        <div className="min-w-0">
                        <div className="border-b border-border bg-muted/30 px-4 py-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                                Email {activePreviewStep.stepNumber} of {sequencePreviewSteps.length}
                              </p>
                              <p className="truncate font-semibold">{activePreviewContent?.subject ?? activePreviewStep.subject}</p>
                              {activePreviewContent?.label && (
                                <p className="mt-0.5 text-xs text-muted-foreground">{activePreviewContent.label}</p>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                onClick={() => setSequencePreviewIndex((current) => Math.max(0, current - 1))}
                                disabled={sequencePreviewIndex === 0}
                                data-testid="button-sequence-preview-prev"
                              >
                                <ChevronLeft className="h-4 w-4" />
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                onClick={() => setSequencePreviewIndex((current) => Math.min(sequencePreviewSteps.length - 1, current + 1))}
                                disabled={sequencePreviewIndex >= sequencePreviewSteps.length - 1}
                                data-testid="button-sequence-preview-next"
                              >
                                <ChevronRight className="h-4 w-4" />
                              </Button>
                              <Badge variant="outline">{activePreviewContent?.bodyType ?? activePreviewStep.bodyType ?? "text"}</Badge>
                            </div>
                          </div>
                          {variantStep?.variants.length ? (
                            <div className="mt-3 flex flex-wrap gap-2">
                              <Button
                                type="button"
                                size="sm"
                                variant={activeVariantKey === "default" ? "default" : "outline"}
                                onClick={() => setActiveVariantByStepId((current) => ({ ...current, [activePreviewStep.id]: "default" }))}
                                data-testid="button-preview-variant-default"
                              >
                                Default
                              </Button>
                              {variantStep.variants.map((variant) => (
                                <Button
                                  key={variant.id}
                                  type="button"
                                  size="sm"
                                  variant={activeVariantKey === variant.id ? "default" : "outline"}
                                  onClick={() => setActiveVariantByStepId((current) => ({ ...current, [activePreviewStep.id]: variant.id }))}
                                  data-testid={`button-preview-variant-${variant.id}`}
                                >
                                  {variant.name}
                                </Button>
                              ))}
                            </div>
                          ) : null}
                        </div>
                        <div className="h-[620px]">
                          {activePreviewContent && (
                            <EmailPreview
                              body={activePreviewContent.body}
                              bodyType={activePreviewContent.bodyType}
                              subject={activePreviewContent.subject}
                              previewText={activePreviewContent.previewText ?? undefined}
                              className="h-full rounded-none border-0"
                            />
                          )}
                        </div>
                      </div>
                        <div className="border-t border-border bg-muted/20 p-4 xl:border-l xl:border-t-0">
                          <p className="text-sm font-semibold">Progress for {activePreviewContent?.label ?? "this step"}</p>
                          <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
                            <div className="rounded-md bg-background/70 p-3">
                              <div className="text-xl font-bold">{activeStats?.sent ?? activePreviewStep.sentLeadCount}</div>
                              <div className="text-muted-foreground">sent</div>
                            </div>
                            <div className="rounded-md bg-background/70 p-3">
                              <div className="text-xl font-bold">{activeStats?.pending ?? activePreviewStep.queuedLeadCount}</div>
                              <div className="text-muted-foreground">queued</div>
                            </div>
                            <div className="rounded-md bg-background/70 p-3">
                              <div className="text-xl font-bold">{activeStats?.replied ?? 0}</div>
                              <div className="text-muted-foreground">replies</div>
                            </div>
                          </div>
                          {activeStats && (
                            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                              <div className="rounded-md bg-background/70 p-3">
                                <div className="text-base font-bold">{activeStats.openRate}%</div>
                                <div className="text-muted-foreground">open rate</div>
                              </div>
                              <div className="rounded-md bg-background/70 p-3">
                                <div className="text-base font-bold">{activeStats.clickRate}%</div>
                                <div className="text-muted-foreground">click rate</div>
                              </div>
                              <div className="rounded-md bg-background/70 p-3">
                                <div className="text-base font-bold">{activeStats.replyRate}%</div>
                                <div className="text-muted-foreground">reply rate</div>
                              </div>
                              <div className="rounded-md bg-background/70 p-3">
                                <div className="text-base font-bold">{activeStats.bounceRate}%</div>
                                <div className="text-muted-foreground">bounce rate</div>
                              </div>
                            </div>
                          )}
                          <div className="mt-4 rounded-md border border-border bg-background/60 p-3 text-sm">
                            <p className="font-medium">Timing</p>
                            <p className="mt-1 text-muted-foreground">
                              {sequencePreviewIndex === 0
                                ? "Day 0: sent when the campaign launches."
                                : `${activePreviewStep.delayDays} day${activePreviewStep.delayDays === 1 ? "" : "s"} after the previous email.`}
                            </p>
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            className="mt-4 w-full"
                            onClick={() => openEdit({ ...activePreviewStep, bodyType: (activePreviewStep.bodyType ?? "text") as "text" | "html" })}
                            data-testid="button-edit-active-preview-step"
                          >
                            <Pencil className="mr-2 h-4 w-4" />
                            Edit this email
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {firstAbStep && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-primary" />
                  A/B Performance
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  Step {firstAbStep.stepNumber}: compare each variant by sends, engagement, replies, and bounces.
                </p>
              </CardHeader>
              <CardContent>
                <div className="rounded-md border border-border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Variant</TableHead>
                        <TableHead className="text-right">Sent</TableHead>
                        <TableHead className="text-right">Queued</TableHead>
                        <TableHead className="text-right">Open</TableHead>
                        <TableHead className="text-right">Click</TableHead>
                        <TableHead className="text-right">Reply</TableHead>
                        <TableHead className="text-right">Bounce</TableHead>
                        <TableHead className="text-right">Positive</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {firstAbStep.variants.map((variant) => (
                        <TableRow key={variant.id} data-testid={`row-ab-variant-${variant.id}`}>
                          <TableCell>
                            <div className="font-medium">{variant.name}</div>
                            <div className="text-xs text-muted-foreground line-clamp-1">{variant.subject}</div>
                          </TableCell>
                          <TableCell className="text-right font-medium">{variant.sent}</TableCell>
                          <TableCell className="text-right">{variant.pending}</TableCell>
                          <TableCell className="text-right">{variant.openRate}%</TableCell>
                          <TableCell className="text-right">{variant.clickRate}%</TableCell>
                          <TableCell className="text-right">{variant.replyRate}%</TableCell>
                          <TableCell className="text-right">{variant.bounceRate}%</TableCell>
                          <TableCell className="text-right">{variant.positiveReplies}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader><CardTitle>Deliverability Snapshot</CardTitle></CardHeader>
            <CardContent className="grid gap-3 text-sm sm:grid-cols-3">
              <div>
                <div className="text-muted-foreground">Bounce Status</div>
                <div className="font-medium">{analytics?.bounced ?? campaign.bounceCount ?? 0} bounces recorded</div>
              </div>
              <div>
                <div className="text-muted-foreground">Sending Pool</div>
                <div className="font-medium">{accounts?.filter((account) => account.status === "connected" || account.status === "warming").length ?? 0} sendable mailboxes</div>
              </div>
              <div>
                <div className="text-muted-foreground">Full Health Table</div>
                <Link href="/growth" className="font-medium text-primary hover:underline">Open Growth deliverability</Link>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Campaign Settings</CardTitle></CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <dt className="text-muted-foreground">Daily Limit</dt>
                  <dd className="font-medium">{campaign.dailyLimit ?? "No limit"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Batch Sending</dt>
                  <dd className="font-medium">{campaign.batchSize ?? 25} staggered across {campaign.batchIntervalMinutes ?? 60} min</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Reply-To</dt>
                  <dd className="font-medium">{campaign.replyTo ?? "—"}</dd>
                </div>
                <div className="col-span-2 space-y-2 rounded-md border border-border bg-muted/20 p-3">
                  <dt className="text-muted-foreground">Batch Sending</dt>
                  <dd className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                    <Input
                      type="number"
                      min={1}
                      value={batchSizeInput}
                      onChange={(e) => setBatchSizeInput(e.target.value)}
                      data-testid="input-campaign-batch-size"
                    />
                    <Input
                      type="number"
                      min={1}
                      value={batchIntervalInput}
                      onChange={(e) => setBatchIntervalInput(e.target.value)}
                      data-testid="input-campaign-batch-interval"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={saveBatchSettings}
                      disabled={updateCampaign.isPending}
                      data-testid="button-save-batch-settings"
                    >
                      Save batch
                    </Button>
                  </dd>
                  <p className="text-xs text-muted-foreground">
                    First box is leads per interval. Second box is interval length. The app staggers sends inside that window and reschedules pending emails when you save.
                  </p>
                </div>
                <div className="col-span-2 space-y-2 rounded-md border border-border bg-muted/20 p-3">
                  <dt className="flex items-center gap-2 text-muted-foreground">
                    <Clock className="h-4 w-4" /> Schedule Start Time
                  </dt>
                  <dd className="flex flex-col gap-2 sm:flex-row">
                    <Input
                      type="datetime-local"
                      value={scheduledStartInput}
                      onChange={(e) => setScheduledStartInput(e.target.value)}
                      data-testid="input-campaign-scheduled-start"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={saveScheduledStart}
                      disabled={updateCampaign.isPending}
                      data-testid="button-save-scheduled-start"
                    >
                      Save start time
                    </Button>
                  </dd>
                  <p className="text-xs text-muted-foreground">
                    {campaign.status === "active"
                      ? "If this campaign is scheduled for the future, pending emails will move to the new start time."
                      : "Leave blank to start immediately when the campaign is launched."}
                  </p>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-muted-foreground">Track Opens</dt>
                  <Switch
                    checked={campaign.trackOpens}
                    onCheckedChange={(v) => updateTracking({ trackOpens: v })}
                    disabled={updateCampaign.isPending}
                    data-testid="switch-track-opens"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-muted-foreground">Track Clicks</dt>
                  <Switch
                    checked={campaign.trackClicks}
                    onCheckedChange={(v) => updateTracking({ trackClicks: v })}
                    disabled={updateCampaign.isPending}
                    data-testid="switch-track-clicks"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-muted-foreground">Unsubscribe Link</dt>
                  <Switch
                    checked={campaign.includeUnsubscribe}
                    onCheckedChange={(v) => updateTracking({ includeUnsubscribe: v })}
                    disabled={updateCampaign.isPending}
                    data-testid="switch-include-unsubscribe"
                  />
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
            <div className="space-y-2">
              {steps?.map((step, idx) => {
                const reportStep = variantReport?.steps.find((item) => item.id === step.id);
                return (
                <div key={step.id}>
                  {idx > 0 && (
                    <button
                      type="button"
                      onClick={() => openEdit({ ...step, bodyType: (step.bodyType ?? "text") as "text" | "html" })}
                      className="group mx-auto my-1 flex items-center gap-2 rounded-full border border-dashed border-border bg-muted/30 px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/60 hover:bg-primary/5 hover:text-foreground"
                      data-testid={`delay-step-${step.id}`}
                      title="Click to edit delay"
                    >
                      <Clock className="h-3 w-3" />
                      <span>
                        Wait <span className="font-medium text-foreground">{step.delayDays}</span> day{step.delayDays !== 1 ? "s" : ""}
                      </span>
                      <Pencil className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
                    </button>
                  )}
                  <Card data-testid={`card-step-${step.id}`}>
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
                              {idx === 0
                                ? "Day 0 — sent when campaign launches"
                                : `Sent ${step.delayDays} day${step.delayDays !== 1 ? "s" : ""} after step ${idx}`}
                            </p>
                            {reportStep?.variants.length ? (
                              <div className="mt-2 flex flex-wrap gap-1">
                                <Badge variant="outline" className="text-[10px]">A/B step</Badge>
                                {reportStep.variants.map((variant) => (
                                  <Badge key={variant.id} variant="secondary" className="text-[10px]">
                                    {variant.name}: {variant.sent} sent / {variant.replyRate}% replies
                                  </Badge>
                                ))}
                              </div>
                            ) : null}
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
                </div>
                );
              })}
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
                  <TableHead>Sequence</TableHead>
                  <TableHead>Next Send</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {campaignLeadsWithProgress.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-12 text-center text-muted-foreground text-sm">
                      No leads in this campaign yet.
                    </TableCell>
                  </TableRow>
                ) : campaignLeadsWithProgress.map(lead => {
                  const progress = lead.sequenceProgress;
                  const progressStatus = progress?.status ?? "not_queued";
                  return (
                    <TableRow key={lead.id} data-testid={`row-campaign-lead-${lead.id}`}>
                      <TableCell className="font-medium">{lead.email}</TableCell>
                      <TableCell>{[lead.firstName, lead.lastName].filter(Boolean).join(" ") || "-"}</TableCell>
                      <TableCell>{lead.company || "-"}</TableCell>
                      <TableCell className="min-w-56">
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-2">
                            <Badge variant={SEQUENCE_STATUS_VARIANTS[progressStatus]}>
                              {SEQUENCE_STATUS_LABELS[progressStatus]}
                            </Badge>
                            <span className="text-sm text-muted-foreground">{sequenceProgressLabel(progress)}</span>
                          </div>
                          {(progress?.nextStepSubject || progress?.currentStepSubject) && (
                            <p className="text-xs text-muted-foreground truncate max-w-72">
                              {progress.nextStepSubject ? `Next: ${progress.nextStepSubject}` : `Current: ${progress.currentStepSubject}`}
                            </p>
                          )}
                          {progress && (progress.opened || progress.clicked || progress.replied) && (
                            <p className="text-xs text-muted-foreground">
                              {[
                                progress.opened ? "opened" : null,
                                progress.clicked ? "clicked" : null,
                                progress.replied ? "replied" : null,
                              ].filter(Boolean).join(" / ")}
                            </p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {progress?.nextScheduledAt ? (
                          <div className="flex items-center gap-2 whitespace-nowrap">
                            <Clock className="h-3.5 w-3.5" />
                            {new Date(progress.nextScheduledAt).toLocaleString()}
                          </div>
                        ) : progress?.lastSentAt ? (
                          <span>Last sent {new Date(progress.lastSentAt).toLocaleString()}</span>
                        ) : "-"}
                      </TableCell>
                      <TableCell><Badge variant="secondary">{lead.status}</Badge></TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" onClick={() => removeLead.mutate({ id, leadId: lead.id })} data-testid={`button-remove-lead-${lead.id}`}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* Opens Tab */}
        <TabsContent value="opens" className="mt-4 space-y-4">
          {!opens || opens.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground">
              <TrendingUp className="h-8 w-8 opacity-30" />
              <p className="text-sm">No opens recorded yet for this campaign.</p>
              <p className="text-xs">Pixel opens, clicks, and replies all count as confirmed opens.</p>
            </div>
          ) : (
            <div className="rounded-md border border-border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Company</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead className="text-right">Opened</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {opens.map((open, i) => (
                    <TableRow key={`${open.leadId}-${open.openedAt}-${i}`} data-testid={`row-open-${i}`}>
                      <TableCell className="font-medium">{open.email ?? `Lead #${open.leadId}`}</TableCell>
                      <TableCell>{open.name ?? "—"}</TableCell>
                      <TableCell>{open.company ?? "—"}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          <Badge variant="secondary" className="capitalize">{open.source}</Badge>
                          {variantBadge((open as any).variantName)}
                        </div>
                      </TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground">
                        {new Date(open.openedAt).toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        {/* Replies Tab */}
        <TabsContent value="replies" className="mt-4 space-y-4">
          {!replies || replies.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground">
              <MessageSquare className="h-8 w-8 opacity-30" />
              <p className="text-sm">No replies recorded yet for this campaign.</p>
              <p className="text-xs">Once inbox polling matches a reply to a sent email, it'll show up here.</p>
            </div>
          ) : (
            <div className="rounded-md border border-border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Company</TableHead>
                    <TableHead>Reply</TableHead>
                    <TableHead className="text-right">Replied</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {replies.map((reply, i) => (
                    <TableRow key={`${reply.leadId}-${reply.repliedAt}-${i}`} data-testid={`row-reply-${i}`}>
                      <TableCell className="font-medium">{reply.email ?? `Lead #${reply.leadId}`}</TableCell>
                      <TableCell>{reply.name ?? "—"}</TableCell>
                      <TableCell>{reply.company ?? "—"}</TableCell>
                      <TableCell className="max-w-md">
                        <p className="font-medium truncate">{reply.subject ?? "Reply"}</p>
                        {variantBadge((reply as any).variantName)}
                        {reply.body && (
                          <p className="text-xs text-muted-foreground line-clamp-2">
                            {reply.body.replace(/\s+/g, " ").trim()}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground">
                        {reply.repliedAt ? new Date(reply.repliedAt).toLocaleString() : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        {/* Links Tab */}
        <TabsContent value="links" className="mt-4 space-y-4">
          {!linkClicks || linkClicks.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground">
              <MousePointerClick className="h-8 w-8 opacity-30" />
              <p className="text-sm">No link clicks recorded yet for this campaign.</p>
              <p className="text-xs">Once recipients click a tracked link in your emails, it'll show up here.</p>
            </div>
          ) : (
            <div className="rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Link</TableHead>
                    <TableHead className="text-right w-32">Total Clicks</TableHead>
                    <TableHead className="text-right w-32">Unique Clicks</TableHead>
                    <TableHead className="text-right w-48">Last Clicked</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {linkClicks.map((row, i) => {
                    const clicks = row.clicks ?? [];
                    return (
                    <Fragment key={`${row.url}-${i}`}>
                      <TableRow key={`${row.url}-${i}`} data-testid={`row-link-click-${i}`}>
                        <TableCell className="max-w-md">
                          <a
                            href={row.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-cyan-400 hover:underline break-all"
                            data-testid={`link-url-${i}`}
                          >
                            {row.url}
                          </a>
                        </TableCell>
                        <TableCell className="text-right font-medium" data-testid={`text-total-clicks-${i}`}>{row.totalClicks}</TableCell>
                        <TableCell className="text-right" data-testid={`text-unique-clicks-${i}`}>{row.uniqueClicks}</TableCell>
                        <TableCell className="text-right text-sm text-muted-foreground">
                          {row.lastClickedAt ? new Date(row.lastClickedAt).toLocaleString() : "—"}
                        </TableCell>
                      </TableRow>
                      {clicks.length > 0 && (
                        <TableRow key={`${row.url}-${i}-details`}>
                          <TableCell colSpan={4} className="bg-muted/20 px-4 py-3">
                            <div className="space-y-2">
                              <p className="text-xs font-medium text-muted-foreground">Clicked by</p>
                              <div className="space-y-1.5">
                                {clicks.map((click, clickIndex) => (
                                  <div
                                    key={`${row.url}-${click.leadId}-${click.clickedAt}-${clickIndex}`}
                                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-background/60 px-3 py-2 text-sm"
                                    data-testid={`row-link-click-lead-${i}-${clickIndex}`}
                                  >
                                    <div className="min-w-0">
                                      <p className="font-medium">{click.email ?? `Lead #${click.leadId}`}</p>
                                      <p className="text-xs text-muted-foreground">
                                        {[click.name, click.company].filter(Boolean).join(" • ") || "No lead details"}
                                      </p>
                                      {variantBadge((click as any).variantName)}
                                    </div>
                                    <span className="text-xs text-muted-foreground">
                                      {click.clickedAt ? new Date(click.clickedAt).toLocaleString() : "—"}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
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
                  seqForm.setValue("previewText", t.previewText ?? "");
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
        <DialogContent className="w-[min(1400px,95vw)] max-w-none flex flex-col max-h-[92vh]">
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
              <div className="grid flex-1 min-h-0 gap-4 pr-1 lg:grid-cols-[minmax(0,1fr)_minmax(420px,0.95fr)]">
                <div className="flex min-w-0 min-h-0 flex-col gap-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField control={seqForm.control} name="subject" render={({ field }) => (
                  <FormItem className="sm:col-span-2">
                    <FormLabel>Subject</FormLabel>
                    <FormControl><Input placeholder="Re: Quick question about {{company}}" data-testid="input-step-subject" {...field} value={field.value ?? ""} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={seqForm.control} name="previewText" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Preview Text <span className="text-muted-foreground font-normal">(optional)</span></FormLabel>
                    <FormControl><Input placeholder="Short snippet shown next to the subject in the inbox preview" data-testid="input-step-preview-text" {...field} value={field.value ?? ""} /></FormControl>
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

              {/* Body type toggle (not bound to a form field — plain markup to avoid useFormField) */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium leading-none">Body</label>
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
              </div>

              <div className="flex-1 min-h-0 rounded-md border border-border bg-card p-3">
                  <FormField control={seqForm.control} name="body" render={({ field }) => (
                    <FormItem className="flex h-full min-h-0 flex-col">
                      <FormControl className="flex-1 min-h-0">
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
                            className="h-full min-h-[360px] font-mono text-xs leading-relaxed resize-none"
                            data-testid="input-step-body"
                            {...field}
                          />
                        ) : (
                          <Textarea
                            placeholder={"Hi {{firstName}},\n\n..."}
                            className="h-full min-h-[360px] resize-none"
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
              </div>
                </div>
                <div className="min-w-0 min-h-0">
                  <EmailPreview
                    body={seqForm.watch("body") || ""}
                    bodyType={editorMode === "text" ? "text" : "html"}
                    subject={seqForm.watch("subject") || undefined}
                    previewText={seqForm.watch("previewText") || undefined}
                    className="h-full"
                  />
                </div>
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
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add Leads to Campaign</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-md border border-border bg-muted/20 p-3 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium">Add by label</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={selectVisibleAvailableLeads}
                  disabled={availableLeadsByLabel.length === 0}
                  data-testid="button-select-visible-leads"
                >
                  Select {availableLeadsByLabel.length}
                </Button>
              </div>
              {!labels?.length ? (
                <p className="text-xs text-muted-foreground">No labels yet. Create labels in Leads, then use them here to add a whole list/segment.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {labels.map((label) => {
                    const selected = selectedAddLabelIds.includes(label.id);
                    const color = label.color || "#06b6d4";
                    return (
                      <button
                        key={label.id}
                        type="button"
                        onClick={() => setSelectedAddLabelIds(selected
                          ? selectedAddLabelIds.filter((labelId) => labelId !== label.id)
                          : [...selectedAddLabelIds, label.id])}
                        className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium border transition-opacity"
                        style={{
                          backgroundColor: selected ? `${color}33` : "transparent",
                          borderColor: `${color}66`,
                          color,
                          opacity: selected ? 1 : 0.65,
                        }}
                        data-testid={`campaign-filter-label-${label.id}`}
                      >
                        {label.name}
                      </button>
                    );
                  })}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                {selectedAddLabelIds.length > 0
                  ? `${availableLeadsByLabel.length} available lead${availableLeadsByLabel.length === 1 ? "" : "s"} match the selected label${selectedAddLabelIds.length === 1 ? "" : "s"}.`
                  : "Pick one or more labels to filter, or select individual leads below."}
              </p>
            </div>
          <div className="max-h-80 overflow-y-auto space-y-2">
            {availableLeads.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">All leads are already in this campaign</p>
            ) : availableLeadsByLabel.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No available leads match those labels.</p>
            ) : availableLeadsByLabel.map(lead => (
              <label
                key={lead.id}
                className="flex items-center gap-3 p-2 rounded hover:bg-accent cursor-pointer"
                data-testid={`label-lead-select-${lead.id}`}
              >
                <input
                  type="checkbox"
                  checked={selectedLeadIds.includes(lead.id)}
                  onChange={e => toggleLeadSelection(lead.id, e.target.checked)}
                  className="rounded border-border"
                />
                <div>
                  <p className="text-sm font-medium">{lead.email}</p>
                  {lead.company && <p className="text-xs text-muted-foreground">{lead.company}</p>}
                  {(lead.labels ?? []).length > 0 && (
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {(lead.labels ?? []).map((label) => label.name).join(", ")}
                    </p>
                  )}
                </div>
              </label>
            ))}
          </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setAddLeadOpen(false); setSelectedLeadIds([]); setSelectedAddLabelIds([]); }} data-testid="button-cancel-add-leads">Cancel</Button>
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
