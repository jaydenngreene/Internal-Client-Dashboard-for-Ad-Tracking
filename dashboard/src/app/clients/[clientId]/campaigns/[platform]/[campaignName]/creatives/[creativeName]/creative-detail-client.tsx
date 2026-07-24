"use client";

import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ImageIcon, Sparkles } from "lucide-react";
import {
  getCreativeDetail,
  getClients,
  campaignGoalForNiche,
  CreativeDetailCopy,
  CreativeVideoMetrics,
  getCreativeTags,
  generateCreativeTagsFor,
} from "@/lib/api";
import { useDateRangeState } from "@/lib/date-range";
import { DateRangeSelect } from "@/components/date-range-select";
import { InsightsPanel } from "@/components/insights-panel";
import { StatTile } from "@/components/stat-tile";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency, formatNumber, formatPercent, formatRoas, formatPlatformLabel } from "@/lib/format";
import { TAG_LABEL } from "@/lib/creative-tag-labels";

function AssetPreview({ asset }: { asset: { thumbnailUrl: string | null; assetUrl: string | null; assetType: "image" | "video" | null } }) {
  if (asset.assetType === "video" && asset.assetUrl) {
    return (
      <video controls poster={asset.thumbnailUrl ?? undefined} className="max-h-96 w-full rounded-lg bg-black">
        <source src={asset.assetUrl} />
      </video>
    );
  }
  const imageUrl = asset.assetUrl ?? asset.thumbnailUrl;
  if (imageUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={imageUrl} alt="Ad creative" className="max-h-96 w-full rounded-lg object-contain bg-muted" />;
  }
  return (
    <div className="flex h-48 w-full flex-col items-center justify-center gap-2 rounded-lg bg-muted text-muted-foreground">
      <ImageIcon className="size-8" />
      <p className="text-xs">
        No creative asset synced yet for this platform. Facebook creative sync populates this automatically once
        connected. Other platforms don&apos;t pull it in yet.
      </p>
    </div>
  );
}

// Headline/primary text/description/landing page — the actual ad copy that ran
// alongside the asset, not just the image/video itself. Same "Facebook only for now"
// disclosure as the asset preview above.
function AdCopy({ copy }: { copy: CreativeDetailCopy }) {
  const hasAny = copy.headline || copy.primaryText || copy.description || copy.landingPageUrl;
  if (!hasAny) {
    return (
      <Card className="px-4 py-4">
        <CardContent className="px-0 text-sm text-muted-foreground">
          No ad copy synced yet for this platform. Facebook creative sync populates headline, primary text,
          description, and landing page automatically once connected - other platforms don&apos;t pull it in yet.
        </CardContent>
      </Card>
    );
  }
  return (
    <Card className="px-4 py-4">
      <CardHeader className="px-0">
        <CardTitle className="text-sm">Ad Copy</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-0">
        {copy.headline && (
          <div>
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Headline</p>
            <p className="text-base font-semibold">{copy.headline}</p>
          </div>
        )}
        {copy.primaryText && (
          <div>
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Primary text</p>
            <p className="text-sm text-foreground">{copy.primaryText}</p>
          </div>
        )}
        {copy.description && (
          <div>
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Description</p>
            <p className="text-sm text-muted-foreground">{copy.description}</p>
          </div>
        )}
        {copy.landingPageUrl && (
          <a
            href={copy.landingPageUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-1 truncate text-xs text-primary underline underline-offset-2"
          >
            {copy.landingPageUrl}
          </a>
        )}
      </CardContent>
    </Card>
  );
}

// AI creative tagging (text-based — ad copy + asset type, not computer-vision
// image analysis) classifies hook type/angle/tone so "what KIND of creative wins"
// is answerable across the account, not just "which specific ad wins." Same
// on-demand+cached pattern as AI Insights: a cached tag renders immediately, a
// missing one shows a Generate button rather than auto-firing on page load.
function AiTagsPanel({ clientId, platform, creativeName }: { clientId: string; platform: string; creativeName: string }) {
  const queryClient = useQueryClient();
  const { data: tags, isLoading } = useQuery({
    queryKey: ["creative-tags", clientId, platform, creativeName],
    queryFn: () => getCreativeTags(clientId, platform, creativeName),
  });
  const generate = useMutation({
    mutationFn: () => generateCreativeTagsFor(clientId, platform, creativeName),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["creative-tags", clientId, platform, creativeName] }),
  });

  return (
    <Card className="px-4 py-4">
      <CardHeader className="flex-row items-center justify-between px-0">
        <CardTitle className="flex items-center gap-1.5 text-sm">
          <Sparkles className="size-3.5 text-primary" /> AI Creative Tags
        </CardTitle>
        <Button size="xs" variant="outline" disabled={generate.isPending} onClick={() => generate.mutate()}>
          {generate.isPending ? "Tagging…" : tags ? "Regenerate" : "Generate tags"}
        </Button>
      </CardHeader>
      <CardContent className="px-0">
        {isLoading && <Skeleton className="h-6 w-full" />}
        {!isLoading && !tags && !generate.isError && (
          <p className="text-sm text-muted-foreground">
            Not tagged yet. Classifies this creative's hook, angle, and tone from its ad copy so patterns show up
            across your whole account in Creative Patterns.
          </p>
        )}
        {generate.isError && (
          <p className="text-sm text-status-critical">{(generate.error as Error).message}</p>
        )}
        {tags?.error && <p className="text-sm text-status-critical">{tags.error}</p>}
        {tags && !tags.error && (
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="secondary">{TAG_LABEL[tags.hook_type] ?? tags.hook_type}</Badge>
            <Badge variant="secondary">{TAG_LABEL[tags.angle] ?? tags.angle}</Badge>
            <Badge variant="secondary">{TAG_LABEL[tags.tone] ?? tags.tone}</Badge>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Hook rate + quartile view-through (Step 42) — null across the board for image
// creatives and every platform besides Facebook, same "not synced for this
// platform yet" pattern as AdCopy/AssetPreview above.
function VideoMetricsPanel({ metrics }: { metrics: CreativeVideoMetrics | null }) {
  if (!metrics) return null;
  const rows: { label: string; value: number | null }[] = [
    { label: "Hook rate (played / saw ad)", value: metrics.hookRate },
    { label: "Watched to 25%", value: metrics.p25Rate },
    { label: "Watched to 50%", value: metrics.p50Rate },
    { label: "Watched to 75%", value: metrics.p75Rate },
    { label: "Watched to 100%", value: metrics.p100Rate },
  ];
  return (
    <Card className="px-4 py-4">
      <CardHeader className="px-0">
        <CardTitle className="text-sm">Video Engagement</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1.5 px-0">
        <p className="text-xs text-muted-foreground">{formatNumber(metrics.plays)} plays</p>
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{r.label}</span>
            <span className="tabular-nums">{r.value === null ? "-" : formatPercent(r.value)}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function CreativeDetailClient({
  clientId,
  platform,
  campaignName,
  creativeName,
}: {
  clientId: string;
  platform: string;
  campaignName: string;
  creativeName: string;
}) {
  const { preset, setPreset, customRange, setCustomRange, range } = useDateRangeState("30d");


  const { data, isLoading, isError } = useQuery({
    queryKey: ["creative-detail", clientId, platform, campaignName, creativeName, range.from, range.to],
    queryFn: () => getCreativeDetail(clientId, platform, campaignName, creativeName, range),
  });
  const { data: clients } = useQuery({ queryKey: ["clients"], queryFn: getClients });
  const niche = clients?.find((c) => c.id === clientId)?.niche;
  const goal = campaignGoalForNiche(niche ?? "other");

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <Link
            href={`/clients/${clientId}/campaigns/${encodeURIComponent(platform)}/${encodeURIComponent(campaignName)}`}
            className="mb-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" /> Back to {campaignName}
          </Link>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold">{creativeName}</h1>
            {formatPlatformLabel(platform) && <Badge variant="secondary">{formatPlatformLabel(platform)}</Badge>}
          </div>
        </div>
        <DateRangeSelect value={preset} onChange={setPreset} customRange={customRange} onCustomRangeChange={setCustomRange} />
      </div>

      {isError && <p className="text-sm text-status-critical">Failed to load creative. Is the API running?</p>}

      {isLoading && <Skeleton className="h-96 w-full" />}

      {data && (
        <>
          <AssetPreview asset={data.asset} />

          {/* Gated on the creative's current asset type, not just whether any video
              stat exists — an ad name can get reused for a different creative over
              time (a paused video swapped for a new static image), and video_plays
              is summed across the whole selected date range, so a stale video figure
              could otherwise survive under what's now a static image or catalog ad. */}
          {data.asset.assetType === "video" && <VideoMetricsPanel metrics={data.videoMetrics} />}

          <AdCopy copy={data.copy} />

          <AiTagsPanel clientId={clientId} platform={platform} creativeName={creativeName} />

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
            <StatTile label="ROAS" value={formatRoas(data.kpis.roas)} />
            <StatTile label="Impressions" value={formatNumber(data.kpis.impressions)} />
            {goal === "sales" && (
              <StatTile label="CPM" value={data.kpis.cpm === null ? "-" : formatCurrency(data.kpis.cpm)} />
            )}
          </div>

          <InsightsPanel
            clientId={clientId}
            scope={{ type: "creative", platform, campaignName, creativeName }}
            queryKeyExtra={["creative", platform, campaignName, creativeName]}
            title="Creative Insight"
            compact
          />

          <Card className="px-4">
            <CardHeader className="px-0">
              <CardTitle>Customers who converted ({data.customers.length})</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 px-0">
              {data.customers.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  No purchases attributed to this creative in this range yet.
                </p>
              ) : (
                data.customers.map((c, i) => (
                  <Link
                    key={i}
                    href={`/clients/${clientId}/leads?email=${encodeURIComponent(c.email)}`}
                    className="flex items-center justify-between rounded-lg border border-border p-3 text-sm hover:bg-accent/40"
                  >
                    <div>
                      <p className="font-medium">{c.email}</p>
                      <p className="text-xs text-muted-foreground">{formatDateTime(c.purchasedAt)}</p>
                    </div>
                    <span className="text-chart-1">{formatCurrency(c.revenue)}</span>
                  </Link>
                ))
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
