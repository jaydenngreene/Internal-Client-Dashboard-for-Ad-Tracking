"use client";

import { useQuery } from "@tanstack/react-query";
import { Radar } from "lucide-react";
import { getPublicShareOverview } from "@/lib/api";
import { formatCurrency, formatDateShort, formatRoas, formatPercent, formatNumber } from "@/lib/format";
import { TrendChart } from "@/components/trend-chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// The client-facing white-label report (Step 40) — deliberately its own small,
// self-contained page: no sidebar, no login, no access to anything else in this
// app. Reached only via a per-client link generated in Settings.
export function ShareReportClient({ token }: { token: string }) {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["public-share", token],
    queryFn: () => getPublicShareOverview(token),
    retry: false,
  });

  return (
    <div className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 p-6">
      <div className="flex items-center gap-2 pt-4">
        {data?.brandLogoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- agency-hosted URL, not a local asset Next can optimize
          <img src={data.brandLogoUrl} alt={data.clientName} className="h-6 max-w-40 object-contain" />
        ) : (
          <>
            <Radar className="size-5 text-chart-4" />
            <span className="text-sm font-medium text-muted-foreground">Ad Tracking</span>
          </>
        )}
      </div>

      {isLoading && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      )}

      {isError && (
        <Card className="px-4 py-8">
          <CardContent className="px-0 text-center text-sm text-muted-foreground">
            {(error as Error).message === "Invalid or revoked link"
              ? "This link is invalid or has been revoked. Ask your agency for a current one."
              : "Couldn't load this report right now."}
          </CardContent>
        </Card>
      )}

      {data && (
        <>
          <div style={data.brandAccentColor ? { borderLeft: `3px solid ${data.brandAccentColor}`, paddingLeft: "0.75rem" } : undefined}>
            <h1 className="text-xl font-semibold" style={data.brandAccentColor ? { color: data.brandAccentColor } : undefined}>
              {data.clientName}
            </h1>
            <p className="text-sm text-muted-foreground">
              {formatDateShort(data.from)} - {formatDateShort(data.to)}
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Card className="px-4">
              <CardContent className="px-0">
                <p className="text-xs font-medium text-muted-foreground">Revenue</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{formatCurrency(data.revenue)}</p>
              </CardContent>
            </Card>
            <Card className="px-4">
              <CardContent className="px-0">
                <p className="text-xs font-medium text-muted-foreground">Profit</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{formatCurrency(data.profit)}</p>
              </CardContent>
            </Card>
            <Card className="px-4">
              <CardContent className="px-0">
                <p className="text-xs font-medium text-muted-foreground">Cost</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{formatCurrency(data.cost)}</p>
              </CardContent>
            </Card>
            <Card className="px-4">
              <CardContent className="px-0">
                <p className="text-xs font-medium text-muted-foreground">ROAS</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{formatRoas(data.roas)}</p>
              </CardContent>
            </Card>
            <Card className="px-4">
              <CardContent className="px-0">
                <p className="text-xs font-medium text-muted-foreground">ROI</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{formatPercent(data.roi)}</p>
              </CardContent>
            </Card>
            <Card className="px-4">
              <CardContent className="px-0">
                <p className="text-xs font-medium text-muted-foreground">Sales</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{formatNumber(data.sales)}</p>
              </CardContent>
            </Card>
          </div>

          <Card className="px-4">
            <CardHeader className="px-0">
              <CardTitle>Cost vs Revenue</CardTitle>
            </CardHeader>
            <CardContent className="px-0">
              <TrendChart
                series={data.series.map((p) => ({ ...p, profit: p.revenue - p.cost, trueProfit: p.revenue - p.cost }))}
              />
            </CardContent>
          </Card>

          <p className="pb-6 text-center text-xs text-muted-foreground">Powered by Ad Tracking</p>
        </>
      )}
    </div>
  );
}
