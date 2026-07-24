"use client";

import { useTheme } from "next-themes";
import { usePathname } from "next/navigation";
import { Bell, Menu, Moon, Sun } from "lucide-react";
import { DateRangeSelect } from "./date-range-select";
import { SavedViews } from "./saved-views";
import { useDateRangeState } from "@/lib/date-range";

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <button
      type="button"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      aria-label="Toggle theme"
      title="Toggle theme"
      className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      {/* CSS-driven rather than a mounted-state check — the .dark class next-themes
          toggles is already the source of truth, so no hydration-flash workaround needed. */}
      <Sun className="size-4 dark:hidden" />
      <Moon className="hidden size-4 dark:block" />
    </button>
  );
}

// Real accounts don't have a per-client date range that matters here — only
// gated off Account Settings, which has no date-scoped content at all.
const NO_DATE_RANGE_PATHS = ["/account"];

// A persistent utility bar above every page's content — Hyros's app has one
// (theme toggle, notifications, avatar) and this app previously had no
// desktop header at all, content sat flush against the sidebar. Folds in the
// mobile hamburger that used to be its own separate bar. Also now the single
// shared home for the date-range picker (reads the same DateRangeProvider
// instance every report page already consumes via useDateRangeState) instead
// of each page rendering its own copy - a real step toward the "one control
// governs every widget" global-filter-bar pattern Northbeam/Datadog use,
// rather than scattered per-page pickers that happened to stay in sync only
// because they shared a storage key.
export function HeaderBar({ onMenuClick }: { onMenuClick: () => void }) {
  const pathname = usePathname();
  const { preset, setPreset, customRange, setCustomRange } = useDateRangeState();
  const showDateRange = !NO_DATE_RANGE_PATHS.includes(pathname);

  return (
    <div className="sticky top-0 z-30 flex h-12 shrink-0 items-center gap-2 border-b border-border bg-background/95 px-3 backdrop-blur supports-backdrop-filter:bg-background/75 md:px-4">
      <button
        type="button"
        onClick={onMenuClick}
        aria-label="Open menu"
        className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground md:hidden"
      >
        <Menu className="size-5" />
      </button>
      <div className="flex-1" />
      {showDateRange && (
        <>
          <DateRangeSelect value={preset} onChange={setPreset} customRange={customRange} onCustomRangeChange={setCustomRange} />
          <SavedViews
            preset={preset}
            customRange={customRange}
            onApply={(nextPreset, nextCustomRange) => {
              setPreset(nextPreset);
              if (nextCustomRange) setCustomRange(nextCustomRange);
            }}
          />
        </>
      )}
      <button
        type="button"
        aria-label="Notifications"
        title="Notifications"
        className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <Bell className="size-4" />
      </button>
      <ThemeToggle />
    </div>
  );
}
