"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getOverview } from "@/lib/api";
import { RangePreset, resolveRange } from "@/lib/date-range";
import { formatCurrency, formatNumber, formatPercent, formatRoas } from "@/lib/format";
import { DateRangeSelect } from "@/components/date-range-select";
import { KpiTile } from "@/components/kpi-tile";
import { TrendChart } from "@/components/trend-chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

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
        <h1 className="text-lg font-semibold">Overview</h1>
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
              value={formatCurrency(data.profit)}
              fromDate={data.from}
              color="var(--color-chart-3)"
              sparkline={data.series.map((p) => p.profit)}
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
              value={formatPercent(data.roi)}
              fromDate={data.from}
              color="var(--color-chart-5)"
              sparkline={data.series.map((p) => (p.cost > 0 ? (p.profit / p.cost) * 100 : 0))}
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
