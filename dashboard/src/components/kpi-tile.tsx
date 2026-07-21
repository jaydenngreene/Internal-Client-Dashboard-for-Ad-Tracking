"use client";

import { Area, AreaChart, ResponsiveContainer } from "recharts";
import { Card } from "@/components/ui/card";
import { formatDateShort } from "@/lib/format";

interface KpiTileProps {
  label: string;
  value: string;
  fromDate: string;
  color: string;
  sparkline: number[];
}

export function KpiTile({ label, value, fromDate, color, sparkline }: KpiTileProps) {
  const data = sparkline.map((v, i) => ({ i, v }));
  const gradientId = `spark-${label.replace(/\s+/g, "-").toLowerCase()}`;

  return (
    <Card className="flex-row items-center justify-between gap-4 px-4">
      <div className="min-w-0">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{value}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">from {formatDateShort(fromDate)}</p>
      </div>
      <div className="h-12 w-24 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.35} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <Area
              type="monotone"
              dataKey="v"
              stroke={color}
              strokeWidth={2}
              fill={`url(#${gradientId})`}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
