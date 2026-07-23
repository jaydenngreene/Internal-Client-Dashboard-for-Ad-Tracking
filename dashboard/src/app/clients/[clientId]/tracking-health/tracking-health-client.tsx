"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getTrackingHealthSignals,
  dismissTrackingHealthSignal,
  TrackingHealthSignal,
  FatigueStatus,
} from "@/lib/api";
import { SegmentedToggle } from "@/components/segmented-toggle";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ClientKicker } from "@/components/client-kicker";
import { cn } from "@/lib/utils";

const STATUS_OPTIONS: { value: FatigueStatus; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "dismissed", label: "Dismissed" },
];

const SIGNAL_LABEL: Record<TrackingHealthSignal["signal_type"], string> = {
  pixel_silent: "No traffic recorded",
  traffic_drop: "Traffic dropped",
  platform_orphaned_spend: "Spend with no matching tracking",
};

function SignalCard({ signal, clientId }: { signal: TrackingHealthSignal; clientId: string }) {
  const queryClient = useQueryClient();
  const dismiss = useMutation({
    mutationFn: () => dismissTrackingHealthSignal(signal.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tracking-health", clientId] }),
  });

  return (
    <Card className="px-4 py-3">
      <CardContent className="flex flex-col gap-2 px-0">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-medium">{SIGNAL_LABEL[signal.signal_type]}</p>
            {signal.platform && <p className="text-xs text-muted-foreground">{signal.platform}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Badge
              variant="outline"
              className={cn(
                "text-[10px]",
                signal.severity === "critical" && "border-status-critical/40 text-status-critical"
              )}
            >
              {signal.severity}
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              {new Date(signal.created_at).toLocaleDateString()}
            </Badge>
          </div>
        </div>

        <p className="text-sm text-foreground/90">{signal.message}</p>

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

export function TrackingHealthClient({ clientId }: { clientId: string }) {
  const [status, setStatus] = useState<FatigueStatus>("active");

  const { data: signals, isLoading } = useQuery({
    queryKey: ["tracking-health", clientId, status],
    queryFn: () => getTrackingHealthSignals(clientId, status),
  });

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <ClientKicker clientId={clientId} />
          <h1 className="text-lg font-semibold">Tracking Health</h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Watches whether tracking itself is intact, not performance — a silent pixel, a traffic collapse, or a
            platform with real ad spend but no matching sessions. Advisory only; nothing here changes automatically.
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
