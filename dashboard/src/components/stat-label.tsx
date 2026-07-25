import { InfoTooltip } from "@/components/ui/info-tooltip";
import { cn } from "@/lib/utils";

// The micro-label above a hand-built stat block (BudgetPacingCard, ForecastWindowCard,
// SnapshotStat) — every one of these previously hardcoded its own
// `<p className="text-xs font-medium text-muted-foreground">{label}</p>`, so this
// pulls that repeated shape into one place and gives it an optional info icon slot.
export function StatLabel({ label, tooltip, className }: { label: string; tooltip?: string; className?: string }) {
  return (
    <p className={cn("flex items-center gap-1 text-xs font-medium text-muted-foreground", className)}>
      {label}
      {tooltip && <InfoTooltip text={tooltip} />}
    </p>
  );
}
