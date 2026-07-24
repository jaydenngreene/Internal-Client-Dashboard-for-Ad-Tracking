"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  getOverview,
  getBudgetPacing,
  getForecast,
  getFunnel,
  getClients,
  getMof,
  getSubscriptions,
  getCalls,
  getLtv,
  campaignGoalForNiche,
  ForecastWindow,
  Niche,
} from "@/lib/api";
import { useDateRangeState } from "@/lib/date-range";
import { formatCurrency, formatNumber, formatPercent, formatRoas } from "@/lib/format";
import { DateRangeSelect } from "@/components/date-range-select";
import { KpiTile } from "@/components/kpi-tile";
import { StatChartCard } from "@/components/stat-chart-card";
import { DonutChart } from "@/components/donut-chart";
import { InsightsPanel } from "@/components/insights-panel";
import { CampaignBreakdownTable } from "@/components/campaign-breakdown-table";
import { SegmentedToggle } from "@/components/segmented-toggle";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ClientKicker } from "@/components/client-kicker";
import { cn } from "@/lib/utils";
import type { OverviewReport } from "@/lib/api";

const BEST_PERFORMING_LIMIT = 10;
type OverviewView = "basic" | "pro";

// Cost/Revenue/Profit/ROAS/ROI — shared by both Basic and Pro view, since it's
// the one row Hyros keeps on screen no matter which tab you're on.
function HeroKpiRow({ data }: { data: OverviewReport }) {
  const dates = data.series.map((p) => p.date);
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <KpiTile
        label="Ad Spend"
        value={formatCurrency(data.cost)}
        fromDate={data.from}
        color="var(--color-chart-2)"
        sparkline={data.series.map((p) => p.cost)}
        dates={dates}
        formatValue={formatCurrency}
      />
      <KpiTile
        label="Total Revenue"
        value={formatCurrency(data.revenue)}
        fromDate={data.from}
        color="var(--color-chart-1)"
        sparkline={data.series.map((p) => p.revenue)}
        dates={dates}
        formatValue={formatCurrency}
      />
      <KpiTile
        label="Profit"
        value={formatCurrency(data.trueProfit)}
        fromDate={data.from}
        color="var(--color-chart-3)"
        sparkline={data.series.map((p) => p.trueProfit)}
        dates={dates}
        formatValue={formatCurrency}
        sublabel={data.hasMarginConfig ? "COGS-adjusted" : "ad cost only, no margin set"}
      />
      <KpiTile
        label="ROAS"
        value={formatRoas(data.roas)}
        fromDate={data.from}
        color="var(--color-chart-4)"
        sparkline={data.series.map((p) => (p.cost > 0 ? p.revenue / p.cost : 0))}
        dates={dates}
        formatValue={(v) => formatRoas(v)}
      />
      <KpiTile
        label="ROI"
        value={formatPercent(data.hasMarginConfig ? data.trueRoi : data.roi)}
        fromDate={data.from}
        color="var(--color-chart-5)"
        sparkline={data.series.map((p) => (p.cost > 0 ? (p.trueProfit / p.cost) * 100 : 0))}
        dates={dates}
        formatValue={(v) => formatPercent(v)}
        sublabel={data.hasMarginConfig ? "COGS-adjusted" : undefined}
      />
    </div>
  );
}

// Step 43 — always the current calendar month, independent of the Overview page's
// own date-range preset — pacing only ever means "this month so far."
function BudgetPacingCard({ clientId }: { clientId: string }) {
  const { data } = useQuery({
    queryKey: ["budget-pacing", clientId],
    queryFn: () => getBudgetPacing(clientId),
  });

  if (!data || data.target === null) return null;

  const statusLabel = { over: "Over pace", under: "Under pace", on_track: "On pace" }[data.paceStatus ?? "on_track"];
  const statusVariant = data.paceStatus === "over" ? "destructive" : "secondary";

  return (
    <Card className="px-4">
      <CardHeader className="px-0">
        <CardTitle className="flex items-center gap-2 text-sm">
          Budget Pacing ({data.month})
          <Badge variant={statusVariant} className="text-[10px]">
            {statusLabel}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap items-baseline gap-6 px-0">
        <div>
          <p className="text-xs font-medium text-muted-foreground">Spend to date</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">{formatCurrency(data.spendToDate)}</p>
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground">Expected by now</p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-muted-foreground">
            {data.expectedSpendToDate === null ? "-" : formatCurrency(data.expectedSpendToDate)}
          </p>
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground">Monthly target</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">{formatCurrency(data.target)}</p>
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground">Projected month-end</p>
          <p
            className={cn(
              "mt-1 text-xl font-semibold tabular-nums",
              data.paceStatus === "over" ? "text-status-critical" : "text-foreground"
            )}
          >
            {formatCurrency(data.projectedMonthEndSpend)}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

// Step 49 — a simple linear-trend projection over the trailing 60 days, not a
// real time-series model. Framed explicitly as a rough trend read, not a precise
// prediction, matching how this app discloses every other simple-method estimate
// (predictive LTV, creative fatigue).
function ForecastWindowCard({ window, label }: { window: ForecastWindow; label: string }) {
  return (
    <Card className="px-4">
      <CardHeader className="px-0">
        <CardTitle className="text-sm">{label}</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-3 px-0 sm:grid-cols-5">
        <div>
          <p className="text-xs font-medium text-muted-foreground">Revenue</p>
          <p className="mt-1 text-lg font-semibold tabular-nums">{formatCurrency(window.projectedRevenue)}</p>
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground">Ad Spend</p>
          <p className="mt-1 text-lg font-semibold tabular-nums">{formatCurrency(window.projectedCost)}</p>
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground">ROAS</p>
          <p className="mt-1 text-lg font-semibold tabular-nums">{formatRoas(window.projectedRoas)}</p>
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground">New Customers</p>
          <p className="mt-1 text-lg font-semibold tabular-nums">{formatNumber(window.projectedNewCustomers)}</p>
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground">CAC</p>
          <p className="mt-1 text-lg font-semibold tabular-nums">
            {window.projectedCac === null ? "-" : formatCurrency(window.projectedCac)}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function ForecastSection({ clientId }: { clientId: string }) {
  const { data } = useQuery({
    queryKey: ["forecast", clientId],
    queryFn: () => getForecast(clientId),
  });

  if (!data) return null;

  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="text-sm font-medium">Forecast</p>
        <p className="text-xs text-muted-foreground">
          A simple straight-line trend from the last {data.lookbackDays} days, not a precise prediction. Read it as
          direction and rough scale, not an exact number.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <ForecastWindowCard window={data.forecast7d} label="Next 7 days" />
        <ForecastWindowCard window={data.forecast30d} label="Next 30 days" />
      </div>
    </div>
  );
}

// Delegates to the same leads-vs-sales split campaignGoalForNiche already uses
// for column choice on the breakdown tables — a single source of truth for
// "does this niche think in leads or in purchases" reused everywhere that
// distinction matters (Overview, Funnel's TOF), instead of a second
// independently-maintained list that could quietly drift out of sync with it.
function isEcomLike(niche: Niche | undefined): boolean {
  return campaignGoalForNiche(niche ?? "other") === "sales";
}

// Ecommerce/info-product's Overview conversion widget: checkouts that
// completed vs. abandoned, built from the same MOF fields Funnel's own
// ecommerce section already surfaces (no new endpoint needed) — the "part of
// a whole" widget these niches actually care about, replacing the
// leads-framed ConversionCard below which doesn't apply to them.
function CartConversionCard({ clientId, range }: { clientId: string; range: { from: string; to: string } }) {
  const { data } = useQuery({
    queryKey: ["mof", clientId, range.from, range.to],
    queryFn: () => getMof(clientId, range),
  });

  if (!data) return null;
  const completed = Math.max(data.initiateCheckoutCount - data.abandonedCartCount, 0);
  const completionRate = data.cartAbandonmentRate === null ? null : 100 - data.cartAbandonmentRate;

  return (
    <Card className="px-4">
      <CardHeader className="px-0">
        <CardTitle className="text-sm">Cart → Purchase Conversion</CardTitle>
      </CardHeader>
      <CardContent className="px-0">
        {data.initiateCheckoutCount > 0 ? (
          <DonutChart
            centerValue={completionRate === null ? "-" : formatPercent(completionRate)}
            centerLabel={`${formatNumber(completed)} of ${formatNumber(data.initiateCheckoutCount)} checkouts`}
            segments={[
              { key: "completed", label: "Completed", value: completed, color: "var(--color-chart-1)" },
              { key: "abandoned", label: "Abandoned", value: data.abandonedCartCount, color: "var(--color-chart-2)" },
            ]}
          />
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">No checkouts started in this range yet.</p>
        )}
      </CardContent>
    </Card>
  );
}

// Leads that went on to buy vs. leads that haven't (yet) — the same "part of a
// whole" shape as Hyros's Cart/Lead Conversion donut, built from numbers the
// overview report already returns (no new endpoint needed). Shown for
// non-ecommerce-like niches only — see CartConversionCard above.
function ConversionCard({ leads, sales }: { leads: number; sales: number }) {
  const converted = Math.min(sales, leads);
  const remaining = Math.max(leads - sales, 0);
  const rate = leads > 0 ? (sales / leads) * 100 : null;

  return (
    <Card className="px-4">
      <CardHeader className="px-0">
        <CardTitle className="text-sm">Lead → Sale Conversion</CardTitle>
      </CardHeader>
      <CardContent className="px-0">
        {leads > 0 ? (
          <DonutChart
            centerValue={rate === null ? "-" : formatPercent(rate)}
            centerLabel={`${formatNumber(sales)} of ${formatNumber(leads)}`}
            segments={[
              { key: "converted", label: "Converted", value: converted, color: "var(--color-chart-1)" },
              { key: "remaining", label: "Not yet", value: remaining, color: "var(--color-chart-2)" },
            ]}
          />
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">No leads in this range yet.</p>
        )}
      </CardContent>
    </Card>
  );
}

// A small stat row shared by the three niche snapshot cards below — same shape
// as BudgetPacingCard's stat row, just reused three times instead of hand-built
// once per card.
function SnapshotStat({ label, value, tone }: { label: string; value: string; tone?: "positive" | "negative" }) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-1 text-xl font-semibold tabular-nums",
          tone === "positive" && "text-chart-1",
          tone === "negative" && "text-chart-2"
        )}
      >
        {value}
      </p>
    </div>
  );
}

// One row of niche-specific snapshot cards — mirrors funnel-client.tsx's own
// isEcommerce/isCallBased conditional sections (that page already tailors MOF's
// cart-funnel fields and BOF's calls section to niche; Overview didn't do the
// same until now). Nothing renders for lead_gen/info_product/other, same as
// funnel-client.tsx today.
function EcommerceSnapshotCard({
  clientId,
  range,
  aov,
}: {
  clientId: string;
  range: { from: string; to: string };
  aov: number | null;
}) {
  const { data } = useQuery({
    queryKey: ["mof", clientId, range.from, range.to],
    queryFn: () => getMof(clientId, range),
  });
  // Weighted by customer count, not a plain average of campaigns — a campaign
  // with 2 customers and one with 200 shouldn't count equally toward the
  // account-wide figure.
  const { data: ltv } = useQuery({
    queryKey: ["ltv", clientId, range.from, range.to],
    queryFn: () => getLtv(clientId, range),
  });
  const avgLtv = useMemo(() => {
    if (!ltv || ltv.campaigns.length === 0) return null;
    const totalCustomers = ltv.campaigns.reduce((sum, c) => sum + c.customers, 0);
    if (totalCustomers === 0) return null;
    const weighted = ltv.campaigns.reduce((sum, c) => sum + c.avgLtvLifetime * c.customers, 0);
    return weighted / totalCustomers;
  }, [ltv]);

  if (!data) return null;

  return (
    <Card className="px-4">
      <CardHeader className="flex flex-row items-center justify-between px-0">
        <CardTitle className="text-sm">Ecommerce Snapshot</CardTitle>
        <Link href={`/clients/${clientId}/funnel`} className="text-xs font-medium text-primary hover:underline">
          View funnel →
        </Link>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-6 px-0">
        <SnapshotStat label="AOV" value={aov === null ? "-" : formatCurrency(aov)} tone="positive" />
        <SnapshotStat label="Avg Customer LTV" value={avgLtv === null ? "-" : formatCurrency(avgLtv)} tone="positive" />
        <SnapshotStat label="Add to Cart" value={formatNumber(data.addToCartCount)} />
        <SnapshotStat label="Checkout Initiated" value={formatNumber(data.initiateCheckoutCount)} />
        <SnapshotStat label="Cart Abandonment" value={formatPercent(data.cartAbandonmentRate)} tone="negative" />
      </CardContent>
    </Card>
  );
}

function SaasSnapshotCard({ clientId, range }: { clientId: string; range: { from: string; to: string } }) {
  const { data } = useQuery({
    queryKey: ["subscriptions", clientId, range.from, range.to],
    queryFn: () => getSubscriptions(clientId, range),
  });
  if (!data) return null;

  return (
    <Card className="px-4">
      <CardHeader className="flex flex-row items-center justify-between px-0">
        <CardTitle className="text-sm">SaaS Snapshot</CardTitle>
        <Link
          href={`/clients/${clientId}/subscriptions`}
          className="text-xs font-medium text-primary hover:underline"
        >
          View subscriptions →
        </Link>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-6 px-0">
        <SnapshotStat label="Current MRR" value={formatCurrency(data.currentMrr)} tone="positive" />
        <SnapshotStat label="Churn Rate" value={formatPercent(data.churnRate)} tone="negative" />
        <SnapshotStat label="Trial Conversion" value={formatPercent(data.trialConversionRate)} />
      </CardContent>
    </Card>
  );
}

function CallsSnapshotCard({ clientId, range }: { clientId: string; range: { from: string; to: string } }) {
  const { data } = useQuery({
    queryKey: ["calls", clientId, range.from, range.to],
    queryFn: () => getCalls(clientId, range),
  });
  if (!data) return null;

  return (
    <Card className="px-4">
      <CardHeader className="flex flex-row items-center justify-between px-0">
        <CardTitle className="text-sm">Calls Snapshot</CardTitle>
        <Link href={`/clients/${clientId}/funnel`} className="text-xs font-medium text-primary hover:underline">
          View funnel →
        </Link>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-6 px-0">
        <SnapshotStat label="Total Calls" value={formatNumber(data.totalCalls)} />
        <SnapshotStat label="Qualified Rate" value={formatPercent(data.qualifiedRate)} tone="positive" />
        <SnapshotStat
          label="Top Campaign"
          value={data.byCampaign[0]?.campaign_name ?? "-"}
        />
      </CardContent>
    </Card>
  );
}

function NicheSnapshotRow({
  clientId,
  range,
  niche,
  aov,
}: {
  clientId: string;
  range: { from: string; to: string };
  niche: Niche | undefined;
  aov: number | null;
}) {
  if (isEcomLike(niche)) return <EcommerceSnapshotCard clientId={clientId} range={range} aov={aov} />;
  if (niche === "saas") return <SaasSnapshotCard clientId={clientId} range={range} />;
  if (niche === "call" || niche === "lead_gen") return <CallsSnapshotCard clientId={clientId} range={range} />;
  return null;
}

function BestPerformingCard({
  clientId,
  range,
  goal,
}: {
  clientId: string;
  range: { from: string; to: string };
  goal: "leads" | "sales";
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["campaigns", clientId, range.from, range.to, "creative"],
    queryFn: () => getFunnel(clientId, range, "creative"),
  });

  const topRows = useMemo(
    () => [...(data?.campaigns ?? [])].sort((a, b) => b.revenue - a.revenue).slice(0, BEST_PERFORMING_LIMIT),
    [data]
  );

  return (
    <Card className="overflow-x-auto px-0">
      <CardHeader className="flex flex-row items-center justify-between px-4">
        <CardTitle className="text-sm">Best Performing Ads</CardTitle>
        <Link
          href={`/clients/${clientId}/campaigns?view=creative`}
          className="text-xs font-medium text-primary hover:underline"
        >
          View all
        </Link>
      </CardHeader>
      <CardContent className="px-0">
        {isLoading && <Skeleton className="mx-4 h-48" />}
        {!isLoading && (
          <CampaignBreakdownTable
            rows={topRows}
            nameColumnLabel="Ad"
            goal={goal}
            getHref={(row) =>
              row.platform && row.campaignName
                ? `/clients/${clientId}/campaigns/${encodeURIComponent(row.platform)}/${encodeURIComponent(row.campaignName)}/creatives/${encodeURIComponent(row.name)}`
                : null
            }
          />
        )}
      </CardContent>
    </Card>
  );
}

export function OverviewClient({ clientId }: { clientId: string }) {
  const { preset, setPreset, customRange, setCustomRange, range } = useDateRangeState("30d");
  const [view, setView] = useState<OverviewView>("basic");


  const { data, isLoading, isError } = useQuery({
    queryKey: ["overview", clientId, range.from, range.to],
    queryFn: () => getOverview(clientId, range),
  });
  const { data: clients } = useQuery({ queryKey: ["clients"], queryFn: getClients });
  const niche = clients?.find((c) => c.id === clientId)?.niche;
  const goal = campaignGoalForNiche(niche ?? "other");

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <ClientKicker clientId={clientId} />
          <h1 className="text-lg font-semibold">Overview</h1>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <SegmentedToggle
            value={view}
            onChange={setView}
            options={[
              { value: "basic", label: "Basic View" },
              { value: "pro", label: "Pro View" },
            ]}
          />
          <DateRangeSelect value={preset} onChange={setPreset} customRange={customRange} onCustomRangeChange={setCustomRange} />
        </div>
      </div>

      {isError && (
        <p className="text-sm text-status-critical">Failed to load report. Is the API running?</p>
      )}

      {isLoading && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      )}

      {data && view === "basic" && (
        <>
          <HeroKpiRow data={data} />

          <div className="flex flex-col gap-3">
            <p className="px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {isEcomLike(niche) ? "Orders" : "Funnel"}
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {isEcomLike(niche) ? (
                <>
                  <KpiTile label="Orders" value={formatNumber(data.sales)} fromDate={data.from} />
                  <KpiTile
                    label="AOV"
                    value={data.sales > 0 ? formatCurrency(data.revenue / data.sales) : "-"}
                    fromDate={data.from}
                  />
                </>
              ) : (
                <>
                  <KpiTile label="Leads" value={formatNumber(data.leads)} fromDate={data.from} />
                  <KpiTile label="Sales" value={formatNumber(data.sales)} fromDate={data.from} />
                </>
              )}
            </div>
          </div>
        </>
      )}

      {data && view === "pro" && (
        <>
          <HeroKpiRow data={data} />

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <StatChartCard
                title="Profitability"
                data={data.series.map((p) => ({ label: p.date, cost: p.cost, revenue: p.revenue, profit: p.trueProfit }))}
                stats={[
                  { key: "cost", label: "Ad Spend", value: formatCurrency(data.cost), color: "var(--color-chart-2)" },
                  { key: "revenue", label: "Total Revenue", value: formatCurrency(data.revenue), color: "var(--color-chart-1)" },
                  { key: "profit", label: "Profit", value: formatCurrency(data.trueProfit), color: "var(--color-chart-3)" },
                ]}
                series={[
                  { key: "revenue", label: "Revenue", color: "var(--color-chart-1)" },
                  { key: "cost", label: "Ad Spend", color: "var(--color-chart-2)" },
                  { key: "profit", label: "Profit", color: "var(--color-chart-3)", fillArea: false },
                ]}
              />
            </div>
            {isEcomLike(niche) ? (
              <CartConversionCard clientId={clientId} range={range} />
            ) : (
              <ConversionCard leads={data.leads} sales={data.sales} />
            )}
          </div>

          <NicheSnapshotRow
            clientId={clientId}
            range={range}
            niche={niche}
            aov={data.sales > 0 ? data.revenue / data.sales : null}
          />

          <BudgetPacingCard clientId={clientId} />

          <ForecastSection clientId={clientId} />

          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            <BestPerformingCard clientId={clientId} range={range} goal={goal} />
            <Card className="px-4">
              <InsightsPanel
                clientId={clientId}
                scope={{ type: "client" }}
                queryKeyExtra={["client"]}
                title="Insights"
                compact
                viewAllHref={`/clients/${clientId}/insights`}
              />
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
