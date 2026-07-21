"use client";

import Link from "next/link";
import { usePathname, useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { getClients } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

const NAV_ITEMS = [
  { slug: "overview", label: "Overview", enabled: true },
  { slug: "campaigns", label: "Campaigns", enabled: true },
  { slug: "leads", label: "Leads", enabled: true },
  { slug: "ltv", label: "LTV", enabled: false },
  { slug: "cohorts", label: "Cohorts", enabled: false },
];

export function Sidebar() {
  const pathname = usePathname();
  const params = useParams<{ clientId?: string }>();
  const activeClientId = params?.clientId;

  const { data: clients, isLoading } = useQuery({
    queryKey: ["clients"],
    queryFn: getClients,
  });

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-border bg-sidebar">
      <div className="flex h-14 items-center border-b border-sidebar-border px-4">
        <span className="text-sm font-semibold tracking-wide text-sidebar-foreground">
          Ad Tracking
        </span>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-4">
        <div className="mb-6">
          <p className="mb-2 px-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Clients
          </p>
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
                      "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
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
            <p className="mb-2 px-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Reports
            </p>
            <ul className="space-y-0.5">
              {NAV_ITEMS.map((item) => {
                const href = `/clients/${activeClientId}/${item.slug}`;
                const isActive = pathname === href;
                return (
                  <li key={item.slug}>
                    {item.enabled ? (
                      <Link
                        href={href}
                        className={cn(
                          "flex items-center justify-between rounded-md px-2 py-1.5 text-sm transition-colors",
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
