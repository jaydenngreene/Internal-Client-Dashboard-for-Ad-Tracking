import { formatNumber, formatPercent } from "@/lib/format";

export interface FunnelStage {
  label: string;
  value: number;
}

// A stage-by-stage funnel visualization built from counts a report already
// returns (no day-by-day series exists for TOF/MOF/BOF, so a trend chart isn't
// possible here) — each bar's width is scaled against the first stage, with
// the raw count and % of top labeled. Plain divs rather than a recharts bar
// chart: this shape (descending horizontal bars, one per named stage) doesn't
// need a cartesian/axis chart, and recharts has no native funnel primitive.
export function FunnelBars({ stages }: { stages: FunnelStage[] }) {
  const top = stages[0]?.value ?? 0;

  return (
    <div className="flex flex-col gap-3">
      {stages.map((stage) => {
        const pct = top > 0 ? (stage.value / top) * 100 : 0;
        return (
          <div key={stage.label} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between text-xs">
              <span className="font-medium text-foreground">{stage.label}</span>
              <span className="text-muted-foreground">
                {formatNumber(stage.value)}
                {stage.value !== top && ` · ${formatPercent(pct)} of ${formatNumber(top)}`}
              </span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-[width]"
                style={{ width: `${Math.max(pct, top > 0 ? 2 : 0)}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
