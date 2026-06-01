import { useState } from "react";
import {
  type EmailAccount,
  useListAccounts,
  useCreateAccount,
  useDeleteAccount,
  useUpdateAccount,
  useTestAccount,
  getListAccountsQueryKey,
} from "@workspace/api-client-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Mail, Flame, CheckCircle2, XCircle, AlertCircle, Send, Upload, Pencil } from "lucide-react";
import { toast } from "@/hooks/use-toast";

const PROVIDER_DEFAULTS: Record<string, { host: string; port: number }> = {
  gmail: { host: "smtp.gmail.com", port: 587 },
  outlook: { host: "smtp.office365.com", port: 587 },
  smtp: { host: "", port: 587 },
};

const IMAP_DEFAULTS: Record<string, { host: string; port: number }> = {
  gmail: { host: "imap.gmail.com", port: 993 },
  outlook: { host: "outlook.office365.com", port: 993 },
  smtp: { host: "", port: 993 },
};

const schema = z.object({
  email: z.string().email("Valid email required"),
  name: z.string().optional(),
  provider: z.enum(["gmail", "outlook", "smtp"]),
  warmupEnabled: z.boolean().default(false),
  dailySendLimit: z.coerce.number().min(1).max(10000).default(50),
  smtpHost: z.string().optional(),
  smtpPort: z.coerce.number().min(1).max(65535).optional(),
  smtpUsername: z.string().optional(),
  imapHost: z.string().optional(),
  imapPort: z.coerce.number().min(1).max(65535).optional(),
  smtpPassword: z.string().min(1, "Required to send emails"),
});

type FormValues = z.infer<typeof schema>;

const editSchema = schema.extend({
  smtpPassword: z.string().optional(),
});

type EditFormValues = z.infer<typeof editSchema>;

const bulkEditSchema = z.object({
  dailySendLimit: z.coerce.number().min(1).max(10000).optional(),
  warmupEnabled: z.enum(["keep", "true", "false"]).default("keep"),
  status: z.enum(["keep", "connected", "disconnected", "error", "warming"]).default("keep"),
  smtpHost: z.string().optional(),
  smtpPort: z.coerce.number().min(1).max(65535).optional(),
  imapHost: z.string().optional(),
  imapPort: z.coerce.number().min(1).max(65535).optional(),
});

type BulkEditFormValues = z.infer<typeof bulkEditSchema>;

type BulkImportResult = {
  total: number;
  imported: number;
  skipped: number;
  accountIds: number[];
  errors: Array<{ row: number; email?: string; reason: string }>;
};

const SAMPLE_CSV = `email,name,provider,smtpPassword,warmupEnabled,dailySendLimit
aj@example.com,AJ Kavanagh,gmail,xxxx xxxx xxxx xxxx,true,15`;

const STATUS_ICON: Record<string, React.ReactNode> = {
  connected: <CheckCircle2 className="h-4 w-4 text-green-500" />,
  disconnected: <XCircle className="h-4 w-4 text-muted-foreground" />,
  error: <AlertCircle className="h-4 w-4 text-destructive" />,
  warming: <Flame className="h-4 w-4 text-orange-500" />,
};

const STATUS_BADGE: Record<string, string> = {
  connected: "default",
  disconnected: "secondary",
  error: "destructive",
  warming: "outline",
};

function warmupDay(createdAt?: string | Date | null): number {
  if (!createdAt) return 1;
  const created = createdAt instanceof Date ? createdAt : new Date(createdAt);
  if (!Number.isFinite(created.getTime())) return 1;
  created.setHours(0, 0, 0, 0);
  const current = new Date();
  current.setHours(0, 0, 0, 0);

  let count = 0;
  const cursor = new Date(created);
  while (cursor <= current) {
    const day = cursor.getDay();
    if (day >= 1 && day <= 5) count += 1;
    cursor.setDate(cursor.getDate() + 1);
  }

  return Math.max(1, count);
}

function warmupLimitForDay(day: number): number {
  if (day <= 3) return 5;
  if (day <= 7) return 10;
  if (day <= 12) return 15;
  if (day <= 17) return 20;
  if (day <= 21) return 25;
  return 30;
}

function effectiveDailyLimit(account: { dailySendLimit: number; warmupEnabled: boolean; status: string; createdAt?: string | Date | null }): number {
  if (!account.warmupEnabled && account.status !== "warming") return account.dailySendLimit;
  return Math.min(account.dailySendLimit, warmupLimitForDay(warmupDay(account.createdAt)));
}

export default function Accounts() {
  const [open, setOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<EmailAccount | null>(null);
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [selectedAccountIds, setSelectedAccountIds] = useState<number[]>([]);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [bulkResult, setBulkResult] = useState<BulkImportResult | null>(null);
  const queryClient = useQueryClient();
  const { data: accounts, isLoading } = useListAccounts();

  const create = useCreateAccount({
    mutation: {
      onSuccess: () => {
        toast({ title: "Account added", description: "Click 'Test' on the card to verify sending works." });
        queryClient.invalidateQueries({ queryKey: getListAccountsQueryKey() });
        setOpen(false);
        form.reset();
      },
      onError: (err: Error) => toast({ title: "Failed to add account", description: err.message, variant: "destructive" }),
    },
  });

  const remove = useDeleteAccount({
    mutation: {
      onSuccess: () => {
        toast({ title: "Account removed" });
        queryClient.invalidateQueries({ queryKey: getListAccountsQueryKey() });
      },
      onError: () => toast({ title: "Failed to remove account", variant: "destructive" }),
    },
  });

  const updateAccount = useUpdateAccount({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListAccountsQueryKey() });
        if (editingAccount) {
          toast({ title: "Account updated" });
          setEditingAccount(null);
          editForm.reset();
        }
      },
      onError: (err: Error) => toast({ title: "Failed to update account", description: err.message, variant: "destructive" }),
    },
  });

  const test = useTestAccount({
    mutation: {
      onSuccess: (data) => {
        queryClient.invalidateQueries({ queryKey: getListAccountsQueryKey() });
        if (data.ok) {
          toast({ title: "Test email sent", description: "Check your own inbox to confirm delivery." });
        } else {
          toast({ title: "Connection failed", description: data.error ?? "Unknown error", variant: "destructive" });
        }
      },
      onError: (err: any) => toast({ title: "Test failed", description: String(err?.message ?? err), variant: "destructive" }),
    },
  });

  const bulkEdit = useMutation({
    mutationFn: async (values: BulkEditFormValues) => {
      const data: Record<string, unknown> = {};
      if (values.dailySendLimit !== undefined) data.dailySendLimit = values.dailySendLimit;
      if (values.warmupEnabled !== "keep") data.warmupEnabled = values.warmupEnabled === "true";
      if (values.status !== "keep") data.status = values.status;
      if (values.smtpHost?.trim()) data.smtpHost = values.smtpHost.trim();
      if (values.smtpPort !== undefined) data.smtpPort = values.smtpPort;
      if (values.imapHost?.trim()) data.imapHost = values.imapHost.trim();
      if (values.imapPort !== undefined) data.imapPort = values.imapPort;
      if (Object.keys(data).length === 0) throw new Error("Choose at least one field to update.");

      const results = await Promise.allSettled(
        selectedAccountIds.map(async (id) => {
          const response = await fetch(`/api/accounts/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data),
          });
          const body = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(body.error ?? `Failed to update account ${id}`);
          return body;
        }),
      );
      const failed = results.filter((result) => result.status === "rejected");
      if (failed.length > 0) throw new Error(`${failed.length} account update${failed.length === 1 ? "" : "s"} failed.`);
      return results.length;
    },
    onSuccess: (count) => {
      toast({ title: "Accounts updated", description: `${count} account${count === 1 ? "" : "s"} updated.` });
      queryClient.invalidateQueries({ queryKey: getListAccountsQueryKey() });
      setBulkEditOpen(false);
      bulkEditForm.reset();
    },
    onError: (err: Error) => toast({ title: "Bulk update failed", description: err.message, variant: "destructive" }),
  });

  const bulkImport = useMutation({
    mutationFn: async (csvText: string): Promise<BulkImportResult> => {
      const response = await fetch("/api/accounts/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csvText }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.error ?? "Import failed");
      }
      return body;
    },
    onSuccess: (result) => {
      setBulkResult(result);
      queryClient.invalidateQueries({ queryKey: getListAccountsQueryKey() });
      toast({
        title: result.imported > 0 ? "Accounts imported" : "No accounts imported",
        description: `${result.imported} imported, ${result.skipped} skipped.`,
        variant: result.imported > 0 ? "default" : "destructive",
      });
    },
    onError: (err: Error) => toast({ title: "Import failed", description: err.message, variant: "destructive" }),
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      email: "",
      name: "",
      provider: "gmail",
      warmupEnabled: false,
      dailySendLimit: 50,
      smtpHost: PROVIDER_DEFAULTS.gmail.host,
      smtpPort: PROVIDER_DEFAULTS.gmail.port,
      imapHost: IMAP_DEFAULTS.gmail.host,
      imapPort: IMAP_DEFAULTS.gmail.port,
      smtpUsername: "",
      smtpPassword: "",
    },
  });

  const editForm = useForm<EditFormValues>({
    resolver: zodResolver(editSchema),
    defaultValues: {
      email: "",
      name: "",
      provider: "gmail",
      warmupEnabled: false,
      dailySendLimit: 50,
      smtpHost: "",
      smtpPort: 587,
      smtpUsername: "",
      imapHost: "",
      imapPort: 993,
      smtpPassword: "",
    },
  });

  const bulkEditForm = useForm<BulkEditFormValues>({
    resolver: zodResolver(bulkEditSchema),
    defaultValues: {
      dailySendLimit: undefined,
      warmupEnabled: "keep",
      status: "keep",
      smtpHost: "",
      smtpPort: undefined,
      imapHost: "",
      imapPort: undefined,
    },
  });

  const provider = form.watch("provider");
  const editProvider = editForm.watch("provider");

  function onProviderChange(value: string) {
    form.setValue("provider", value as "gmail" | "outlook" | "smtp");
    const defaults = PROVIDER_DEFAULTS[value];
    if (defaults) {
      form.setValue("smtpHost", defaults.host);
      form.setValue("smtpPort", defaults.port);
    }
    const imapDefaults = IMAP_DEFAULTS[value];
    if (imapDefaults) {
      form.setValue("imapHost", imapDefaults.host);
      form.setValue("imapPort", imapDefaults.port);
    }
  }

  function onSubmit(values: FormValues) {
    create.mutate({ data: values });
  }

  function openEditAccount(account: NonNullable<typeof accounts>[number]) {
    setEditingAccount(account);
    editForm.reset({
      email: account.email,
      name: account.name ?? "",
      provider: account.provider,
      warmupEnabled: account.warmupEnabled,
      dailySendLimit: account.dailySendLimit,
      smtpHost: account.smtpHost ?? PROVIDER_DEFAULTS[account.provider]?.host ?? "",
      smtpPort: account.smtpPort ?? PROVIDER_DEFAULTS[account.provider]?.port ?? 587,
      smtpUsername: account.smtpUsername ?? "",
      imapHost: account.imapHost ?? IMAP_DEFAULTS[account.provider]?.host ?? "",
      imapPort: account.imapPort ?? IMAP_DEFAULTS[account.provider]?.port ?? 993,
      smtpPassword: "",
    });
  }

  function onEditProviderChange(value: string) {
    editForm.setValue("provider", value as "gmail" | "outlook" | "smtp");
    const defaults = PROVIDER_DEFAULTS[value];
    if (defaults) {
      editForm.setValue("smtpHost", defaults.host);
      editForm.setValue("smtpPort", defaults.port);
    }
    const imapDefaults = IMAP_DEFAULTS[value];
    if (imapDefaults) {
      editForm.setValue("imapHost", imapDefaults.host);
      editForm.setValue("imapPort", imapDefaults.port);
    }
  }

  function onEditSubmit(values: EditFormValues) {
    if (!editingAccount) return;
    const { smtpPassword, ...rest } = values;
    updateAccount.mutate({
      id: editingAccount.id,
      data: {
        ...rest,
        smtpPassword: smtpPassword?.trim() ? smtpPassword : undefined,
      },
    });
  }

  function toggleSelectedAccount(id: number, selected: boolean) {
    setSelectedAccountIds((current) => selected ? Array.from(new Set([...current, id])) : current.filter((accountId) => accountId !== id));
  }

  function toggleAllAccounts(selected: boolean) {
    setSelectedAccountIds(selected ? (accounts ?? []).map((account) => account.id) : []);
  }

  function onBulkEditSubmit(values: BulkEditFormValues) {
    if (selectedAccountIds.length === 0) {
      toast({ title: "Select accounts first", description: "Choose one or more mailboxes to update.", variant: "destructive" });
      return;
    }
    bulkEdit.mutate(values);
  }

  async function onBulkFileChange(file?: File) {
    if (!file) return;
    setBulkText(await file.text());
    setBulkResult(null);
  }

  function onBulkSubmit() {
    const text = bulkText.trim();
    if (!text) {
      toast({ title: "Add accounts first", description: "Paste CSV rows or upload a CSV file.", variant: "destructive" });
      return;
    }
    bulkImport.mutate(text);
  }

  const accountSummary = (() => {
    const rows = accounts ?? [];
    const sendable = rows.filter((account) => account.status === "connected" || account.status === "warming");
    const effectiveCapacity = sendable.reduce((sum, account) => sum + effectiveDailyLimit(account), 0);
    const sentToday = sendable.reduce((sum, account) => sum + (account.sentToday ?? 0), 0);
    const warming = rows.filter((account) => account.status === "warming" || account.warmupEnabled).length;
    const errors = rows.filter((account) => account.status === "error").length;
    return { sendable: sendable.length, effectiveCapacity, sentToday, warming, errors };
  })();

  return (
    <div className="p-8 max-w-[1500px] mx-auto space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Email Accounts</h1>
          <p className="text-sm text-muted-foreground mt-1">{accounts?.length ?? 0} sending accounts connected</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => { setBulkOpen(true); setBulkResult(null); }} data-testid="button-import-accounts">
            <Upload className="mr-2 h-4 w-4" /> Import Accounts
          </Button>
          <Button variant="outline" onClick={() => setBulkEditOpen(true)} disabled={selectedAccountIds.length === 0} data-testid="button-bulk-edit-accounts">
            <Pencil className="mr-2 h-4 w-4" /> Bulk Edit{selectedAccountIds.length > 0 ? ` (${selectedAccountIds.length})` : ""}
          </Button>
          <Button onClick={() => setOpen(true)} data-testid="button-add-account">
            <Plus className="mr-2 h-4 w-4" /> Add Account
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Sendable Mailboxes", value: accountSummary.sendable, sub: `${accounts?.length ?? 0} total connected`, icon: Mail },
          { label: "Capacity Today", value: accountSummary.effectiveCapacity, sub: `${accountSummary.sentToday} already sent`, icon: Send },
          { label: "Warmup Accounts", value: accountSummary.warming, sub: "weekday-based warmup caps", icon: Flame },
          { label: "Needs Attention", value: accountSummary.errors, sub: "accounts in error state", icon: AlertCircle },
        ].map((item) => (
          <Card key={item.label}>
            <CardContent className="pt-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm text-muted-foreground">{item.label}</p>
                  <p className="mt-1 text-2xl font-semibold">{item.value.toLocaleString()}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{item.sub}</p>
                </div>
                <item.icon className="h-4 w-4 text-muted-foreground" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {(accounts ?? []).length > 0 && (
        <Card>
          <CardContent className="pt-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">Mailbox Capacity Heatmap</p>
                <p className="text-xs text-muted-foreground">Each bar shows sent today against the current warmup-adjusted limit.</p>
              </div>
              <Badge variant="secondary">{accountSummary.sentToday}/{accountSummary.effectiveCapacity} used</Badge>
            </div>
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
              {(accounts ?? []).map((account) => {
                const limit = effectiveDailyLimit(account);
                const pct = Math.min(100, Math.round(((account.sentToday ?? 0) / Math.max(1, limit)) * 100));
                return (
                  <div key={account.id} className="rounded-md border border-border bg-muted/20 p-2">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="truncate">{account.email}</span>
                      <span className="text-muted-foreground">{account.sentToday}/{limit}</span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="text-center py-16 text-muted-foreground">Loading accounts...</div>
      ) : accounts?.length === 0 ? (
        <div className="flex flex-col items-center gap-4 py-20 text-muted-foreground">
          <Mail className="h-10 w-10 opacity-30" />
          <p className="text-sm">No email accounts connected yet.</p>
          <Button variant="outline" onClick={() => setOpen(true)} data-testid="button-add-first-account">
            Connect your first account
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-2 rounded-md border border-border bg-muted/20 px-3 py-2 text-sm">
            <Checkbox
              checked={selectedAccountIds.length > 0 && selectedAccountIds.length === (accounts?.length ?? 0)}
              onCheckedChange={(checked) => toggleAllAccounts(checked === true)}
              data-testid="checkbox-select-all-accounts"
            />
            <span>Select all accounts</span>
            {selectedAccountIds.length > 0 && <span className="text-muted-foreground">({selectedAccountIds.length} selected)</span>}
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {accounts?.map(account => (
            <Card key={account.id} data-testid={`card-account-${account.id}`} className="border-border">
              <CardContent className="pt-5 space-y-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 gap-3">
                    <Checkbox
                      className="mt-0.5"
                      checked={selectedAccountIds.includes(account.id)}
                      onCheckedChange={(checked) => toggleSelectedAccount(account.id, checked === true)}
                      data-testid={`checkbox-account-${account.id}`}
                    />
                    <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      {STATUS_ICON[account.status]}
                      <p className="font-medium text-sm truncate">{account.email}</p>
                    </div>
                    {account.name && <p className="text-xs text-muted-foreground mt-0.5">{account.name}</p>}
                    </div>
                  </div>
                  <Badge variant={STATUS_BADGE[account.status] as any} className="shrink-0 capitalize">
                    {account.status}
                  </Badge>
                </div>

                {account.status === "error" && account.lastError && (
                  <p className="text-xs text-destructive bg-destructive/10 rounded p-2 break-words">{account.lastError}</p>
                )}

                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-muted-foreground text-xs">Provider</p>
                    <p className="font-medium capitalize">{account.provider}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Sent Today</p>
                    <p className="font-medium">{account.sentToday} / {effectiveDailyLimit(account)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Daily Limit</p>
                    <p className="font-medium">{account.dailySendLimit}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Effective Today</p>
                    <p className="font-medium">{effectiveDailyLimit(account)}</p>
                  </div>
                  {account.smtpHost && (
                    <div className="col-span-2">
                      <p className="text-muted-foreground text-xs">SMTP</p>
                      <p className="font-medium text-xs truncate">{account.smtpHost}:{account.smtpPort}</p>
                    </div>
                  )}
                  {account.imapHost && (
                    <div className="col-span-2">
                      <p className="text-muted-foreground text-xs">IMAP</p>
                      <p className="font-medium text-xs truncate">{account.imapHost}:{account.imapPort}</p>
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between pt-1 border-t border-border">
                  <div className="flex items-center gap-2">
                    <Flame className="h-4 w-4 text-orange-500" />
                    <span className="text-sm">Warmup</span>
                    <Switch
                      checked={account.warmupEnabled}
                      onCheckedChange={(v) => updateAccount.mutate({ id: account.id, data: { warmupEnabled: v } })}
                      data-testid={`switch-warmup-${account.id}`}
                    />
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openEditAccount(account)}
                      data-testid={`button-edit-account-${account.id}`}
                    >
                      <Pencil className="h-4 w-4 mr-1" />
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => test.mutate({ id: account.id })}
                      disabled={test.isPending || !account.hasSmtpPassword}
                      data-testid={`button-test-account-${account.id}`}
                    >
                      <Send className="h-4 w-4 mr-1" />
                      Test
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => remove.mutate({ id: account.id })}
                      data-testid={`button-delete-account-${account.id}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
            ))}
          </div>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Connect Email Account</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col flex-1 min-h-0">
              <div className="overflow-y-auto flex-1 space-y-4 pr-1">
                <FormField control={form.control} name="email" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email Address <span className="text-destructive">*</span></FormLabel>
                    <FormControl><Input placeholder="you@company.com" data-testid="input-account-email" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="name" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Display Name</FormLabel>
                    <FormControl><Input placeholder="Your Name" data-testid="input-account-name" {...field} /></FormControl>
                    <FormDescription>Shown in the "From" field of outgoing emails</FormDescription>
                  </FormItem>
                )} />
                <FormField control={form.control} name="provider" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Provider <span className="text-destructive">*</span></FormLabel>
                    <Select onValueChange={onProviderChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-provider">
                          <SelectValue placeholder="Select provider" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="gmail">Gmail</SelectItem>
                        <SelectItem value="outlook">Outlook</SelectItem>
                        <SelectItem value="smtp">Custom SMTP</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />

                {provider === "gmail" && (
                  <div className="rounded-md border border-border bg-muted/30 p-3 text-xs space-y-1.5">
                    <p className="font-medium">Gmail needs an App Password</p>
                    <p className="text-muted-foreground">
                      Your regular Gmail password won't work. Generate a 16-character app password at{" "}
                      <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener noreferrer" className="text-primary underline">
                        myaccount.google.com/apppasswords
                      </a>{" "}
                      (requires 2-Step Verification) and paste it below.
                    </p>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <FormField control={form.control} name="smtpHost" render={({ field }) => (
                    <FormItem className="col-span-2 sm:col-span-1">
                      <FormLabel>SMTP Host</FormLabel>
                      <FormControl><Input placeholder="smtp.gmail.com" data-testid="input-smtp-host" {...field} /></FormControl>
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="smtpPort" render={({ field }) => (
                    <FormItem className="col-span-2 sm:col-span-1">
                      <FormLabel>Port</FormLabel>
                      <FormControl><Input type="number" placeholder="587" data-testid="input-smtp-port" {...field} /></FormControl>
                    </FormItem>
                  )} />
                </div>

                <FormField control={form.control} name="smtpUsername" render={({ field }) => (
                  <FormItem>
                    <FormLabel>SMTP Username</FormLabel>
                    <FormControl><Input placeholder="Leave blank to use email address" data-testid="input-smtp-username" {...field} /></FormControl>
                  </FormItem>
                )} />

                <div className="grid grid-cols-2 gap-3">
                  <FormField control={form.control} name="imapHost" render={({ field }) => (
                    <FormItem className="col-span-2 sm:col-span-1">
                      <FormLabel>IMAP Host</FormLabel>
                      <FormControl><Input placeholder="imap.gmail.com" data-testid="input-imap-host" {...field} /></FormControl>
                      <FormDescription>Used to track replies and bounces.</FormDescription>
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="imapPort" render={({ field }) => (
                    <FormItem className="col-span-2 sm:col-span-1">
                      <FormLabel>IMAP Port</FormLabel>
                      <FormControl><Input type="number" placeholder="993" data-testid="input-imap-port" {...field} /></FormControl>
                    </FormItem>
                  )} />
                </div>

                <FormField control={form.control} name="smtpPassword" render={({ field }) => (
                  <FormItem>
                    <FormLabel>SMTP Password / App Password <span className="text-destructive">*</span></FormLabel>
                    <FormControl><Input type="password" placeholder="16-character app password" data-testid="input-smtp-password" {...field} /></FormControl>
                    <FormDescription>Stored encrypted. Never returned by the API.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="dailySendLimit" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Daily Send Limit</FormLabel>
                    <FormControl><Input type="number" placeholder="50" data-testid="input-daily-limit" {...field} /></FormControl>
                    <FormDescription>Max emails sent per day from this account</FormDescription>
                  </FormItem>
                )} />

                <FormField control={form.control} name="warmupEnabled" render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between">
                    <div>
                      <FormLabel>Enable Warmup</FormLabel>
                      <FormDescription>Gradually increase sending volume to improve deliverability</FormDescription>
                    </div>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} data-testid="switch-warmup-new" />
                    </FormControl>
                  </FormItem>
                )} />
              </div>
              <DialogFooter className="shrink-0 pt-4 border-t border-border mt-2">
                <Button type="button" variant="outline" onClick={() => setOpen(false)} data-testid="button-cancel-account">Cancel</Button>
                <Button type="submit" disabled={create.isPending} data-testid="button-submit-account">
                  {create.isPending ? "Connecting..." : "Connect Account"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editingAccount} onOpenChange={(nextOpen) => { if (!nextOpen) setEditingAccount(null); }}>
        <DialogContent className="max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Edit Email Account</DialogTitle>
          </DialogHeader>
          <Form {...editForm}>
            <form onSubmit={editForm.handleSubmit(onEditSubmit)} className="flex flex-col flex-1 min-h-0">
              <div className="overflow-y-auto flex-1 space-y-4 pr-1">
                <FormField control={editForm.control} name="email" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email Address</FormLabel>
                    <FormControl><Input data-testid="input-edit-account-email" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={editForm.control} name="name" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Display Name</FormLabel>
                    <FormControl><Input data-testid="input-edit-account-name" {...field} /></FormControl>
                  </FormItem>
                )} />
                <FormField control={editForm.control} name="provider" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Provider</FormLabel>
                    <Select onValueChange={onEditProviderChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-edit-provider">
                          <SelectValue placeholder="Select provider" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="gmail">Gmail</SelectItem>
                        <SelectItem value="outlook">Outlook</SelectItem>
                        <SelectItem value="smtp">Custom SMTP</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />

                {editProvider === "gmail" && (
                  <div className="rounded-md border border-border bg-muted/30 p-3 text-xs space-y-1.5">
                    <p className="font-medium">Gmail needs an App Password</p>
                    <p className="text-muted-foreground">Leave the password blank unless you want to replace the stored app password.</p>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <FormField control={editForm.control} name="smtpHost" render={({ field }) => (
                    <FormItem className="col-span-2 sm:col-span-1">
                      <FormLabel>SMTP Host</FormLabel>
                      <FormControl><Input data-testid="input-edit-smtp-host" {...field} /></FormControl>
                    </FormItem>
                  )} />
                  <FormField control={editForm.control} name="smtpPort" render={({ field }) => (
                    <FormItem className="col-span-2 sm:col-span-1">
                      <FormLabel>SMTP Port</FormLabel>
                      <FormControl><Input type="number" data-testid="input-edit-smtp-port" {...field} /></FormControl>
                    </FormItem>
                  )} />
                </div>

                <FormField control={editForm.control} name="smtpUsername" render={({ field }) => (
                  <FormItem>
                    <FormLabel>SMTP Username</FormLabel>
                    <FormControl><Input data-testid="input-edit-smtp-username" {...field} /></FormControl>
                  </FormItem>
                )} />

                <div className="grid grid-cols-2 gap-3">
                  <FormField control={editForm.control} name="imapHost" render={({ field }) => (
                    <FormItem className="col-span-2 sm:col-span-1">
                      <FormLabel>IMAP Host</FormLabel>
                      <FormControl><Input data-testid="input-edit-imap-host" {...field} /></FormControl>
                      <FormDescription>Used to track replies and bounces.</FormDescription>
                    </FormItem>
                  )} />
                  <FormField control={editForm.control} name="imapPort" render={({ field }) => (
                    <FormItem className="col-span-2 sm:col-span-1">
                      <FormLabel>IMAP Port</FormLabel>
                      <FormControl><Input type="number" data-testid="input-edit-imap-port" {...field} /></FormControl>
                    </FormItem>
                  )} />
                </div>

                <FormField control={editForm.control} name="smtpPassword" render={({ field }) => (
                  <FormItem>
                    <FormLabel>SMTP Password / App Password</FormLabel>
                    <FormControl><Input type="password" placeholder="Leave blank to keep existing password" data-testid="input-edit-smtp-password" {...field} /></FormControl>
                    <FormDescription>Only enter this if replacing the stored password.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={editForm.control} name="dailySendLimit" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Daily Send Limit</FormLabel>
                    <FormControl><Input type="number" data-testid="input-edit-daily-limit" {...field} /></FormControl>
                  </FormItem>
                )} />

                <FormField control={editForm.control} name="warmupEnabled" render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between">
                    <div>
                      <FormLabel>Enable Warmup</FormLabel>
                      <FormDescription>Gradually increases the effective sending cap.</FormDescription>
                    </div>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} data-testid="switch-edit-warmup" />
                    </FormControl>
                  </FormItem>
                )} />
              </div>
              <DialogFooter className="shrink-0 pt-4 border-t border-border mt-2">
                <Button type="button" variant="outline" onClick={() => setEditingAccount(null)} data-testid="button-cancel-edit-account">Cancel</Button>
                <Button type="submit" disabled={updateAccount.isPending} data-testid="button-save-edit-account">
                  {updateAccount.isPending ? "Saving..." : "Save Account"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkEditOpen} onOpenChange={setBulkEditOpen}>
        <DialogContent className="max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Bulk Edit Accounts</DialogTitle>
          </DialogHeader>
          <Form {...bulkEditForm}>
            <form onSubmit={bulkEditForm.handleSubmit(onBulkEditSubmit)} className="flex flex-col flex-1 min-h-0">
              <div className="overflow-y-auto flex-1 space-y-4 pr-1">
                <div className="rounded-md border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
                  Updating {selectedAccountIds.length} selected account{selectedAccountIds.length === 1 ? "" : "s"}. Blank fields are left unchanged.
                </div>

                <FormField control={bulkEditForm.control} name="dailySendLimit" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Daily Send Limit</FormLabel>
                    <FormControl><Input type="number" placeholder="Leave blank to keep unchanged" data-testid="input-bulk-daily-limit" {...field} value={field.value ?? ""} /></FormControl>
                    <FormDescription>Warmup may still cap the effective daily volume below this number.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )} />

                <div className="grid gap-3 sm:grid-cols-2">
                  <FormField control={bulkEditForm.control} name="warmupEnabled" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Warmup</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl><SelectTrigger data-testid="select-bulk-warmup"><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="keep">Keep unchanged</SelectItem>
                          <SelectItem value="true">Enable warmup</SelectItem>
                          <SelectItem value="false">Disable warmup</SelectItem>
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )} />
                  <FormField control={bulkEditForm.control} name="status" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Status</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl><SelectTrigger data-testid="select-bulk-status"><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="keep">Keep unchanged</SelectItem>
                          <SelectItem value="connected">Connected</SelectItem>
                          <SelectItem value="warming">Warming</SelectItem>
                          <SelectItem value="disconnected">Disconnected</SelectItem>
                          <SelectItem value="error">Error</SelectItem>
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )} />
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <FormField control={bulkEditForm.control} name="smtpHost" render={({ field }) => (
                    <FormItem>
                      <FormLabel>SMTP Host</FormLabel>
                      <FormControl><Input placeholder="Leave blank to keep unchanged" data-testid="input-bulk-smtp-host" {...field} /></FormControl>
                    </FormItem>
                  )} />
                  <FormField control={bulkEditForm.control} name="smtpPort" render={({ field }) => (
                    <FormItem>
                      <FormLabel>SMTP Port</FormLabel>
                      <FormControl><Input type="number" placeholder="Leave blank" data-testid="input-bulk-smtp-port" {...field} value={field.value ?? ""} /></FormControl>
                    </FormItem>
                  )} />
                  <FormField control={bulkEditForm.control} name="imapHost" render={({ field }) => (
                    <FormItem>
                      <FormLabel>IMAP Host</FormLabel>
                      <FormControl><Input placeholder="Leave blank to keep unchanged" data-testid="input-bulk-imap-host" {...field} /></FormControl>
                    </FormItem>
                  )} />
                  <FormField control={bulkEditForm.control} name="imapPort" render={({ field }) => (
                    <FormItem>
                      <FormLabel>IMAP Port</FormLabel>
                      <FormControl><Input type="number" placeholder="Leave blank" data-testid="input-bulk-imap-port" {...field} value={field.value ?? ""} /></FormControl>
                    </FormItem>
                  )} />
                </div>
              </div>
              <DialogFooter className="shrink-0 pt-4 border-t border-border mt-2">
                <Button type="button" variant="outline" onClick={() => setBulkEditOpen(false)} data-testid="button-cancel-bulk-edit">Cancel</Button>
                <Button type="submit" disabled={bulkEdit.isPending || selectedAccountIds.length === 0} data-testid="button-save-bulk-edit">
                  {bulkEdit.isPending ? "Updating..." : "Update Selected"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Import Email Accounts</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 overflow-y-auto pr-1">
            <div className="rounded-md border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
              Upload a CSV or paste rows below. Passwords are encrypted on import and never returned by the API.
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium">CSV File</label>
              <Input
                type="file"
                accept=".csv,text/csv"
                onChange={(event) => onBulkFileChange(event.target.files?.[0])}
                data-testid="input-bulk-accounts-file"
              />
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium">CSV Rows</label>
              <Textarea
                className="min-h-64 font-mono text-xs"
                placeholder={SAMPLE_CSV}
                value={bulkText}
                onChange={(event) => { setBulkText(event.target.value); setBulkResult(null); }}
                data-testid="textarea-bulk-accounts"
              />
              <p className="text-xs text-muted-foreground">
                Supported columns: email, name, provider, smtpPassword, warmupEnabled, dailySendLimit, smtpHost, smtpPort, smtpUsername, imapHost, imapPort.
              </p>
            </div>

            {bulkResult && (
              <div className="rounded-md border border-border p-3 space-y-3" data-testid="bulk-import-result">
                <div className="grid grid-cols-3 gap-3 text-sm">
                  <div>
                    <p className="text-muted-foreground text-xs">Imported</p>
                    <p className="text-xl font-semibold">{bulkResult.imported}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Skipped</p>
                    <p className="text-xl font-semibold">{bulkResult.skipped}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Total Rows</p>
                    <p className="text-xl font-semibold">{bulkResult.total}</p>
                  </div>
                </div>
                {bulkResult.errors.length > 0 && (
                  <div className="max-h-40 overflow-y-auto rounded bg-muted/30 p-2 text-xs">
                    {bulkResult.errors.slice(0, 25).map((error, index) => (
                      <p key={`${error.row}-${error.email ?? index}`} className="text-muted-foreground">
                        Row {error.row}: {error.email ? `${error.email} - ` : ""}{error.reason}
                      </p>
                    ))}
                    {bulkResult.errors.length > 25 && (
                      <p className="text-muted-foreground">Plus {bulkResult.errors.length - 25} more skipped rows.</p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
          <DialogFooter className="shrink-0 pt-4 border-t border-border mt-2">
            <Button type="button" variant="outline" onClick={() => setBulkOpen(false)} data-testid="button-cancel-bulk-accounts">
              Close
            </Button>
            <Button type="button" onClick={onBulkSubmit} disabled={bulkImport.isPending} data-testid="button-submit-bulk-accounts">
              {bulkImport.isPending ? "Importing..." : "Import Accounts"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
