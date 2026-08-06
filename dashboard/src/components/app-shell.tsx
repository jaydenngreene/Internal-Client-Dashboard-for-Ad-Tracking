"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Sidebar } from "./sidebar";
import { HeaderBar } from "./header-bar";
import { getToken } from "@/lib/auth";
import { DateRangeProvider } from "@/lib/date-range";

// These get no sidebar/chrome and no token requirement — they're reachable from
// an email link (or, for /login, before any account exists at all) by someone
// who may not be logged in. Every other page requires a token to even attempt
// rendering — an invalid/expired token still gets caught reactively by
// apiRequest()'s 401 handler in lib/api.ts once a real request goes out, this
// only guards against "no token at all."
const PUBLIC_PATHS = ["/login", "/reset-password", "/verify-email"];
// /share/:token (Step 40) is a whole separate tree of pages meant to be opened by
// a client with no login at all — a prefix check, not an exact match, since every
// token gets its own path segment.
const PUBLIC_PATH_PREFIXES = ["/share/"];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isPublicPage =
    PUBLIC_PATHS.includes(pathname) || PUBLIC_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
  const [ready, setReady] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    if (isPublicPage) {
      setReady(true);
      return;
    }
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    setReady(true);
  }, [pathname, isPublicPage, router]);

  // A navigation should always close the mobile drawer, even though most clicks
  // inside Sidebar already call onClose themselves.
  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  if (isPublicPage) return <>{children}</>;
  if (!ready) return null;

  return (
    <DateRangeProvider>
      <Sidebar open={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <HeaderBar onMenuClick={() => setMobileNavOpen(true)} />
        <main className="flex-1 overflow-y-auto print:overflow-visible">{children}</main>
      </div>
    </DateRangeProvider>
  );
}
