"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getInsights, regenerateInsights, Insight, InsightScope } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

const PRIORITY_VARIANT: Record<Insight["priority"], "destructive" | "outline" | "secondary"> = {
  high: "destructive",
  medium: "outline",
  low: "secondary",
};

function InsightCard({ insight }: { insight: Insight }) {
  return (
    <Card className="px-4 py-3">
      <CardContent className="flex flex-col gap-1.5 px-0">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-medium">{insight.title}</p>
          <Badge variant={PRIORITY_VARIANT[insight.priority]} className="shrink-0">
            {insight.priority}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">{insight.detail}</p>
      </CardContent>
    </Card>
  );
}

// Reused at every insight scope (whole-account on the Insights tab, one platform, one
// campaign, one creative) — same generate/regenerate/stale-cache UX throughout, just a
// different scope + query key per caller.
export function InsightsPanel({
  clientId,
  scope,
  queryKeyExtra,
  title = "Insights",
  compact = false,
}: {
  clientId: string;
  scope?: InsightScope;
  queryKeyExtra: (string | undefined)[];
  title?: string;
  compact?: boolean;
}) {
  const queryClient = useQueryClient();
  const queryKey = ["insights", clientId, ...queryKeyExtra];

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => getInsights(clientId, scope),
  });

  const mutation = useMutation({
    mutationFn: () => regenerateInsights(clientId, scope),
    onSuccess: (result) => {
      queryClient.setQueryData(queryKey, result);
    },
  });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className={compact ? "text-sm font-semibold" : "text-lg font-semibold"}>{title}</h2>
        <Button size={compact ? "xs" : "default"} onClick={() => mutation.mutate()} disabled={mutation.isPending}>
          {mutation.isPending ? "Generating…" : data ? "Regenerate" : "Generate insights"}
        </Button>
      </div>

      {(isLoading || mutation.isPending) && (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      )}

      {!isLoading && !mutation.isPending && !data && (
        <Card className="px-4 py-8">
          <CardContent className="px-0 text-center text-sm text-muted-foreground">
            No insights generated yet. Click &quot;Generate insights&quot; to analyze the last 30 days.
          </CardContent>
        </Card>
      )}

      {!mutation.isPending && data?.error && (
        <p className="text-sm text-status-critical">Last generation failed: {data.error}</p>
      )}

      {!mutation.isPending && data && !data.error && (
        <>
          <p className="text-xs text-muted-foreground">
            Generated {new Date(data.generated_at).toLocaleString()}
          </p>
          {data.insights.length === 0 ? (
            <Card className="px-4 py-8">
              <CardHeader className="px-0">
                <CardTitle className="text-sm">No recommendations</CardTitle>
              </CardHeader>
              <CardContent className="px-0 text-sm text-muted-foreground">
                Not enough data in this range to generate meaningful recommendations yet.
              </CardContent>
            </Card>
          ) : (
            <div className="flex flex-col gap-3">
              {data.insights.map((insight, i) => (
                <InsightCard key={i} insight={insight} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
