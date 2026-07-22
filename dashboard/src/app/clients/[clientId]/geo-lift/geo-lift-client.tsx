"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getGeoLiftTests, createGeoLiftTest, deleteGeoLiftTest, GeoLiftTestWithResult } from "@/lib/api";
import { formatCurrency } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FieldLabel } from "@/components/ui/field-label";
import { Skeleton } from "@/components/ui/skeleton";
import { ClientKicker } from "@/components/client-kicker";

const STATUS_LABEL = { pending: "Not started", running: "In progress", completed: "Completed" };
const STATUS_VARIANT: Record<string, "outline" | "secondary" | "default"> = {
  pending: "outline",
  running: "secondary",
  completed: "default",
};

function TestCard({ item, clientId }: { item: GeoLiftTestWithResult; clientId: string }) {
  const { test, result } = item;
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: () => deleteGeoLiftTest(test.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["geo-lift-tests", clientId] }),
  });

  return (
    <Card className="px-4 py-3">
      <CardContent className="flex flex-col gap-2 px-0">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-medium">{test.campaign_name}</p>
            <p className="text-xs text-muted-foreground">
              {test.platform} &middot; holdout: {test.holdout_regions.join(", ")} &middot; {test.test_start} to {test.test_end}
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
            <p className="text-xs text-muted-foreground">Pre-period rev/session (holdout)</p>
            <p className="text-sm font-medium tabular-nums">{formatCurrency(result.preHoldoutRevenuePerSession)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Pre-period rev/session (treatment)</p>
            <p className="text-sm font-medium tabular-nums">{formatCurrency(result.preTreatmentRevenuePerSession)}</p>
          </div>
          {result.status !== "pending" ? (
            <>
              <div>
                <p className="text-xs text-muted-foreground">During rev/session (holdout vs. treatment)</p>
                <p className="text-sm font-medium tabular-nums">
                  {formatCurrency(result.duringHoldoutRevenuePerSession ?? 0)} vs.{" "}
                  {formatCurrency(result.duringTreatmentRevenuePerSession ?? 0)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">DiD estimate (lift per session)</p>
                <p className="text-sm font-medium tabular-nums">
                  {result.didEstimate === null ? "-" : formatCurrency(result.didEstimate)}
                </p>
              </div>
            </>
          ) : (
            <div className="col-span-2">
              <p className="text-xs text-muted-foreground">Results appear once the test window starts.</p>
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
  const [holdoutRegions, setHoldoutRegions] = useState("");
  const [testStart, setTestStart] = useState("");
  const [testEnd, setTestEnd] = useState("");
  const [prePeriodDays, setPrePeriodDays] = useState("30");

  const mutation = useMutation({
    mutationFn: () =>
      createGeoLiftTest(clientId, {
        platform,
        campaignName,
        holdoutRegions: holdoutRegions.split(",").map((r) => r.trim().toUpperCase()).filter(Boolean),
        testStart,
        testEnd,
        prePeriodDays: parseInt(prePeriodDays, 10) || 30,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["geo-lift-tests", clientId] });
      setPlatform("");
      setCampaignName("");
      setHoldoutRegions("");
      setTestStart("");
      setTestEnd("");
    },
  });

  const canSubmit = platform.trim() && campaignName.trim() && holdoutRegions.trim() && testStart && testEnd;

  return (
    <Card className="px-4">
      <CardHeader className="px-0">
        <CardTitle>New Test</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-0">
        <p className="text-xs text-muted-foreground">
          Exclude the holdout regions from this campaign's targeting in its ad platform for the window below (this
          app doesn't change targeting for you), then come back to see the estimated lift.
        </p>
        <div className="flex flex-wrap gap-2">
          <div className="flex flex-col gap-1">
            <FieldLabel>Platform</FieldLabel>
            <Input className="w-36" placeholder="facebook_ads" value={platform} onChange={(e) => setPlatform(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <FieldLabel>Campaign name</FieldLabel>
            <Input className="w-48" value={campaignName} onChange={(e) => setCampaignName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <FieldLabel>Holdout regions (comma-separated)</FieldLabel>
            <Input className="w-48" placeholder="e.g. CA, NY, TX" value={holdoutRegions} onChange={(e) => setHoldoutRegions(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <FieldLabel>Test start</FieldLabel>
            <Input className="w-40" type="date" value={testStart} onChange={(e) => setTestStart(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <FieldLabel>Test end</FieldLabel>
            <Input className="w-40" type="date" value={testEnd} onChange={(e) => setTestEnd(e.target.value)} />
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

export function GeoLiftClient({ clientId }: { clientId: string }) {
  const { data: tests, isLoading } = useQuery({
    queryKey: ["geo-lift-tests", clientId],
    queryFn: () => getGeoLiftTests(clientId),
  });

  return (
    <div className="flex flex-col gap-4 p-6">
      <div>
        <ClientKicker clientId={clientId} />
        <h1 className="text-lg font-semibold">Geo-Lift Testing</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          True geographic holdout testing via difference-in-differences — more rigorous than Incrementality
          Testing's time-based pause test, because it controls for anything that changed for everyone at the same
          time (seasonality, a site issue), not just for this campaign specifically. Needs enough session volume
          with resolved regions in both the holdout and treatment groups to be meaningful.
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
