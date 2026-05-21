import { useState } from "react";
import { useListCampaigns } from "@workspace/api-client-react";
import { useCampaignActions } from "@/hooks/use-campaigns";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
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
import { Play, Pause, Plus, Trash2 } from "lucide-react";
import { Link } from "wouter";

export default function CampaignsList() {
  const { data: campaigns, isLoading } = useListCampaigns();
  const { launch, pause, remove } = useCampaignActions();
  const [confirmDelete, setConfirmDelete] = useState<{ id: number; name: string } | null>(null);

  if (isLoading) return <div className="p-8">Loading campaigns...</div>;

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold tracking-tight">Campaigns</h1>
        <Link href="/campaigns/new">
          <Button data-testid="button-new-campaign">
            <Plus className="mr-2 h-4 w-4" /> New Campaign
          </Button>
        </Link>
      </div>

      <div className="bg-card rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Sent</TableHead>
              <TableHead>Opens</TableHead>
              <TableHead>Replies</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {campaigns?.map((campaign) => (
              <TableRow key={campaign.id}>
                <TableCell className="font-medium">
                  <Link href={`/campaigns/${campaign.id}`} className="hover:underline">
                    {campaign.name}
                  </Link>
                </TableCell>
                <TableCell>
                  <Badge variant={campaign.status === "active" ? "default" : "secondary"}>
                    {campaign.status}
                  </Badge>
                </TableCell>
                <TableCell>{campaign.sentCount || 0}</TableCell>
                <TableCell>{campaign.openCount || 0}</TableCell>
                <TableCell>{campaign.replyCount || 0}</TableCell>
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
            ))}
            {campaigns?.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  No campaigns found. Create one to get started.
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
