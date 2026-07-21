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
import { FunnelRow } from "@/lib/api";
import { formatCurrency, formatNumber, formatRoas, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

type SortKey = "name" | "cost" | "ctr" | "cpc" | "leads" | "cpl" | "sales" | "revenue" | "profit" | "roas";

export function CampaignBreakdownTable({
  rows,
  nameColumnLabel,
}: {
  rows: FunnelRow[];
  nameColumnLabel: string;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("revenue");
  const [sortDesc, setSortDesc] = useState(true);

  const columns: { key: SortKey; label: string; align?: "right" }[] = [
    { key: "name", label: nameColumnLabel },
    { key: "cost", label: "Cost", align: "right" },
    { key: "ctr", label: "CTR", align: "right" },
    { key: "cpc", label: "CPC", align: "right" },
    { key: "leads", label: "Leads", align: "right" },
    { key: "cpl", label: "CPL", align: "right" },
    { key: "sales", label: "Sales", align: "right" },
    { key: "revenue", label: "Revenue", align: "right" },
    { key: "profit", label: "Profit", align: "right" },
    { key: "roas", label: "ROAS", align: "right" },
  ];

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

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {columns.map((col) => (
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
            <TableRow key={row.name}>
              <TableCell className="max-w-64 truncate font-medium">
                <div className="flex items-center gap-2">
                  <span className="truncate">{row.name}</span>
                  {!row.matched && (
                    <Badge variant="outline" className="shrink-0 text-[10px] text-status-warning border-status-warning/40">
                      unmatched
                    </Badge>
                  )}
                </div>
              </TableCell>
              <TableCell className="text-right tabular-nums">{formatCurrency(row.cost)}</TableCell>
              <TableCell className="text-right tabular-nums">{row.ctr === null ? "—" : formatPercent(row.ctr)}</TableCell>
              <TableCell className="text-right tabular-nums">{row.cpc === null ? "—" : formatCurrency(row.cpc)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatNumber(row.leads)}</TableCell>
              <TableCell className="text-right tabular-nums">
                {row.cpl === null ? "—" : formatCurrency(row.cpl)}
              </TableCell>
              <TableCell className="text-right tabular-nums">{formatNumber(row.sales)}</TableCell>
              <TableCell className="text-right tabular-nums text-chart-1">{formatCurrency(row.revenue)}</TableCell>
              <TableCell
                className={cn("text-right tabular-nums", row.profit >= 0 ? "text-chart-1" : "text-chart-2")}
              >
                {formatCurrency(row.profit)}
              </TableCell>
              <TableCell className="text-right tabular-nums">{formatRoas(row.roas)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
