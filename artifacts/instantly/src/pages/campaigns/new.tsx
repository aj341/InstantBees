import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useCreateCampaign, getListCampaignsQueryKey, getGetCampaignStatsQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, CalendarClock, CheckCircle2, MailPlus, MousePointerClick, Route, ShieldCheck } from "lucide-react";
import { Link } from "wouter";
import { toast } from "@/hooks/use-toast";

const schema = z.object({
  name: z.string().min(1, "Campaign name is required"),
  fromName: z.string().optional(),
  replyTo: z.string().email("Must be a valid email").optional().or(z.literal("")),
  dailyLimit: z.coerce.number().min(1).max(10000).optional(),
  batchSize: z.coerce.number().min(1).max(10000).default(25),
  batchIntervalMinutes: z.coerce.number().min(1).max(1440).default(60),
  trackOpens: z.boolean().default(true),
  trackClicks: z.boolean().default(true),
  includeUnsubscribe: z.boolean().default(true),
  scheduledStartAt: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

export default function NewCampaign() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const create = useCreateCampaign({
    mutation: {
      onSuccess: (campaign) => {
        toast({ title: "Campaign created successfully" });
        queryClient.invalidateQueries({ queryKey: getListCampaignsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetCampaignStatsQueryKey() });
        setLocation(`/campaigns/${campaign.id}`);
      },
      onError: () => toast({ title: "Failed to create campaign", variant: "destructive" }),
    },
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "",
      fromName: "",
      replyTo: "",
      trackOpens: true,
      trackClicks: true,
      includeUnsubscribe: true,
      batchSize: 25,
      batchIntervalMinutes: 60,
      scheduledStartAt: "",
    },
  });

  const batchSize = form.watch("batchSize") || 1;
  const batchIntervalMinutes = form.watch("batchIntervalMinutes") || 60;
  const dailyLimit = form.watch("dailyLimit");
  const staggerMinutes = Math.max(1, Math.round(batchIntervalMinutes / Math.max(batchSize, 1)));
  const estimatedDailyVolume = dailyLimit || "Mailbox capped";

  function onSubmit(values: FormValues) {
    const scheduled = values.scheduledStartAt
      ? new Date(values.scheduledStartAt).toISOString()
      : undefined;
    create.mutate({
      data: {
        name: values.name,
        fromName: values.fromName || undefined,
        replyTo: values.replyTo || undefined,
        dailyLimit: values.dailyLimit,
        batchSize: values.batchSize,
        batchIntervalMinutes: values.batchIntervalMinutes,
        trackOpens: values.trackOpens,
        trackClicks: values.trackClicks,
        includeUnsubscribe: values.includeUnsubscribe,
        scheduledStartAt: scheduled,
      },
    });
  }

  return (
    <div className="p-8 max-w-[1200px] mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/campaigns">
          <Button variant="ghost" size="icon" data-testid="button-back">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">New Campaign</h1>
          <p className="text-sm text-muted-foreground">Create the shell, then add sequence steps and leads.</p>
        </div>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-6">
            <div className="grid gap-3 md:grid-cols-4">
              {[
                { label: "Basics", icon: MailPlus },
                { label: "Cadence", icon: CalendarClock },
                { label: "Tracking", icon: MousePointerClick },
                { label: "Launch", icon: ShieldCheck },
              ].map((step, index) => {
                const Icon = step.icon;
                return (
                  <div key={step.label} className="rounded-lg border border-border bg-card/70 p-3">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary">
                        <Icon className="h-4 w-4" />
                      </span>
                      {step.label}
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">Step {index + 1}</p>
                  </div>
                );
              })}
            </div>

            <Card>
            <CardHeader>
              <CardTitle>Campaign Details</CardTitle>
              <CardDescription>Basic information about your campaign</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Campaign Name</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. Q4 SaaS Outreach" data-testid="input-campaign-name" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="fromName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>From Name</FormLabel>
                    <FormControl>
                      <Input placeholder="Your name or company" data-testid="input-from-name" {...field} />
                    </FormControl>
                    <FormDescription>The name recipients see as the sender</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="replyTo"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Reply-To Email</FormLabel>
                    <FormControl>
                      <Input placeholder="you@company.com" data-testid="input-reply-to" {...field} />
                    </FormControl>
                    <FormDescription>Replies go to this address</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="dailyLimit"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Daily Send Limit</FormLabel>
                    <FormControl>
                      <Input type="number" placeholder="50" data-testid="input-daily-limit" {...field} />
                    </FormControl>
                    <FormDescription>Max emails sent per day across all accounts</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="batchSize"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Batch Size</FormLabel>
                      <FormControl>
                        <Input type="number" min={1} placeholder="25" data-testid="input-batch-size" {...field} />
                      </FormControl>
                      <FormDescription>How many leads to queue per batch.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="batchIntervalMinutes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Batch Interval</FormLabel>
                      <FormControl>
                        <Input type="number" min={1} placeholder="60" data-testid="input-batch-interval" {...field} />
                      </FormControl>
                      <FormDescription>Minutes to wait between batches.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="scheduledStartAt"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Schedule Start Time</FormLabel>
                    <FormControl>
                      <Input
                        type="datetime-local"
                        data-testid="input-scheduled-start-at"
                        {...field}
                        value={field.value ?? ""}
                      />
                    </FormControl>
                    <FormDescription>
                      Optional. If set, sends won't begin until this date/time even after you click Launch. Leave blank to start immediately on launch.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
            </Card>

            <Card>
            <CardHeader>
              <CardTitle>Tracking</CardTitle>
              <CardDescription>Configure what gets tracked for this campaign</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="trackOpens"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between">
                    <div>
                      <FormLabel>Track Opens</FormLabel>
                      <FormDescription>Track when recipients open your emails</FormDescription>
                    </div>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} data-testid="switch-track-opens" />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="trackClicks"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between">
                    <div>
                      <FormLabel>Track Clicks</FormLabel>
                      <FormDescription>Track when recipients click links in your emails</FormDescription>
                    </div>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} data-testid="switch-track-clicks" />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="includeUnsubscribe"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between">
                    <div>
                      <FormLabel>Include Unsubscribe Link</FormLabel>
                      <FormDescription>Adds a one-click unsubscribe link and a List-Unsubscribe header to every email. Strongly recommended for deliverability and compliance.</FormDescription>
                    </div>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} data-testid="switch-include-unsub" />
                    </FormControl>
                  </FormItem>
                )}
              />
            </CardContent>
            </Card>

            <div className="flex justify-end gap-3">
              <Link href="/campaigns">
                <Button variant="outline" type="button" data-testid="button-cancel">Cancel</Button>
              </Link>
              <Button type="submit" disabled={create.isPending} data-testid="button-create-campaign">
                {create.isPending ? "Creating..." : "Create Campaign"}
              </Button>
            </div>
          </div>

          <aside className="space-y-4">
            <Card className="sticky top-6">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Route className="h-4 w-4 text-primary" />
                  Launch Readiness
                </CardTitle>
                <CardDescription>What happens after this campaign shell is created.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-lg border border-border bg-muted/30 p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Cadence preview</p>
                  <p className="mt-2 text-2xl font-bold">{batchSize} per batch</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Staggered about every {staggerMinutes} min across a {batchIntervalMinutes} min interval.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge variant="secondary">Daily: {estimatedDailyVolume}</Badge>
                    <Badge variant="outline">Mailbox limits still win</Badge>
                  </div>
                </div>

                {[
                  "Create sequence steps",
                  "Attach leads or labels",
                  "Confirm mailbox pool",
                  "Review send window",
                  "Launch when ready",
                ].map((item) => (
                  <div key={item} className="flex items-center gap-3 text-sm">
                    <CheckCircle2 className="h-4 w-4 text-primary" />
                    <span>{item}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </aside>
        </form>
      </Form>
    </div>
  );
}
