"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getBudgetReallocations,
  confirmBudgetReallocation,
  dismissBudgetReallocation,
  BudgetReallocationSuggestion,
  BudgetReallocationStatus,
} from "@/lib/api";
import { formatCurrency } from "@/lib/format";
import { SegmentedToggle } from "@/components/segmented-toggle";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ClientKicker } from "@/components/client-kicker";

const STATUS_OPTIONS: { value: BudgetReallocationStatus; label: string }[] = [
  { value: "pending", label: "Pending Review" },
  { value: "confirmed", label: "Confirmed" },
  { value: "dismissed", label: "Dismissed" },
  { value: "failed", label: "Failed" },
];

function SuggestionCard({ item, clientId }: { item: BudgetReallocationSuggestion; clientId: string }) {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["budget-reallocations", clientId] });

  const confirm = useMutation({
    mutationFn: () => confirmBudgetReallocation(item.id),
    onSuccess: invalidate,
    onError: invalidate,
  });
  const dismiss = useMutation({
    mutationFn: () => dismissBudgetReallocation(item.id),
    onSuccess: invalidate,
  });

  const isPending = item.status === "pending";

  return (
    <Card className="px-4 py-3">
      <CardContent className="flex flex-col gap-2 px-0">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-medium">
              {item.from_campaign_name ?? item.from_campaign_id} → {item.to_campaign_name ?? item.to_campaign_id}
            </p>
            <p className="text-xs text-muted-foreground">{item.platform}</p>
          </div>
          <Badge variant="outline" className="shrink-0 text-[10px]">
            {new Date(item.created_at).toLocaleDateString()}
          </Badge>
        </div>

        <p className="text-sm text-foreground/90">{item.reasoning}</p>
        <p className="text-xs text-muted-foreground">
          Suggested shift: <span className="font-medium text-foreground">{formatCurrency(item.suggested_shift_amount)}/day</span>
        </p>

        {item.error && (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{item.error}</p>
        )}
        {confirm.isError && (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {(confirm.error as Error).message}
          </p>
        )}

        {isPending && (
          <div className="flex gap-2">
            <Button size="sm" onClick={() => confirm.mutate()} disabled={confirm.isPending || dismiss.isPending}>
              {confirm.isPending ? "Shifting budget…" : "Confirm shift"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => dismiss.mutate()}
              disabled={confirm.isPending || dismiss.isPending}
            >
              Dismiss
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function BudgetReallocationClient({ clientId }: { clientId: string }) {
  const [status, setStatus] = useState<BudgetReallocationStatus>("pending");

  const { data: items, isLoading } = useQuery({
    queryKey: ["budget-reallocations", clientId, status],
    queryFn: () => getBudgetReallocations(clientId, status),
  });

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <ClientKicker clientId={clientId} />
          <h1 className="text-lg font-semibold">Budget Reallocation</h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Campaign pairs with a real ROAS gap (winner at least 1.5x the loser's ROAS over the last 7 days).
            Nothing shifts automatically. Confirm to actually move budget, or dismiss to leave both unchanged.
          </p>
        </div>
        <SegmentedToggle value={status} onChange={(v) => setStatus(v as BudgetReallocationStatus)} options={STATUS_OPTIONS} />
      </div>

      {isLoading && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      )}

      {!isLoading && items?.length === 0 && (
        <Card className="px-4 py-8">
          <CardContent className="px-0 text-center text-sm text-muted-foreground">
            No {status} suggestions yet.
          </CardContent>
        </Card>
      )}

      {items && items.length > 0 && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {items.map((item) => (
            <SuggestionCard key={item.id} item={item} clientId={clientId} />
          ))}
        </div>
      )}
    </div>
  );
}
