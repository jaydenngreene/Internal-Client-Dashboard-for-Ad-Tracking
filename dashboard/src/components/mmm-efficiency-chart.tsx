"use client";

import { Cell, LabelList, ReferenceLine, Scatter, ScatterChart, XAxis, YAxis, ZAxis } from "recharts";
import { ChartContainer, ChartTooltip } from "@/components/ui/chart";
import { MmmChannel } from "@/lib/api";
import { formatCurrency, formatPlatformLabel } from "@/lib/format";

// The "how do my channels actually compare" question this page exists to
// answer was previously only answerable by reading a grid of number cards one
// at a time. Plotting spend against marginal efficiency turns that into one
// glance: how far right (how much is going in) crossed against how far above
// the break-even line (whether that money is actually working), with bubble
// size carrying the third number (estimated $/day it's actually producing)
// instead of a 3D render — legible for a 2-5 channel account, which is what
// this page realistically shows, rather than a showpiece that needs a dozen
// points to not look sparse.
interface EfficiencyPoint {
  platform: string;
  label: string;
  avgDailySpend: number;
  coefficientPerDollar: number;
  contribution: number;
}

function statusColor(coefficientPerDollar: number): string {
  if (coefficientPerDollar >= 1.2) return "var(--status-good)";
  if (coefficientPerDollar >= 0.8) return "var(--status-warning)";
  return "var(--status-critical)";
}

function statusLabel(coefficientPerDollar: number): string {
  if (coefficientPerDollar >= 1.2) return "Profitable at the margin";
  if (coefficientPerDollar >= 0.8) return "Roughly break-even";
  return "Losing money at the margin";
}

function EfficiencyTooltip({ active, payload }: { active?: boolean; payload?: { payload: EfficiencyPoint }[] }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="grid gap-1 rounded-lg border border-border/50 bg-background px-3 py-2 text-xs shadow-xl">
      <p className="font-medium text-foreground">{p.label}</p>
      <p className="text-muted-foreground">
        Avg daily spend: <span className="font-mono tabular-nums text-foreground">{formatCurrency(p.avgDailySpend)}</span>
      </p>
      <p className="text-muted-foreground">
        Revenue per $1 spent:{" "}
        <span className="font-mono tabular-nums text-foreground">{formatCurrency(p.coefficientPerDollar)}</span>
      </p>
      <p className="text-muted-foreground">
        Est. daily revenue from this channel:{" "}
        <span className="font-mono tabular-nums text-foreground">{formatCurrency(Math.max(p.contribution, 0))}</span>
      </p>
      <p className="font-medium" style={{ color: statusColor(p.coefficientPerDollar) }}>
        {statusLabel(p.coefficientPerDollar)}
      </p>
    </div>
  );
}

export function MmmEfficiencyChart({ channels }: { channels: MmmChannel[] }) {
  const points: EfficiencyPoint[] = channels.map((c) => ({
    platform: c.platform,
    label: formatPlatformLabel(c.platform) ?? c.platform,
    avgDailySpend: c.avgDailySpend,
    coefficientPerDollar: c.coefficientPerDollar,
    contribution: c.coefficientPerDollar * c.avgDailySpend,
  }));

  // Recharts' default auto-domain is exactly [dataMin, dataMax], which plants
  // the extreme points flush against the plot edge - their bubble radius and
  // platform-name label then get clipped by the chart's own bounding box.
  // Padding both axes past the data range keeps every point (and its label)
  // fully inside the plot no matter how few channels there are.
  const spendValues = points.map((p) => p.avgDailySpend);
  const maxSpend = Math.max(...spendValues, 0);
  const minSpend = Math.min(...spendValues, 0);
  const spendPad = Math.max((maxSpend - minSpend) * 0.25, maxSpend * 0.15, 10);
  const xDomain: [number, number] = [Math.max(0, minSpend - spendPad), maxSpend + spendPad];

  const coefValues = points.map((p) => p.coefficientPerDollar);
  const maxCoef = Math.max(...coefValues, 1);
  const minCoef = Math.min(...coefValues, 0);
  const coefPad = Math.max((maxCoef - minCoef) * 0.3, 0.4);
  const yDomain: [number, number] = [minCoef - coefPad, maxCoef + coefPad];

  return (
    <div className="flex flex-col gap-2">
      <ChartContainer config={{}} className="aspect-auto h-80 w-full">
        <ScatterChart margin={{ top: 20, right: 28, bottom: 28, left: 8 }}>
          <XAxis
            type="number"
            dataKey="avgDailySpend"
            name="Avg daily spend"
            domain={xDomain}
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            tickFormatter={(v: number) => formatCurrency(v)}
            label={{ value: "Avg daily spend", position: "insideBottom", offset: -20, fill: "var(--muted-foreground)", fontSize: 11 }}
          />
          <YAxis
            type="number"
            dataKey="coefficientPerDollar"
            name="Revenue per $1 spent"
            domain={yDomain}
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            width={60}
            tickFormatter={(v: number) => formatCurrency(v)}
            label={{
              value: "Revenue per $1 spent",
              angle: -90,
              position: "insideLeft",
              fill: "var(--muted-foreground)",
              fontSize: 11,
              style: { textAnchor: "middle" },
            }}
          />
          <ZAxis type="number" dataKey="contribution" range={[300, 2200]} />
          <ReferenceLine
            y={1}
            stroke="var(--border)"
            strokeDasharray="4 4"
            label={{ value: "Break-even", position: "insideTopRight", fill: "var(--muted-foreground)", fontSize: 11 }}
          />
          <ChartTooltip content={<EfficiencyTooltip />} cursor={{ strokeDasharray: "3 3" }} />
          <Scatter data={points} isAnimationActive={false}>
            {points.map((p) => (
              <Cell key={p.platform} fill={statusColor(p.coefficientPerDollar)} fillOpacity={0.7} stroke={statusColor(p.coefficientPerDollar)} />
            ))}
            <LabelList
              dataKey="label"
              position="top"
              offset={10}
              style={{ fontSize: 11, fontWeight: 500, fill: "var(--foreground)" }}
            />
          </Scatter>
        </ScatterChart>
      </ChartContainer>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full" style={{ background: "var(--status-good)" }} />
          Profitable at the margin
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full" style={{ background: "var(--status-warning)" }} />
          Roughly break-even
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full" style={{ background: "var(--status-critical)" }} />
          Losing money at the margin
        </span>
        <span className="ml-auto">Bubble size = estimated daily revenue from that channel</span>
      </div>
    </div>
  );
}
