import { useState } from "react";
import { useListInboxMessages, useUpdateInboxMessage, getListInboxMessagesQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Archive, Star, Circle, CheckCircle, Inbox as InboxIcon, TrendingUp, Minus, TrendingDown } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";

const SENTIMENT_CONFIG = {
  positive: { label: "Positive", icon: TrendingUp, className: "text-green-500" },
  neutral: { label: "Neutral", icon: Minus, className: "text-muted-foreground" },
  negative: { label: "Negative", icon: TrendingDown, className: "text-destructive" },
};

export default function Inbox() {
  const [selected, setSelected] = useState<number | null>(null);
  const queryClient = useQueryClient();
  const { data: messages, isLoading } = useListInboxMessages();

  const update = useUpdateInboxMessage({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getListInboxMessagesQueryKey() }),
      onError: () => toast({ title: "Action failed", variant: "destructive" }),
    },
  });

  const selectedMsg = messages?.find(m => m.id === selected);
  const unreadCount = messages?.filter(m => !m.isRead).length ?? 0;

  function markRead(id: number) {
    update.mutate({ id, data: { isRead: true } });
  }

  function toggleFavorite(id: number, current: boolean) {
    update.mutate({ id, data: { isFavorite: !current } });
  }

  function archive(id: number) {
    update.mutate({ id, data: { isArchived: true } });
    if (selected === id) setSelected(null);
    toast({ title: "Message archived" });
  }

  return (
    <div className="flex h-[calc(100vh-0px)] max-h-screen">
      {/* Message list */}
      <div className="w-80 border-r border-border bg-card flex flex-col shrink-0">
        <div className="p-4 border-b border-border">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-bold">Inbox</h1>
            {unreadCount > 0 && (
              <Badge variant="default" data-testid="badge-unread-count">{unreadCount} unread</Badge>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="p-4 text-center text-muted-foreground text-sm">Loading...</div>
          ) : messages?.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-16 px-4 text-muted-foreground">
              <InboxIcon className="h-8 w-8 opacity-30" />
              <p className="text-sm text-center">No messages yet. Replies from your campaigns will appear here.</p>
            </div>
          ) : messages?.map(msg => (
            <button
              key={msg.id}
              onClick={() => { setSelected(msg.id); markRead(msg.id); }}
              className={cn(
                "w-full text-left px-4 py-3 border-b border-border hover:bg-accent/50 transition-colors",
                selected === msg.id && "bg-accent",
                !msg.isRead && "border-l-2 border-l-primary"
              )}
              data-testid={`button-message-${msg.id}`}
            >
              <div className="flex items-start justify-between gap-2 mb-1">
                <p className={cn("text-sm truncate", !msg.isRead ? "font-semibold" : "font-medium")}>
                  {msg.fromName || msg.fromEmail}
                </p>
                <p className="text-xs text-muted-foreground shrink-0">
                  {formatDistanceToNow(new Date(msg.receivedAt), { addSuffix: true })}
                </p>
              </div>
              <p className={cn("text-xs truncate mb-1", !msg.isRead ? "text-foreground" : "text-muted-foreground")}>
                {msg.subject}
              </p>
              <div className="flex items-center gap-2">
                {msg.sentiment && SENTIMENT_CONFIG[msg.sentiment] && (() => {
                  const config = SENTIMENT_CONFIG[msg.sentiment as keyof typeof SENTIMENT_CONFIG];
                  const Icon = config.icon;
                  return (
                    <span className={cn("flex items-center gap-1 text-xs", config.className)}>
                      <Icon className="h-3 w-3" />
                      {config.label}
                    </span>
                  );
                })()}
                {msg.isFavorite && <Star className="h-3 w-3 text-yellow-500 fill-yellow-500" />}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Message detail */}
      <div className="flex-1 flex flex-col bg-background">
        {selectedMsg ? (
          <>
            <div className="p-4 border-b border-border flex items-center justify-between">
              <div>
                <p className="font-semibold">{selectedMsg.fromName || selectedMsg.fromEmail}</p>
                <p className="text-xs text-muted-foreground">{selectedMsg.fromEmail}</p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => toggleFavorite(selectedMsg.id, selectedMsg.isFavorite ?? false)}
                  data-testid="button-toggle-favorite"
                >
                  <Star className={cn("h-4 w-4", selectedMsg.isFavorite ? "text-yellow-500 fill-yellow-500" : "text-muted-foreground")} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => update.mutate({ id: selectedMsg.id, data: { isRead: !selectedMsg.isRead } })}
                  data-testid="button-toggle-read"
                >
                  {selectedMsg.isRead
                    ? <Circle className="h-4 w-4 text-muted-foreground" />
                    : <CheckCircle className="h-4 w-4 text-primary" />}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => archive(selectedMsg.id)}
                  data-testid="button-archive"
                >
                  <Archive className="h-4 w-4 text-muted-foreground" />
                </Button>
              </div>
            </div>
            <div className="p-6 flex-1 overflow-y-auto">
              <h2 className="text-xl font-bold mb-4">{selectedMsg.subject}</h2>
              {selectedMsg.sentiment && SENTIMENT_CONFIG[selectedMsg.sentiment as keyof typeof SENTIMENT_CONFIG] && (() => {
                const config = SENTIMENT_CONFIG[selectedMsg.sentiment as keyof typeof SENTIMENT_CONFIG];
                const Icon = config.icon;
                return (
                  <div className={cn("flex items-center gap-1.5 mb-4 text-sm", config.className)}>
                    <Icon className="h-4 w-4" />
                    <span>{config.label} sentiment</span>
                  </div>
                );
              })()}
              <div className="prose prose-sm max-w-none text-foreground whitespace-pre-wrap">
                {selectedMsg.body}
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground">
            <InboxIcon className="h-10 w-10 opacity-20" />
            <p className="text-sm">Select a message to read</p>
          </div>
        )}
      </div>
    </div>
  );
}
