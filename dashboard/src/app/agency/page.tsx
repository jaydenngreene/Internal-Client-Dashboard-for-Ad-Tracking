"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { getAgencyOverview, AgencyClientRow } from "@/lib/api";
import { RangePreset, resolveRange } from "@/lib/date-range";
import { formatCurrency, formatRoas, formatPercent } from "@/lib/format";
import { DateRangeSelect } from "@/components/date-range-select";
import { DeltaBadge } from "@/components/delta-badge";
import { useRecentClientIds } from "@/lib/recent-clients";
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
import { cn } from "@/lib/utils";

type SortKey = keyof Pick<AgencyClientRow, "name" | "cost" | "revenue" | "profit" | "roas" | "roi">;

export default function AgencyOverviewPage() {
  const [preset, setPreset] = useState<RangePreset>("7d");
  const [sortKey, setSortKey] = useState<SortKey>("revenue");
  const [sortDesc, setSortDesc] = useState(true);
  const recentIds = useRecentClientIds();
  const range = resolveRange(preset);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["agency-overview", range.from, range.to],
    queryFn: () => getAgencyOverview(range),
  });

  const columns: { key: SortKey; label: string; align?: "right" }[] = [
    { key: "name", label: "Client" },
    { key: "cost", label: "Cost", align: "right" },
    { key: "revenue", label: "Revenue", align: "right" },
    { key: "profit", label: "Profit", align: "right" },
    { key: "roas", label: "ROAS", align: "right" },
    { key: "roi", label: "ROI", align: "right" },
  ];

  const sorted = data
    ? [...data.clients].sort((a, b) => {
        const av = a[sortKey];
        const bv = b[sortKey];
        if (typeof av === "string" || typeof bv === "string") {
          const cmp = String(av).localeCompare(String(bv));
          return sortDesc ? -cmp : cmp;
        }
        const an = av === null ? -Infinity : av;
        const bn = bv === null ? -Infinity : bv;
        const cmp = an - bn;
        return sortDesc ? -cmp : cmp;
      })
    : [];

  const recentClients = data
    ? recentIds
        .map((id) => data.clients.find((c) => c.id === id))
        .filter((c): c is AgencyClientRow => c !== undefined)
    : [];

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDesc((d) => !d);
    } else {
      setSortKey(key);
      setSortDesc(true);
    }
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Agency Overview</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">Every client&apos;s performance, side by side</p>
        </div>
        <DateRangeSelect value={preset} onChange={setPreset} />
      </div>

      {isError && (
        <p className="text-sm text-status-critical">Failed to load report. Is the API running?</p>
      )}

      {isLoading && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      )}

      {data && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Card className="px-4">
              <CardContent className="px-0">
                <p className="text-xs font-medium text-muted-foreground">Total Cost</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums text-chart-2">
                  {formatCurrency(data.totals.cost)}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">across {data.clients.length} client(s)</p>
              </CardContent>
            </Card>
            <Card className="px-4">
              <CardContent className="px-0">
                <p className="text-xs font-medium text-muted-foreground">Total Revenue</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums text-chart-1">
                  {formatCurrency(data.totals.revenue)}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">across {data.clients.length} client(s)</p>
              </CardContent>
            </Card>
            <Card className="px-4">
              <CardContent className="px-0">
                <p className="text-xs font-medium text-muted-foreground">Total Profit</p>
                <p
                  className={cn(
                    "mt-1 text-2xl font-semibold tabular-nums",
                    data.totals.trueProfit >= 0 ? "text-chart-1" : "text-chart-2"
                  )}
                >
                  {formatCurrency(data.totals.trueProfit)}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">across {data.clients.length} client(s)</p>
              </CardContent>
            </Card>
          </div>

          {recentClients.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Recently Viewed
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
                {recentClients.map((client) => (
                  <Link key={client.id} href={`/clients/${client.id}/overview`}>
                    <Card className="px-4 transition-colors hover:bg-secondary/40">
                      <CardContent className="px-0">
                        <p className="truncate text-sm font-medium">{client.name}</p>
                        <p className="mt-1 text-lg font-semibold tabular-nums text-chart-1">
                          {formatCurrency(client.revenue)}
                        </p>
                        <div className="mt-0.5">
                          <DeltaBadge pct={client.revenueChangePct} />
                          <span className="ml-1 text-xs text-muted-foreground">vs prior period</span>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            </div>
          )}

          <Card className="px-0">
            <CardHeader className="px-4">
              <CardTitle>Clients</CardTitle>
            </CardHeader>
            <CardContent className="px-0">
              {data.clients.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-muted-foreground">No clients yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      {columns.map((col) => (
                        <TableHead
                          key={col.key}
                          onClick={() => toggleSort(col.key)}
                          className={cn(
                            "cursor-pointer select-none text-[11px] font-medium uppercase tracking-wider text-muted-foreground",
                            col.align === "right" && "text-right"
                          )}
                        >
                          {col.label}
                          {sortKey === col.key && (sortDesc ? " ↓" : " ↑")}
                        </TableHead>
                      ))}
                      <TableHead className="text-right text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                        Revenue Δ
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sorted.map((client) => (
                      <TableRow key={client.id}>
                        <TableCell className="font-medium">
                          <Link
                            href={`/clients/${client.id}/overview`}
                            className="hover:underline hover:text-primary"
                          >
                            {client.name}
                          </Link>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{formatCurrency(client.cost)}</TableCell>
                        <TableCell className="text-right tabular-nums text-chart-1">
                          {formatCurrency(client.revenue)}
                        </TableCell>
                        <TableCell
                          className={cn(
                            "text-right tabular-nums",
                            client.trueProfit >= 0 ? "text-chart-1" : "text-chart-2"
                          )}
                        >
                          {formatCurrency(client.trueProfit)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{formatRoas(client.roas)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatPercent(client.roi)}</TableCell>
                        <TableCell className="text-right">
                          <DeltaBadge pct={client.revenueChangePct} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
