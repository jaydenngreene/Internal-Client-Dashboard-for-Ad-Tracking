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
import { formatDateShort } from "@/lib/format";

const chartConfig = {
  cost: { label: "Ad Spend", color: "var(--color-chart-2)" },
  revenue: { label: "Revenue", color: "var(--color-chart-1)" },
  profit: { label: "Profit", color: "var(--color-chart-3)" },
} satisfies ChartConfig;

// Deliberately just the four fields actually rendered below (not the full
// OverviewSeriesPoint) — this chart is shared by the full Overview page's
// series and the public share report's simpler one, which doesn't carry
// attribution-split fields.
interface TrendChartPoint {
  date: string;
  cost: number;
  revenue: number;
  profit: number;
}

export function TrendChart({ series }: { series: TrendChartPoint[] }) {
  const data = series.map((point) => ({
    ...point,
    label: formatDateShort(point.date),
  }));

  return (
    <ChartContainer config={chartConfig} className="aspect-auto h-72 w-full">
      <AreaChart data={data} margin={{ left: 0, right: 12, top: 12, bottom: 0 }}>
        <defs>
          <linearGradient id="fill-revenue" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-chart-1)" stopOpacity={0.3} />
            <stop offset="95%" stopColor="var(--color-chart-1)" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="fill-cost" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-chart-2)" stopOpacity={0.25} />
            <stop offset="95%" stopColor="var(--color-chart-2)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={32}
        />
        <YAxis tickLine={false} axisLine={false} tickMargin={8} width={56} />
        <ChartTooltip content={<ChartTooltipContent indicator="dot" />} />
        <Area
          dataKey="revenue"
          type="monotone"
          stroke="var(--color-chart-1)"
          strokeWidth={2}
          fill="url(#fill-revenue)"
          isAnimationActive={false}
        />
        <Area
          dataKey="cost"
          type="monotone"
          stroke="var(--color-chart-2)"
          strokeWidth={2}
          fill="url(#fill-cost)"
          isAnimationActive={false}
        />
        <Area
          dataKey="profit"
          type="monotone"
          stroke="var(--color-chart-3)"
          strokeWidth={2}
          fill="none"
          isAnimationActive={false}
        />
        <ChartLegend content={<ChartLegendContent />} />
      </AreaChart>
    </ChartContainer>
  );
}
