"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getBof } from "@/lib/api";
import { RangePreset, resolveRange } from "@/lib/date-range";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/format";
import { DateRangeSelect } from "@/components/date-range-select";
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

export function BofClient({ clientId }: { clientId: string }) {
  const [preset, setPreset] = useState<RangePreset>("30d");
  const range = resolveRange(preset);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["bof", clientId, range.from, range.to],
    queryFn: () => getBof(clientId, range),
  });

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Bottom of Funnel</h1>
        <DateRangeSelect value={preset} onChange={setPreset} />
      </div>

      {isError && (
        <p className="text-sm text-status-critical">Failed to load report. Is the API running?</p>
      )}

      {isLoading && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      )}

      {data && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Card className="px-4">
              <CardContent className="px-0">
                <p className="text-xs font-medium text-muted-foreground">Lead → Buyer Rate</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">
                  {formatPercent(data.leadToBuyerRate)}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {formatNumber(data.convertedLeads)} of {formatNumber(data.totalLeads)} leads
                </p>
              </CardContent>
            </Card>
            <Card className="px-4">
              <CardContent className="px-0">
                <p className="text-xs font-medium text-muted-foreground">Avg Days to Convert</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">
                  {data.avgDaysToConvert === null ? "—" : data.avgDaysToConvert.toFixed(1)}
                </p>
              </CardContent>
            </Card>
            <Card className="px-4">
              <CardContent className="px-0">
                <p className="text-xs font-medium text-muted-foreground">Refund Rate</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums text-chart-2">
                  {formatPercent(data.refundRate)}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {formatNumber(data.refundedOrders)} of {formatNumber(data.totalOrders)} orders
                </p>
              </CardContent>
            </Card>
            <Card className="px-4">
              <CardContent className="px-0">
                <p className="text-xs font-medium text-muted-foreground">Total Orders</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{formatNumber(data.totalOrders)}</p>
              </CardContent>
            </Card>
          </div>

          <Card className="px-0">
            <CardHeader className="px-4">
              <CardTitle>AOV by Source</CardTitle>
            </CardHeader>
            <CardContent className="px-0">
              {data.aovBySource.length === 0 ? (
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
                    {data.aovBySource.map((row) => (
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
        </>
      )}
    </div>
  );
}
