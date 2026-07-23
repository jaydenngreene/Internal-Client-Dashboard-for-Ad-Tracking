"use client";

import { Area, AreaChart, ResponsiveContainer, Tooltip } from "recharts";
import { Card } from "@/components/ui/card";
import { formatDateShort } from "@/lib/format";

interface KpiTileProps {
  label: string;
  value: string;
  fromDate: string;
  // Both omitted together = no background chart (e.g. Overview's Basic View
  // Leads/Sales tiles, which have no daily series to draw from) — just the
  // label/value/date block, no crash on an empty array.
  color?: string;
  sparkline?: number[];
  // Parallel to sparkline, one ISO date per point — powers the hover tooltip's
  // date label. Omitted = tooltip shows just the value, no date.
  dates?: string[];
  // Formats a single sparkline point for the hover tooltip (e.g. formatCurrency,
  // formatRoas) — without it the tooltip falls back to a plain localized number.
  formatValue?: (v: number) => string;
  sublabel?: string;
}

interface SparkPoint {
  i: number;
  v: number;
  date?: string;
}

function SparkTooltip({
  active,
  payload,
  formatValue,
}: {
  active?: boolean;
  payload?: { payload: SparkPoint }[];
  formatValue?: (v: number) => string;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className="rounded-md border border-border/50 bg-popover px-2 py-1 text-[11px] shadow-lg">
      <p className="font-semibold tabular-nums text-foreground">
        {formatValue ? formatValue(point.v) : point.v.toLocaleString()}
      </p>
      {point.date && <p className="text-muted-foreground">{formatDateShort(point.date)}</p>}
    </div>
  );
}

// The chart sits in its own band below the label/value/date block (bled to the
// card's left/right/bottom edges), not layered behind the text — running it
// full-bleed behind the number the way an earlier pass did let tall peaks
// overlap and clip against the text above it.
export function KpiTile({ label, value, fromDate, color, sparkline, dates, formatValue, sublabel }: KpiTileProps) {
  const hasChart = !!color && !!sparkline && sparkline.length > 0;
  const data: SparkPoint[] = hasChart ? sparkline.map((v, i) => ({ i, v, date: dates?.[i] })) : [];
  const gradientId = `spark-${label.replace(/\s+/g, "-").toLowerCase()}`;

  return (
    <Card className={hasChart ? "overflow-hidden px-4 pb-0" : "px-4"}>
      <div className="min-w-0">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{value}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          from {formatDateShort(fromDate)}
          {sublabel ? ` · ${sublabel}` : ""}
        </p>
      </div>
      {hasChart && (
        <div className="-mx-4 h-16">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.4} />
                  <stop offset="100%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Tooltip
                content={<SparkTooltip formatValue={formatValue} />}
                cursor={{ stroke: color, strokeWidth: 1, strokeDasharray: "3 3" }}
                isAnimationActive={false}
              />
              <Area
                type="monotone"
                dataKey="v"
                stroke={color}
                strokeWidth={1.75}
                fill={`url(#${gradientId})`}
                isAnimationActive={false}
                activeDot={{ r: 3 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}
