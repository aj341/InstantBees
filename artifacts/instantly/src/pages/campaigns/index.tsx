import { useListCampaigns } from "@workspace/api-client-react";
import { useCampaignActions } from "@/hooks/use-campaigns";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Play, Pause, Plus } from "lucide-react";
import { Link } from "wouter";

export default function CampaignsList() {
  const { data: campaigns, isLoading } = useListCampaigns();
  const { launch, pause } = useCampaignActions();

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
                  {campaign.status === "active" ? (
                    <Button variant="outline" size="sm" onClick={() => pause.mutate({ id: campaign.id })}>
                      <Pause className="h-4 w-4" />
                    </Button>
                  ) : (
                    <Button variant="outline" size="sm" onClick={() => launch.mutate({ id: campaign.id })}>
                      <Play className="h-4 w-4" />
                    </Button>
                  )}
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
    </div>
  );
}
