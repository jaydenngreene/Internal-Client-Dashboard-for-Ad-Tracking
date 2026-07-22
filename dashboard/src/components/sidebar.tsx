"use client";

import Link from "next/link";
import { usePathname, useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Radar, X, Settings, Users } from "lucide-react";
import { getClients, getMe } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

const navLinkBase =
  "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar";

// `niches` restricts a nav item to clients of that niche (e.g. Subscriptions only
// makes sense for niche='saas'); omitted entirely means it shows for every client —
// this is the sidebar's first niche-aware nav item (existing niche filtering only
// happened *within* a page, e.g. funnel-client.tsx's cart cards).
const NAV_ITEMS: { slug: string; label: string; enabled: boolean; niches?: string[] }[] = [
  { slug: "overview", label: "Overview", enabled: true },
  { slug: "insights", label: "Insights", enabled: true },
  { slug: "chat", label: "Ask Your Data", enabled: true },
  { slug: "campaigns", label: "Campaigns", enabled: true },
  { slug: "funnel", label: "Funnel", enabled: true },
  { slug: "mmm", label: "Media Mix Model", enabled: true },
  { slug: "leads", label: "Leads", enabled: true },
  { slug: "subscriptions", label: "Subscriptions", enabled: true, niches: ["saas"] },
  { slug: "email-sms", label: "Email & SMS", enabled: true },
  { slug: "remarketing", label: "Remarketing", enabled: true },
  { slug: "pause-candidates", label: "Pause Candidates", enabled: true },
  { slug: "budget-reallocation", label: "Budget Reallocation", enabled: true },
  { slug: "creative-fatigue", label: "Creative Fatigue", enabled: true },
  { slug: "invalid-traffic", label: "Invalid Traffic", enabled: true },
  { slug: "incrementality", label: "Incrementality Testing", enabled: true },
  { slug: "geo-lift", label: "Geo-Lift Testing", enabled: true },
  { slug: "tags", label: "Tags & Stages", enabled: true },
  { slug: "audiences", label: "Audiences", enabled: true },
  { slug: "cohorts", label: "Cohorts", enabled: true },
  { slug: "settings", label: "Settings", enabled: true },
];

// Always in the DOM; a fixed off-canvas drawer below the md breakpoint (slides
// in via `open`), a normal in-flow sidebar at md+ regardless of `open` — the
// same component serves both, no duplicated nav markup.
export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const params = useParams<{ clientId?: string }>();
  const activeClientId = params?.clientId;
  const isAgencyOverview = pathname === "/agency";
  const isAccountSettings = pathname === "/account";

  const { data: clients, isLoading } = useQuery({
    queryKey: ["clients"],
    queryFn: getClients,
  });
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: getMe });

  const activeClient = clients?.find((c) => c.id === activeClientId);
  const activeNiche = activeClient?.niche;
  const visibleNavItems = NAV_ITEMS.filter((item) => !item.niches || (activeNiche && item.niches.includes(activeNiche)));

  return (
    <>
      {open && (
        <div className="fixed inset-0 z-40 bg-black/50 md:hidden" onClick={onClose} aria-hidden="true" />
      )}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex h-full w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar transition-transform duration-200 md:static md:z-auto md:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
      <div className="flex h-14 items-center gap-2.5 border-b border-sidebar-border px-4">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary">
          <Radar className="size-4" strokeWidth={2.25} />
        </span>
        <span className="truncate text-sm font-semibold tracking-tight text-sidebar-foreground">
          {me?.agency_name ?? "Ad Tracking"}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close menu"
          className="ml-auto shrink-0 text-muted-foreground hover:text-sidebar-foreground md:hidden"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-4" onClick={onClose}>
        <div className="mb-6">
          <Link
            href="/agency"
            className={cn(
              navLinkBase,
              "font-medium",
              isAgencyOverview
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
            )}
          >
            <span
              className={cn(
                "h-1.5 w-1.5 shrink-0 rounded-full",
                isAgencyOverview ? "bg-primary" : "bg-muted-foreground/40"
              )}
            />
            Agency Overview
          </Link>
        </div>

        <div className="mb-6">
          <div className="mb-2 flex items-center justify-between px-1">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Clients</p>
            <Link
              href="/clients/new"
              className={cn(
                navLinkBase,
                "px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground hover:text-sidebar-foreground",
                pathname === "/clients/new" && "text-primary"
              )}
            >
              + Add
            </Link>
          </div>
          {isLoading && (
            <div className="space-y-2 px-1">
              <Skeleton className="h-7 w-full" />
              <Skeleton className="h-7 w-full" />
            </div>
          )}
          {!isLoading && clients?.length === 0 && (
            <p className="px-1 text-xs text-muted-foreground">No clients yet</p>
          )}
          <ul className="space-y-0.5">
            {clients?.map((client) => {
              const isActive = client.id === activeClientId;
              return (
                <li key={client.id}>
                  <Link
                    href={`/clients/${client.id}/overview`}
                    className={cn(
                      navLinkBase,
                      isActive
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
                    )}
                  >
                    <span
                      className={cn(
                        "h-1.5 w-1.5 shrink-0 rounded-full",
                        isActive ? "bg-primary" : "bg-muted-foreground/40"
                      )}
                    />
                    <span className="truncate">{client.name}</span>
                    {!client.is_owner && (
                      <span className="ml-auto shrink-0" title="Shared with you">
                        <Users className="size-3 text-muted-foreground" aria-label="Shared with you" />
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>

        {activeClientId && (
          <div>
            <p className="mb-2 truncate px-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {activeClient ? `${activeClient.name} Reports` : "Reports"}
            </p>
            <ul className="space-y-0.5">
              {visibleNavItems.map((item) => {
                const href = `/clients/${activeClientId}/${item.slug}`;
                const isActive = pathname === href;
                return (
                  <li key={item.slug}>
                    {item.enabled ? (
                      <Link
                        href={href}
                        className={cn(
                          navLinkBase,
                          "justify-between",
                          isActive
                            ? "bg-sidebar-accent text-sidebar-accent-foreground"
                            : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
                        )}
                      >
                        {item.label}
                      </Link>
                    ) : (
                      <div className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm text-muted-foreground/40">
                        {item.label}
                        <span className="text-[10px] uppercase tracking-wide">Soon</span>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>

      <div className={cn("flex items-center justify-between border-t border-sidebar-border px-4 py-3", isAccountSettings && "bg-sidebar-accent")}>
        <span className="truncate text-xs text-muted-foreground">{me?.email}</span>
        <Link
          href="/account"
          onClick={onClose}
          aria-label="Account settings"
          title="Account settings"
          className={cn(
            "shrink-0 rounded-md p-1 text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
            isAccountSettings && "text-primary"
          )}
        >
          <Settings className="size-4" />
        </Link>
      </div>
      </aside>
    </>
  );
}
