"use client";

import { useQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { getCreativeTagPerformance, CreativeTagPerformanceRow } from "@/lib/api";
import { formatCurrency, formatRoas } from "@/lib/format";
import { TAG_LABEL, DIMENSION_LABEL } from "@/lib/creative-tag-labels";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ClientKicker } from "@/components/client-kicker";
import { cn } from "@/lib/utils";

// "What KIND of creative wins," not just which specific ad — aggregates every
// AI-tagged creative's real spend/revenue by hook type/angle/tone (generate tags
// from a creative's detail page first; nothing here re-runs the AI itself, this
// is purely a read over already-generated tags).
function DimensionSection({ label, rows }: { label: string; rows: CreativeTagPerformanceRow[] }) {
  if (rows.length === 0) return null;
  return (
    <Card className="px-4">
      <CardHeader className="px-0">
        <CardTitle className="text-sm">{label}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 px-0">
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
      </CardContent>
    </Card>
  );
}

export function CreativePatternsClient({ clientId }: { clientId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["creative-tag-performance", clientId],
    queryFn: () => getCreativeTagPerformance(clientId),
  });

  const byDimension = (dim: CreativeTagPerformanceRow["dimension"]) =>
    (data ?? []).filter((r) => r.dimension === dim);

  return (
    <div className="flex flex-col gap-4 p-6">
      <div>
        <ClientKicker clientId={clientId} />
        <h1 className="flex items-center gap-1.5 text-lg font-semibold">
          <Sparkles className="size-4 text-primary" /> Creative Patterns
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Real spend/revenue for every AI-tagged creative, grouped by hook type, angle, and tone — answers "what kind
          of creative wins," not just which specific ad does. Generate tags from any creative's detail page first;
          this page only aggregates what's already been tagged.
        </p>
      </div>

      {isLoading && <Skeleton className="h-64 w-full" />}

      {data && data.length === 0 && (
        <Card className="px-4 py-8">
          <CardContent className="px-0 text-center text-sm text-muted-foreground">
            No tagged creatives yet — open a creative's detail page under Campaigns and click "Generate tags."
          </CardContent>
        </Card>
      )}

      {data && data.length > 0 && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <DimensionSection label={DIMENSION_LABEL.hook_type} rows={byDimension("hook_type")} />
          <DimensionSection label={DIMENSION_LABEL.angle} rows={byDimension("angle")} />
          <DimensionSection label={DIMENSION_LABEL.tone} rows={byDimension("tone")} />
        </div>
      )}
    </div>
  );
}
