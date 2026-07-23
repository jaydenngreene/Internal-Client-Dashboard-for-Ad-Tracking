"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getCreativeFatigueSignals, dismissCreativeFatigueSignal, CreativeFatigueSignal, FatigueStatus } from "@/lib/api";
import { formatPercent } from "@/lib/format";
import { SegmentedToggle } from "@/components/segmented-toggle";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ClientKicker } from "@/components/client-kicker";

const STATUS_OPTIONS: { value: FatigueStatus; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "dismissed", label: "Dismissed" },
];

function SignalCard({ signal, clientId }: { signal: CreativeFatigueSignal; clientId: string }) {
  const queryClient = useQueryClient();
  const dismiss = useMutation({
    mutationFn: () => dismissCreativeFatigueSignal(signal.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["creative-fatigue", clientId] }),
  });

  return (
    <Card className="px-4 py-3">
      <CardContent className="flex flex-col gap-2 px-0">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-medium">{signal.ad_name ?? signal.ad_id}</p>
            <p className="text-xs text-muted-foreground">
              {signal.campaign_name ?? "No campaign"} &middot; {signal.platform}
            </p>
          </div>
          <Badge variant="outline" className="text-[10px]">
            {new Date(signal.created_at).toLocaleDateString()}
          </Badge>
        </div>

        <p className="text-sm text-foreground/90">
          CTR down {formatPercent(signal.decline_pct)} — {formatPercent(signal.recent_ctr)} over the last 3 days vs.{" "}
          {formatPercent(signal.prior_ctr)} the 7 days before that. Consider refreshing this creative.
        </p>

        {signal.status === "active" && (
          <div>
            <Button size="sm" variant="outline" onClick={() => dismiss.mutate()} disabled={dismiss.isPending}>
              Dismiss
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function CreativeFatigueClient({ clientId }: { clientId: string }) {
  const [status, setStatus] = useState<FatigueStatus>("active");

  const { data: signals, isLoading } = useQuery({
    queryKey: ["creative-fatigue", clientId, status],
    queryFn: () => getCreativeFatigueSignals(clientId, status),
  });

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <ClientKicker clientId={clientId} />
          <h1 className="text-lg font-semibold">Creative Fatigue</h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Creatives whose CTR has declined 30%+ over the last 3 days vs. the 7 days before that — a trend signal,
            distinct from Pause Candidates' ROAS-threshold alerts. Advisory only, nothing is paused.
          </p>
        </div>
        <SegmentedToggle value={status} onChange={(v) => setStatus(v as FatigueStatus)} options={STATUS_OPTIONS} />
      </div>

      {isLoading && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      )}

      {!isLoading && signals?.length === 0 && (
        <Card className="px-4 py-8">
          <CardContent className="px-0 text-center text-sm text-muted-foreground">No {status} signals.</CardContent>
        </Card>
      )}

      {signals && signals.length > 0 && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {signals.map((s) => (
            <SignalCard key={s.id} signal={s} clientId={clientId} />
          ))}
        </div>
      )}
    </div>
  );
}
