"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getCampaigns } from "@/lib/api";
import { RangePreset, resolveRange } from "@/lib/date-range";
import { DateRangeSelect } from "@/components/date-range-select";
import { CampaignTable } from "@/components/campaign-table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function CampaignsClient({ clientId }: { clientId: string }) {
  const [preset, setPreset] = useState<RangePreset>("30d");
  const range = resolveRange(preset);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["campaigns", clientId, range.from, range.to],
    queryFn: () => getCampaigns(clientId, range),
  });

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Campaign Performance</h1>
        <DateRangeSelect value={preset} onChange={setPreset} />
      </div>

      {isError && (
        <p className="text-sm text-status-critical">Failed to load report. Is the API running?</p>
      )}

      {isLoading && <Skeleton className="h-96 w-full" />}

      {data && (
        <Card className="px-0">
          <CardHeader className="px-4">
            <CardTitle>Campaigns</CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            <CampaignTable campaigns={data.campaigns} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
