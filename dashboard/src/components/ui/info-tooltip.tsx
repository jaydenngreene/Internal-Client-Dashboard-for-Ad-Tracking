import { Info } from "lucide-react";
import { cn } from "@/lib/utils";

// The small "i" glyph next to a stat label that reveals a definition on hover/focus
// (Meta Ads Manager's own convention for this) — pure CSS via the `group/tip` +
// group-hover/focus-within pattern this codebase already uses (see card.tsx's
// group/card), no JS state and no new dependency. The icon is a real <button> (not
// a div) so it's keyboard-reachable and announces via aria-label, matching the
// keyboard-accessibility pass already done on the header dropdowns.
export function InfoTooltip({ text, className }: { text: string; className?: string }) {
  return (
    <span className={cn("group/tip relative inline-flex", className)}>
      <button type="button" aria-label={text} className="inline-flex shrink-0 text-muted-foreground/50 outline-none transition-colors hover:text-muted-foreground focus-visible:text-muted-foreground">
        <Info className="h-3 w-3" />
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute top-full left-0 z-50 mt-1.5 w-56 rounded-md border border-border/50 bg-popover px-2.5 py-1.5 text-[11px] font-normal normal-case leading-snug text-popover-foreground opacity-0 shadow-lg transition-opacity duration-100 group-hover/tip:opacity-100 group-focus-within/tip:opacity-100"
      >
        {text}
      </span>
    </span>
  );
}
