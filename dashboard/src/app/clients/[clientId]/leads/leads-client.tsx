"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getLeads } from "@/lib/api";
import { RangePreset, resolveRange } from "@/lib/date-range";
import { formatCurrency, formatNumber } from "@/lib/format";
import { DateRangeSelect } from "@/components/date-range-select";
import { LeadsTable } from "@/components/leads-table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function LeadsClient({ clientId }: { clientId: string }) {
  const [preset, setPreset] = useState<RangePreset>("30d");
  const range = resolveRange(preset);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["leads", clientId, range.from, range.to],
    queryFn: () => getLeads(clientId, range),
  });

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Leads</h1>
        <DateRangeSelect value={preset} onChange={setPreset} />
      </div>

      {isError && (
        <p className="text-sm text-status-critical">Failed to load report. Is the API running?</p>
      )}

      {isLoading && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      )}

      {data && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Card className="px-4">
              <CardContent className="px-0">
                <p className="text-xs font-medium text-muted-foreground">Total Leads</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{formatNumber(data.totalLeads)}</p>
              </CardContent>
            </Card>
            <Card className="px-4">
              <CardContent className="px-0">
                <p className="text-xs font-medium text-muted-foreground">Cost Per Lead</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">
                  {data.cpl === null ? "—" : formatCurrency(data.cpl)}
                </p>
              </CardContent>
            </Card>
          </div>

          <Card className="px-0">
            <CardHeader className="px-4">
              <CardTitle>Leads by Campaign</CardTitle>
            </CardHeader>
            <CardContent className="px-0">
              <LeadsTable campaigns={data.campaigns} />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
