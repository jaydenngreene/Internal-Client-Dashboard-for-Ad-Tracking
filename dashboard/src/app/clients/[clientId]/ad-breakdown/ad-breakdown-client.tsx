"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  getAdBreakdown,
  AdBreakdownLevel,
  AdBreakdownType,
  AdBreakdownRow,
} from "@/lib/api";
import { useDateRangeState } from "@/lib/date-range";
import { formatNumber } from "@/lib/format";
import { SegmentedToggle } from "@/components/segmented-toggle";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ClientKicker } from "@/components/client-kicker";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const LEVEL_OPTIONS: { value: AdBreakdownLevel; label: string }[] = [
  { value: "campaign", label: "Campaign" },
  { value: "ad", label: "Ad" },
];

const TYPE_OPTIONS: { value: AdBreakdownType; label: string }[] = [
  { value: "age", label: "Age" },
  { value: "gender", label: "Gender" },
  { value: "placement", label: "Placement" },
];

const TYPE_COLUMN_LABEL: Record<AdBreakdownType, string> = {
  age: "Age",
  gender: "Gender",
  placement: "Placement",
};

interface Group {
  key: string;
  name: string;
  total: number;
  rows: AdBreakdownRow[];
}

// Groups the flat API rows by campaign/ad so each gets its own card, sorted
// by that group's total purchases (busiest first) rather than alphabetically
// — within a group, breakdown values are sorted by purchases too.
function groupRows(rows: AdBreakdownRow[]): Group[] {
  const byKey = new Map<string, Group>();
  for (const row of rows) {
    const key = `${row.id ?? ""}::${row.name}`;
    const group = byKey.get(key) ?? { key, name: row.name, total: 0, rows: [] };
    group.rows.push(row);
    group.total += row.purchases;
    byKey.set(key, group);
  }
  return Array.from(byKey.values())
    .map((group) => ({ ...group, rows: [...group.rows].sort((a, b) => b.purchases - a.purchases) }))
    .sort((a, b) => b.total - a.total);
}

export function AdBreakdownClient({ clientId }: { clientId: string }) {
  const { range } = useDateRangeState("30d");
  const [level, setLevel] = useState<AdBreakdownLevel>("campaign");
  const [type, setType] = useState<AdBreakdownType>("age");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["ad-breakdown", clientId, range.from, range.to, level, type],
    queryFn: () => getAdBreakdown(clientId, range, level, type),
  });

  const groups = data ? groupRows(data.rows) : [];
  const columnLabel = TYPE_COLUMN_LABEL[type];

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <ClientKicker clientId={clientId} />
          <h1 className="text-lg font-semibold">Ad Breakdown</h1>
          <p className="mt-0.5 max-w-2xl text-xs text-muted-foreground">
            Purchases Meta attributes to each {columnLabel.toLowerCase()} bucket, by {level} — the same source
            Ads Manager&apos;s own breakdown tables use. This is Meta&apos;s pixel-attributed count, not Kado&apos;s
            session-based attribution: Facebook&apos;s click doesn&apos;t carry age/placement info, so it can&apos;t
            be tied to this app&apos;s own revenue numbers.
          </p>
        </div>
        <div className="flex flex-col items-start gap-3 sm:items-end">
          <SegmentedToggle value={level} onChange={setLevel} options={LEVEL_OPTIONS} />
          <SegmentedToggle value={type} onChange={setType} options={TYPE_OPTIONS} />
        </div>
      </div>

      {isError && (
        <p className="text-sm text-status-critical">Failed to load report. Is the API running?</p>
      )}

      {isLoading && <Skeleton className="h-96 w-full" />}

      {data && groups.length === 0 && (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No Facebook purchase data broken down by {columnLabel.toLowerCase()} in this range yet.
        </p>
      )}

      {data && groups.length > 0 && (
        <div className="flex flex-col gap-4">
          {groups.map((group) => (
            <Card key={group.key} className="px-0">
              <CardHeader className="flex flex-row items-center justify-between gap-3 px-4">
                <CardTitle className="truncate text-sm">{group.name}</CardTitle>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatNumber(group.total)} purchase{group.total === 1 ? "" : "s"}
                </span>
              </CardHeader>
              <CardContent className="px-0">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                        {columnLabel}
                      </TableHead>
                      <TableHead className="text-right text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                        Purchases
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {group.rows.map((row) => (
                      <TableRow key={row.breakdownValue}>
                        <TableCell className="font-medium">{row.breakdownValue}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatNumber(row.purchases)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
