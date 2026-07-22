"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ImageIcon } from "lucide-react";
import { getCreativeDetail, getClients, campaignGoalForNiche, CreativeDetailCopy } from "@/lib/api";
import { RangePreset, resolveRange } from "@/lib/date-range";
import { DateRangeSelect } from "@/components/date-range-select";
import { InsightsPanel } from "@/components/insights-panel";
import { StatTile } from "@/components/stat-tile";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency, formatNumber, formatPercent, formatRoas, formatPlatformLabel } from "@/lib/format";

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
        connected — other platforms don&apos;t pull it in yet.
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
      <CardContent className="flex flex-col gap-2 px-0">
        {copy.headline && <p className="text-base font-semibold">{copy.headline}</p>}
        {copy.primaryText && <p className="text-sm text-foreground">{copy.primaryText}</p>}
        {copy.description && <p className="text-sm text-muted-foreground">{copy.description}</p>}
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
  const [preset, setPreset] = useState<RangePreset>("30d");
  const range = resolveRange(preset);

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
        <DateRangeSelect value={preset} onChange={setPreset} />
      </div>

      {isError && <p className="text-sm text-status-critical">Failed to load creative. Is the API running?</p>}

      {isLoading && <Skeleton className="h-96 w-full" />}

      {data && (
        <>
          <AssetPreview asset={data.asset} />

          <AdCopy copy={data.copy} />

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label="Cost" value={formatCurrency(data.kpis.cost)} />
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
                  label="Cost / Purchase"
                  value={data.kpis.sales > 0 ? formatCurrency(data.kpis.cost / data.kpis.sales) : "-"}
                />
              </>
            )}
            <StatTile label="Revenue" value={formatCurrency(data.kpis.revenue)} tone="positive" />
            <StatTile
              label="Profit"
              value={formatCurrency(data.kpis.profit)}
              tone={data.kpis.profit >= 0 ? "positive" : "negative"}
            />
            <StatTile label="ROAS" value={formatRoas(data.kpis.roas)} />
            <StatTile label="Impressions" value={formatNumber(data.kpis.impressions)} />
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
