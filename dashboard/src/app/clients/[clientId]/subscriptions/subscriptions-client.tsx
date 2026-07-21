"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getSubscriptions } from "@/lib/api";
import { RangePreset, resolveRange } from "@/lib/date-range";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/format";
import { DateRangeSelect } from "@/components/date-range-select";
import { KpiTile } from "@/components/kpi-tile";
import { MrrTrendChart } from "@/components/mrr-trend-chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function SubscriptionsClient({ clientId }: { clientId: string }) {
  const [preset, setPreset] = useState<RangePreset>("30d");
  const range = resolveRange(preset);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["subscriptions", clientId, range.from, range.to],
    queryFn: () => getSubscriptions(clientId, range),
  });

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Subscriptions</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            MRR, trial conversion, and churn. Current MRR is a live snapshot, the rest is scoped to the selected range
          </p>
        </div>
        <DateRangeSelect value={preset} onChange={setPreset} />
      </div>

      {isError && <p className="text-sm text-status-critical">Failed to load report. Is the API running?</p>}

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
              label="Current MRR"
              value={formatCurrency(data.currentMrr)}
              fromDate={data.from}
              color="var(--color-chart-1)"
              sparkline={data.series.map((p) => p.mrr)}
            />
            <KpiTile
              label="New MRR"
              value={formatCurrency(data.newMrr)}
              fromDate={data.from}
              color="var(--color-chart-3)"
              sparkline={data.series.map((p) => p.mrr)}
            />
            <KpiTile
              label="Churned MRR"
              value={formatCurrency(data.churnedMrr)}
              fromDate={data.from}
              color="var(--color-chart-2)"
              sparkline={data.series.map((p) => p.mrr)}
            />
            <KpiTile
              label="Trial Conversion"
              value={formatPercent(data.trialConversionRate)}
              fromDate={data.from}
              color="var(--color-chart-4)"
              sparkline={data.series.map((p) => p.mrr)}
            />
            <KpiTile
              label="Churn Rate"
              value={formatPercent(data.churnRate)}
              fromDate={data.from}
              color="var(--color-chart-5)"
              sparkline={data.series.map((p) => p.mrr)}
            />
          </div>

          <Card className="px-4">
            <CardContent className="flex items-baseline gap-6 px-0">
              <div>
                <p className="text-xs font-medium text-muted-foreground">Active Subscribers</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{formatNumber(data.activeCount)}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">Trials Started</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{formatNumber(data.trialsStarted)}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">Canceled</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{formatNumber(data.canceledCount)}</p>
              </div>
            </CardContent>
          </Card>

          <Card className="px-4">
            <CardHeader className="px-0">
              <CardTitle>MRR Trend</CardTitle>
            </CardHeader>
            <CardContent className="px-0">
              <MrrTrendChart series={data.series} />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
