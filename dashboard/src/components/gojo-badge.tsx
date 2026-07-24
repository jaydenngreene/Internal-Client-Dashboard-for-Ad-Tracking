import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

// This app's AI persona, shared everywhere AI-generated content shows up (Gojo
// chat, Insights, remarketing drafts, creative tagging) so it reads as one
// deliberate product feature rather than a handful of separately bolted-on "AI"
// labels — the same reason every serious competitor (Moby, AIR) names its
// assistant instead of just saying "AI" on a button.
export function GojoBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary",
        className
      )}
    >
      <Sparkles className="size-2.5" strokeWidth={2.5} />
      Gojo
    </span>
  );
}
