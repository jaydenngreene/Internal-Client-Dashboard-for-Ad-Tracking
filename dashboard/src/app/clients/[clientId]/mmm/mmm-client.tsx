"use client";

import { useQuery } from "@tanstack/react-query";
import { getMmm } from "@/lib/api";
import { formatCurrency, formatPercent, formatPlatformLabel } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ClientKicker } from "@/components/client-kicker";

// Step 52 — Media Mix Modeling via a straightforward multiple linear regression,
// deliberately NOT Northbeam-style Bayesian MMM+ with adstock/saturation curves.
// rSquared and sampleSizeDays are always shown front and center, not buried, so a
// low-confidence fit is visible rather than hidden behind a confident-looking number.
export function MmmClient({ clientId }: { clientId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["mmm", clientId],
    queryFn: () => getMmm(clientId),
  });

  const fitQuality = data?.rSquared !== undefined ? (data.rSquared > 0.7 ? "good" : data.rSquared > 0.4 ? "moderate" : "weak") : null;

  return (
    <div className="flex flex-col gap-4 p-6">
      <div>
        <ClientKicker clientId={clientId} />
        <h1 className="text-lg font-semibold">Media Mix Model</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          A multiple linear regression estimating each ad platform's marginal contribution to revenue, holding the
          others constant — a real, recognized starting point for MMM, but not the sophisticated Bayesian model
          with adstock/saturation curves that Northbeam's MMM+ uses. Trust the fit quality (R²) before the numbers:
          too little history or too little spend variance will produce an unreliable coefficient.
        </p>
      </div>

      {isLoading && <Skeleton className="h-64 w-full" />}

      {data && !data.available && (
        <Card className="px-4 py-8">
          <CardContent className="px-0 text-center text-sm text-muted-foreground">{data.reason}</CardContent>
        </Card>
      )}

      {data && data.available && (
        <>
          <Card className="px-4">
            <CardHeader className="px-0">
              <CardTitle className="flex items-center gap-2 text-sm">
                Fit Quality
                <Badge variant={fitQuality === "good" ? "secondary" : "outline"} className="text-[10px]">
                  {fitQuality} fit
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex gap-6 px-0">
              <div>
                <p className="text-xs text-muted-foreground">R² (variance explained)</p>
                <p className="text-lg font-semibold tabular-nums">{formatPercent((data.rSquared ?? 0) * 100)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Days of history used</p>
                <p className="text-lg font-semibold tabular-nums">{data.sampleSizeDays}</p>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {data.channels?.map((c) => (
              <Card key={c.platform} className="px-4 py-3">
                <CardContent className="flex flex-col gap-1 px-0">
                  <p className="text-sm font-medium">{formatPlatformLabel(c.platform) ?? c.platform}</p>
                  <p className="text-xs text-muted-foreground">Avg daily spend: {formatCurrency(c.avgDailySpend)}</p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums">
                    {formatCurrency(c.coefficientPerDollar)} <span className="text-sm font-normal text-muted-foreground">per $1 spent</span>
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
