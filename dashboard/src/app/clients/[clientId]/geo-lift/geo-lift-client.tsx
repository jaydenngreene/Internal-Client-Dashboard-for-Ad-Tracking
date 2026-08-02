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
            <p className="text-xs text-muted-foreground">Usual revenue/visit, no-ads regions</p>
            <p className="text-sm font-medium tabular-nums">{formatCurrency(result.preHoldoutRevenuePerSession)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Usual revenue/visit, other regions</p>
            <p className="text-sm font-medium tabular-nums">{formatCurrency(result.preTreatmentRevenuePerSession)}</p>
          </div>
          {result.status !== "pending" ? (
            <>
              <div>
                <p className="text-xs text-muted-foreground">During the test, no-ads vs. other regions</p>
                <p className="text-sm font-medium tabular-nums">
                  {formatCurrency(result.duringHoldoutRevenuePerSession ?? 0)} vs.{" "}
                  {formatCurrency(result.duringTreatmentRevenuePerSession ?? 0)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Estimated lift (extra revenue per visit)</p>
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
          Pick a few regions and pause this campaign's targeting there in its ad platform for the window below (this
          app doesn't change targeting for you), then come back to see how much extra revenue the campaign was
          actually driving.
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
            <FieldLabel>Comparison window (days)</FieldLabel>
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

// Renders just this experiment type's own content, mounted as one tab inside
// the Experiments hub — see incrementality-client.tsx's header comment for
// the full reasoning.
export function GeoLiftClient({ clientId }: { clientId: string }) {
  const { data: tests, isLoading } = useQuery({
    queryKey: ["geo-lift-tests", clientId],
    queryFn: () => getGeoLiftTests(clientId),
  });

  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-2xl text-sm text-muted-foreground">
        Tests whether a campaign is really driving new sales, not just taking credit for sales that would have
        happened anyway. You pause its ads in a few &quot;holdout&quot; regions while ads keep running everywhere
        else, then compare how revenue per visitor changed in both groups. This is a more rigorous version of the
        Incrementality tab: it also accounts for anything that affects your whole business at once, like a
        seasonal dip or a site issue, instead of just this one campaign. You&apos;ll need a fair amount of visitor
        traffic with a known region on both sides for the result to mean anything.
      </p>

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
