"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getFunnel, campaignGoalForNiche, getClients } from "@/lib/api";
import { InsightsPanel } from "@/components/insights-panel";
import { CampaignBreakdownTable } from "@/components/campaign-breakdown-table";
import { useDateRangeState } from "@/lib/date-range";
import { SegmentedToggle } from "@/components/segmented-toggle";
import { Skeleton } from "@/components/ui/skeleton";
import { ClientKicker } from "@/components/client-kicker";
import { formatPlatformLabel } from "@/lib/format";

const ALL_PLATFORMS = "__all__";

// The old version of this tab was one whole-account insight and nothing else. Per the
// user's explicit ask: "overall insights should be per platform as well not overall
// overall" — a client running Facebook + Google + TikTok wants a separate insight per
// platform, plus the ability to browse into any individual campaign's own insight
// (generated fresh on that campaign's detail page) rather than only ever seeing one
// blended account-wide number.
export function InsightsClient({ clientId }: { clientId: string }) {
  const { range } = useDateRangeState("30d");
  const [platform, setPlatform] = useState<string>(ALL_PLATFORMS);

  const funnelQuery = useQuery({
    queryKey: ["campaigns", clientId, range.from, range.to, "campaign"],
    queryFn: () => getFunnel(clientId, range, "campaign"),
  });
  const { data: clients } = useQuery({ queryKey: ["clients"], queryFn: getClients });
  const niche = clients?.find((c) => c.id === clientId)?.niche;
  const goal = campaignGoalForNiche(niche ?? "other");

  const platforms = useMemo(() => {
    const seen = new Map<string, string>();
    for (const row of funnelQuery.data?.campaigns ?? []) {
      if (row.platform) seen.set(row.platform, formatPlatformLabel(row.platform) ?? row.platform);
    }
    return Array.from(seen.entries());
  }, [funnelQuery.data]);

  const platformOptions = [
    { value: ALL_PLATFORMS, label: "All Platforms" },
    ...platforms.map(([value, label]) => ({ value, label })),
  ];

  const filteredCampaigns = useMemo(() => {
    const rows = funnelQuery.data?.campaigns ?? [];
    if (platform === ALL_PLATFORMS) return rows;
    return rows.filter((r) => r.platform === platform);
  }, [funnelQuery.data, platform]);

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <ClientKicker clientId={clientId} />
          <h1 className="text-lg font-semibold">Insights</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            AI-generated recommendations, scoped to the whole account or a single platform. Click into any
            campaign below for its own campaign- and creative-level insights.
          </p>
        </div>
      </div>

      {platformOptions.length > 1 && (
        <SegmentedToggle value={platform} onChange={setPlatform} options={platformOptions} />
      )}

      <InsightsPanel
        clientId={clientId}
        scope={platform === ALL_PLATFORMS ? { type: "client" } : { type: "platform", platform }}
        queryKeyExtra={platform === ALL_PLATFORMS ? ["client"] : ["platform", platform]}
        title={platform === ALL_PLATFORMS ? "Whole Account" : `${formatPlatformLabel(platform) ?? platform} Overview`}
      />

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">
          Campaigns{platform !== ALL_PLATFORMS ? ` · ${formatPlatformLabel(platform) ?? platform}` : ""}
        </h2>
        <p className="text-xs text-muted-foreground">
          Click a campaign to see its own KPIs, creatives, and campaign-level insight.
        </p>
        {funnelQuery.isLoading && <Skeleton className="h-64 w-full" />}
        {!funnelQuery.isLoading && (
          <CampaignBreakdownTable
            rows={filteredCampaigns}
            nameColumnLabel="Campaign"
            goal={goal}
            showPlatformBadge={platform === ALL_PLATFORMS}
            getHref={(row) =>
              row.platform
                ? `/clients/${clientId}/campaigns/${encodeURIComponent(row.platform)}/${encodeURIComponent(row.name)}`
                : null
            }
          />
        )}
      </div>
    </div>
  );
}
