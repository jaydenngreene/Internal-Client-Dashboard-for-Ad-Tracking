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
import { LeadCampaignRow } from "@/lib/api";
import { formatCurrency, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

type SortKey = "campaign_name" | "cost" | "leads" | "cpl";

const COLUMNS: { key: SortKey; label: string; align?: "right" }[] = [
  { key: "campaign_name", label: "Campaign" },
  { key: "cost", label: "Cost", align: "right" },
  { key: "leads", label: "Leads", align: "right" },
  { key: "cpl", label: "CPL", align: "right" },
];

export function LeadsTable({ campaigns }: { campaigns: LeadCampaignRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("leads");
  const [sortDesc, setSortDesc] = useState(true);

  const sorted = [...campaigns].sort((a, b) => {
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

  if (campaigns.length === 0) {
    return (
      <p className="px-4 py-8 text-center text-sm text-muted-foreground">
        No leads or campaign spend in this range yet.
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
            <TableCell className="text-right tabular-nums text-chart-1">{formatNumber(row.leads)}</TableCell>
            <TableCell className="text-right tabular-nums">
              {row.cpl === null ? "—" : formatCurrency(row.cpl)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
