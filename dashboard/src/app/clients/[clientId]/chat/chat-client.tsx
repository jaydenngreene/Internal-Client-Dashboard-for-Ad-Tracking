"use client";

import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getChatHistory, sendChatMessage, getClients, campaignGoalForNiche } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ClientKicker } from "@/components/client-kicker";
import { ChatToolResult } from "@/components/chat-tool-result";
import { cn } from "@/lib/utils";

// A handful of real questions Gojo can actually answer with the tools it has
// (see api/src/lib/chatTools.ts) — clickable so a first-time user doesn't have
// to guess what's fair game to ask, instead of static hint text nobody can act on.
const EXAMPLE_PROMPTS = [
  "What's my best campaign this month?",
  "Why did ROAS drop last week?",
  "How's my LTV trending?",
  "What's my current budget pacing?",
];

function GojoAvatar({ size = "md" }: { size?: "md" | "lg" }) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-full ring-1 ring-primary/25",
        size === "lg" ? "size-10" : "size-6"
      )}
    >
      <img src="/gojo-logo.png" alt="Gojo" className="size-full object-cover" />
    </span>
  );
}

// Step 51 — conversational AI chat, branded as "Gojo" (this app's named AI
// persona, same convention as every serious competitor's own named assistant —
// Moby, AIR — rather than a generic unbranded "Chat" button). Claude answers
// using real live-queried data via tool-use, never guesses.
export function ChatClient({ clientId }: { clientId: string }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: messages, isLoading } = useQuery({
    queryKey: ["chat", clientId],
    queryFn: () => getChatHistory(clientId),
  });
  const { data: clients } = useQuery({ queryKey: ["clients"], queryFn: getClients });
  const goal = campaignGoalForNiche(clients?.find((c) => c.id === clientId)?.niche ?? "other");

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

  function handleSend(message?: string) {
    const text = (message ?? draft).trim();
    if (!text || send.isPending) return;
    setDraft("");
    send.mutate(text);
  }

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <div className="flex items-center gap-3">
        <GojoAvatar size="lg" />
        <div>
          <ClientKicker clientId={clientId} />
          <h1 className="text-lg font-semibold">Gojo</h1>
        </div>
      </div>
      <p className="-mt-2 text-sm text-muted-foreground">
        Ask a question about this client's performance. Gojo queries real data live, it doesn't guess.
      </p>

      <Card className="flex flex-1 flex-col overflow-hidden px-0">
        <CardContent className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-4">
          {isLoading && <Skeleton className="h-24 w-full" />}

          {!isLoading && (!messages || messages.length === 0) && (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 py-8">
              <span className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-full ring-2 ring-primary/20">
                <img src="/gojo-logo.png" alt="Gojo" className="size-full object-cover" />
              </span>
              <p className="text-sm text-muted-foreground">Try asking Gojo something like:</p>
              <div className="flex flex-wrap justify-center gap-2 px-4">
                {EXAMPLE_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => handleSend(prompt)}
                    className="rounded-full border border-border bg-muted/40 px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-accent"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages?.map((m) => (
            <div
              key={m.id}
              className={cn("flex items-end gap-2", m.role === "user" ? "ml-auto flex-row-reverse" : "mr-auto")}
            >
              {m.role === "assistant" && <GojoAvatar />}
              <div className={cn("flex max-w-[85%] flex-col gap-2", m.role === "user" && "items-end")}>
                <div
                  className={cn(
                    "rounded-lg px-3 py-2 text-sm whitespace-pre-wrap",
                    m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"
                  )}
                >
                  {m.content}
                </div>
                {m.tool_calls?.map((call, i) => <ChatToolResult key={i} call={call} goal={goal} />)}
              </div>
            </div>
          ))}

          {send.isPending && (
            <div className="mr-auto flex items-end gap-2">
              <GojoAvatar />
              <div className="max-w-[85%] rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
                Thinking…
              </div>
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
            placeholder="Ask Gojo about this client's performance…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSend();
            }}
            disabled={send.isPending}
          />
          <Button size="sm" onClick={() => handleSend()} disabled={!draft.trim() || send.isPending}>
            Send
          </Button>
        </div>
      </Card>
    </div>
  );
}
