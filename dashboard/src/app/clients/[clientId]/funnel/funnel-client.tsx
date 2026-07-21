"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getTof, getMof, getBof, getCalls, getClients } from "@/lib/api";
import { RangePreset, resolveRange } from "@/lib/date-range";
import { formatCurrency, formatNumber, formatPercent, formatDuration } from "@/lib/format";
import { DateRangeSelect } from "@/components/date-range-select";
import { SegmentedToggle } from "@/components/segmented-toggle";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

type Stage = "tof" | "mof" | "bof";

const STAGE_OPTIONS: { value: Stage; label: string }[] = [
  { value: "tof", label: "TOF" },
  { value: "mof", label: "MOF" },
  { value: "bof", label: "BOF" },
];

const STAGE_SUBTITLE: Record<Stage, string> = {
  tof: "Top of funnel — leads coming in and what they cost",
  mof: "Middle of funnel — engagement between first click and conversion",
  bof: "Bottom of funnel — who actually buys, how fast, and what sticks",
};

export function FunnelClient({ clientId }: { clientId: string }) {
  const [preset, setPreset] = useState<RangePreset>("30d");
  const [stage, setStage] = useState<Stage>("tof");
  const range = resolveRange(preset);

  const tof = useQuery({
    queryKey: ["tof", clientId, range.from, range.to],
    queryFn: () => getTof(clientId, range),
    enabled: stage === "tof",
  });
  const mof = useQuery({
    queryKey: ["mof", clientId, range.from, range.to],
    queryFn: () => getMof(clientId, range),
    enabled: stage === "mof",
  });
  const bof = useQuery({
    queryKey: ["bof", clientId, range.from, range.to],
    queryFn: () => getBof(clientId, range),
    enabled: stage === "bof",
  });

  const active = stage === "tof" ? tof : stage === "mof" ? mof : bof;

  const { data: clients } = useQuery({ queryKey: ["clients"], queryFn: getClients });
  const niche = clients?.find((c) => c.id === clientId)?.niche;
  const isEcommerce = niche === "ecommerce";
  const isCallBased = niche === "call";

  const calls = useQuery({
    queryKey: ["calls", clientId, range.from, range.to],
    queryFn: () => getCalls(clientId, range),
    enabled: stage === "bof" && isCallBased,
  });

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Funnel</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">{STAGE_SUBTITLE[stage]}</p>
        </div>
        <div className="flex items-center gap-3">
          <SegmentedToggle value={stage} onChange={setStage} options={STAGE_OPTIONS} />
          <DateRangeSelect value={preset} onChange={setPreset} />
        </div>
      </div>

      {active.isError && (
        <p className="text-sm text-status-critical">Failed to load report. Is the API running?</p>
      )}

      {active.isLoading && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      )}

      {stage === "tof" && tof.data && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Card className="px-4">
            <CardContent className="px-0">
              <p className="text-xs font-medium text-muted-foreground">Total Leads</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{formatNumber(tof.data.totalLeads)}</p>
            </CardContent>
          </Card>
          <Card className="px-4">
            <CardContent className="px-0">
              <p className="text-xs font-medium text-muted-foreground">Cost Per Lead</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">
                {tof.data.cpl === null ? "—" : formatCurrency(tof.data.cpl)}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {stage === "mof" && mof.data && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Card className="px-4">
              <CardContent className="px-0">
                <p className="text-xs font-medium text-muted-foreground">Sessions</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{formatNumber(mof.data.totalSessions)}</p>
              </CardContent>
            </Card>
            <Card className="px-4">
              <CardContent className="px-0">
                <p className="text-xs font-medium text-muted-foreground">Pageviews</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{formatNumber(mof.data.totalPageviews)}</p>
              </CardContent>
            </Card>
            <Card className="px-4">
              <CardContent className="px-0">
                <p className="text-xs font-medium text-muted-foreground">Avg Pageviews / Session</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">
                  {mof.data.avgPageviewsPerSession === null ? "—" : mof.data.avgPageviewsPerSession.toFixed(1)}
                </p>
              </CardContent>
            </Card>
            <Card className="px-4">
              <CardContent className="px-0">
                <p className="text-xs font-medium text-muted-foreground">Engagement Rate</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums text-chart-1">
                  {formatPercent(mof.data.engagementRate)}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {formatNumber(mof.data.engagedSessions)} sessions with a pageview
                </p>
              </CardContent>
            </Card>
          </div>

          {isEcommerce && (
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Ecommerce
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Card className="px-4">
                  <CardContent className="px-0">
                    <p className="text-xs font-medium text-muted-foreground">Product Views</p>
                    <p className="mt-1 text-2xl font-semibold tabular-nums">
                      {formatNumber(mof.data.viewContentCount)}
                    </p>
                  </CardContent>
                </Card>
                <Card className="px-4">
                  <CardContent className="px-0">
                    <p className="text-xs font-medium text-muted-foreground">Add to Cart</p>
                    <p className="mt-1 text-2xl font-semibold tabular-nums">
                      {formatNumber(mof.data.addToCartCount)}
                    </p>
                  </CardContent>
                </Card>
                <Card className="px-4">
                  <CardContent className="px-0">
                    <p className="text-xs font-medium text-muted-foreground">Checkout Initiated</p>
                    <p className="mt-1 text-2xl font-semibold tabular-nums">
                      {formatNumber(mof.data.initiateCheckoutCount)}
                    </p>
                  </CardContent>
                </Card>
                <Card className="px-4">
                  <CardContent className="px-0">
                    <p className="text-xs font-medium text-muted-foreground">Cart Abandonment</p>
                    <p className="mt-1 text-2xl font-semibold tabular-nums text-chart-2">
                      {formatPercent(mof.data.cartAbandonmentRate)}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {formatNumber(mof.data.abandonedCartCount)} carts, {formatCurrency(mof.data.abandonedCartValue)}
                    </p>
                  </CardContent>
                </Card>
              </div>
            </div>
          )}
        </>
      )}

      {stage === "bof" && bof.data && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Card className="px-4">
              <CardContent className="px-0">
                <p className="text-xs font-medium text-muted-foreground">Lead → Buyer Rate</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">
                  {formatPercent(bof.data.leadToBuyerRate)}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {formatNumber(bof.data.convertedLeads)} of {formatNumber(bof.data.totalLeads)} leads
                </p>
              </CardContent>
            </Card>
            <Card className="px-4">
              <CardContent className="px-0">
                <p className="text-xs font-medium text-muted-foreground">Avg Days to Convert</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">
                  {bof.data.avgDaysToConvert === null ? "—" : bof.data.avgDaysToConvert.toFixed(1)}
                </p>
              </CardContent>
            </Card>
            <Card className="px-4">
              <CardContent className="px-0">
                <p className="text-xs font-medium text-muted-foreground">Refund Rate</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums text-chart-2">
                  {formatPercent(bof.data.refundRate)}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {formatNumber(bof.data.refundedOrders)} of {formatNumber(bof.data.totalOrders)} orders
                </p>
              </CardContent>
            </Card>
            <Card className="px-4">
              <CardContent className="px-0">
                <p className="text-xs font-medium text-muted-foreground">Total Orders</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{formatNumber(bof.data.totalOrders)}</p>
              </CardContent>
            </Card>
          </div>

          <Card className="px-0">
            <CardHeader className="px-4">
              <CardTitle>AOV by Source</CardTitle>
            </CardHeader>
            <CardContent className="px-0">
              {bof.data.aovBySource.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                  No non-refunded orders in this range yet.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                        Source
                      </TableHead>
                      <TableHead className="text-right text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                        AOV
                      </TableHead>
                      <TableHead className="text-right text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                        Sales
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {bof.data.aovBySource.map((row) => (
                      <TableRow key={row.source}>
                        <TableCell className="font-medium">{row.source}</TableCell>
                        <TableCell className="text-right tabular-nums text-chart-1">
                          {formatCurrency(row.aov)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{formatNumber(row.sales)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {isCallBased && calls.data && (
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">Calls</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Card className="px-4">
                  <CardContent className="px-0">
                    <p className="text-xs font-medium text-muted-foreground">Total Calls</p>
                    <p className="mt-1 text-2xl font-semibold tabular-nums">{formatNumber(calls.data.totalCalls)}</p>
                  </CardContent>
                </Card>
                <Card className="px-4">
                  <CardContent className="px-0">
                    <p className="text-xs font-medium text-muted-foreground">Qualified Rate</p>
                    <p className="mt-1 text-2xl font-semibold tabular-nums text-chart-1">
                      {formatPercent(calls.data.qualifiedRate)}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {formatNumber(calls.data.qualifiedCalls)} of {formatNumber(calls.data.totalCalls)} calls
                    </p>
                  </CardContent>
                </Card>
                <Card className="px-4">
                  <CardContent className="px-0">
                    <p className="text-xs font-medium text-muted-foreground">Avg Call Duration</p>
                    <p className="mt-1 text-2xl font-semibold tabular-nums">
                      {calls.data.avgDurationSeconds === null ? "—" : formatDuration(calls.data.avgDurationSeconds)}
                    </p>
                  </CardContent>
                </Card>
                <Card className="px-4">
                  <CardContent className="px-0">
                    <p className="text-xs font-medium text-muted-foreground">Top Campaign</p>
                    <p className="mt-1 truncate text-lg font-semibold">
                      {calls.data.byCampaign[0]?.campaign_name ?? "—"}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {calls.data.byCampaign[0] ? `${formatNumber(calls.data.byCampaign[0].calls)} calls` : ""}
                    </p>
                  </CardContent>
                </Card>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
