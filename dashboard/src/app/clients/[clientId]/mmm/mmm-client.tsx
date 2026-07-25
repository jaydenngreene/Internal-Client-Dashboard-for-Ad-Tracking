"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { getMmm, getMmmScenario, MmmScenarioResult } from "@/lib/api";
import { formatCurrency, formatPercent, formatPlatformLabel } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FieldLabel } from "@/components/ui/field-label";
import { Skeleton } from "@/components/ui/skeleton";
import { ClientKicker } from "@/components/client-kicker";
import { MmmEfficiencyChart } from "@/components/mmm-efficiency-chart";
import { cn } from "@/lib/utils";

// Step 52 — Media Mix Modeling via a straightforward multiple linear regression,
// deliberately NOT Northbeam-style Bayesian MMM+ with adstock/saturation curves.
// Every user-facing label on this page is written for a marketing agency owner,
// not a statistician — rSquared/sampleSizeDays are shown as a plain-English
// "confidence score" (front and center, not buried) instead of the term R²,
// which testing this page live confirmed means nothing to that audience.
function BudgetScenarioSimulator({ clientId, platforms }: { clientId: string; platforms: string[] }) {
  const [deltas, setDeltas] = useState<Record<string, string>>({});
  const [result, setResult] = useState<MmmScenarioResult | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      getMmmScenario(
        clientId,
        platforms
          .map((platform) => ({ platform, spendDelta: parseFloat(deltas[platform] || "0") || 0 }))
          .filter((a) => a.spendDelta !== 0)
      ),
    onSuccess: setResult,
  });

  return (
    <Card className="px-4">
      <CardHeader className="px-0">
        <CardTitle className="text-sm">Budget Scenario Simulator</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 px-0">
        <p className="text-xs text-muted-foreground">
          See what might happen if you moved daily budget between platforms. This accounts for diminishing returns:
          putting more money into a platform that's already getting a lot of spend usually pays off less than putting
          that same money into one with more room to grow.
        </p>
        <div className="flex flex-wrap gap-3">
          {platforms.map((platform) => (
            <div key={platform} className="flex flex-col gap-1">
              <FieldLabel>{formatPlatformLabel(platform) ?? platform} ($/day change)</FieldLabel>
              <Input
                className="w-36"
                type="number"
                step="1"
                placeholder="e.g. -50 or 50"
                value={deltas[platform] ?? ""}
                onChange={(e) => setDeltas((d) => ({ ...d, [platform]: e.target.value }))}
              />
            </div>
          ))}
        </div>
        <div>
          <Button size="sm" disabled={mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending ? "Simulating…" : "Simulate"}
          </Button>
        </div>

        {result && !result.available && (
          <p className="text-xs text-status-critical">{result.reason}</p>
        )}

        {result && result.available && (
          <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/20 p-3">
            <div className="flex flex-wrap gap-6">
              <div>
                <p className="text-xs text-muted-foreground">Your current daily revenue (estimated)</p>
                <p className="text-lg font-semibold tabular-nums">
                  {formatCurrency(result.currentProjectedDailyRevenue ?? 0)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Daily revenue after this change (estimated)</p>
                <p className="text-lg font-semibold tabular-nums">
                  {formatCurrency(result.scenarioProjectedDailyRevenue ?? 0)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Estimated difference</p>
                <p
                  className={cn(
                    "text-lg font-semibold tabular-nums",
                    (result.projectedDailyRevenueDelta ?? 0) >= 0 ? "text-chart-1" : "text-chart-2"
                  )}
                >
                  {(result.projectedDailyRevenueDelta ?? 0) >= 0 ? "+" : ""}
                  {formatCurrency(result.projectedDailyRevenueDelta ?? 0)}/day
                </p>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function MmmClient({ clientId }: { clientId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["mmm", clientId],
    queryFn: () => getMmm(clientId),
  });

  const confidenceLevel = data?.rSquared !== undefined ? (data.rSquared > 0.7 ? "high" : data.rSquared > 0.4 ? "some" : "low") : null;
  const confidenceLabel = confidenceLevel === "high" ? "High confidence" : confidenceLevel === "some" ? "Some confidence" : "Low confidence";

  return (
    <div className="flex flex-col gap-4 p-6">
      <div>
        <ClientKicker clientId={clientId} />
        <h1 className="text-lg font-semibold">Media Mix Model</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Estimates how much revenue each ad platform is actually responsible for, based on your real spend and
          revenue history, separate from whichever attribution model drives the rest of this dashboard. This is a
          straightforward statistical estimate, not the more advanced modeling the biggest agency tools use, so
          check the confidence score below before acting on these numbers: with too little history, or too little
          change in your day-to-day spend, the estimate for a platform can be unreliable.
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
                How Much To Trust These Numbers
                <Badge variant={confidenceLevel === "high" ? "secondary" : "outline"} className="text-[10px]">
                  {confidenceLabel}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex gap-6 px-0">
              <div>
                <p className="text-xs text-muted-foreground">Confidence score</p>
                <p className="text-lg font-semibold tabular-nums">{formatPercent((data.rSquared ?? 0) * 100)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Based on this many days of data</p>
                <p className="text-lg font-semibold tabular-nums">{data.sampleSizeDays}</p>
              </div>
            </CardContent>
          </Card>

          {data.channels && data.channels.length > 0 && (
            <Card className="px-4">
              <CardHeader className="px-0">
                <CardTitle className="text-sm">Channel Efficiency Map</CardTitle>
              </CardHeader>
              <CardContent className="px-0">
                <MmmEfficiencyChart channels={data.channels} />
              </CardContent>
            </Card>
          )}

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {data.channels?.map((c) => (
              <Card key={c.platform} className="px-4 py-3">
                <CardContent className="flex flex-col gap-1 px-0">
                  <p className="text-sm font-medium">{formatPlatformLabel(c.platform) ?? c.platform}</p>
                  <p className="text-xs text-muted-foreground">Avg daily spend: {formatCurrency(c.avgDailySpend)}</p>
                  <p
                    className={cn(
                      "mt-1 text-2xl font-semibold tabular-nums",
                      c.coefficientPerDollar >= 0 ? "text-chart-1" : "text-chart-2"
                    )}
                  >
                    {formatCurrency(c.coefficientPerDollar)}{" "}
                    <span className="text-sm font-normal text-muted-foreground">per $1 spent</span>
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>

          <BudgetScenarioSimulator clientId={clientId} platforms={data.channels?.map((c) => c.platform) ?? []} />
        </>
      )}
    </div>
  );
}
