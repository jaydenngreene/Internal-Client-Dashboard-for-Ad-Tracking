"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import {
  getFunnel,
  getLtv,
  getClients,
  getIntegrations,
  campaignGoalForNiche,
  FunnelBreakdown,
  getAttributionComparison,
  getAttributionModelComparison,
  getCreativeRoles,
  getJourneyPaths,
  JourneyPathsForGrain,
  getMarkovAttribution,
  getCreativeTagPerformance,
  CreativeTagPerformanceRow,
  Niche,
} from "@/lib/api";
import { useDateRangeState } from "@/lib/date-range";
import { SegmentedToggle } from "@/components/segmented-toggle";
import { CampaignBreakdownTable } from "@/components/campaign-breakdown-table";
import { LtvTable } from "@/components/ltv-table";
import { AddCustomCostForm } from "@/components/add-custom-cost-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { RoleBadge } from "@/components/role-badge";
import { ClientKicker } from "@/components/client-kicker";
import { formatCurrency, formatNumber, formatPercent, formatRoas } from "@/lib/format";
import { vocabularyForNiche } from "@/lib/niche-vocabulary";
import { TAG_LABEL, DIMENSION_LABEL } from "@/lib/creative-tag-labels";
import { cn } from "@/lib/utils";

// Niches that default to Last Click (high-volume, transactional purchases -
// see api/src/lib/attributionDefaults.ts for the full reasoning). Everything
// else (lead_gen/call/saas/other) defaults to U-Shaped instead. Drives which
// of the two comparison tables below is relevant for this client - a lead
// never has a first/last-touch REVENUE figure to compare in the first place.
const LAST_CLICK_DEFAULT_NICHES: Niche[] = ["ecommerce", "info_product"];

// Complements the main breakdown table's single revenue figure (whichever
// attribution_model the client is set to in Settings) with both first-touch
// and last-touch side by side, without needing to flip that setting back and
// forth. Only makes sense per-campaign, so it's Campaign-tab-only.
function AttributionComparisonTable({ clientId, from, to }: { clientId: string; from: string; to: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["attribution-comparison", clientId, from, to],
    queryFn: () => getAttributionComparison(clientId, { from, to }),
  });

  if (isLoading) return <Skeleton className="h-48 w-full" />;
  if (!data || data.campaigns.length === 0) return null;

  return (
    <Card className="px-0">
      <CardHeader className="px-4">
        <CardTitle>First-Touch vs Last-Touch</CardTitle>
        <p className="mt-0.5 text-xs text-muted-foreground">
          The same purchases credited two different ways: the first ad that ever brought this customer in, versus
          the last one they clicked before buying. Recomputed independently of the Attribution Model setting in
          Settings, so both are always visible together.
        </p>
      </CardHeader>
      <CardContent className="px-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-4 py-2 font-medium">Campaign</th>
                <th className="px-4 py-2 font-medium">First-Touch Revenue</th>
                <th className="px-4 py-2 font-medium">First-Touch Sales</th>
                <th className="px-4 py-2 font-medium">Last-Touch Revenue</th>
                <th className="px-4 py-2 font-medium">Last-Touch Sales</th>
              </tr>
            </thead>
            <tbody>
              {data.campaigns.map((row) => (
                <tr key={`${row.name}::${row.platform ?? ""}`} className="border-b border-border last:border-0 hover:bg-muted/40">
                  <td className="px-4 py-2 font-medium">
                    {row.platform ? (
                      <Link
                        href={`/clients/${clientId}/campaigns/${encodeURIComponent(row.platform)}/${encodeURIComponent(row.name)}`}
                        className="text-primary hover:underline"
                      >
                        {row.name}
                      </Link>
                    ) : (
                      row.name
                    )}
                  </td>
                  <td className="px-4 py-2">{formatCurrency(row.firstTouchRevenue)}</td>
                  <td className="px-4 py-2">{formatNumber(row.firstTouchSales)}</td>
                  <td className="px-4 py-2">{formatCurrency(row.lastTouchRevenue)}</td>
                  <td className="px-4 py-2">{formatNumber(row.lastTouchSales)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

// Leads-side equivalent of AttributionComparisonTable above - U-Shaped (this
// niche group's default) vs Time-Decay, since a lead/call/subscription has no
// stored attribution rows to read back under either model (see
// attributionModelComparison.ts). "Credit" is a dollar figure only for niches
// that actually have one (saas' MRR) - everything else is a fractional
// conversion count, so a lead_gen client sees "2.4 leads" rather than a
// dollar amount their data never had.
function ModelComparisonTable({
  clientId,
  from,
  to,
  hasValue,
}: {
  clientId: string;
  from: string;
  to: string;
  hasValue: boolean;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["attribution-model-comparison", clientId, from, to],
    queryFn: () => getAttributionModelComparison(clientId, { from, to }),
  });

  if (isLoading) return <Skeleton className="h-48 w-full" />;
  if (!data || data.campaigns.length === 0) return null;

  const format = hasValue ? formatCurrency : formatNumber;

  return (
    <Card className="px-0">
      <CardHeader className="px-4">
        <CardTitle>U-Shaped vs Time-Decay</CardTitle>
        <p className="mt-0.5 text-xs text-muted-foreground">
          The same conversions credited two different ways: U-Shaped (this account&apos;s default: 40% first touch /
          40% last touch / 20% split across the rest) versus Time-Decay, which weighs recent touches more heavily.
          Recomputed independently of the Attribution Model setting in Settings, so both are always visible together.
        </p>
      </CardHeader>
      <CardContent className="px-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-4 py-2 font-medium">Campaign</th>
                <th className="px-4 py-2 font-medium">U-Shaped Credit</th>
                <th className="px-4 py-2 font-medium">Time-Decay Credit</th>
              </tr>
            </thead>
            <tbody>
              {data.campaigns.map((row) => (
                <tr key={`${row.name}::${row.platform ?? ""}`} className="border-b border-border last:border-0 hover:bg-muted/40">
                  <td className="px-4 py-2 font-medium">
                    {row.platform ? (
                      <Link
                        href={`/clients/${clientId}/campaigns/${encodeURIComponent(row.platform)}/${encodeURIComponent(row.name)}`}
                        className="text-primary hover:underline"
                      >
                        {row.name}
                      </Link>
                    ) : (
                      row.name
                    )}
                  </td>
                  <td className="px-4 py-2">{format(row.uShapedCredit)}</td>
                  <td className="px-4 py-2">{format(row.timeDecayCredit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

// Customer Journey path clustering - built as a prototype-against-real-data
// pass (2026-08-01) after finding that consecutive repeats of the same touch
// (retargeting showing the same ad 3-5x before a purchase) inflate "unique
// path" rates to 60-100% unless collapsed first; collapsed, real clients'
// data showed a clean majority pattern at campaign grain (e.g. "70% of
// buyers touched exactly one campaign"). Campaign-grain tab shown first for
// that reason - creative-grain is real but more spread out. Source/platform
// grain was prototyped too but dropped: it was almost trivially dominant
// ("just Facebook") and not worth a whole view. See journeyPaths.ts for the
// full methodology and the "singleton" gate (a path only one buyer ever took
// isn't a pattern).
type PathGrain = "campaign" | "creative";

function JourneyStepChain({ steps }: { steps: string[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {steps.map((step, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {i > 0 && <span className="text-muted-foreground">&rarr;</span>}
          <Badge variant="secondary" className="max-w-56 truncate text-[11px]">
            {step}
          </Badge>
        </span>
      ))}
    </div>
  );
}

function JourneyPathsGrainView({ data, hasValue }: { data: JourneyPathsForGrain; hasValue: boolean }) {
  if (data.patterns.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        No repeat journey pattern yet. Every converting path in this range was unique to one buyer.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {data.patterns.map((row, i) => (
        <div key={i} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3">
          <JourneyStepChain steps={row.steps} />
          <div className="flex items-center gap-4 text-sm">
            <span className="text-muted-foreground">
              {formatNumber(row.count)} buyer{row.count === 1 ? "" : "s"} ({row.percentage.toFixed(1)}%)
            </span>
            {hasValue && <span className="font-medium text-chart-1">{formatCurrency(row.totalValue)}</span>}
          </div>
        </div>
      ))}
      {data.singletonJourneys > 0 && (
        <p className="px-1 text-xs text-muted-foreground">
          Plus {formatNumber(data.singletonJourneys)} other journey{data.singletonJourneys === 1 ? "" : "s"}{" "}
          whose exact path was unique to that one buyer, not shown individually since one buyer isn&apos;t a pattern.
        </p>
      )}
    </div>
  );
}

function JourneyPathsCard({ clientId, from, to, hasValue }: { clientId: string; from: string; to: string; hasValue: boolean }) {
  const [grain, setGrain] = useState<PathGrain>("campaign");
  const { data, isLoading } = useQuery({
    queryKey: ["journey-paths", clientId, from, to],
    queryFn: () => getJourneyPaths(clientId, { from, to }),
  });

  if (isLoading) return <Skeleton className="h-48 w-full" />;
  if (!data || data.totalJourneys === 0) return null;

  // A handful of total journeys isn't enough to call anything a "pattern" -
  // same reasoning as the singleton gate itself, just applied to the whole
  // account rather than one path. Still shows the real total rather than
  // hiding the card outright, so a thin client sees why nothing's listed.
  const MIN_TOTAL_FOR_PATTERNS = 5;
  const hasEnoughData = data.totalJourneys >= MIN_TOTAL_FOR_PATTERNS;

  return (
    <Card className="px-0">
      <CardHeader className="flex flex-row items-start justify-between gap-4 px-4">
        <div>
          <CardTitle>Customer Journey Patterns</CardTitle>
          <p className="mt-0.5 text-xs text-muted-foreground">
            The actual sequence of ads buyers touched before purchasing, grouped into common patterns. Based on{" "}
            {formatNumber(data.totalJourneys)} converting journey{data.totalJourneys === 1 ? "" : "s"} in this range.
          </p>
        </div>
        <SegmentedToggle
          value={grain}
          onChange={(v) => setGrain(v as PathGrain)}
          options={[
            { value: "campaign", label: "By Campaign" },
            { value: "creative", label: "By Creative" },
          ]}
        />
      </CardHeader>
      <CardContent className="px-4">
        {hasEnoughData ? (
          <JourneyPathsGrainView data={data[grain]} hasValue={hasValue} />
        ) : (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Only {formatNumber(data.totalJourneys)} converting journey{data.totalJourneys === 1 ? "" : "s"} in this
            range, not enough yet to reliably call anything a common pattern.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// Step 59 — data-driven ("algorithmic") attribution via a Markov chain removal-
// effect model: how much each channel's OWN conversion probability would drop
// if it were removed from every visitor's path entirely, across every visitor
// (converting and not), not just the touches on one sale. Deliberately a
// comparison view, not a switch - whichever rule-based model is set in
// Settings is still what drives every other report's revenue numbers. Folded
// into this tab (2026-08-01 nav consolidation) as a third comparison card next
// to First-Touch-vs-Last-Touch / U-Shaped-vs-Time-Decay above, since it's the
// same "same purchases, credited a different way" idea - it used to be its own
// standalone page under Data-Driven Attribution.
function DataDrivenAttributionCard({ clientId, from, to }: { clientId: string; from: string; to: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["markov-attribution", clientId, from, to],
    queryFn: () => getMarkovAttribution(clientId, { from, to }),
  });

  if (isLoading) return <Skeleton className="h-48 w-full" />;
  if (!data) return null;

  return (
    <Card className="px-0">
      <CardHeader className="px-4">
        <CardTitle>Data-Driven Attribution</CardTitle>
        <p className="mt-0.5 max-w-2xl text-xs text-muted-foreground">
          A more advanced read on which channels actually deserve credit, based on real patterns across every
          visitor&apos;s path to purchase (not just people who bought): for each channel, how much your results would
          suffer if it disappeared entirely. Shown for comparison only: the Attribution Model set in Settings still
          drives the revenue numbers everywhere else.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 px-4">
        {!data.available && <p className="py-4 text-center text-sm text-muted-foreground">{data.reason}</p>}
        {data.available && (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-border px-3 py-2">
                <p className="text-xs font-medium text-muted-foreground">Overall Conversion Rate</p>
                <p className="mt-1 text-xl font-semibold tabular-nums">
                  {formatPercent((data.totalConversionProbability ?? 0) * 100)}
                </p>
              </div>
              <div className="rounded-lg border border-border px-3 py-2">
                <p className="text-xs font-medium text-muted-foreground">Visitors Analyzed</p>
                <p className="mt-1 text-xl font-semibold tabular-nums">{formatNumber(data.visitorsAnalyzed ?? 0)}</p>
              </div>
              <div className="rounded-lg border border-border px-3 py-2">
                <p className="text-xs font-medium text-muted-foreground">Total Revenue</p>
                <p className="mt-1 text-xl font-semibold tabular-nums">{formatCurrency(data.totalRevenue ?? 0)}</p>
              </div>
            </div>
            <div className="flex flex-col gap-3">
              <p className="text-sm font-medium">Channel Impact</p>
              {data.channels?.map((c) => (
                <div key={c.channel} className="flex flex-col gap-1 border-b border-border pb-2 last:border-0 last:pb-0">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">{c.channel}</p>
                    <p className="text-sm font-semibold tabular-nums">{formatCurrency(c.attributedRevenue)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-chart-4" style={{ width: `${Math.round(c.creditShare * 100)}%` }} />
                    </div>
                    <p className="w-36 shrink-0 text-right text-xs text-muted-foreground">
                      {formatPercent(c.creditShare * 100)} credit, {formatNumber(c.touchpoints)} touchpoints
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// "What KIND of creative wins," not just which specific ad - aggregates every
// AI-tagged creative's real spend/revenue by hook type/angle/tone (generate
// tags from a creative's own detail page first; this reads already-generated
// tags, nothing here re-runs the AI). Account-wide, not date-scoped. Folded
// into the Creative tab (2026-08-01 nav consolidation) since it's the same
// subject at a different grain (tag-aggregate vs. per-ad) - it used to be its
// own standalone page under Creative Patterns.
function CreativePatternsCard({ clientId }: { clientId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["creative-tag-performance", clientId],
    queryFn: () => getCreativeTagPerformance(clientId),
  });

  if (isLoading) return <Skeleton className="h-48 w-full" />;
  if (!data || data.length === 0) return null;

  const byDimension = (dim: CreativeTagPerformanceRow["dimension"]) => data.filter((r) => r.dimension === dim);

  return (
    <Card className="px-4">
      <CardHeader className="px-0">
        <CardTitle className="flex items-center gap-1.5">
          <Sparkles className="size-4 text-primary" /> Creative Patterns
        </CardTitle>
        <p className="mt-0.5 max-w-2xl text-xs text-muted-foreground">
          What KIND of creative wins, not just which specific ad: every AI-tagged creative&apos;s real spend and
          revenue, grouped by hook type, angle, and tone. Generate tags from a creative&apos;s detail page above first;
          this only aggregates what&apos;s already tagged.
        </p>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-4 px-0 lg:grid-cols-3">
        {(["hook_type", "angle", "tone"] as const).map((dim) => {
          const rows = byDimension(dim);
          if (rows.length === 0) return null;
          return (
            <div key={dim} className="flex flex-col gap-2">
              <p className="text-sm font-medium">{DIMENSION_LABEL[dim]}</p>
              {rows.map((r) => (
                <div key={r.value} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{TAG_LABEL[r.value] ?? r.value}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {r.creativeCount} creative{r.creativeCount === 1 ? "" : "s"} &middot; {formatCurrency(r.totalSpend)} spent
                    </span>
                  </div>
                  <span className={cn("text-sm font-semibold tabular-nums", (r.avgRoas ?? 0) >= 1 ? "text-chart-1" : "text-chart-2")}>
                    {r.avgRoas === null ? "-" : formatRoas(r.avgRoas)}
                  </span>
                </div>
              ))}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

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
      return goal === "leads"
        ? `Performance for each individual ad campaign: cost, ${perOutcome}, and revenue.`
        : `Performance for each individual ad campaign: cost, ${perOutcome}, revenue, and ROAS.`;
    case "source":
      return "The same numbers rolled up by platform only (all of Facebook combined, all of Google combined, etc.), a quick where's-my-budget-going read across many campaigns, rather than one campaign at a time.";
    case "keyword":
      return "Only populated for Search campaigns with keyword-level UTM tagging (utm_term). If you're not running Search ads with keyword tracking, this will show mostly untagged rows.";
    case "creative":
      return "Individual ad-level performance. Click a row to open that specific ad's own detail page.";
    case "ltv":
      return "Average customer value at 30/60/90/180 days and lifetime, by acquisition campaign. Trailing-window snapshots as of now, refreshed nightly.";
  }
}

const VIEW_VALUES = VIEW_OPTIONS.map((o) => o.value);

// Matches the "Ad Platforms" category in settings-client.tsx's INTEGRATIONS list —
// the Source tab rolls performance up "all of Facebook combined, all of Google
// combined," which is meaningless noise (one row, repeating what Campaign view
// already shows) until there's a second platform actually running to roll up
// against. Reappears automatically the moment a client connects one.
const AD_PLATFORM_KEYS = new Set([
  'facebook_ads',
  'google_ads',
  'bing_ads',
  'tiktok_ads',
  'snapchat_ads',
  'pinterest_ads',
  'linkedin_ads',
  'reddit_ads',
]);

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

  const { range } = useDateRangeState("30d");
  const [view, setView] = useState<ViewMode>(initialView);

  const { data: integrations } = useQuery({
    queryKey: ["integrations", clientId],
    queryFn: () => getIntegrations(clientId),
  });
  const connectedAdPlatforms = (integrations ?? []).filter((i) => AD_PLATFORM_KEYS.has(i.platform)).length;
  const viewOptions = connectedAdPlatforms >= 2 ? VIEW_OPTIONS : VIEW_OPTIONS.filter((o) => o.value !== "source");
  // Falls back off Source if it was requested (via ?view=source, or a toggle click
  // from before a platform got disconnected) but isn't available anymore, rather
  // than rendering a toggle selection that no longer has a matching option.
  const effectiveView = viewOptions.some((o) => o.value === view) ? view : "campaign";

  const isLtv = effectiveView === "ltv";

  const funnelQuery = useQuery({
    queryKey: ["campaigns", clientId, range.from, range.to, effectiveView],
    queryFn: () => getFunnel(clientId, range, effectiveView as FunnelBreakdown),
    enabled: !isLtv,
  });
  // Customer Journey / Ad Role columns only apply to the Creative tab - role
  // (opener/closer/assist) is a per-ad concept, not a per-campaign one.
  const isCreativeView = effectiveView === "creative";
  const creativeRolesQuery = useQuery({
    queryKey: ["creative-roles", clientId, range.from, range.to],
    queryFn: () => getCreativeRoles(clientId, range),
    enabled: isCreativeView,
  });
  const roleByKey = new Map((creativeRolesQuery.data?.creatives ?? []).map((r) => [`${r.name}::${r.platform ?? ""}`, r]));
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
          <p className="mt-0.5 max-w-2xl text-xs text-muted-foreground">{viewSubtitle(effectiveView, goal)}</p>
        </div>
        <div className="flex items-center gap-3">
          <SegmentedToggle value={effectiveView} onChange={setView} options={viewOptions} />
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
            <CardTitle>{VIEW_TITLE[effectiveView]}</CardTitle>
          </CardHeader>
          <CardContent className="px-0 overflow-x-auto">
            <LtvTable campaigns={ltvQuery.data.campaigns} predictiveLtvAvailable={ltvQuery.data.predictiveLtvAvailable} />
          </CardContent>
        </Card>
      )}

      {!isLtv && funnelQuery.data && (
        <Card className="px-0">
          <CardHeader className="px-4">
            <CardTitle>{VIEW_TITLE[effectiveView]}</CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            <CampaignBreakdownTable
              rows={funnelQuery.data.campaigns}
              nameColumnLabel={BREAKDOWN_COLUMN_LABEL[effectiveView as FunnelBreakdown]}
              goal={goal}
              showPlatformBadge={effectiveView !== "source"}
              getHref={
                effectiveView === "campaign"
                  ? (row) =>
                      row.platform
                        ? `/clients/${clientId}/campaigns/${encodeURIComponent(row.platform)}/${encodeURIComponent(row.name)}`
                        : null
                  : effectiveView === "creative"
                    ? (row) =>
                        row.platform && row.campaignName
                          ? `/clients/${clientId}/campaigns/${encodeURIComponent(row.platform)}/${encodeURIComponent(row.campaignName)}/creatives/${encodeURIComponent(row.name)}`
                          : null
                    : undefined
              }
              extraColumns={
                isCreativeView
                  ? [
                      { key: "openerCount", label: "Opener" },
                      { key: "closerCount", label: "Closer" },
                      { key: "assistCount", label: "Assist" },
                      { key: "role", label: "Role" },
                    ]
                  : undefined
              }
              renderExtraCell={
                isCreativeView
                  ? (row, key) => {
                      const roleRow = roleByKey.get(`${row.name}::${row.platform ?? ""}`);
                      if (!roleRow) return "—";
                      if (key === "role") return <RoleBadge role={roleRow.role} />;
                      if (key === "openerCount") return formatNumber(roleRow.openerCount);
                      if (key === "closerCount") return formatNumber(roleRow.closerCount);
                      if (key === "assistCount") return formatNumber(roleRow.assistCount);
                      return null;
                    }
                  : undefined
              }
            />
          </CardContent>
        </Card>
      )}

      {isCreativeView && (
        <p className="px-1 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Opener</span> = first touch in a converting journey (cold
          traffic this ad brought in), <span className="font-medium text-foreground">Closer</span> = last touch
          before purchase, <span className="font-medium text-foreground">Assist</span> = a touch in between. Judging
          an ad on revenue/ROAS alone can make a real opener look worthless and lead to cutting the ad that&apos;s
          quietly feeding the rest of the funnel.
        </p>
      )}

      {effectiveView === "campaign" && niche && LAST_CLICK_DEFAULT_NICHES.includes(niche) && (
        <AttributionComparisonTable clientId={clientId} from={range.from} to={range.to} />
      )}
      {effectiveView === "campaign" && niche && !LAST_CLICK_DEFAULT_NICHES.includes(niche) && (
        <ModelComparisonTable
          clientId={clientId}
          from={range.from}
          to={range.to}
          hasValue={vocabularyForNiche(niche).valueColumnLabel !== null}
        />
      )}
      {effectiveView === "campaign" && niche && (
        <JourneyPathsCard
          clientId={clientId}
          from={range.from}
          to={range.to}
          hasValue={vocabularyForNiche(niche).valueColumnLabel !== null}
        />
      )}
      {effectiveView === "campaign" && (
        <DataDrivenAttributionCard clientId={clientId} from={range.from} to={range.to} />
      )}

      {isCreativeView && <CreativePatternsCard clientId={clientId} />}
    </div>
  );
}
