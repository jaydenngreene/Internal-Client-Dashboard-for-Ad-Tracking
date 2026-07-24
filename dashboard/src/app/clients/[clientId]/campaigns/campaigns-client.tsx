"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { getFunnel, getLtv, getClients, campaignGoalForNiche, FunnelBreakdown } from "@/lib/api";
import { useDateRangeState } from "@/lib/date-range";
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

// Each tab groups the exact same underlying spend/leads/revenue data by a
// different dimension — worth spelling out per tab, since "what is
// source/keyword even for" isn't obvious from the tab label alone.
function viewSubtitle(view: ViewMode, goal: "leads" | "sales"): string {
  const perOutcome = goal === "leads" ? "cost per lead" : "cost per purchase";
  switch (view) {
    case "campaign":
      return `Performance for each individual ad campaign — cost, ${perOutcome}, revenue, and ROAS.`;
    case "source":
      return "The same numbers rolled up by platform only (all of Facebook combined, all of Google combined, etc.) — a quick where's-my-budget-going read across many campaigns, rather than one campaign at a time.";
    case "keyword":
      return "Only populated for Search campaigns with keyword-level UTM tagging (utm_term). If you're not running Search ads with keyword tracking, this will show mostly untagged rows.";
    case "creative":
      return "Individual ad-level performance — click a row to open that specific ad's own detail page.";
    case "ltv":
      return "Average customer value at 30/60/90/180 days and lifetime, by acquisition campaign. Trailing-window snapshots as of now, refreshed nightly.";
  }
}

const VIEW_VALUES = VIEW_OPTIONS.map((o) => o.value);

export function CampaignsClient({ clientId }: { clientId: string }) {
  // Lets a link from elsewhere (e.g. Overview's Best Performing Ads "View all")
  // land directly on a specific breakdown, e.g. /campaigns?view=creative, instead
  // of always opening on the Campaign tab. Read once on mount — the toggle itself
  // is the source of truth after that, same as every other page's own state.
  const searchParams = useSearchParams();
  const requestedView = searchParams.get("view");
  const initialView = (VIEW_VALUES as string[]).includes(requestedView ?? "")
    ? (requestedView as ViewMode)
    : "campaign";

  const { preset, setPreset, customRange, setCustomRange, range } = useDateRangeState("30d");
  const [view, setView] = useState<ViewMode>(initialView);

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
          <p className="mt-0.5 max-w-2xl text-xs text-muted-foreground">{viewSubtitle(view, goal)}</p>
        </div>
        <div className="flex items-center gap-3">
          <SegmentedToggle value={view} onChange={setView} options={VIEW_OPTIONS} />
          <DateRangeSelect value={preset} onChange={setPreset} customRange={customRange} onCustomRangeChange={setCustomRange} />
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
                  : view === "creative"
                    ? (row) =>
                        row.platform && row.campaignName
                          ? `/clients/${clientId}/campaigns/${encodeURIComponent(row.platform)}/${encodeURIComponent(row.campaignName)}/creatives/${encodeURIComponent(row.name)}`
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
