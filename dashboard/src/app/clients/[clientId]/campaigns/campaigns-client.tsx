"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getFunnel, FunnelBreakdown } from "@/lib/api";
import { RangePreset, resolveRange } from "@/lib/date-range";
import { DateRangeSelect } from "@/components/date-range-select";
import { SegmentedToggle } from "@/components/segmented-toggle";
import { CampaignBreakdownTable } from "@/components/campaign-breakdown-table";
import { AddCustomCostForm } from "@/components/add-custom-cost-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const BREAKDOWN_OPTIONS: { value: FunnelBreakdown; label: string }[] = [
  { value: "campaign", label: "Campaign" },
  { value: "source", label: "Source" },
  { value: "keyword", label: "Keyword" },
  { value: "creative", label: "Creative" },
];

const BREAKDOWN_TITLE: Record<FunnelBreakdown, string> = {
  campaign: "Campaigns",
  source: "Traffic Sources",
  keyword: "Keywords",
  creative: "Creatives",
};

const BREAKDOWN_COLUMN_LABEL: Record<FunnelBreakdown, string> = {
  campaign: "Campaign",
  source: "Source",
  keyword: "Keyword",
  creative: "Creative",
};

export function CampaignsClient({ clientId }: { clientId: string }) {
  const [preset, setPreset] = useState<RangePreset>("30d");
  const [breakdown, setBreakdown] = useState<FunnelBreakdown>("campaign");
  const range = resolveRange(preset);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["campaigns", clientId, range.from, range.to, breakdown],
    queryFn: () => getFunnel(clientId, range, breakdown),
  });

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Campaigns</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Cost → leads → sales → revenue → ROAS, broken down by campaign, source, keyword, or individual creative
          </p>
        </div>
        <div className="flex items-center gap-3">
          <SegmentedToggle value={breakdown} onChange={setBreakdown} options={BREAKDOWN_OPTIONS} />
          <DateRangeSelect value={preset} onChange={setPreset} />
        </div>
      </div>

      {isError && (
        <p className="text-sm text-status-critical">Failed to load report. Is the API running?</p>
      )}

      <AddCustomCostForm clientId={clientId} />

      {isLoading && <Skeleton className="h-96 w-full" />}

      {data && (
        <Card className="px-0">
          <CardHeader className="px-4">
            <CardTitle>{BREAKDOWN_TITLE[breakdown]}</CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            <CampaignBreakdownTable rows={data.campaigns} nameColumnLabel={BREAKDOWN_COLUMN_LABEL[breakdown]} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
