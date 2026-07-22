"use client";

import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getChatHistory, sendChatMessage } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ClientKicker } from "@/components/client-kicker";
import { cn } from "@/lib/utils";

// Step 51 — conversational AI chat. Claude answers using real live-queried data
// via tool-use (see api/src/lib/chatTools.ts), never guesses — this UI is
// intentionally plain (a message list + one input), the substance is the backend
// tool-use loop, not the chrome around it.
export function ChatClient({ clientId }: { clientId: string }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: messages, isLoading } = useQuery({
    queryKey: ["chat", clientId],
    queryFn: () => getChatHistory(clientId),
  });

  const send = useMutation({
    mutationFn: (message: string) => sendChatMessage(clientId, message),
    onMutate: async (message: string) => {
      // Optimistically show the user's own message immediately — the real
      // history refetch below will replace this with the persisted version.
      queryClient.setQueryData(["chat", clientId], (old: unknown) => [
        ...((old as { id: string; role: string; content: string; created_at: string }[]) ?? []),
        { id: `optimistic-${Date.now()}`, role: "user", content: message, created_at: new Date().toISOString() },
      ]);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["chat", clientId] }),
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, send.isPending]);

  function handleSend() {
    const message = draft.trim();
    if (!message || send.isPending) return;
    setDraft("");
    send.mutate(message);
  }

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <div>
        <ClientKicker clientId={clientId} />
        <h1 className="text-lg font-semibold">Ask Your Data</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Ask a question about this client's performance — it queries real data live, it doesn't guess.
        </p>
      </div>

      <Card className="flex flex-1 flex-col overflow-hidden px-0">
        <CardContent className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-4">
          {isLoading && <Skeleton className="h-24 w-full" />}

          {!isLoading && (!messages || messages.length === 0) && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Try: "What's my best campaign this month?" or "Why did ROAS drop last week?"
            </p>
          )}

          {messages?.map((m) => (
            <div
              key={m.id}
              className={cn(
                "max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap",
                m.role === "user" ? "ml-auto bg-primary text-primary-foreground" : "mr-auto bg-muted"
              )}
            >
              {m.content}
            </div>
          ))}

          {send.isPending && (
            <div className="mr-auto max-w-[85%] rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
              Thinking…
            </div>
          )}
          {send.isError && (
            <p className="text-xs text-status-critical">{(send.error as Error).message}</p>
          )}
          <div ref={bottomRef} />
        </CardContent>

        <div className="flex items-center gap-2 border-t border-border p-3">
          <Input
            className="flex-1"
            placeholder="Ask a question about this client's performance…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSend();
            }}
            disabled={send.isPending}
          />
          <Button size="sm" onClick={handleSend} disabled={!draft.trim() || send.isPending}>
            Send
          </Button>
        </div>
      </Card>
    </div>
  );
}
