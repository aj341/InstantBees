import { useState } from "react";
import {
  useListAccounts,
  useCreateAccount,
  useDeleteAccount,
  useUpdateAccount,
  useTestAccount,
  getListAccountsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Mail, Flame, CheckCircle2, XCircle, AlertCircle, Send } from "lucide-react";
import { toast } from "@/hooks/use-toast";

const PROVIDER_DEFAULTS: Record<string, { host: string; port: number }> = {
  gmail: { host: "smtp.gmail.com", port: 587 },
  outlook: { host: "smtp.office365.com", port: 587 },
  smtp: { host: "", port: 587 },
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
  smtpPassword: z.string().min(1, "Required to send emails"),
});

type FormValues = z.infer<typeof schema>;

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

export default function Accounts() {
  const [open, setOpen] = useState(false);
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
      onError: () => toast({ title: "Failed to add account", variant: "destructive" }),
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

  const updateWarmup = useUpdateAccount({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListAccountsQueryKey() });
      },
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
      smtpUsername: "",
      smtpPassword: "",
    },
  });

  const provider = form.watch("provider");

  function onProviderChange(value: string) {
    form.setValue("provider", value as "gmail" | "outlook" | "smtp");
    const defaults = PROVIDER_DEFAULTS[value];
    if (defaults) {
      form.setValue("smtpHost", defaults.host);
      form.setValue("smtpPort", defaults.port);
    }
  }

  function onSubmit(values: FormValues) {
    create.mutate({ data: values });
  }

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Email Accounts</h1>
          <p className="text-sm text-muted-foreground mt-1">{accounts?.length ?? 0} sending accounts connected</p>
        </div>
        <Button onClick={() => setOpen(true)} data-testid="button-add-account">
          <Plus className="mr-2 h-4 w-4" /> Add Account
        </Button>
      </div>

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
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {accounts?.map(account => (
            <Card key={account.id} data-testid={`card-account-${account.id}`} className="border-border">
              <CardContent className="pt-5 space-y-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      {STATUS_ICON[account.status]}
                      <p className="font-medium text-sm truncate">{account.email}</p>
                    </div>
                    {account.name && <p className="text-xs text-muted-foreground mt-0.5">{account.name}</p>}
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
                    <p className="font-medium">{account.sentToday} / {account.dailySendLimit}</p>
                  </div>
                  {account.smtpHost && (
                    <div className="col-span-2">
                      <p className="text-muted-foreground text-xs">SMTP</p>
                      <p className="font-medium text-xs truncate">{account.smtpHost}:{account.smtpPort}</p>
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between pt-1 border-t border-border">
                  <div className="flex items-center gap-2">
                    <Flame className="h-4 w-4 text-orange-500" />
                    <span className="text-sm">Warmup</span>
                    <Switch
                      checked={account.warmupEnabled}
                      onCheckedChange={(v) => updateWarmup.mutate({ id: account.id, data: { warmupEnabled: v } })}
                      data-testid={`switch-warmup-${account.id}`}
                    />
                  </div>
                  <div className="flex items-center gap-1">
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
    </div>
  );
}
