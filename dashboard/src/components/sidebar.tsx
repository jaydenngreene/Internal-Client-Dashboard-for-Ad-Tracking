"use client";

import Link from "next/link";
import { usePathname, useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Radar } from "lucide-react";
import { getClients } from "@/lib/api";
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
  { slug: "campaigns", label: "Campaigns", enabled: true },
  { slug: "funnel", label: "Funnel", enabled: true },
  { slug: "leads", label: "Leads", enabled: true },
  { slug: "subscriptions", label: "Subscriptions", enabled: true, niches: ["saas"] },
  { slug: "remarketing", label: "Remarketing", enabled: true },
  { slug: "tags", label: "Tags & Stages", enabled: true },
  { slug: "audiences", label: "Audiences", enabled: true },
  { slug: "cohorts", label: "Cohorts", enabled: true },
  { slug: "settings", label: "Settings", enabled: true },
];

export function Sidebar() {
  const pathname = usePathname();
  const params = useParams<{ clientId?: string }>();
  const activeClientId = params?.clientId;
  const isAgencyOverview = pathname === "/agency";

  const { data: clients, isLoading } = useQuery({
    queryKey: ["clients"],
    queryFn: getClients,
  });

  const activeClient = clients?.find((c) => c.id === activeClientId);
  const activeNiche = activeClient?.niche;
  const visibleNavItems = NAV_ITEMS.filter((item) => !item.niches || (activeNiche && item.niches.includes(activeNiche)));

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
      <div className="flex h-14 items-center gap-2.5 border-b border-sidebar-border px-4">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary">
          <Radar className="size-4" strokeWidth={2.25} />
        </span>
        <span className="text-sm font-semibold tracking-tight text-sidebar-foreground">
          Ad Tracking
        </span>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-4">
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
    </aside>
  );
}
