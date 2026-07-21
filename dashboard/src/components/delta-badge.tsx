import { cn } from "@/lib/utils";

export function DeltaBadge({ pct }: { pct: number | null }) {
  if (pct === null) {
    return <span className="text-xs text-muted-foreground">-</span>;
  }
  const isUp = pct > 0;
  const isFlat = pct === 0;
  return (
    <span
      className={cn(
        "text-xs font-medium tabular-nums",
        isFlat ? "text-muted-foreground" : isUp ? "text-status-good" : "text-status-critical"
      )}
    >
      {isFlat ? "" : isUp ? "↑ " : "↓ "}
      {Math.abs(pct).toFixed(1)}%
    </span>
  );
}
