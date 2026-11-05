"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ChevronRight, ImageIcon, PlayIcon } from "lucide-react";
import {
  getCampaignDetail,
  getClients,
  getCreativeRoles,
  campaignGoalForNiche,
  CampaignAdsetRow,
  CampaignCreativeRow,
  CreativeRoleRow,
} from "@/lib/api";
import { SegmentedToggle } from "@/components/segmented-toggle";
import { useDateRangeState } from "@/lib/date-range";
import { InsightsPanel } from "@/components/insights-panel";
import { StatTile } from "@/components/stat-tile";
import { Badge } from "@/components/ui/badge";
import { RoleBadge } from "@/components/role-badge";
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
  role,
}: {
  creative: CampaignCreativeRow;
  href: string;
  goal: "leads" | "sales";
  // Undefined while still loading; null once loaded if this creative never
  // appeared in a converting journey at all (nothing to tag a role onto).
  role: CreativeRoleRow["role"] | null | undefined;
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
          {role && <RoleBadge role={role} />}
          {!creative.matched && (
            <Badge variant="outline" className="shrink-0 text-[10px] text-status-warning border-status-warning/40">
              unmatched
            </Badge>
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          <span>{creative.matched ? formatCurrency(creative.cost) : "-"} spend</span>
          {goal === "leads" ? (
            <>
              <span>{formatNumber(creative.leads)} leads</span>
              <span className="text-chart-1">{formatCurrency(creative.revenue)} revenue</span>
            </>
          ) : (
            <>
              <span>{count(creative.blendedSales)} purchases</span>
              <span className="text-foreground">{formatNumber(creative.sales)} traced</span>
              <span className="text-chart-1">{money(creative.blendedRevenue)} revenue</span>
              <span>{formatRoas(creative.blendedRoas)} ROAS</span>
            </>
          )}
          <span>{formatPercent(creative.ctr)} CTR</span>
        </div>
      </div>
    </div>
  );
}

// null/undefined = no blended number available (e.g. nothing ad-traced yet): show "-",
// never the click-traced value under a "blended" label.
const money = (v: number | null | undefined) => (v == null ? "-" : formatCurrency(v));
const count = (v: number | null | undefined) => (v == null ? "-" : formatNumber(Math.round(v)));

function MiniStat({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`truncate text-sm font-medium tabular-nums ${className ?? ""}`}>{value}</p>
    </div>
  );
}

// One ad set, Ads Manager style: its own full metrics on the row, and the ads
// running inside it revealed on click.
function AdsetCard({
  adset,
  goal,
  expanded,
  onToggle,
  children,
}: {
  adset: CampaignAdsetRow;
  goal: "leads" | "sales";
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full flex-col gap-3 rounded-lg p-3 text-left hover:bg-accent/40"
      >
        <div className="flex w-full items-center gap-2">
          <ChevronRight className={`size-4 shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-90" : ""}`} />
          <p className="min-w-0 flex-1 truncate text-sm font-semibold">{adset.name}</p>
          <Badge variant="secondary" className="shrink-0 text-[10px]">
            {adset.adCount} {adset.adCount === 1 ? "ad" : "ads"}
          </Badge>
          {!adset.matched && (
            <Badge variant="outline" className="shrink-0 text-[10px] text-status-warning border-status-warning/40">
              unmatched
            </Badge>
          )}
        </div>
        <div className="grid w-full grid-cols-3 gap-x-4 gap-y-2 pl-6 sm:grid-cols-5 lg:grid-cols-9">
          <MiniStat label="Spend" value={adset.matched ? formatCurrency(adset.cost) : "-"} />
          {goal === "leads" ? (
            <>
              <MiniStat label="Leads" value={formatNumber(adset.leads)} />
              <MiniStat label="CPL" value={adset.cpl === null ? "-" : formatCurrency(adset.cpl)} />
              <MiniStat label="Revenue" value={formatCurrency(adset.revenue)} className="text-chart-1" />
              <MiniStat
                label="Profit"
                value={formatCurrency(adset.trueProfit)}
                className={adset.trueProfit >= 0 ? "text-chart-1" : "text-chart-2"}
              />
            </>
          ) : (
            <>
              <MiniStat label="Purchases" value={count(adset.blendedSales)} />
              <MiniStat label="Traced Sales" value={formatNumber(adset.sales)} />
              <MiniStat label="Cost / Purchase" value={money(adset.blendedCostPerSale)} />
              <MiniStat label="Revenue" value={money(adset.blendedRevenue)} className="text-chart-1" />
              <MiniStat
                label="Profit"
                value={money(adset.blendedTrueProfit)}
                className={(adset.blendedTrueProfit ?? 0) >= 0 ? "text-chart-1" : "text-chart-2"}
              />
              <MiniStat label="Blended ROAS" value={formatRoas(adset.blendedRoas)} />
            </>
          )}
          <MiniStat label="CTR" value={formatPercent(adset.ctr)} />
          <MiniStat label="CPM" value={adset.cpm === null ? "-" : formatCurrency(adset.cpm)} />
        </div>
      </button>
      {expanded && <div className="flex flex-col gap-2 border-t border-border p-2.5 pl-8">{children}</div>}
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

  // Same Opener/Closer/Assist role tags shown on the Campaigns page's Creative
  // tab, merged in here by name+platform so the same ad reads the same way
  // wherever it's listed - including via a click-through from the First-Touch
  // vs Last-Touch (or U-Shaped vs Time-Decay) comparison tables, which both
  // land on this exact page.
  const { data: creativeRoles } = useQuery({
    queryKey: ["creative-roles", clientId, range.from, range.to],
    queryFn: () => getCreativeRoles(clientId, range),
  });
  const roleByKey = new Map((creativeRoles?.creatives ?? []).map((r) => [`${r.name}::${r.platform ?? ""}`, r.role]));

  const [view, setView] = useState<"adsets" | "ads">("adsets");
  const [expandedAdsets, setExpandedAdsets] = useState<Set<string>>(new Set());
  const toggleAdset = (key: string) =>
    setExpandedAdsets((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const renderCreative = (c: CampaignCreativeRow) => (
    <CreativeRowCard
      // The same ad name can run in more than one ad set, so the key includes it.
      key={`${c.adsetKey}::${c.name}`}
      creative={c}
      goal={goal}
      role={creativeRoles ? (roleByKey.get(`${c.name}::${platform}`) ?? null) : undefined}
      href={`/clients/${clientId}/campaigns/${encodeURIComponent(platform)}/${encodeURIComponent(campaignName)}/creatives/${encodeURIComponent(c.name)}`}
    />
  );

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
                <StatTile label="Purchases" value={count(data.kpis.blendedSales)} />
                <StatTile label="Traced Purchases" value={formatNumber(data.kpis.sales)} />
                <StatTile
                  label="Ad Spend / Purchase"
                  value={money(data.kpis.blendedCostPerSale)}
                />
              </>
            )}
            <StatTile
              label="Revenue"
              value={goal === "sales" ? money(data.kpis.blendedRevenue) : formatCurrency(data.kpis.revenue)}
              tone="positive"
            />
            {(() => {
              const p = goal === "sales" ? data.kpis.blendedTrueProfit : data.kpis.trueProfit;
              return <StatTile label="Profit" value={money(p)} tone={(p ?? 0) >= 0 ? "positive" : "negative"} />;
            })()}
            {goal === "sales" && <StatTile label="Blended ROAS" value={formatRoas(data.kpis.blendedRoas)} />}
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
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">
                {view === "adsets" ? `Ad Sets (${data.adsets.length})` : `Ads (${data.creatives.length})`}
              </h2>
              <SegmentedToggle
                value={view}
                onChange={setView}
                options={[
                  { value: "adsets", label: "By ad set" },
                  { value: "ads", label: "All ads" },
                ]}
              />
            </div>
            {data.creatives.length === 0 && data.adsets.length === 0 ? (
              <Card className="px-4 py-8">
                <CardContent className="px-0 text-center text-sm text-muted-foreground">
                  No ad set or ad-level spend, leads, or revenue in this range yet.
                </CardContent>
              </Card>
            ) : view === "adsets" ? (
              <div className="flex flex-col gap-2">
                {data.adsets.map((a) => {
                  const ads = data.creatives.filter((c) => c.adsetKey === a.key);
                  return (
                    <AdsetCard
                      key={a.key}
                      adset={a}
                      goal={goal}
                      expanded={expandedAdsets.has(a.key)}
                      onToggle={() => toggleAdset(a.key)}
                    >
                      {ads.length === 0 ? (
                        <p className="px-1 py-2 text-xs text-muted-foreground">
                          These sales came from links that named the ad set but not a specific ad.
                        </p>
                      ) : (
                        ads.map(renderCreative)
                      )}
                    </AdsetCard>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-col gap-2">{data.creatives.map(renderCreative)}</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
