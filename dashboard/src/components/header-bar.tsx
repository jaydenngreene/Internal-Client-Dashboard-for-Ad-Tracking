"use client";

import { useTheme } from "next-themes";
import { Bell, Menu, Moon, Sun } from "lucide-react";

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

// A persistent utility bar above every page's content — Hyros's app has one
// (theme toggle, notifications, avatar) and this app previously had no
// desktop header at all, content sat flush against the sidebar. Folds in the
// mobile hamburger that used to be its own separate bar.
export function HeaderBar({ onMenuClick }: { onMenuClick: () => void }) {
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
