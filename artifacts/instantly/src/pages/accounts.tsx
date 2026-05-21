import { useState } from "react";
import { useListAccounts, useCreateAccount, useDeleteAccount, useUpdateAccount, getListAccountsQueryKey } from "@workspace/api-client-react";
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
import { Plus, Trash2, Mail, Flame, CheckCircle2, XCircle, AlertCircle } from "lucide-react";
import { toast } from "@/hooks/use-toast";

const schema = z.object({
  email: z.string().email("Valid email required"),
  name: z.string().optional(),
  provider: z.enum(["gmail", "outlook", "smtp"]),
  warmupEnabled: z.boolean().default(false),
  dailySendLimit: z.coerce.number().min(1).max(10000).default(50),
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
        toast({ title: "Account connected" });
        queryClient.invalidateQueries({ queryKey: getListAccountsQueryKey() });
        setOpen(false);
        form.reset();
      },
      onError: () => toast({ title: "Failed to connect account", variant: "destructive" }),
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

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", name: "", provider: "gmail", warmupEnabled: false, dailySendLimit: 50 },
  });

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

                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-muted-foreground text-xs">Provider</p>
                    <p className="font-medium capitalize">{account.provider}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Sent Today</p>
                    <p className="font-medium">{account.sentToday} / {account.dailySendLimit}</p>
                  </div>
                  {account.healthScore != null && (
                    <div>
                      <p className="text-muted-foreground text-xs">Health Score</p>
                      <p className="font-medium">{account.healthScore}/100</p>
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
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Connect Email Account</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
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
                </FormItem>
              )} />
              <FormField control={form.control} name="provider" render={({ field }) => (
                <FormItem>
                  <FormLabel>Provider <span className="text-destructive">*</span></FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
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
              <DialogFooter>
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
