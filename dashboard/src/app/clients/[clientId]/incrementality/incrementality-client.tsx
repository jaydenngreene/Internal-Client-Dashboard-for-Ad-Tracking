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
            <p className="text-xs text-muted-foreground">Your usual total daily revenue</p>
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
                <p className="text-xs text-muted-foreground">Expected vs. actual revenue while paused</p>
                <p className="text-sm font-medium tabular-nums">
                  {formatCurrency(result.projectedBaselineTotalRevenue ?? 0)} vs.{" "}
                  {formatCurrency(result.actualTotalRevenueDuringPause ?? 0)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Estimated real impact</p>
                <p className="text-sm font-medium tabular-nums">
                  {formatCurrency(result.incrementalRevenueEstimate ?? 0)}
                  {result.incrementalityRatio !== null && ` (${formatPercent(result.incrementalityRatio * 100)} of what was credited to it)`}
                </p>
              </div>
            </>
          ) : (
            <div className="col-span-2">
              <p className="text-xs text-muted-foreground">
                {result.status === "pending" ? "Results appear once the pause window ends." : "Campaign is paused, results appear once the window ends."}
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
// the Experiments hub (experiments-client.tsx), which supplies the shared
// header; this used to be its own standalone page.
export function IncrementalityClient({ clientId }: { clientId: string }) {
  const { data: tests, isLoading } = useQuery({
    queryKey: ["incrementality-tests", clientId],
    queryFn: () => getIncrementalityTests(clientId),
  });

  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-2xl text-sm text-muted-foreground">
        Tests whether a campaign is really driving new sales, not just taking credit for sales that would have
        happened anyway. Pause the campaign completely, then watch what happens to your TOTAL revenue, not just
        this campaign&apos;s own attributed revenue (that number trivially drops to zero the moment it&apos;s
        paused, so it can&apos;t tell you anything on its own). If total revenue drops too, that drop is roughly
        what the campaign was really worth. If total revenue barely moves, this campaign was likely just taking
        credit for sales that would have come through another channel anyway. See the Geo-Lift tab for a more
        rigorous version of this same idea, once you have visitor location data to use.
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
