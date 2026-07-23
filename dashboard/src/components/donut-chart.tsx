"use client";

import { Cell, Pie, PieChart } from "recharts";
import { ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { cn } from "@/lib/utils";

export interface DonutSegment {
  key: string;
  label: string;
  value: number;
  color: string;
}

// A "part of a whole" widget (Hyros's Cart/Lead Conversion donuts) — this
// codebase's first pie/donut chart. A 2px card-color stroke between segments
// stands in for the dataviz skill's surface-gap spacer rule, and the legend
// below is mandatory (never color-alone) since a segment's color is its only
// encoding otherwise.
export function DonutChart({
  segments,
  centerLabel,
  centerValue,
  className,
}: {
  segments: DonutSegment[];
  centerLabel?: string;
  centerValue?: string;
  className?: string;
}) {
  const config = segments.reduce((acc, s) => {
    acc[s.key] = { label: s.label, color: s.color };
    return acc;
  }, {} as ChartConfig);

  const total = segments.reduce((sum, s) => sum + s.value, 0);

  return (
    <div className={cn("flex flex-col items-center gap-3", className)}>
      <div className="relative">
        <ChartContainer config={config} className="aspect-square h-40 w-40">
          <PieChart>
            <ChartTooltip content={<ChartTooltipContent hideLabel />} />
            <Pie
              data={segments}
              dataKey="value"
              nameKey="label"
              innerRadius="65%"
              outerRadius="100%"
              strokeWidth={2}
              stroke="var(--card)"
              isAnimationActive={false}
            >
              {segments.map((s) => (
                <Cell key={s.key} fill={s.color} />
              ))}
            </Pie>
          </PieChart>
        </ChartContainer>
        {(centerLabel || centerValue) && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            {centerValue && <p className="text-xl font-semibold tabular-nums text-foreground">{centerValue}</p>}
            {centerLabel && <p className="text-[11px] text-muted-foreground">{centerLabel}</p>}
          </div>
        )}
      </div>
      <ul className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
        {segments.map((s) => {
          const pct = total > 0 ? (s.value / total) * 100 : 0;
          return (
            <li key={s.key} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="size-2 shrink-0 rounded-[2px]" style={{ backgroundColor: s.color }} />
              {s.label}
              <span className="font-medium tabular-nums text-foreground">{pct.toFixed(0)}%</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
