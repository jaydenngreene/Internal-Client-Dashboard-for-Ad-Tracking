import { CreativeRole } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// Customer Journey / Ad Role badge - which job a creative is strongest at, so
// a cold-traffic opener doesn't get judged (and cut) purely on last-click
// revenue. Shared by every surface that lists individual creatives (the
// Campaigns page's Creative tab, and the campaign detail page's own creative
// list) so the same ad shows the same role tag everywhere it appears. See
// api/src/lib/creativeRoles.ts for the full methodology.
export const ROLE_LABEL: Record<CreativeRole, string> = {
  opener: "Opener",
  closer: "Closer",
  assist: "Assist",
  multi_role: "Multi-Role",
};

const ROLE_BADGE_CLASS: Record<CreativeRole, string> = {
  opener: "border-chart-4/40 bg-chart-4/10 text-chart-4",
  closer: "border-chart-1/40 bg-chart-1/10 text-chart-1",
  assist: "border-chart-3/40 bg-chart-3/10 text-chart-3",
  multi_role: "border-border bg-muted text-muted-foreground",
};

export function RoleBadge({ role }: { role: CreativeRole }) {
  return (
    <Badge variant="outline" className={cn("text-[10px]", ROLE_BADGE_CLASS[role])}>
      {ROLE_LABEL[role]}
    </Badge>
  );
}
