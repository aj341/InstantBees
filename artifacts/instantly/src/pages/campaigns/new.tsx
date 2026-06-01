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
import { ArrowLeft } from "lucide-react";
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
    <div className="p-8 max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/campaigns">
          <Button variant="ghost" size="icon" data-testid="button-back">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">New Campaign</h1>
          <p className="text-sm text-muted-foreground">Set up a new cold email campaign</p>
        </div>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
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
        </form>
      </Form>
    </div>
  );
}
