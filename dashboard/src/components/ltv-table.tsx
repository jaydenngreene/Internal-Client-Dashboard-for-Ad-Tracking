"use client";

import { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { LtvCampaignRow } from "@/lib/api";
import { formatCurrency, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

type SortKey =
  | "campaign_name"
  | "customers"
  | "avgLtv30d"
  | "avgLtv60d"
  | "avgLtv90d"
  | "avgLtv180d"
  | "avgLtvLifetime"
  | "predictedAvgLtv";

const COLUMNS: { key: SortKey; label: string; align?: "right" }[] = [
  { key: "campaign_name", label: "Campaign" },
  { key: "customers", label: "Customers", align: "right" },
  { key: "avgLtv30d", label: "LTV 30d", align: "right" },
  { key: "avgLtv60d", label: "LTV 60d", align: "right" },
  { key: "avgLtv90d", label: "LTV 90d", align: "right" },
  { key: "avgLtv180d", label: "LTV 180d", align: "right" },
  { key: "avgLtvLifetime", label: "LTV Lifetime", align: "right" },
  { key: "predictedAvgLtv", label: "Predicted LTV", align: "right" },
];

export function LtvTable({ campaigns, predictiveLtvAvailable }: { campaigns: LtvCampaignRow[]; predictiveLtvAvailable: boolean }) {
  const [sortKey, setSortKey] = useState<SortKey>("avgLtvLifetime");
  const [sortDesc, setSortDesc] = useState(true);

  const sorted = [...campaigns].sort((a, b) => {
    const av = a[sortKey];
    const bv = b[sortKey];
    if (typeof av === "string" || typeof bv === "string") {
      const cmp = String(av).localeCompare(String(bv));
      return sortDesc ? -cmp : cmp;
    }
    // null (no prediction available for that cohort) always sorts last regardless
    // of sort direction — it's "unknown," not "zero."
    if (av === null) return bv === null ? 0 : 1;
    if (bv === null) return -1;
    const cmp = av - bv;
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

  if (campaigns.length === 0) {
    return (
      <p className="px-4 py-8 text-center text-sm text-muted-foreground">
        No customers acquired in this range yet.
      </p>
    );
  }

  return (
    <>
      {!predictiveLtvAvailable && (
        <p className="px-4 pb-2 text-xs text-muted-foreground">
          Predicted LTV needs more purchase history to build a reliable projection curve — it'll fill in once enough
          customers have aged past 180 days.
        </p>
      )}
      <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          {COLUMNS.map((col) => (
            <TableHead
              key={col.key}
              onClick={() => toggleSort(col.key)}
              className={cn(
                "cursor-pointer select-none text-[11px] font-medium uppercase tracking-wider text-muted-foreground",
                col.align === "right" && "text-right"
              )}
            >
              {col.label}
              {sortKey === col.key && (sortDesc ? " ↓" : " ↑")}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map((row) => (
          <TableRow key={row.campaign_name}>
            <TableCell className="max-w-64 truncate font-medium">{row.campaign_name}</TableCell>
            <TableCell className="text-right tabular-nums">{formatNumber(row.customers)}</TableCell>
            <TableCell className="text-right tabular-nums">{formatCurrency(row.avgLtv30d)}</TableCell>
            <TableCell className="text-right tabular-nums">{formatCurrency(row.avgLtv60d)}</TableCell>
            <TableCell className="text-right tabular-nums">{formatCurrency(row.avgLtv90d)}</TableCell>
            <TableCell className="text-right tabular-nums">{formatCurrency(row.avgLtv180d)}</TableCell>
            <TableCell className="text-right tabular-nums text-chart-1">
              {formatCurrency(row.avgLtvLifetime)}
            </TableCell>
            <TableCell className="text-right tabular-nums text-muted-foreground">
              {row.predictedAvgLtv === null ? "-" : formatCurrency(row.predictedAvgLtv)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
      </Table>
    </>
  );
}
