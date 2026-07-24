"use client";

import { useEffect, useRef, useState } from "react";
import { Bookmark, X } from "lucide-react";
import { RANGE_PRESETS, RangePreset } from "@/lib/date-range";
import { DateRange } from "@/lib/api";
import { cn } from "@/lib/utils";

// A lightweight version of "saved dashboard views" (Hyros's drag-and-drop
// dashboards, Rockerbox's saved custom views) scoped to what's actually cheap
// and real right now: name the current date range, jump back to it later.
// Stored per-browser in localStorage, not a backend table - covers most of the
// perceived value ("get back to the view I was just looking at") without a
// bigger views/columns/filters schema this app doesn't have anywhere else yet.
interface SavedView {
  id: string;
  name: string;
  preset: RangePreset;
  customRange?: DateRange;
}

const STORAGE_KEY = "adt-saved-views";

function readViews(): SavedView[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeViews(views: SavedView[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(views));
  } catch {
    // Storage unavailable (private browsing, quota) - saving silently no-ops
    // rather than crashing the picker.
  }
}

function presetLabel(preset: RangePreset): string {
  return RANGE_PRESETS.find((p) => p.value === preset)?.label ?? preset;
}

export function SavedViews({
  preset,
  customRange,
  onApply,
}: {
  preset: RangePreset;
  customRange?: DateRange;
  onApply: (preset: RangePreset, customRange?: DateRange) => void;
}) {
  const [open, setOpen] = useState(false);
  const [views, setViews] = useState<SavedView[]>([]);
  const [nameDraft, setNameDraft] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setViews(readViews());
  }, []);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function save() {
    const name = nameDraft.trim();
    if (!name) return;
    const next = [...views, { id: crypto.randomUUID(), name, preset, customRange }];
    setViews(next);
    writeViews(next);
    setNameDraft("");
  }

  function remove(id: string) {
    const next = views.filter((v) => v.id !== id);
    setViews(next);
    writeViews(next);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Saved views"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Saved views"
        className={cn(
          "flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground",
          open && "bg-muted text-foreground"
        )}
      >
        <Bookmark className="size-4" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-10 z-40 w-64 rounded-md border border-border bg-popover p-2 shadow-lg">
          <p className="px-1 pb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Saved views
          </p>
          {views.length === 0 && (
            <p className="px-1 pb-2 text-xs text-muted-foreground">No saved views yet.</p>
          )}
          <div className="flex flex-col gap-0.5">
            {views.map((v) => (
              <div key={v.id} className="group flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    onApply(v.preset, v.customRange);
                    setOpen(false);
                  }}
                  className="flex-1 truncate rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                >
                  {v.name}
                  <span className="ml-1.5 text-xs text-muted-foreground">{presetLabel(v.preset)}</span>
                </button>
                <button
                  type="button"
                  onClick={() => remove(v.id)}
                  aria-label={`Remove ${v.name}`}
                  className="rounded-md p-1 text-muted-foreground opacity-0 hover:bg-accent hover:text-foreground group-hover:opacity-100"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-1.5 border-t border-border pt-2">
            <input
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && save()}
              placeholder={`Save "${presetLabel(preset)}" as…`}
              className="h-8 flex-1 min-w-0 rounded-md border border-input bg-transparent px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <button
              type="button"
              onClick={save}
              disabled={!nameDraft.trim()}
              className="h-8 shrink-0 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground disabled:opacity-40"
            >
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
