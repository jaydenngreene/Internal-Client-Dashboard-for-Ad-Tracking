"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getCohorts } from "@/lib/api";
import { CohortTable } from "@/components/cohort-table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { SegmentedToggle } from "@/components/segmented-toggle";
import { ClientKicker } from "@/components/client-kicker";

const MONTH_OPTIONS: { value: string; label: string }[] = [
  { value: "6", label: "6mo" },
  { value: "12", label: "12mo" },
  { value: "24", label: "24mo" },
];

export function CohortsClient({ clientId }: { clientId: string }) {
  const [months, setMonths] = useState("12");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["cohorts", clientId, months],
    queryFn: () => getCohorts(clientId, parseInt(months, 10)),
  });

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <ClientKicker clientId={clientId} />
          <h1 className="text-lg font-semibold">LTV Cohorts</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Customers grouped by acquisition month, using the same trailing-window LTV snapshots as the LTV report, refreshed nightly
          </p>
        </div>
        <SegmentedToggle value={months} onChange={setMonths} options={MONTH_OPTIONS} />
      </div>

      {isError && (
        <p className="text-sm text-status-critical">Failed to load report. Is the API running?</p>
      )}

      {isLoading && <Skeleton className="h-96 w-full" />}

      {data && (
        <Card className="px-0">
          <CardHeader className="px-4">
            <CardTitle>Cohorts</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto px-0">
            <CohortTable cohorts={data.cohorts} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
