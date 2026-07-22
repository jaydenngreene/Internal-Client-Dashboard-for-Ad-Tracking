"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getOverview, getBudgetPacing } from "@/lib/api";
import { RangePreset, resolveRange } from "@/lib/date-range";
import { formatCurrency, formatNumber, formatPercent, formatRoas } from "@/lib/format";
import { DateRangeSelect } from "@/components/date-range-select";
import { KpiTile } from "@/components/kpi-tile";
import { TrendChart } from "@/components/trend-chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ClientKicker } from "@/components/client-kicker";
import { cn } from "@/lib/utils";

// Step 43 — always the current calendar month, independent of the Overview page's
// own date-range preset — pacing only ever means "this month so far."
function BudgetPacingCard({ clientId }: { clientId: string }) {
  const { data } = useQuery({
    queryKey: ["budget-pacing", clientId],
    queryFn: () => getBudgetPacing(clientId),
  });

  if (!data || data.target === null) return null;

  const statusLabel = { over: "Over pace", under: "Under pace", on_track: "On pace" }[data.paceStatus ?? "on_track"];
  const statusVariant = data.paceStatus === "over" ? "destructive" : "secondary";

  return (
    <Card className="px-4">
      <CardHeader className="px-0">
        <CardTitle className="flex items-center gap-2 text-sm">
          Budget Pacing ({data.month})
          <Badge variant={statusVariant} className="text-[10px]">
            {statusLabel}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap items-baseline gap-6 px-0">
        <div>
          <p className="text-xs font-medium text-muted-foreground">Spend to date</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">{formatCurrency(data.spendToDate)}</p>
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground">Expected by now</p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-muted-foreground">
            {data.expectedSpendToDate === null ? "-" : formatCurrency(data.expectedSpendToDate)}
          </p>
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground">Monthly target</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">{formatCurrency(data.target)}</p>
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground">Projected month-end</p>
          <p
            className={cn(
              "mt-1 text-xl font-semibold tabular-nums",
              data.paceStatus === "over" ? "text-status-critical" : "text-foreground"
            )}
          >
            {formatCurrency(data.projectedMonthEndSpend)}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

export function OverviewClient({ clientId }: { clientId: string }) {
  const [preset, setPreset] = useState<RangePreset>("30d");
  const range = resolveRange(preset);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["overview", clientId, range.from, range.to],
    queryFn: () => getOverview(clientId, range),
  });

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <ClientKicker clientId={clientId} />
          <h1 className="text-lg font-semibold">Overview</h1>
        </div>
        <DateRangeSelect value={preset} onChange={setPreset} />
      </div>

      {isError && (
        <p className="text-sm text-status-critical">Failed to load report. Is the API running?</p>
      )}

      {isLoading && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      )}

      {data && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <KpiTile
              label="Cost"
              value={formatCurrency(data.cost)}
              fromDate={data.from}
              color="var(--color-chart-2)"
              sparkline={data.series.map((p) => p.cost)}
            />
            <KpiTile
              label="Total Revenue"
              value={formatCurrency(data.revenue)}
              fromDate={data.from}
              color="var(--color-chart-1)"
              sparkline={data.series.map((p) => p.revenue)}
            />
            <KpiTile
              label="Profit"
              value={formatCurrency(data.trueProfit)}
              fromDate={data.from}
              color="var(--color-chart-3)"
              sparkline={data.series.map((p) => p.trueProfit)}
              sublabel={data.hasMarginConfig ? "COGS-adjusted" : "ad cost only, no margin set"}
            />
            <KpiTile
              label="ROAS"
              value={formatRoas(data.roas)}
              fromDate={data.from}
              color="var(--color-chart-4)"
              sparkline={data.series.map((p) => (p.cost > 0 ? p.revenue / p.cost : 0))}
            />
            <KpiTile
              label="ROI"
              value={formatPercent(data.hasMarginConfig ? data.trueRoi : data.roi)}
              fromDate={data.from}
              color="var(--color-chart-5)"
              sparkline={data.series.map((p) => (p.cost > 0 ? (p.trueProfit / p.cost) * 100 : 0))}
              sublabel={data.hasMarginConfig ? "COGS-adjusted" : undefined}
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Card className="px-4">
              <CardContent className="flex items-baseline gap-6 px-0">
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Leads</p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums">{formatNumber(data.leads)}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Sales</p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums">{formatNumber(data.sales)}</p>
                </div>
              </CardContent>
            </Card>
          </div>

          <BudgetPacingCard clientId={clientId} />

          <Card className="px-4">
            <CardHeader className="px-0">
              <CardTitle>Cost vs Revenue vs Profit</CardTitle>
            </CardHeader>
            <CardContent className="px-0">
              <TrendChart series={data.series} />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
