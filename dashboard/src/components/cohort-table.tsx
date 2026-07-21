"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CohortRow } from "@/lib/api";
import { formatCurrency, formatNumber } from "@/lib/format";

const WINDOW_COLUMNS: { key: keyof CohortRow; label: string }[] = [
  { key: "avgLtv30d", label: "30d" },
  { key: "avgLtv60d", label: "60d" },
  { key: "avgLtv90d", label: "90d" },
  { key: "avgLtv180d", label: "180d" },
  { key: "avgLtvLifetime", label: "Lifetime" },
];

function formatCohortMonth(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" }).format(d);
}

// Sequential single-hue heat tint (magnitude, not identity) — normalized independently
// per column since each revenue window has a different natural scale. The number
// itself always carries the real value; the tint is a background-only affordance,
// never the sole encoding of magnitude.
function heatStyle(value: number, min: number, max: number): React.CSSProperties {
  const t = max > min ? (value - min) / (max - min) : 0;
  const mixPercent = 6 + t * 34; // 6%–40%
  return { backgroundColor: `color-mix(in oklch, var(--chart-1) ${mixPercent}%, transparent)` };
}

export function CohortTable({ cohorts }: { cohorts: CohortRow[] }) {
  if (cohorts.length === 0) {
    return (
      <p className="px-4 py-8 text-center text-sm text-muted-foreground">
        No cohorts with a first purchase in this window yet.
      </p>
    );
  }

  const columnRanges = Object.fromEntries(
    WINDOW_COLUMNS.map((col) => {
      const values = cohorts.map((c) => c[col.key] as number);
      return [col.key, { min: Math.min(...values), max: Math.max(...values) }];
    })
  ) as Record<string, { min: number; max: number }>;

  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Cohort
          </TableHead>
          <TableHead className="text-right text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Customers
          </TableHead>
          {WINDOW_COLUMNS.map((col) => (
            <TableHead
              key={col.key}
              className="text-right text-[11px] font-medium uppercase tracking-wider text-muted-foreground"
            >
              Avg LTV {col.label}
            </TableHead>
          ))}
          <TableHead className="text-right text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Total Lifetime
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {cohorts.map((row) => (
          <TableRow key={row.cohortMonth}>
            <TableCell className="font-medium">{formatCohortMonth(row.cohortMonth)}</TableCell>
            <TableCell className="text-right tabular-nums">{formatNumber(row.customers)}</TableCell>
            {WINDOW_COLUMNS.map((col) => (
              <TableCell
                key={col.key}
                className="text-right tabular-nums"
                style={heatStyle(row[col.key] as number, columnRanges[col.key].min, columnRanges[col.key].max)}
              >
                {formatCurrency(row[col.key] as number)}
              </TableCell>
            ))}
            <TableCell className="text-right tabular-nums font-medium">
              {formatCurrency(row.totalLtvLifetime)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
