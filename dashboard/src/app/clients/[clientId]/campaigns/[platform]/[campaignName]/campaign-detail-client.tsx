"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ImageIcon, PlayIcon } from "lucide-react";
import { getCampaignDetail, getClients, campaignGoalForNiche, CampaignCreativeRow } from "@/lib/api";
import { useDateRangeState } from "@/lib/date-range";
import { InsightsPanel } from "@/components/insights-panel";
import { StatTile } from "@/components/stat-tile";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency, formatNumber, formatPercent, formatRoas, formatPlatformLabel } from "@/lib/format";

// Small, inline-stats creative list — same idea as Meta Ads Manager's campaign-level ad
// list: a compact thumbnail + name + the numbers that matter, visible WITHOUT clicking
// in; clicking the row goes to the full creative detail page (the actual image/video,
// full stats, and the customers who converted through it).
function CreativeRowCard({
  creative,
  href,
  goal,
}: {
  creative: CampaignCreativeRow;
  href: string;
  goal: "leads" | "sales";
}) {
  const router = useRouter();
  return (
    <div
      onClick={() => router.push(href)}
      className="flex cursor-pointer items-center gap-3 rounded-lg border border-border p-2.5 hover:bg-accent/40"
    >
      <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
        {creative.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={creative.thumbnailUrl} alt={creative.name} className="size-full object-cover" />
        ) : creative.assetType === "video" ? (
          <PlayIcon className="size-5 text-muted-foreground" />
        ) : (
          <ImageIcon className="size-5 text-muted-foreground" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium">{creative.name}</p>
          {!creative.matched && (
            <Badge variant="outline" className="shrink-0 text-[10px] text-status-warning border-status-warning/40">
              unmatched
            </Badge>
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          <span>{creative.matched ? formatCurrency(creative.cost) : "-"} spend</span>
          {goal === "leads" ? (
            <span>{formatNumber(creative.leads)} leads</span>
          ) : (
            <span>{formatNumber(creative.sales)} purchases</span>
          )}
          <span className="text-chart-1">{formatCurrency(creative.revenue)} revenue</span>
          {goal === "sales" && <span>{formatRoas(creative.roas)} ROAS</span>}
          <span>{formatPercent(creative.ctr)} CTR</span>
        </div>
      </div>
    </div>
  );
}

export function CampaignDetailClient({
  clientId,
  platform,
  campaignName,
}: {
  clientId: string;
  platform: string;
  campaignName: string;
}) {
  const { range } = useDateRangeState("30d");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["campaign-detail", clientId, platform, campaignName, range.from, range.to],
    queryFn: () => getCampaignDetail(clientId, platform, campaignName, range),
  });
  const { data: clients } = useQuery({ queryKey: ["clients"], queryFn: getClients });
  const niche = clients?.find((c) => c.id === clientId)?.niche;
  const goal = campaignGoalForNiche(niche ?? "other");

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <Link
            href={`/clients/${clientId}/campaigns`}
            className="mb-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" /> Back to Campaigns
          </Link>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold">{campaignName}</h1>
            {formatPlatformLabel(platform) && <Badge variant="secondary">{formatPlatformLabel(platform)}</Badge>}
          </div>
        </div>
      </div>

      {isError && <p className="text-sm text-status-critical">Failed to load campaign. Is the API running?</p>}

      {isLoading && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      )}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label="Ad Spend" value={formatCurrency(data.kpis.cost)} />
            <StatTile label="CTR" value={formatPercent(data.kpis.ctr)} />
            {goal === "leads" ? (
              <>
                <StatTile label="Leads" value={formatNumber(data.kpis.leads)} />
                <StatTile label="CPL" value={data.kpis.cpl === null ? "-" : formatCurrency(data.kpis.cpl)} />
              </>
            ) : (
              <>
                <StatTile label="Purchases" value={formatNumber(data.kpis.sales)} />
                <StatTile
                  label="Ad Spend / Purchase"
                  value={data.kpis.sales > 0 ? formatCurrency(data.kpis.cost / data.kpis.sales) : "-"}
                />
              </>
            )}
            <StatTile label="Revenue" value={formatCurrency(data.kpis.revenue)} tone="positive" />
            <StatTile
              label="Profit"
              value={formatCurrency(data.kpis.trueProfit)}
              tone={data.kpis.trueProfit >= 0 ? "positive" : "negative"}
            />
            {goal === "sales" && <StatTile label="ROAS" value={formatRoas(data.kpis.roas)} />}
            <StatTile label="Impressions" value={formatNumber(data.kpis.impressions)} />
            {goal === "sales" && (
              <StatTile label="CPM" value={data.kpis.cpm === null ? "-" : formatCurrency(data.kpis.cpm)} />
            )}
          </div>

          <InsightsPanel
            clientId={clientId}
            scope={{ type: "campaign", platform, campaignName }}
            queryKeyExtra={["campaign", platform, campaignName]}
            title="Campaign Insight"
            compact
          />

          <div className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold">Creatives ({data.creatives.length})</h2>
            {data.creatives.length === 0 ? (
              <Card className="px-4 py-8">
                <CardContent className="px-0 text-center text-sm text-muted-foreground">
                  No creative-level spend, leads, or revenue in this range yet.
                </CardContent>
              </Card>
            ) : (
              <div className="flex flex-col gap-2">
                {data.creatives.map((c) => (
                  <CreativeRowCard
                    key={c.name}
                    creative={c}
                    goal={goal}
                    href={`/clients/${clientId}/campaigns/${encodeURIComponent(platform)}/${encodeURIComponent(campaignName)}/creatives/${encodeURIComponent(c.name)}`}
                  />
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
