import Link from "next/link";
import { Info } from "lucide-react";
import { Tooltip } from "@base-ui/react/tooltip";
import { cn } from "@/lib/utils";

// The small "i" glyph next to a label that reveals a definition on hover/focus
// (Meta Ads Manager's own convention for this). Built on Base UI's Tooltip
// (already a dependency via select.tsx) rather than the old pure-CSS version —
// that one positioned itself with `absolute top-full left-0` *inside* whatever
// container it was in, which meant it silently clipped or got cut off any time
// the trigger sat inside a `Card` (cards are `overflow-hidden`, see card.tsx)
// or near a viewport edge. Base UI's Portal renders the popup into
// `document.body` and its Positioner auto-flips/shifts to stay on-screen, so
// this can be dropped next to any label anywhere without checking what
// contains it.
//
// If `href` is given, the icon itself becomes a link (not a link *inside* the
// tooltip bubble — a tooltip's ARIA role must not contain focusable content)
// and the popup gets a "view full setup guide"-style hint appended, for
// descriptions too long to comfortably read in a hover bubble.
export function InfoTooltip({
  text,
  href,
  linkLabel = "Full setup guide",
  className,
}: {
  text: string;
  href?: string;
  linkLabel?: string;
  className?: string;
}) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger
        aria-label={text}
        delay={150}
        render={
          href ? (
            <Link
              href={href}
              className={cn(
                "inline-flex shrink-0 text-muted-foreground/50 outline-none transition-colors hover:text-primary focus-visible:text-primary",
                className
              )}
            />
          ) : (
            <button
              type="button"
              className={cn(
                "inline-flex shrink-0 text-muted-foreground/50 outline-none transition-colors hover:text-muted-foreground focus-visible:text-muted-foreground",
                className
              )}
            />
          )
        }
      >
        <Info className="h-3 w-3" />
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Positioner side="top" sideOffset={6} collisionPadding={8} className="z-50">
          <Tooltip.Popup className="max-w-[min(18rem,calc(100vw-1.5rem))] rounded-md border border-border/50 bg-popover px-2.5 py-1.5 text-[11px] font-normal normal-case leading-snug text-popover-foreground shadow-lg">
            <p>{text}</p>
            {href && <p className="mt-1 font-medium text-primary">{linkLabel} →</p>}
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
