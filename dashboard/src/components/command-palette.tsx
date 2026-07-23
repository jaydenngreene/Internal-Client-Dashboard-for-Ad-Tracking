"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { Search, Building2, LayoutDashboard } from "lucide-react";
import { NAV_SECTIONS } from "@/lib/nav-items";
import { cn } from "@/lib/utils";
import type { Client } from "@/lib/api";

interface Entry {
  key: string;
  label: string;
  group: string;
  href: string;
  icon: typeof Search;
}

// A ⌘K palette so switching between clients and jumping to a report page doesn't
// require scrolling a 20+ item sidebar — the single highest-leverage nav addition
// for someone managing many clients in one sitting. Deliberately no fuzzy-scoring
// library: a plain case-insensitive substring match over a list this size (a
// few dozen clients, ~20 nav items) is instant and has no ranking surprises.
export function CommandPalette({ clients, activeClientId }: { clients: Client[]; activeClientId?: string }) {
  const router = useRouter();
  const params = useParams<{ clientId?: string }>();
  const currentClientId = activeClientId ?? params?.clientId;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    }
    function onOpenEvent() {
      setOpen(true);
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("adt:open-command-palette", onOpenEvent);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("adt:open-command-palette", onOpenEvent);
    };
  }, []);

  useEffect(() => {
    if (open) {
      setQuery("");
      setHighlighted(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const entries: Entry[] = useMemo(() => {
    const list: Entry[] = [
      { key: "agency", label: "Agency Overview", group: "Go to", href: "/agency", icon: Building2 },
    ];
    for (const client of clients) {
      list.push({
        key: `client-${client.id}`,
        label: client.name,
        group: "Clients",
        href: `/clients/${client.id}/overview`,
        icon: Building2,
      });
    }
    if (currentClientId) {
      const activeClient = clients.find((c) => c.id === currentClientId);
      for (const section of NAV_SECTIONS) {
        for (const item of section.items) {
          if (item.niches && !(activeClient && item.niches.includes(activeClient.niche))) continue;
          list.push({
            key: `nav-${item.slug}`,
            label: item.label,
            group: activeClient ? `${activeClient.name} — ${section.label}` : section.label,
            href: `/clients/${currentClientId}/${item.slug}`,
            icon: item.icon,
          });
        }
      }
    }
    return list;
  }, [clients, currentClientId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries.slice(0, 20);
    return entries.filter((e) => e.label.toLowerCase().includes(q) || e.group.toLowerCase().includes(q)).slice(0, 20);
  }, [entries, query]);

  function select(entry: Entry) {
    router.push(entry.href);
    setOpen(false);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center bg-black/60 pt-[12vh]" onClick={() => setOpen(false)}>
      <div
        className="flex w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-2xl shadow-black/50"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border px-3">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setHighlighted(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setHighlighted((h) => Math.min(h + 1, filtered.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setHighlighted((h) => Math.max(h - 1, 0));
              } else if (e.key === "Enter" && filtered[highlighted]) {
                select(filtered[highlighted]);
              }
            }}
            placeholder="Jump to a client or report…"
            className="h-11 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <kbd className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">Esc</kbd>
        </div>
        <div className="max-h-80 overflow-y-auto py-1">
          {filtered.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">No matches.</p>
          )}
          {filtered.map((entry, i) => {
            const Icon = entry.icon ?? LayoutDashboard;
            return (
              <button
                key={entry.key}
                type="button"
                onMouseEnter={() => setHighlighted(i)}
                onClick={() => select(entry)}
                className={cn(
                  "flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors",
                  highlighted === i ? "bg-accent text-accent-foreground" : "text-foreground"
                )}
              >
                <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="flex-1 truncate">{entry.label}</span>
                <span className="shrink-0 truncate text-[11px] text-muted-foreground">{entry.group}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
