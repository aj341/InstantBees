import { useState } from "react";
import {
  useGetAnalyticsSummary,
  useGetDailyAnalytics,
  useGetCampaignStats,
  useListCampaigns,
  useResetAllData,
  getGetAnalyticsSummaryQueryKey,
  getGetDailyAnalyticsQueryKey,
  getGetCampaignStatsQueryKey,
  getListCampaignsQueryKey,
  getListLeadsQueryKey,
  getListInboxMessagesQueryKey,
  getListAccountsQueryKey,
  getListTemplatesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Activity, Mail, Users, Inbox, AlertTriangle } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { toast } from "@/hooks/use-toast";

export default function Dashboard() {
  const { data: summary, isLoading: isLoadingSummary } = useGetAnalyticsSummary();
  const { data: dailyStats, isLoading: isLoadingDaily } = useGetDailyAnalytics();
  const { data: campaignStats, isLoading: isLoadingCampaigns } = useGetCampaignStats();
  const queryClient = useQueryClient();

  const [resetOpen, setResetOpen] = useState(false);
  const [resetAccounts, setResetAccounts] = useState(false);
  const [resetTemplates, setResetTemplates] = useState(false);

  const reset = useResetAllData({
    mutation: {
      onSuccess: () => {
        toast({ title: "All data cleared" });
        queryClient.invalidateQueries({ queryKey: getGetAnalyticsSummaryQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetDailyAnalyticsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetCampaignStatsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListCampaignsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListLeadsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListInboxMessagesQueryKey() });
        if (resetAccounts) queryClient.invalidateQueries({ queryKey: getListAccountsQueryKey() });
        if (resetTemplates) queryClient.invalidateQueries({ queryKey: getListTemplatesQueryKey() });
        setResetOpen(false);
        setResetAccounts(false);
        setResetTemplates(false);
      },
      onError: () => toast({ title: "Failed to reset data", variant: "destructive" }),
    },
  });

  if (isLoadingSummary || isLoadingDaily || isLoadingCampaigns) {
    return <div className="p-8">Loading dashboard...</div>;
  }

  return (
    <div className="p-8 space-y-8 max-w-7xl mx-auto">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <Button
          variant="outline"
          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={() => setResetOpen(true)}
          data-testid="button-reset-data"
        >
          <AlertTriangle className="mr-2 h-4 w-4" /> Reset all data
        </Button>
      </div>

      <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Wipe all data?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  This permanently deletes all campaigns, leads, sequence steps, send jobs, inbox messages,
                  unsubscribes, and daily analytics. There's no undo.
                </p>
                <p className="text-xs">By default, email accounts and saved templates are kept.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2 py-2">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={resetAccounts} onCheckedChange={(v) => setResetAccounts(v === true)} data-testid="checkbox-reset-accounts" />
              Also delete connected email accounts
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={resetTemplates} onCheckedChange={(v) => setResetTemplates(v === true)} data-testid="checkbox-reset-templates" />
              Also delete saved email templates
            </label>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-reset">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() =>
                reset.mutate({
                  data: {
                    confirm: "DELETE_ALL_DATA",
                    includeAccounts: resetAccounts,
                    includeTemplates: resetTemplates,
                  },
                })
              }
              data-testid="button-confirm-reset"
            >
              Delete everything
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Sent</CardTitle>
            <Mail className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary?.totalSent || 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Open Rate</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{(summary?.openRate || 0).toFixed(1)}%</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Reply Rate</CardTitle>
            <Inbox className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{(summary?.replyRate || 0).toFixed(1)}%</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Campaigns</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{campaignStats?.activeCampaigns || 0}</div>
          </CardContent>
        </Card>
      </div>

      <Card className="col-span-4">
        <CardHeader>
          <CardTitle>Daily Email Volume</CardTitle>
        </CardHeader>
        <CardContent className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={dailyStats || []}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="date" />
              <YAxis />
              <Tooltip />
              <Line type="monotone" dataKey="sent" stroke="hsl(var(--primary))" strokeWidth={2} />
              <Line type="monotone" dataKey="opened" stroke="hsl(var(--chart-2))" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}
