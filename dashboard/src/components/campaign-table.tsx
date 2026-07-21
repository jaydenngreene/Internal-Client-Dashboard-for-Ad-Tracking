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
import { Badge } from "@/components/ui/badge";
import { CampaignRow } from "@/lib/api";
import { formatCurrency, formatNumber, formatRoas } from "@/lib/format";
import { cn } from "@/lib/utils";

type SortKey = "campaign_name" | "cost" | "revenue" | "profit" | "roas" | "sales";

const COLUMNS: { key: SortKey; label: string; align?: "right" }[] = [
  { key: "campaign_name", label: "Campaign" },
  { key: "cost", label: "Cost", align: "right" },
  { key: "revenue", label: "Revenue", align: "right" },
  { key: "profit", label: "Profit", align: "right" },
  { key: "roas", label: "ROAS", align: "right" },
  { key: "sales", label: "Sales", align: "right" },
];

export function CampaignTable({ campaigns }: { campaigns: CampaignRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("revenue");
  const [sortDesc, setSortDesc] = useState(true);

  const sorted = [...campaigns].sort((a, b) => {
    const av = a[sortKey];
    const bv = b[sortKey];
    const an = av === null ? -Infinity : typeof av === "string" ? av.localeCompare(bv as string) : av;
    const bn = bv === null ? -Infinity : typeof bv === "string" ? 0 : bv;
    const cmp = typeof av === "string" ? an : (an as number) - (bn as number);
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
        No campaign spend or revenue in this range yet.
      </p>
    );
  }

  return (
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
            <TableCell className="max-w-64 truncate font-medium">
              <div className="flex items-center gap-2">
                <span className="truncate">{row.campaign_name}</span>
                {!row.matched && (
                  <Badge variant="outline" className="shrink-0 text-[10px] text-status-warning border-status-warning/40">
                    unmatched
                  </Badge>
                )}
              </div>
            </TableCell>
            <TableCell className="text-right tabular-nums">{formatCurrency(row.cost)}</TableCell>
            <TableCell className="text-right tabular-nums text-chart-1">
              {formatCurrency(row.revenue)}
            </TableCell>
            <TableCell
              className={cn(
                "text-right tabular-nums",
                row.profit >= 0 ? "text-chart-1" : "text-chart-2"
              )}
            >
              {formatCurrency(row.profit)}
            </TableCell>
            <TableCell className="text-right tabular-nums">{formatRoas(row.roas)}</TableCell>
            <TableCell className="text-right tabular-nums">{formatNumber(row.sales)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
