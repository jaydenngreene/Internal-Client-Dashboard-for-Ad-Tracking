"use client";

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { SubscriptionsSeriesPoint } from "@/lib/api";
import { formatDateShort } from "@/lib/format";

const chartConfig = {
  mrr: { label: "MRR", color: "var(--color-chart-1)" },
} satisfies ChartConfig;

// Single series — per the dataviz convention, one series needs no legend box, the
// chart title already names it.
export function MrrTrendChart({ series }: { series: SubscriptionsSeriesPoint[] }) {
  const data = series.map((point) => ({ ...point, label: formatDateShort(point.date) }));

  return (
    <ChartContainer config={chartConfig} className="aspect-auto h-72 w-full">
      <AreaChart data={data} margin={{ left: 0, right: 12, top: 12, bottom: 0 }}>
        <defs>
          <linearGradient id="fill-mrr" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-chart-1)" stopOpacity={0.3} />
            <stop offset="95%" stopColor="var(--color-chart-1)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={32} />
        <YAxis tickLine={false} axisLine={false} tickMargin={8} width={56} />
        <ChartTooltip content={<ChartTooltipContent indicator="dot" />} />
        <Area
          dataKey="mrr"
          type="monotone"
          stroke="var(--color-chart-1)"
          strokeWidth={2}
          fill="url(#fill-mrr)"
          isAnimationActive={false}
        />
      </AreaChart>
    </ChartContainer>
  );
}
