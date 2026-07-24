"use client";

import { useQuery } from "@tanstack/react-query";
import { getMarkovAttribution } from "@/lib/api";
import { useDateRangeState } from "@/lib/date-range";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ClientKicker } from "@/components/client-kicker";

// Step 59 — data-driven ("algorithmic") attribution via a Markov chain
// removal-effect model: how much each channel's OWN conversion probability
// would drop if it were removed from every visitor's path entirely, across
// every visitor (converting and not), not just the touches on one sale.
// Deliberately a comparison view, not a switch — whichever rule-based model is
// set in Settings (first/last/linear/time-decay/u-shaped) is still what drives
// every other report's revenue numbers. All labels below are plain-English,
// not the underlying stats terms (no "Markov chain," "removal effect," or
// "conversion probability" shown to the user) — this is read by agency owners,
// not data scientists.
export function MarkovAttributionClient({ clientId }: { clientId: string }) {
  const { range } = useDateRangeState("30d");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["markov-attribution", clientId, range.from, range.to],
    queryFn: () => getMarkovAttribution(clientId, range),
  });

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <ClientKicker clientId={clientId} />
          <h1 className="text-lg font-semibold">Data-Driven Attribution</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            A more advanced way to see which channels actually deserve credit, based on real patterns across every
            visitor&apos;s path to purchase, not just the people who bought. For each channel, it estimates how much
            your results would suffer if that channel disappeared entirely, a more accurate way to spot channels
            that are quietly doing a lot of work. This is shown here for comparison only: the attribution model
            you&apos;ve picked in Settings is still what drives the revenue numbers everywhere else in this
            dashboard.
          </p>
        </div>
      </div>

      {isError && <p className="text-sm text-status-critical">Failed to load report. Is the API running?</p>}
      {isLoading && <Skeleton className="h-64 w-full" />}

      {data && !data.available && (
        <Card className="px-4 py-8">
          <CardContent className="px-0 text-center text-sm text-muted-foreground">{data.reason}</CardContent>
        </Card>
      )}

      {data && data.available && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Card className="px-4">
              <CardContent className="px-0">
                <p className="text-xs font-medium text-muted-foreground">Overall Conversion Rate</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">
                  {formatPercent((data.totalConversionProbability ?? 0) * 100)}
                </p>
              </CardContent>
            </Card>
            <Card className="px-4">
              <CardContent className="px-0">
                <p className="text-xs font-medium text-muted-foreground">Visitors Analyzed</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{formatNumber(data.visitorsAnalyzed ?? 0)}</p>
              </CardContent>
            </Card>
            <Card className="px-4">
              <CardContent className="px-0">
                <p className="text-xs font-medium text-muted-foreground">Total Revenue</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{formatCurrency(data.totalRevenue ?? 0)}</p>
              </CardContent>
            </Card>
          </div>

          <Card className="px-4">
            <CardHeader className="px-0">
              <CardTitle>Channel Impact</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 px-0">
              {data.channels?.map((c) => (
                <div key={c.channel} className="flex flex-col gap-1 border-b border-border pb-2 last:border-0 last:pb-0">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">{c.channel}</p>
                    <p className="text-sm font-semibold tabular-nums">{formatCurrency(c.attributedRevenue)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-chart-4" style={{ width: `${Math.round(c.creditShare * 100)}%` }} />
                    </div>
                    <p className="w-36 shrink-0 text-right text-xs text-muted-foreground">
                      {formatPercent(c.creditShare * 100)} credit, {formatNumber(c.touchpoints)} touchpoints
                    </p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
