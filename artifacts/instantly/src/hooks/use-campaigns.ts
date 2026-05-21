import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  useListCampaigns,
  useCreateCampaign,
  useUpdateCampaign,
  useDeleteCampaign,
  useLaunchCampaign,
  usePauseCampaign,
  getListCampaignsQueryKey,
  getGetCampaignQueryKey,
  getGetCampaignStatsQueryKey,
} from "@workspace/api-client-react";
import { toast } from "@/hooks/use-toast";

export function useCampaignActions() {
  const queryClient = useQueryClient();

  const create = useCreateCampaign({
    mutation: {
      onSuccess: () => {
        toast({ title: "Campaign created" });
        queryClient.invalidateQueries({ queryKey: getListCampaignsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetCampaignStatsQueryKey() });
      },
      onError: () => toast({ title: "Failed to create campaign", variant: "destructive" }),
    },
  });

  const update = useUpdateCampaign({
    mutation: {
      onSuccess: (data) => {
        toast({ title: "Campaign updated" });
        queryClient.invalidateQueries({ queryKey: getListCampaignsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetCampaignQueryKey(data.id) });
      },
      onError: () => toast({ title: "Failed to update campaign", variant: "destructive" }),
    },
  });

  const remove = useDeleteCampaign({
    mutation: {
      onSuccess: () => {
        toast({ title: "Campaign deleted" });
        queryClient.invalidateQueries({ queryKey: getListCampaignsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetCampaignStatsQueryKey() });
      },
      onError: () => toast({ title: "Failed to delete campaign", variant: "destructive" }),
    },
  });

  const launch = useLaunchCampaign({
    mutation: {
      onSuccess: (data) => {
        toast({ title: "Campaign launched" });
        queryClient.invalidateQueries({ queryKey: getListCampaignsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetCampaignQueryKey(data.id) });
        queryClient.invalidateQueries({ queryKey: getGetCampaignStatsQueryKey() });
      },
      onError: () => toast({ title: "Failed to launch campaign", variant: "destructive" }),
    },
  });

  const pause = usePauseCampaign({
    mutation: {
      onSuccess: (data) => {
        toast({ title: "Campaign paused" });
        queryClient.invalidateQueries({ queryKey: getListCampaignsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetCampaignQueryKey(data.id) });
        queryClient.invalidateQueries({ queryKey: getGetCampaignStatsQueryKey() });
      },
      onError: () => toast({ title: "Failed to pause campaign", variant: "destructive" }),
    },
  });

  return { create, update, remove, launch, pause };
}
