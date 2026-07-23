"use client";

import Link from "next/link";
import { usePathname, useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Radar, X, Settings, Users } from "lucide-react";
import { getClients, getMe } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { CommandPalette } from "@/components/command-palette";
import { NAV_SECTIONS } from "@/lib/nav-items";

const navLinkBase =
  "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar";

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
  const visibleSections = NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => !item.niches || (activeNiche && item.niches.includes(activeNiche))),
  })).filter((section) => section.items.length > 0);

  return (
    <>
      <CommandPalette clients={clients ?? []} activeClientId={activeClientId} />
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
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            window.dispatchEvent(new CustomEvent("adt:open-command-palette"));
          }}
          className="mb-4 flex w-full items-center gap-2 rounded-md border border-sidebar-border bg-sidebar-accent/40 px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-sidebar-accent/70 hover:text-sidebar-foreground"
        >
          <span className="flex-1">Jump to…</span>
          <kbd className="rounded border border-sidebar-border bg-sidebar px-1.5 py-0.5 font-mono text-[10px]">⌘K</kbd>
        </button>

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
          <div className="flex flex-col gap-5">
            {activeClient && (
              <p className="truncate px-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                {activeClient.name}
              </p>
            )}
            {visibleSections.map((section) => (
              <div key={section.label}>
                <p className="mb-1.5 px-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
                  {section.label}
                </p>
                <ul className="space-y-0.5">
                  {section.items.map((item) => {
                    const href = `/clients/${activeClientId}/${item.slug}`;
                    const isActive = pathname === href;
                    const Icon = item.icon;
                    return (
                      <li key={item.slug}>
                        {item.enabled ? (
                          <Link
                            href={href}
                            className={cn(
                              navLinkBase,
                              isActive
                                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                                : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
                            )}
                          >
                            <Icon className="size-3.5 shrink-0" strokeWidth={2} />
                            <span className="truncate">{item.label}</span>
                          </Link>
                        ) : (
                          <div className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground/40">
                            <Icon className="size-3.5 shrink-0" strokeWidth={2} />
                            <span className="truncate">{item.label}</span>
                            <span className="ml-auto text-[10px] uppercase tracking-wide">Soon</span>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
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
