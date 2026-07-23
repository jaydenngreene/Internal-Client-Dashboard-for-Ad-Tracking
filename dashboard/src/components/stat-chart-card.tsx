"use client";

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export interface StatChartSeries {
  key: string;
  label: string;
  color: string;
  // false = stroke-only line, no area fill — matches the existing TrendChart's
  // profit-as-outline-over-the-fills treatment so a 3rd overlapping series
  // doesn't muddy the two filled areas underneath it.
  fillArea?: boolean;
}

export interface StatChartStat {
  key: string;
  label: string;
  value: string;
  color?: string;
}

// Hyros's "Profitability" widget shape: a few headline numbers and one
// multi-series trend chart in a single card, generalized from the
// cost/revenue/profit chart this app already had (see trend-chart.tsx) so any
// widget can reuse it. Stat numbers stay in foreground ink per the dataviz
// skill (color is never carried by a value's own text) — identity comes from
// the small swatch beside each label instead.
export function StatChartCard({
  title,
  stats,
  data,
  series,
  xKey = "label",
}: {
  title: string;
  stats: StatChartStat[];
  data: Record<string, unknown>[];
  series: StatChartSeries[];
  xKey?: string;
}) {
  const config = series.reduce((acc, s) => {
    acc[s.key] = { label: s.label, color: s.color };
    return acc;
  }, {} as ChartConfig);

  return (
    <Card className="px-4">
      <CardHeader className="px-0">
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 px-0">
        <div className="flex flex-wrap items-start gap-6">
          {stats.map((s) => (
            <div key={s.key} className="flex flex-col gap-1">
              <div className="flex items-center gap-1.5">
                {s.color && <span className="size-2 shrink-0 rounded-[2px]" style={{ backgroundColor: s.color }} />}
                <p className="text-xs font-medium text-muted-foreground">{s.label}</p>
              </div>
              <p className="text-xl font-semibold tabular-nums text-foreground">{s.value}</p>
            </div>
          ))}
        </div>
        <ChartContainer config={config} className="aspect-auto h-64 w-full">
          <AreaChart data={data} margin={{ left: 0, right: 12, top: 12, bottom: 0 }}>
            <defs>
              {series.map((s) => (
                <linearGradient key={s.key} id={`fill-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={s.color} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={s.color} stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey={xKey} tickLine={false} axisLine={false} tickMargin={8} minTickGap={32} />
            <YAxis tickLine={false} axisLine={false} tickMargin={8} width={56} />
            <ChartTooltip content={<ChartTooltipContent indicator="dot" />} />
            {series.map((s) => (
              <Area
                key={s.key}
                dataKey={s.key}
                type="monotone"
                stroke={s.color}
                strokeWidth={2}
                fill={s.fillArea === false ? "none" : `url(#fill-${s.key})`}
                isAnimationActive={false}
              />
            ))}
            <ChartLegend content={<ChartLegendContent />} />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
