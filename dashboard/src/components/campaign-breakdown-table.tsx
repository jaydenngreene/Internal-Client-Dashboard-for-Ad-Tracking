"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Compass } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PlatformIcon, isAdPlatform } from "@/components/platform-icon";
import { FunnelRow } from "@/lib/api";
import { formatCurrency, formatNumber, formatRoas, formatPercent, formatPlatformLabel } from "@/lib/format";
import { downloadCsv } from "@/lib/csv";
import { cn } from "@/lib/utils";

type SortKey =
  | "name"
  | "cost"
  | "ctr"
  | "cpc"
  | "leads"
  | "cpl"
  | "sales"
  | "costPerPurchase"
  | "aov"
  | "revenue"
  | "profit"
  | "roas";

// Which funnel-stage metric block applies depends on what the client is actually
// selling: a lead-gen/call/SaaS business is optimizing for cost per lead, an
// ecommerce/info-product business is optimizing for cost per purchase and order
// value. Showing both blocks on every client buries the number that actually
// matters for that business under one that doesn't apply.
export type CampaignGoal = "leads" | "sales";

export function CampaignBreakdownTable({
  rows,
  nameColumnLabel,
  goal,
  showPlatformBadge = true,
  getHref,
}: {
  rows: FunnelRow[];
  nameColumnLabel: string;
  goal: CampaignGoal;
  // Source-breakdown rows are already grouped BY platform (the row name IS the
  // platform), so a badge there would just repeat the name — every other breakdown
  // (campaign, creative) benefits from it since a client running the same-named
  // campaign on two platforms would otherwise look like one merged row.
  showPlatformBadge?: boolean;
  // Only the campaign breakdown has a drill-down page to link to (source/keyword/
  // creative rows aren't a single scoped entity the same way) — omitted entirely means
  // rows render as plain (non-clickable) table rows, same as before this prop existed.
  getHref?: (row: FunnelRow) => string | null;
}) {
  const router = useRouter();
  const [sortKey, setSortKey] = useState<SortKey>("revenue");
  const [sortDesc, setSortDesc] = useState(true);
  // CTR/CPC default hidden - a table showing every column at once was flagged as
  // a real "generic internal tool" tell (Linear/Asana's whitespace-heavy default
  // is the model: ~6-8 visible columns, an explicit control to reveal more,
  // rather than everything at once). Both stay one click away, not removed.
  const [hiddenColumns, setHiddenColumns] = useState<Set<SortKey>>(new Set(["ctr", "cpc"]));

  const goalColumns: { key: SortKey; label: string; align?: "right" }[] =
    goal === "leads"
      ? [
          { key: "leads", label: "Leads", align: "right" },
          { key: "cpl", label: "CPL", align: "right" },
          { key: "sales", label: "Sales", align: "right" },
        ]
      : [
          { key: "sales", label: "Purchases", align: "right" },
          { key: "costPerPurchase", label: "Ad Spend / Purchase", align: "right" },
          { key: "aov", label: "AOV", align: "right" },
        ];

  const optionalColumns: { key: SortKey; label: string; align?: "right" }[] = [
    { key: "ctr", label: "CTR", align: "right" },
    { key: "cpc", label: "CPC", align: "right" },
  ];

  // Per-row ROAS divides a row's revenue (attribution-matched only, same
  // limitation as Overview's plain ROAS tile) by that row's spend — for a
  // leads-goal niche (lead-gen/call/SaaS), revenue realizes later through a
  // separate system with no session to match back to, so this always reads as
  // artificially bad. Unlike Overview's account-wide Blended ROAS, there's no
  // per-row substitute to show instead: unattributed revenue has no known
  // campaign/creative to blend into by definition, so the column is just
  // dropped rather than replaced with a number that would be fabricated.
  const allColumns: { key: SortKey; label: string; align?: "right" }[] = [
    { key: "name", label: nameColumnLabel },
    { key: "cost", label: "Ad Spend", align: "right" },
    ...optionalColumns,
    ...goalColumns,
    { key: "revenue", label: "Revenue", align: "right" },
    { key: "profit", label: "Profit", align: "right" },
    ...(goal === "sales" ? [{ key: "roas" as SortKey, label: "ROAS", align: "right" as const }] : []),
  ];
  const columns = allColumns.filter((c) => !hiddenColumns.has(c.key));

  function toggleColumn(key: SortKey) {
    setHiddenColumns((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const sorted = [...rows].sort((a, b) => {
    const av = a[sortKey];
    const bv = b[sortKey];
    if (typeof av === "string" || typeof bv === "string") {
      const cmp = String(av).localeCompare(String(bv));
      return sortDesc ? -cmp : cmp;
    }
    const an = av === null ? -Infinity : av;
    const bn = bv === null ? -Infinity : bv;
    const cmp = an - bn;
    return sortDesc ? -cmp : cmp;
  });

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDesc((d) => !d);
    } else {
      setSortKey(key);
      setSortDesc(true);
    }
  }

  if (rows.length === 0) {
    return (
      <p className="px-4 py-8 text-center text-sm text-muted-foreground">
        No spend, leads, or revenue in this range yet.
      </p>
    );
  }

  function exportCsv() {
    downloadCsv(
      `${nameColumnLabel.toLowerCase()}-breakdown.csv`,
      sorted,
      [...allColumns, { key: "platform", label: "Platform" }, { key: "matched", label: "Matched" }]
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-end gap-2 px-4">
        {optionalColumns.map((col) => (
          <button
            key={col.key}
            type="button"
            onClick={() => toggleColumn(col.key)}
            className={cn(
              "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
              hiddenColumns.has(col.key)
                ? "border-border text-muted-foreground hover:bg-muted"
                : "border-primary/40 bg-primary/10 text-primary"
            )}
          >
            {hiddenColumns.has(col.key) ? `+ ${col.label}` : `✓ ${col.label}`}
          </button>
        ))}
        <Button size="xs" variant="outline" onClick={exportCsv}>
          Export CSV
        </Button>
      </div>
      <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted hover:bg-muted">
            {columns.map((col) => (
              <TableHead
                key={col.key}
                onClick={() => toggleSort(col.key)}
                className={cn(
                  "cursor-pointer select-none text-[11px] font-medium uppercase tracking-wider text-muted-foreground",
                  col.align === "right" && "text-right",
                  // The name column stays pinned while the rest of a wide breakdown
                  // table scrolls horizontally — otherwise a campaign/creative name
                  // scrolls out of view along with which row's numbers you're
                  // even looking at.
                  col.key === "name" && "sticky left-0 z-20 bg-muted"
                )}
              >
                {col.label}
                {sortKey === col.key && (sortDesc ? " ↓" : " ↑")}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((row) => {
            const href = getHref?.(row) ?? null;
            return (
            <TableRow
              key={`${row.name}::${row.platform ?? ""}`}
              onClick={href ? () => router.push(href) : undefined}
              className={cn("group", href && "cursor-pointer hover:bg-accent/40")}
            >
              <TableCell className="sticky left-0 z-10 max-w-64 truncate bg-card font-medium group-hover:bg-muted/50">
                <div className="flex items-center gap-2">
                  {showPlatformBadge && row.platform === null && (
                    <span className="inline-flex size-[18px] shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                      <Compass className="size-3" />
                    </span>
                  )}
                  {showPlatformBadge && row.platform !== null && <PlatformIcon platform={row.platform} />}
                  <span className="truncate">{row.name}</span>
                  {showPlatformBadge && (
                    <Badge variant="secondary" className="shrink-0 text-[10px]">
                      {row.platform === null ? "Direct / Organic" : (formatPlatformLabel(row.platform) ?? row.name)}
                    </Badge>
                  )}
                  {/* A row assembled only from leads/revenue (no ad_costs match) only means a
                      real tracking gap when the source is actually an ad platform Kado syncs
                      spend for — Klaviyo, direct/organic, or any other non-ad source was never
                      going to have a spend row to match in the first place. Source-breakdown
                      rows (showPlatformBadge=false) carry the same platform value in row.name,
                      so this check applies there too even without the badge/icon above it. */}
                  {!row.matched && isAdPlatform(showPlatformBadge ? row.platform : row.name) && (
                    <Badge variant="outline" className="shrink-0 text-[10px] text-status-warning border-status-warning/40">
                      unmatched
                    </Badge>
                  )}
                </div>
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {/* An unmatched row's $0 cost means "couldn't join spend data," not
                    "verified zero spend" - showing $0.00 reads as the latter. */}
                {row.matched ? formatCurrency(row.cost) : "-"}
              </TableCell>
              {!hiddenColumns.has("ctr") && (
                <TableCell className="text-right tabular-nums">{formatPercent(row.ctr)}</TableCell>
              )}
              {!hiddenColumns.has("cpc") && (
                <TableCell className="text-right tabular-nums">
                  {row.cpc === null ? "-" : formatCurrency(row.cpc)}
                </TableCell>
              )}
              {goal === "leads" ? (
                <>
                  <TableCell className="text-right tabular-nums">{formatNumber(row.leads)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.cpl === null ? "-" : formatCurrency(row.cpl)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(row.sales)}</TableCell>
                </>
              ) : (
                <>
                  <TableCell className="text-right tabular-nums">{formatNumber(row.sales)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.costPerPurchase === null ? "-" : formatCurrency(row.costPerPurchase)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.aov === null ? "-" : formatCurrency(row.aov)}
                  </TableCell>
                </>
              )}
              <TableCell className="text-right tabular-nums text-chart-1">{formatCurrency(row.revenue)}</TableCell>
              <TableCell
                className={cn("text-right tabular-nums", row.trueProfit >= 0 ? "text-chart-1" : "text-chart-2")}
              >
                {formatCurrency(row.trueProfit)}
              </TableCell>
              {goal === "sales" && (
                <TableCell className="text-right tabular-nums">{formatRoas(row.roas)}</TableCell>
              )}
            </TableRow>
            );
          })}
        </TableBody>
      </Table>
      </div>
    </div>
  );
}
