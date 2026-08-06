"use client";

import { useQuery } from "@tanstack/react-query";
import {
  getOverview,
  getTof,
  getMof,
  getBof,
  getFunnel,
  getAdBreakdown,
  getBuyingJourney,
  getLtv,
  getOrders,
  getClients,
  campaignGoalForNiche,
  AdBreakdownType,
} from "@/lib/api";
import { useDateRangeState } from "@/lib/date-range";
import { formatCurrency, formatNumber, formatPercent, formatRoas } from "@/lib/format";
import { vocabularyForNiche } from "@/lib/niche-vocabulary";
import { StatTile } from "@/components/stat-tile";
import { StatChartCard } from "@/components/stat-chart-card";
import { FunnelBars } from "@/components/funnel-bars";
import { CampaignBreakdownTable } from "@/components/campaign-breakdown-table";
import { LtvTable } from "@/components/ltv-table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ClientKicker } from "@/components/client-kicker";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { downloadCsv } from "@/lib/csv";

// `purchased_at` is a full TIMESTAMPTZ, not the bare YYYY-MM-DD date string
// `formatDateShort` expects (that helper appends its own "T00:00:00Z", which
// corrupts an already-full ISO timestamp into an invalid one) — needs its own
// formatter, same shape as leads-client.tsx's local `formatDateTime`.
function formatOrderDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

const AD_BREAKDOWN_TYPES: { type: AdBreakdownType; label: string }[] = [
  { type: "age", label: "Age" },
  { type: "gender", label: "Gender" },
  { type: "placement", label: "Placement" },
];

// One table per dimension, summed account-wide across every campaign — the
// per-campaign drill-down already exists on the dedicated Ad Breakdown tab,
// this page's job is "what's the account-wide shape," not re-deriving that.
function AdBreakdownDimensionCard({ clientId, from, to, type, label }: { clientId: string; from: string; to: string; type: AdBreakdownType; label: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["ad-breakdown", clientId, from, to, "campaign", type],
    queryFn: () => getAdBreakdown(clientId, { from, to }, "campaign", type),
  });

  if (isLoading) return <Skeleton className="h-48 w-full" />;

  const totals = new Map<string, number>();
  for (const row of data?.rows ?? []) {
    totals.set(row.breakdownValue, (totals.get(row.breakdownValue) ?? 0) + row.purchases);
  }
  const sorted = Array.from(totals.entries())
    .filter(([, purchases]) => purchases > 0)
    .sort((a, b) => b[1] - a[1]);

  return (
    <Card className="px-0">
      <CardHeader className="px-4">
        <CardTitle className="text-sm">{label}</CardTitle>
      </CardHeader>
      <CardContent className="px-0">
        {sorted.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-muted-foreground">No Facebook purchase data yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  {label}
                </TableHead>
                <TableHead className="text-right text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Purchases
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map(([value, purchases]) => (
                <TableRow key={value}>
                  <TableCell className="font-medium">{value}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(purchases)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

export function FullReportClient({ clientId }: { clientId: string }) {
  const { range } = useDateRangeState("30d");
  const { from, to } = range;

  const { data: clients } = useQuery({ queryKey: ["clients"], queryFn: getClients });
  const niche = clients?.find((c) => c.id === clientId)?.niche;
  const goal = campaignGoalForNiche(niche ?? "other");
  const vocab = vocabularyForNiche(niche);

  const overview = useQuery({
    queryKey: ["overview", clientId, from, to],
    queryFn: () => getOverview(clientId, range),
  });
  const tof = useQuery({ queryKey: ["tof", clientId, from, to], queryFn: () => getTof(clientId, range) });
  const mof = useQuery({ queryKey: ["mof", clientId, from, to], queryFn: () => getMof(clientId, range) });
  const bof = useQuery({ queryKey: ["bof", clientId, from, to], queryFn: () => getBof(clientId, range) });
  const campaigns = useQuery({
    queryKey: ["campaigns", clientId, from, to, "campaign"],
    queryFn: () => getFunnel(clientId, range, "campaign"),
  });
  const buyingJourney = useQuery({
    queryKey: ["buying-journey", clientId, from, to],
    queryFn: () => getBuyingJourney(clientId, range),
  });
  const ltv = useQuery({ queryKey: ["ltv", clientId, from, to], queryFn: () => getLtv(clientId, range) });
  const orders = useQuery({ queryKey: ["orders", clientId, from, to], queryFn: () => getOrders(clientId, range) });

  return (
    <div className="flex flex-col gap-8 p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <ClientKicker clientId={clientId} />
          <h1 className="text-lg font-semibold">Full Report</h1>
          <p className="mt-0.5 max-w-2xl text-xs text-muted-foreground">
            Every report this app tracks for the selected date range, in one place — KPIs, funnel health, campaign
            performance, ad breakdowns, customer buying journey, LTV, and the individual orders behind the numbers.
          </p>
          {/* The header bar's date-range picker is hidden in print (see globals.css/
              header-bar.tsx) since its dropdown/controls make no sense on paper —
              this line is the printed page's only record of which range the
              numbers below actually cover. Screen-hidden the rest of the time
              since the picker already shows this. */}
          <p className="mt-2 hidden text-xs text-muted-foreground print:block">
            {from} to {to} · exported {new Date().toLocaleDateString()}
          </p>
        </div>
        <Button size="sm" variant="outline" className="print:hidden" onClick={() => window.print()}>
          Export PDF
        </Button>
      </div>

      <Section title="Overview">
        {overview.isLoading && <Skeleton className="h-20 w-full" />}
        {overview.data && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <StatTile label="Cost" value={formatCurrency(overview.data.cost)} />
            <StatTile label="Revenue" value={formatCurrency(overview.data.revenue)} />
            <StatTile
              label="Profit"
              value={formatCurrency(overview.data.profit)}
              tone={overview.data.profit >= 0 ? "positive" : "negative"}
            />
            <StatTile label="Blended ROAS" value={formatRoas(overview.data.blendedRoas)} />
            <StatTile label="ROI" value={formatPercent(overview.data.roi)} />
            <StatTile label="Attribution Rate" value={formatPercent(overview.data.attributionRate)} />
          </div>
        )}
        {overview.data && (
          <StatChartCard
            title="Profitability"
            data={overview.data.series.map((p) => ({ label: p.date, cost: p.cost, revenue: p.revenue, profit: p.trueProfit }))}
            stats={[
              { key: "cost", label: "Ad Spend", value: formatCurrency(overview.data.cost), color: "var(--color-chart-2)" },
              { key: "revenue", label: "Total Revenue", value: formatCurrency(overview.data.revenue), color: "var(--color-chart-1)" },
              { key: "profit", label: "Profit", value: formatCurrency(overview.data.trueProfit), color: "var(--color-chart-3)" },
            ]}
            series={[
              { key: "revenue", label: "Revenue", color: "var(--color-chart-1)" },
              { key: "cost", label: "Ad Spend", color: "var(--color-chart-2)" },
              { key: "profit", label: "Profit", color: "var(--color-chart-3)", fillArea: false },
            ]}
          />
        )}
      </Section>

      <Section title="Funnel Health" subtitle="Top / middle / bottom of funnel, side by side instead of tabbed.">
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          <Card className="px-4">
            <CardHeader className="px-0">
              <CardTitle className="text-sm">Top of Funnel</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 px-0">
              {tof.isLoading && <Skeleton className="h-16 w-full" />}
              {tof.data && (
                <>
                  <p className="text-xl font-semibold tabular-nums">
                    {goal === "sales" ? formatNumber(tof.data.totalPurchases) : formatNumber(tof.data.totalLeads)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {goal === "sales" ? "purchases" : "leads"} ·{" "}
                    {goal === "sales"
                      ? tof.data.costPerPurchase !== null
                        ? formatCurrency(tof.data.costPerPurchase) + "/purchase"
                        : "—"
                      : tof.data.cpl !== null
                        ? formatCurrency(tof.data.cpl) + "/lead"
                        : "—"}
                  </p>
                </>
              )}
            </CardContent>
          </Card>
          <Card className="px-4">
            <CardHeader className="px-0">
              <CardTitle className="text-sm">Middle of Funnel</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 px-0">
              {mof.isLoading && <Skeleton className="h-16 w-full" />}
              {mof.data && (
                <>
                  <p className="text-xl font-semibold tabular-nums">{formatNumber(mof.data.totalSessions)}</p>
                  <p className="text-xs text-muted-foreground">
                    sessions · {formatPercent(mof.data.engagementRate)} engaged
                  </p>
                </>
              )}
            </CardContent>
          </Card>
          <Card className="px-4">
            <CardHeader className="px-0">
              <CardTitle className="text-sm">Bottom of Funnel</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 px-0">
              {bof.isLoading && <Skeleton className="h-16 w-full" />}
              {bof.data && (
                <>
                  <p className="text-xl font-semibold tabular-nums">{formatNumber(bof.data.totalOrders)}</p>
                  <p className="text-xs text-muted-foreground">
                    orders · {formatPercent(bof.data.refundRate)} refund rate
                  </p>
                </>
              )}
            </CardContent>
          </Card>
        </div>
        {mof.data && tof.data && bof.data && (
          <Card className="px-4">
            <CardHeader className="px-0">
              <CardTitle className="text-sm">Sessions → {goal === "sales" ? "Purchases" : "Leads"} → Orders</CardTitle>
            </CardHeader>
            <CardContent className="px-0">
              <FunnelBars
                stages={[
                  { label: "Sessions", value: mof.data.totalSessions },
                  {
                    label: goal === "sales" ? "Purchases" : "Leads",
                    value: goal === "sales" ? tof.data.totalPurchases : tof.data.totalLeads,
                  },
                  { label: "Orders", value: bof.data.totalOrders },
                ]}
              />
            </CardContent>
          </Card>
        )}
      </Section>

      <Section title="Campaign Performance">
        {campaigns.isLoading && <Skeleton className="h-96 w-full" />}
        {campaigns.data && (
          <Card className="px-0">
            <CardContent className="px-0">
              <CampaignBreakdownTable rows={campaigns.data.campaigns} nameColumnLabel="Campaign" goal={goal} />
            </CardContent>
          </Card>
        )}
      </Section>

      <Section
        title="Ad Breakdown"
        subtitle="Meta-attributed purchases by age/gender/placement, summed across every campaign. Facebook-only — see the Ad Breakdown tab for per-campaign detail."
      >
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          {AD_BREAKDOWN_TYPES.map(({ type, label }) => (
            <AdBreakdownDimensionCard key={type} clientId={clientId} from={from} to={to} type={type} label={label} />
          ))}
        </div>
      </Section>

      <Section title="Customer Buying Journey">
        {buyingJourney.isLoading && <Skeleton className="h-48 w-full" />}
        {buyingJourney.data && (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <StatTile
                label="Avg days to convert"
                value={buyingJourney.data.avgDaysToConvert !== null ? buyingJourney.data.avgDaysToConvert.toFixed(1) : "—"}
              />
              <StatTile
                label="Avg sessions to convert"
                value={buyingJourney.data.avgSessionsToConvert !== null ? buyingJourney.data.avgSessionsToConvert.toFixed(1) : "—"}
              />
            </div>
            {buyingJourney.data.people.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No {vocab.personNoun.toLowerCase()}s converted in this range.
              </p>
            ) : (
              <Card className="px-0">
                <CardHeader className="px-4">
                  <CardTitle className="text-sm">
                    Top converters {buyingJourney.data.people.length > 10 && `(top 10 of ${buyingJourney.data.people.length})`}
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-0">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Email</TableHead>
                        <TableHead className="text-right text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Conversions</TableHead>
                        {vocab.valueColumnLabel && (
                          <TableHead className="text-right text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                            {vocab.valueColumnLabel}
                          </TableHead>
                        )}
                        <TableHead className="text-right text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Sessions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {[...buyingJourney.data.people]
                        .sort((a, b) => (b.totalValue ?? 0) - (a.totalValue ?? 0))
                        .slice(0, 10)
                        .map((p) => (
                          <TableRow key={p.identifier}>
                            <TableCell className="font-medium">{p.identifier}</TableCell>
                            <TableCell className="text-right tabular-nums">{formatNumber(p.conversionCount)}</TableCell>
                            {vocab.valueColumnLabel && (
                              <TableCell className="text-right tabular-nums">
                                {p.totalValue !== null ? formatCurrency(p.totalValue) : "—"}
                              </TableCell>
                            )}
                            <TableCell className="text-right tabular-nums">{p.sessionsToConvert ?? "—"}</TableCell>
                          </TableRow>
                        ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </Section>

      <Section title="LTV by Acquisition Campaign">
        {ltv.isLoading && <Skeleton className="h-64 w-full" />}
        {ltv.data && (
          <Card className="px-0">
            <CardContent className="overflow-x-auto px-0">
              <LtvTable campaigns={ltv.data.campaigns} predictiveLtvAvailable={ltv.data.predictiveLtvAvailable} />
            </CardContent>
          </Card>
        )}
      </Section>

      <Section
        title="Orders"
        subtitle={
          orders.data
            ? orders.data.truncated
              ? `Showing the most recent 500 of ${formatNumber(orders.data.total)} orders in this range.`
              : `${formatNumber(orders.data.total)} order${orders.data.total === 1 ? "" : "s"} in this range.`
            : undefined
        }
      >
        {orders.isLoading && <Skeleton className="h-96 w-full" />}
        {orders.data && orders.data.orders.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">No orders in this range.</p>
        )}
        {orders.data && orders.data.orders.length > 0 && (
          <Card className="px-0">
            <CardHeader className="flex flex-row items-center justify-between px-4">
              <CardTitle className="text-sm">Order Detail</CardTitle>
              <Button
                size="xs"
                variant="outline"
                className="print:hidden"
                onClick={() =>
                  downloadCsv(
                    "orders.csv",
                    orders.data!.orders.map((o) => ({
                      date: formatOrderDate(o.purchasedAt),
                      orderId: o.orderId ?? "",
                      email: o.email,
                      revenue: o.revenue,
                      refunded: o.refunded,
                      campaign: o.campaign ?? "",
                      source: o.source ?? "",
                    })),
                    [
                      { key: "date", label: "Date" },
                      { key: "orderId", label: "Order ID" },
                      { key: "email", label: "Email" },
                      { key: "revenue", label: "Revenue" },
                      { key: "refunded", label: "Refunded" },
                      { key: "campaign", label: "Campaign" },
                      { key: "source", label: "Source" },
                    ]
                  )
                }
              >
                Export CSV
              </Button>
            </CardHeader>
            {/* The 600px scroll cap is a screen-only convenience (500 orders would
                otherwise make this the longest thing on the page) — printing needs
                every row to actually flow across pages instead of being clipped to
                whatever fit in that scroll box. */}
            <CardContent className="max-h-[600px] overflow-y-auto px-0 print:max-h-none print:overflow-visible">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Date</TableHead>
                    <TableHead className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Email</TableHead>
                    <TableHead className="text-right text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Revenue</TableHead>
                    <TableHead className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Campaign</TableHead>
                    <TableHead className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Source</TableHead>
                    <TableHead className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orders.data.orders.map((o) => (
                    <TableRow key={o.id}>
                      <TableCell className="whitespace-nowrap text-xs">{formatOrderDate(o.purchasedAt)}</TableCell>
                      <TableCell className="max-w-48 truncate">{o.email}</TableCell>
                      <TableCell className="text-right tabular-nums text-chart-1">{formatCurrency(o.revenue)}</TableCell>
                      <TableCell className="max-w-40 truncate text-xs">{o.campaign ?? "—"}</TableCell>
                      <TableCell className="text-xs">{o.source ?? "—"}</TableCell>
                      <TableCell>
                        {o.refunded ? (
                          <Badge variant="destructive" className="text-[10px]">refunded</Badge>
                        ) : !o.matched ? (
                          <Badge variant="outline" className="text-status-warning border-status-warning/40 text-[10px]">
                            unattributed
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-[10px]">attributed</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </Section>
    </div>
  );
}
