"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getFunnel, getLtv, getClients, campaignGoalForNiche, FunnelBreakdown } from "@/lib/api";
import { RangePreset, resolveRange } from "@/lib/date-range";
import { DateRangeSelect } from "@/components/date-range-select";
import { SegmentedToggle } from "@/components/segmented-toggle";
import { CampaignBreakdownTable } from "@/components/campaign-breakdown-table";
import { LtvTable } from "@/components/ltv-table";
import { AddCustomCostForm } from "@/components/add-custom-cost-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ClientKicker } from "@/components/client-kicker";

// LTV isn't a funnel breakdown the API knows about (it's its own report, keyed only
// by acquisition campaign) - it's folded into this page's toggle purely as a UI
// grouping so "what's this campaign worth" lives next to the rest of the
// per-campaign views instead of occupying its own sidebar tab.
type ViewMode = FunnelBreakdown | "ltv";

const VIEW_OPTIONS: { value: ViewMode; label: string }[] = [
  { value: "campaign", label: "Campaign" },
  { value: "source", label: "Source" },
  { value: "keyword", label: "Keyword" },
  { value: "creative", label: "Creative" },
  { value: "ltv", label: "LTV" },
];

const VIEW_TITLE: Record<ViewMode, string> = {
  campaign: "Campaigns",
  source: "Traffic Sources",
  keyword: "Keywords",
  creative: "Creatives",
  ltv: "LTV by Acquisition Campaign",
};

const BREAKDOWN_COLUMN_LABEL: Record<FunnelBreakdown, string> = {
  campaign: "Campaign",
  source: "Source",
  keyword: "Keyword",
  creative: "Creative",
};

export function CampaignsClient({ clientId }: { clientId: string }) {
  const [preset, setPreset] = useState<RangePreset>("30d");
  const [view, setView] = useState<ViewMode>("campaign");
  const range = resolveRange(preset);
  const isLtv = view === "ltv";

  const funnelQuery = useQuery({
    queryKey: ["campaigns", clientId, range.from, range.to, view],
    queryFn: () => getFunnel(clientId, range, view as FunnelBreakdown),
    enabled: !isLtv,
  });
  const ltvQuery = useQuery({
    queryKey: ["ltv", clientId, range.from, range.to],
    queryFn: () => getLtv(clientId, range),
    enabled: isLtv,
  });
  const { isLoading, isError } = isLtv ? ltvQuery : funnelQuery;

  const { data: clients } = useQuery({ queryKey: ["clients"], queryFn: getClients });
  const niche = clients?.find((c) => c.id === clientId)?.niche;
  const goal = campaignGoalForNiche(niche ?? "other");

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <ClientKicker clientId={clientId} />
          <h1 className="text-lg font-semibold">Campaigns</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {isLtv
              ? "Average customer value at 30/60/90/180 days and lifetime, by acquisition campaign. Trailing-window snapshots as of now, refreshed nightly."
              : goal === "leads"
                ? "Cost, cost per lead, revenue, and ROAS, broken down by campaign, source, keyword, or individual creative"
                : "Cost, cost per purchase, revenue, and ROAS, broken down by campaign, source, keyword, or individual creative"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <SegmentedToggle value={view} onChange={setView} options={VIEW_OPTIONS} />
          <DateRangeSelect value={preset} onChange={setPreset} />
        </div>
      </div>

      {isError && (
        <p className="text-sm text-status-critical">Failed to load report. Is the API running?</p>
      )}

      {!isLtv && <AddCustomCostForm clientId={clientId} />}

      {isLoading && <Skeleton className="h-96 w-full" />}

      {isLtv && ltvQuery.data && (
        <Card className="px-0">
          <CardHeader className="px-4">
            <CardTitle>{VIEW_TITLE[view]}</CardTitle>
          </CardHeader>
          <CardContent className="px-0 overflow-x-auto">
            <LtvTable campaigns={ltvQuery.data.campaigns} predictiveLtvAvailable={ltvQuery.data.predictiveLtvAvailable} />
          </CardContent>
        </Card>
      )}

      {!isLtv && funnelQuery.data && (
        <Card className="px-0">
          <CardHeader className="px-4">
            <CardTitle>{VIEW_TITLE[view]}</CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            <CampaignBreakdownTable
              rows={funnelQuery.data.campaigns}
              nameColumnLabel={BREAKDOWN_COLUMN_LABEL[view as FunnelBreakdown]}
              goal={goal}
              showPlatformBadge={view !== "source"}
              getHref={
                view === "campaign"
                  ? (row) =>
                      row.platform
                        ? `/clients/${clientId}/campaigns/${encodeURIComponent(row.platform)}/${encodeURIComponent(row.name)}`
                        : null
                  : undefined
              }
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
