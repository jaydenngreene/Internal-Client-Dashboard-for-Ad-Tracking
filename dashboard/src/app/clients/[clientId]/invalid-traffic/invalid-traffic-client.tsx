"use client";

import { useQuery } from "@tanstack/react-query";
import { getInvalidTraffic } from "@/lib/api";
import { useDateRangeState } from "@/lib/date-range";
import { formatNumber, formatPercent } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// Step 56 — advisory only, same "flag, don't silently act" pattern as Pause
// Candidates/Creative Fatigue. Nothing here excludes anything from other
// reports automatically. Renders just this recommendation type's own content,
// mounted as one tab inside the Recommendations hub — see
// pause-candidates-client.tsx's header comment for the full reasoning.
export function InvalidTrafficClient({ clientId }: { clientId: string }) {
  const { range } = useDateRangeState("30d");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["invalid-traffic", clientId, range.from, range.to],
    queryFn: () => getInvalidTraffic(clientId, range),
  });

  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-2xl text-sm text-muted-foreground">
        Sessions flagged by user-agent (known bots/crawlers/headless browsers) or click-velocity signatures
        (many sessions from one IP in a short window). Advisory only, nothing is excluded from other reports
        automatically. Ad spend/click numbers come from each platform&apos;s own reporting, not this pixel, so this
        mainly protects funnel/engagement metrics from bot noise, not ad spend efficiency.
      </p>

      {isError && <p className="text-sm text-status-critical">Failed to load report. Is the API running?</p>}
      {isLoading && <Skeleton className="h-48 w-full" />}

      {data && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Card className="px-4">
              <CardContent className="px-0">
                <p className="text-xs font-medium text-muted-foreground">Total Sessions</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{formatNumber(data.totalSessions)}</p>
              </CardContent>
            </Card>
            <Card className="px-4">
              <CardContent className="px-0">
                <p className="text-xs font-medium text-muted-foreground">Suspected Bot Sessions</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums text-status-warning">
                  {formatNumber(data.suspectedBotSessions)}
                </p>
              </CardContent>
            </Card>
            <Card className="px-4">
              <CardContent className="px-0">
                <p className="text-xs font-medium text-muted-foreground">Suspected Bot Rate</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">
                  {data.suspectedBotRate === null ? "-" : formatPercent(data.suspectedBotRate)}
                </p>
              </CardContent>
            </Card>
          </div>

          <Card className="px-4">
            <CardHeader className="px-0">
              <CardTitle>Top Flag Reasons</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-1.5 px-0">
              {data.topReasons.length === 0 && (
                <p className="text-sm text-muted-foreground">No suspected bot sessions in this range.</p>
              )}
              {data.topReasons.map((r, i) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <span className="truncate text-foreground/90">{r.reason}</span>
                  <span className="tabular-nums text-muted-foreground">{formatNumber(r.count)}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
