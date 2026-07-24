"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { getNotificationsSummary } from "@/lib/api";
import { cn } from "@/lib/utils";

// The bell previously did nothing when clicked - a visible, interactive-looking
// control with zero behavior is exactly the kind of thing that reads as broken
// rather than "not implemented yet." This app already has four real advisory
// signals (Pause Candidates, Creative Fatigue, Tracking Health, Budget
// Reallocation) a user would otherwise only ever see by remembering to check
// each page separately - this just counts and links to them, not a new
// notifications table/inbox to maintain.
const CATEGORIES: { key: "pauseCandidates" | "creativeFatigue" | "trackingHealth" | "budgetReallocation"; label: string; href: string }[] = [
  { key: "pauseCandidates", label: "Pause candidates", href: "pause-candidates" },
  { key: "creativeFatigue", label: "Creative fatigue", href: "creative-fatigue" },
  { key: "trackingHealth", label: "Tracking health", href: "tracking-health" },
  { key: "budgetReallocation", label: "Budget reallocation", href: "budget-reallocation" },
];

export function NotificationsBell() {
  const params = useParams<{ clientId?: string }>();
  const clientId = params?.clientId;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const { data } = useQuery({
    queryKey: ["notifications-summary", clientId],
    queryFn: () => getNotificationsSummary(clientId!),
    enabled: !!clientId,
    refetchInterval: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  const total = data?.total ?? 0;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={total > 0 ? `Notifications (${total})` : "Notifications"}
        title="Notifications"
        className={cn(
          "relative flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground",
          open && "bg-muted text-foreground"
        )}
      >
        <Bell className="size-4" />
        {total > 0 && (
          <span className="absolute right-1 top-1 flex size-3.5 items-center justify-center rounded-full bg-status-critical text-[9px] font-semibold text-white">
            {total > 9 ? "9+" : total}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-10 z-40 w-72 rounded-md border border-border bg-popover p-2 shadow-lg">
          <p className="px-1 pb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Needs review
          </p>
          {!clientId && <p className="px-1 pb-1 text-xs text-muted-foreground">Open a client to see what needs review.</p>}
          {clientId && total === 0 && <p className="px-1 pb-1 text-xs text-muted-foreground">Nothing needs review right now.</p>}
          {clientId && total > 0 && (
            <div className="flex flex-col gap-0.5">
              {CATEGORIES.filter((c) => (data?.[c.key] ?? 0) > 0).map((c) => (
                <Link
                  key={c.key}
                  href={`/clients/${clientId}/${c.href}`}
                  onClick={() => setOpen(false)}
                  className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-accent"
                >
                  {c.label}
                  <span className="rounded-full bg-status-critical/15 px-1.5 py-0.5 text-[10px] font-semibold text-status-critical">
                    {data?.[c.key]}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
