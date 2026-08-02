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

// Review fix (2026-07-28, item 3/8): only roas/cpa/ctr can raise a fatigue
// flag on their own (matches creativeFatigue/run.ts's PRIMARY_TRIGGER_METRICS)
// — cpm and frequency are corroborating signals only (CPM is driven by
// auction competition/seasonality, not creative wear; rising frequency is the
// expected behavior of any ad left running, a fatigue precursor rather than
// fatigue itself). The UI distinguishes them so a signal never reads as
// "flagged because CPM rose" when CPM alone can't flag anything.
const PRIMARY_METRICS = new Set(["roas", "cpa", "ctr"]);

function formatMetricValue(metric: string, value: number | null): string {
  if (value === null) return "—";
  if (metric === "roas") return `${value.toFixed(2)}x`;
  if (metric === "ctr") return `${value.toFixed(2)}%`;
  if (metric === "cpa" || metric === "cpm") return `$${value.toFixed(2)}`;
  return value.toFixed(2);
}

// Review fix (2026-07-28, item 8): recent_ctr/prior_ctr/decline_pct are always
// populated with real CTR numbers regardless of which metric actually
// triggered — writing them into the headline unconditionally used to make an
// ad flagged solely on CPM or CPA display a CTR-derived percentage as if CTR
// were the reason, which is a false claim about why it was flagged. The
// headline is now built from whichever metric(s) actually triggered.
function headlineText(signal: CreativeFatigueSignal): string {
  const triggeredPrimary = signal.metrics_triggered
    ? Object.entries(signal.metrics_triggered).filter(([metric, m]) => PRIMARY_METRICS.has(metric) && m.triggered)
    : [];
  if (triggeredPrimary.length === 0) {
    // Old rows from before this column existed, or an edge case with no
    // metrics_triggered payload — fall back to the legacy recent_ctr/prior_ctr/
    // decline_pct fields, but formatted using primary_metric (added in the
    // same review fix) rather than assuming they're CTR. Rows from before
    // BOTH fixes landed have no primary_metric either — those genuinely were
    // always CTR, so the "ctr" default is correct for them specifically.
    const metric = signal.primary_metric ?? "ctr";
    const label = METRIC_LABEL[metric] ?? "CTR";
    const direction = metric === "cpa" ? "up" : "down";
    return `${label} ${direction} ${formatPercent(signal.decline_pct)}: ${formatMetricValue(metric, signal.recent_ctr)} over the last 3 days vs. ${formatMetricValue(metric, signal.prior_ctr)} the 7 days before that.`;
  }
  const parts = triggeredPrimary.map(([metric, m]) => {
    const direction = metric === "cpa" ? "up" : "down";
    return `${METRIC_LABEL[metric]} ${direction} (${formatMetricValue(metric, m.recentShort)} vs. ${formatMetricValue(metric, m.priorShort)})`;
  });
  return `${parts.join(", ")} over the last 3 days vs. the 7 days before that.`;
}

// Only the metrics that actually triggered the sustained day-and-week trend
// are called out here — the rest were checked but didn't cross their
// threshold. Corroborating (non-primary) metrics are labeled as such so it's
// clear they strengthened the picture without being the reason it flagged.
function TriggeredMetrics({ signal }: { signal: CreativeFatigueSignal }) {
  if (!signal.metrics_triggered) return null;
  const triggered = Object.entries(signal.metrics_triggered).filter(([, m]) => m.triggered);
  if (triggered.length === 0) return null;

  return (
    <div className="flex flex-col gap-1">
      {triggered.map(([metric, m]) => (
        <p key={metric} className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground/90">{METRIC_LABEL[metric] ?? metric}</span>
          {!PRIMARY_METRICS.has(metric) && <span className="italic"> (corroborating)</span>}: {formatMetricValue(metric, m.recentShort)}{" "}
          over the last few days vs. {formatMetricValue(metric, m.priorShort)} before that (also crossed over the last week:{" "}
          {formatMetricValue(metric, m.recentLong)} vs. {formatMetricValue(metric, m.priorLong)}).
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
          {headlineText(signal)} Consider refreshing this creative.
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

// Renders just this recommendation type's own controls + content, mounted as
// one tab inside the Recommendations hub — see pause-candidates-client.tsx's
// header comment for the full reasoning.
export function CreativeFatigueClient({ clientId }: { clientId: string }) {
  const [status, setStatus] = useState<FatigueStatus>("active");

  const { data: signals, isLoading } = useQuery({
    queryKey: ["creative-fatigue", clientId, status],
    queryFn: () => getCreativeFatigueSignals(clientId, status),
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-xl text-sm text-muted-foreground">
          Creatives with a sustained decline in ROAS, CTR, CPA, CPM, or frequency — confirmed over both the last
          few days and the last couple weeks, not a one-day dip. Only shown once a creative has spent or run long
          enough to earn a verdict. A trend signal, distinct from Pause Candidates&apos; ROAS-threshold alerts.
          Advisory only, nothing is paused.
        </p>
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
