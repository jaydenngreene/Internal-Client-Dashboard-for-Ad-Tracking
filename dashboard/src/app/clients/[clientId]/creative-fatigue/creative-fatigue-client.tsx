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

const CONFIDENCE_VARIANT: Record<"low" | "medium" | "high", "outline" | "secondary"> = {
  high: "secondary",
  medium: "outline",
  low: "outline",
};

const METRIC_LABEL: Record<string, string> = {
  roas: "ROAS",
  ctr: "CTR",
  cpa: "CPA",
  cpm: "CPM",
  frequency: "Frequency",
};

// Phase 1 guardrails (2026-07-27) — every signal now carries the full
// roas/ctr/cpa/cpm/frequency breakdown (short-window and long-window, each
// flagged whether it actually triggered), not just the original CTR-only
// decline_pct. Only the metrics that actually triggered the sustained
// day-and-week trend are called out here — the rest were checked but didn't
// cross their threshold.
function TriggeredMetrics({ signal }: { signal: CreativeFatigueSignal }) {
  if (!signal.metrics_triggered) return null;
  const triggered = Object.entries(signal.metrics_triggered).filter(([, m]) => m.triggered);
  if (triggered.length === 0) return null;

  return (
    <div className="flex flex-col gap-1">
      {triggered.map(([metric, m]) => (
        <p key={metric} className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground/90">{METRIC_LABEL[metric] ?? metric}</span>: {m.recentShort?.toFixed(2)} over the
          last few days vs. {m.priorShort?.toFixed(2)} before that (also down over the last week: {m.recentLong?.toFixed(2)} vs.{" "}
          {m.priorLong?.toFixed(2)}).
        </p>
      ))}
    </div>
  );
}

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
          <div className="flex shrink-0 items-center gap-1.5">
            {signal.confidence && (
              <Badge variant={CONFIDENCE_VARIANT[signal.confidence]} className="text-[10px]">
                {signal.confidence} confidence
              </Badge>
            )}
            <Badge variant="outline" className="text-[10px]">
              {new Date(signal.created_at).toLocaleDateString()}
            </Badge>
          </div>
        </div>

        <p className="text-sm text-foreground/90">
          CTR down {formatPercent(signal.decline_pct)}: {formatPercent(signal.recent_ctr)} over the last 3 days vs.{" "}
          {formatPercent(signal.prior_ctr)} the 7 days before that. Consider refreshing this creative.
        </p>

        <TriggeredMetrics signal={signal} />

        {signal.days_live !== null && (
          <p className="text-[10px] text-muted-foreground">
            {signal.days_live} days live &middot; passed the data-sufficiency gate on{" "}
            {signal.gate_opened_by === "spend" ? "spend" : "days live"}
            {signal.spend !== null && signal.spend_threshold !== null && (
              <> (${signal.spend.toFixed(2)} spent vs. ${signal.spend_threshold.toFixed(2)} threshold)</>
            )}
          </p>
        )}

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
            Creatives with a sustained decline in ROAS, CTR, CPA, CPM, or frequency — confirmed over both the last
            few days and the last couple weeks, not a one-day dip. Only shown once a creative has spent or run long
            enough to earn a verdict. A trend signal, distinct from Pause Candidates&apos; ROAS-threshold alerts.
            Advisory only, nothing is paused.
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
