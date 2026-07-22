"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getIncrementalityTests,
  createIncrementalityTest,
  deleteIncrementalityTest,
  IncrementalityTestWithResult,
} from "@/lib/api";
import { formatCurrency, formatPercent } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FieldLabel } from "@/components/ui/field-label";
import { Skeleton } from "@/components/ui/skeleton";
import { ClientKicker } from "@/components/client-kicker";

const STATUS_LABEL = { pending: "Not started", running: "Paused, in progress", completed: "Completed" };
const STATUS_VARIANT: Record<string, "outline" | "secondary" | "default"> = {
  pending: "outline",
  running: "secondary",
  completed: "default",
};

function TestCard({ item, clientId }: { item: IncrementalityTestWithResult; clientId: string }) {
  const { test, result } = item;
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: () => deleteIncrementalityTest(test.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["incrementality-tests", clientId] }),
  });

  return (
    <Card className="px-4 py-3">
      <CardContent className="flex flex-col gap-2 px-0">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-medium">{test.campaign_name}</p>
            <p className="text-xs text-muted-foreground">
              {test.platform} &middot; paused {test.pause_start} to {test.pause_end}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={STATUS_VARIANT[result.status]} className="text-[10px]">
              {STATUS_LABEL[result.status]}
            </Badge>
            <Button size="xs" variant="outline" onClick={() => remove.mutate()} disabled={remove.isPending}>
              Delete
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 border-t border-border pt-2 sm:grid-cols-4">
          <div>
            <p className="text-xs text-muted-foreground">Pre-period daily total revenue</p>
            <p className="text-sm font-medium tabular-nums">{formatCurrency(result.preperiodDailyTotalRevenue)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">This campaign's usual daily revenue</p>
            <p className="text-sm font-medium tabular-nums">
              {formatCurrency(result.preperiodDailyCampaignAttributedRevenue)}
            </p>
          </div>
          {result.status === "completed" ? (
            <>
              <div>
                <p className="text-xs text-muted-foreground">Projected vs. actual total revenue</p>
                <p className="text-sm font-medium tabular-nums">
                  {formatCurrency(result.projectedBaselineTotalRevenue ?? 0)} vs.{" "}
                  {formatCurrency(result.actualTotalRevenueDuringPause ?? 0)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Estimated true incrementality</p>
                <p className="text-sm font-medium tabular-nums">
                  {formatCurrency(result.incrementalRevenueEstimate ?? 0)}
                  {result.incrementalityRatio !== null && ` (${formatPercent(result.incrementalityRatio * 100)} of attributed)`}
                </p>
              </div>
            </>
          ) : (
            <div className="col-span-2">
              <p className="text-xs text-muted-foreground">
                {result.status === "pending" ? "Results appear once the pause window ends." : "Pause window in progress — results appear once it ends."}
              </p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function NewTestForm({ clientId }: { clientId: string }) {
  const queryClient = useQueryClient();
  const [platform, setPlatform] = useState("");
  const [campaignName, setCampaignName] = useState("");
  const [pauseStart, setPauseStart] = useState("");
  const [pauseEnd, setPauseEnd] = useState("");
  const [prePeriodDays, setPrePeriodDays] = useState("30");

  const mutation = useMutation({
    mutationFn: () =>
      createIncrementalityTest(clientId, {
        platform,
        campaignName,
        pauseStart,
        pauseEnd,
        prePeriodDays: parseInt(prePeriodDays, 10) || 30,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["incrementality-tests", clientId] });
      setPlatform("");
      setCampaignName("");
      setPauseStart("");
      setPauseEnd("");
    },
  });

  const canSubmit = platform.trim() && campaignName.trim() && pauseStart && pauseEnd;

  return (
    <Card className="px-4">
      <CardHeader className="px-0">
        <CardTitle>New Test</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-0">
        <p className="text-xs text-muted-foreground">
          Pause this exact campaign in its ad platform for the window below (this app doesn't pause it for you), then
          come back once the window ends to see the estimated incremental revenue.
        </p>
        <div className="flex flex-wrap gap-2">
          <div className="flex flex-col gap-1">
            <FieldLabel>Platform</FieldLabel>
            <Input className="w-36" placeholder="facebook_ads" value={platform} onChange={(e) => setPlatform(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <FieldLabel>Campaign name</FieldLabel>
            <Input className="w-48" placeholder="Must match exactly" value={campaignName} onChange={(e) => setCampaignName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <FieldLabel>Pause start</FieldLabel>
            <Input className="w-40" type="date" value={pauseStart} onChange={(e) => setPauseStart(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <FieldLabel>Pause end</FieldLabel>
            <Input className="w-40" type="date" value={pauseEnd} onChange={(e) => setPauseEnd(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <FieldLabel>Pre-period (days)</FieldLabel>
            <Input className="w-24" type="number" min={7} value={prePeriodDays} onChange={(e) => setPrePeriodDays(e.target.value)} />
          </div>
        </div>
        <div>
          <Button size="sm" disabled={!canSubmit || mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending ? "Creating…" : "Create test"}
          </Button>
        </div>
        {mutation.isError && <p className="text-xs text-status-critical">{(mutation.error as Error).message}</p>}
      </CardContent>
    </Card>
  );
}

export function IncrementalityClient({ clientId }: { clientId: string }) {
  const { data: tests, isLoading } = useQuery({
    queryKey: ["incrementality-tests", clientId],
    queryFn: () => getIncrementalityTests(clientId),
  });

  return (
    <div className="flex flex-col gap-4 p-6">
      <div>
        <ClientKicker clientId={clientId} />
        <h1 className="text-lg font-semibold">Incrementality Testing</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          A time-based pause test, not a geo-holdout (this account tracks no geographic data). Pausing a campaign's
          OWN attributed revenue trivially goes to zero and tells you nothing — what matters is whether TOTAL
          account revenue drops while it's paused. If it does, that drop is the campaign's real incremental
          contribution. If total revenue barely moves, this campaign's attributed revenue was likely converting
          demand that would have happened through another channel anyway.
        </p>
      </div>

      <NewTestForm clientId={clientId} />

      {isLoading && <Skeleton className="h-32 w-full" />}

      {!isLoading && tests?.length === 0 && (
        <Card className="px-4 py-8">
          <CardContent className="px-0 text-center text-sm text-muted-foreground">No tests yet.</CardContent>
        </Card>
      )}

      {tests && tests.length > 0 && (
        <div className="flex flex-col gap-3">
          {tests.map((item) => (
            <TestCard key={item.test.id} item={item} clientId={clientId} />
          ))}
        </div>
      )}
    </div>
  );
}
