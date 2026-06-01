import { useMemo, useState } from "react";
import { useListCampaigns } from "@workspace/api-client-react";
import { useCampaignActions } from "@/hooks/use-campaigns";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
import { Activity, BarChart3, Mail, Pause, Play, Plus, Search, Trash2, Users } from "lucide-react";
import { Link } from "wouter";

export default function CampaignsList() {
  const { data: campaigns, isLoading } = useListCampaigns();
  const { launch, pause, remove } = useCampaignActions();
  const [confirmDelete, setConfirmDelete] = useState<{ id: number; name: string } | null>(null);
  const [search, setSearch] = useState("");

  const filteredCampaigns = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return campaigns ?? [];
    return (campaigns ?? []).filter((campaign) =>
      campaign.name.toLowerCase().includes(q) || campaign.status.toLowerCase().includes(q),
    );
  }, [campaigns, search]);

  const summary = useMemo(() => {
    const rows = campaigns ?? [];
    const sent = rows.reduce((sum, campaign) => sum + (campaign.sentCount ?? 0), 0);
    const active = rows.filter((campaign) => campaign.status === "active").length;
    const leads = rows.reduce((sum, campaign) => sum + (campaign.leadsCount ?? 0), 0);
    const replies = rows.reduce((sum, campaign) => sum + (campaign.replyCount ?? 0), 0);
    return { sent, active, leads, replies };
  }, [campaigns]);

  if (isLoading) return <div className="p-8">Loading campaigns...</div>;

  return (
    <div className="p-8 max-w-[1500px] mx-auto space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Campaigns</h1>
          <p className="mt-1 text-sm text-muted-foreground">Build, schedule, monitor, and tune outbound sequences from one control room.</p>
        </div>
        <Link href="/campaigns/new">
          <Button data-testid="button-new-campaign">
            <Plus className="mr-2 h-4 w-4" /> New Campaign
          </Button>
        </Link>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Active Campaigns", value: summary.active, icon: Activity },
          { label: "Total Sent", value: summary.sent, icon: Mail },
          { label: "Leads Enrolled", value: summary.leads, icon: Users },
          { label: "Replies", value: summary.replies, icon: BarChart3 },
        ].map((item) => (
          <Card key={item.label}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{item.label}</CardTitle>
              <item.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold">{item.value.toLocaleString()}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex flex-col gap-3 rounded-md border border-border bg-card p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search campaigns or status"
            className="pl-9"
            data-testid="input-search-campaigns"
          />
        </div>
        <div className="text-xs text-muted-foreground">
          {filteredCampaigns.length.toLocaleString()} of {(campaigns ?? []).length.toLocaleString()} campaigns
        </div>
      </div>

      <div className="bg-card rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Leads</TableHead>
              <TableHead>Sent</TableHead>
              <TableHead>Open Rate</TableHead>
              <TableHead>Click Rate</TableHead>
              <TableHead>Reply Rate</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredCampaigns.map((campaign) => {
              const sent = campaign.sentCount ?? 0;
              const openRate = sent > 0 ? (((campaign.openCount ?? 0) / sent) * 100).toFixed(1) : "0.0";
              const clickRate = sent > 0 ? (((campaign.clickCount ?? 0) / sent) * 100).toFixed(1) : "0.0";
              const replyRate = sent > 0 ? (((campaign.replyCount ?? 0) / sent) * 100).toFixed(1) : "0.0";
              return (
              <TableRow key={campaign.id} className="align-middle">
                <TableCell className="font-medium">
                  <Link href={`/campaigns/${campaign.id}`} className="group block">
                    <span className="group-hover:underline">{campaign.name}</span>
                    <span className="mt-1 block text-xs font-normal text-muted-foreground">
                      {(campaign.batchSize ?? 25).toLocaleString()} staggered every {campaign.batchIntervalMinutes ?? 60} min
                    </span>
                  </Link>
                </TableCell>
                <TableCell>
                  <Badge variant={campaign.status === "active" ? "default" : "secondary"}>
                    {campaign.status}
                  </Badge>
                </TableCell>
                <TableCell>{(campaign.leadsCount ?? 0).toLocaleString()}</TableCell>
                <TableCell>{sent.toLocaleString()}</TableCell>
                <TableCell>{openRate}%</TableCell>
                <TableCell>{clickRate}%</TableCell>
                <TableCell>{replyRate}%</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    {campaign.status === "active" ? (
                      <Button variant="outline" size="sm" onClick={() => pause.mutate({ id: campaign.id })} data-testid={`button-pause-campaign-${campaign.id}`}>
                        <Pause className="h-4 w-4" />
                      </Button>
                    ) : (
                      <Button variant="outline" size="sm" onClick={() => launch.mutate({ id: campaign.id })} data-testid={`button-launch-campaign-${campaign.id}`}>
                        <Play className="h-4 w-4" />
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => setConfirmDelete({ id: campaign.id, name: campaign.name })}
                      data-testid={`button-delete-campaign-${campaign.id}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            );})}
            {filteredCampaigns.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-12 text-muted-foreground">
                  {(campaigns ?? []).length === 0 ? "No campaigns found. Create one to get started." : "No campaigns match that search."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <AlertDialog open={!!confirmDelete} onOpenChange={(open) => !open && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete campaign?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <span className="font-medium">{confirmDelete?.name}</span> along with all its
              sequences, send jobs, lead assignments, and replies. Leads themselves stay in your database.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-campaign">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (confirmDelete) remove.mutate({ id: confirmDelete.id });
                setConfirmDelete(null);
              }}
              data-testid="button-confirm-delete-campaign"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
