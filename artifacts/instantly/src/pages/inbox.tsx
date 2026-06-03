import { useState } from "react";
import { useListInboxMessages, useUpdateInboxMessage, getListInboxMessagesQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Archive, Star, Circle, CheckCircle, Inbox as InboxIcon, TrendingUp, Minus, TrendingDown, Search, Clock } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";

const SENTIMENT_CONFIG = {
  positive: { label: "Positive", icon: TrendingUp, className: "text-green-500" },
  neutral: { label: "Neutral", icon: Minus, className: "text-muted-foreground" },
  negative: { label: "Negative", icon: TrendingDown, className: "text-destructive" },
};

const CATEGORY_CONFIG = {
  out_of_office: { label: "Out of office", icon: Clock, className: "text-amber-400" },
  interested: SENTIMENT_CONFIG.positive,
  referral: { label: "Referral", icon: TrendingUp, className: "text-green-500" },
  objection: { label: "Objection", icon: Minus, className: "text-muted-foreground" },
  not_interested: { label: "Not interested", icon: TrendingDown, className: "text-destructive" },
  bounce: { label: "Bounce", icon: TrendingDown, className: "text-destructive" },
  neutral: SENTIMENT_CONFIG.neutral,
};

type ReplyFilter = "all" | "positive" | "neutral" | "negative" | "out_of_office";

function replyDisplay(message: { sentiment?: string | null; category?: string | null }) {
  if (message.category && message.category in CATEGORY_CONFIG) {
    return CATEGORY_CONFIG[message.category as keyof typeof CATEGORY_CONFIG];
  }
  if (message.sentiment && message.sentiment in SENTIMENT_CONFIG) {
    return SENTIMENT_CONFIG[message.sentiment as keyof typeof SENTIMENT_CONFIG];
  }
  return null;
}

export default function Inbox() {
  const [selected, setSelected] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [replyFilter, setReplyFilter] = useState<ReplyFilter>("all");
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
  const positiveCount = messages?.filter(m => m.sentiment === "positive").length ?? 0;
  const outOfOfficeCount = messages?.filter(m => m.category === "out_of_office").length ?? 0;
  const neutralCount = messages?.filter(m => m.sentiment === "neutral" && m.category !== "out_of_office").length ?? 0;
  const negativeCount = messages?.filter(m => m.sentiment === "negative").length ?? 0;
  const filteredMessages = messages?.filter((msg) => {
    const haystack = `${msg.fromName ?? ""} ${msg.fromEmail ?? ""} ${msg.subject ?? ""} ${msg.body ?? ""}`.toLowerCase();
    const matchesQuery = !query.trim() || haystack.includes(query.trim().toLowerCase());
    const matchesReplyFilter = replyFilter === "all"
      || (replyFilter === "out_of_office" ? msg.category === "out_of_office" : msg.sentiment === replyFilter && msg.category !== "out_of_office");
    return matchesQuery && matchesReplyFilter;
  });

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
      <div className="w-[380px] border-r border-border bg-card flex flex-col shrink-0">
        <div className="p-4 border-b border-border space-y-4">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-bold">Inbox</h1>
            {unreadCount > 0 && (
              <Badge variant="default" data-testid="badge-unread-count">{unreadCount} unread</Badge>
            )}
          </div>
          <div className="grid grid-cols-4 gap-2">
            <Card className="bg-muted/30">
              <CardContent className="p-3">
                <p className="text-xs text-muted-foreground">Positive</p>
                <p className="text-lg font-bold text-green-500">{positiveCount}</p>
              </CardContent>
            </Card>
            <Card className="bg-muted/30">
              <CardContent className="p-3">
                <p className="text-xs text-muted-foreground">Neutral</p>
                <p className="text-lg font-bold">{neutralCount}</p>
              </CardContent>
            </Card>
            <Card className="bg-muted/30">
              <CardContent className="p-3">
                <p className="text-xs text-muted-foreground">OOO</p>
                <p className="text-lg font-bold text-amber-400">{outOfOfficeCount}</p>
              </CardContent>
            </Card>
            <Card className="bg-muted/30">
              <CardContent className="p-3">
                <p className="text-xs text-muted-foreground">Negative</p>
                <p className="text-lg font-bold text-destructive">{negativeCount}</p>
              </CardContent>
            </Card>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search replies"
              className="pl-9"
              data-testid="input-inbox-search"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {(["all", "positive", "neutral", "out_of_office", "negative"] as const).map((value) => (
              <Button
                key={value}
                type="button"
                variant={replyFilter === value ? "default" : "outline"}
                size="sm"
                className="capitalize"
                onClick={() => setReplyFilter(value)}
              >
                {value === "out_of_office" ? "Out of office" : value}
              </Button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="p-4 text-center text-muted-foreground text-sm">Loading...</div>
          ) : filteredMessages?.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-16 px-4 text-muted-foreground">
              <InboxIcon className="h-8 w-8 opacity-30" />
              <p className="text-sm text-center">No replies match this view.</p>
            </div>
          ) : filteredMessages?.map(msg => (
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
                {(() => {
                  const config = replyDisplay(msg);
                  if (!config) return null;
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
              {(() => {
                const config = replyDisplay(selectedMsg);
                if (!config) return null;
                const Icon = config.icon;
                return (
                  <div className={cn("flex items-center gap-1.5 mb-4 text-sm", config.className)}>
                    <Icon className="h-4 w-4" />
                    <span>{selectedMsg.category === "out_of_office" ? config.label : `${config.label} sentiment`}</span>
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
