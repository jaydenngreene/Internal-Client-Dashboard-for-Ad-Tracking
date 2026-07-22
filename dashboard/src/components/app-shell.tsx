"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Menu } from "lucide-react";
import { Sidebar } from "./sidebar";
import { getToken } from "@/lib/auth";

// These get no sidebar/chrome and no token requirement — they're reachable from
// an email link (or, for /login, before any account exists at all) by someone
// who may not be logged in. Every other page requires a token to even attempt
// rendering — an invalid/expired token still gets caught reactively by
// apiRequest()'s 401 handler in lib/api.ts once a real request goes out, this
// only guards against "no token at all."
const PUBLIC_PATHS = ["/login", "/reset-password", "/verify-email"];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isPublicPage = PUBLIC_PATHS.includes(pathname);
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
    <>
      <Sidebar open={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-12 shrink-0 items-center border-b border-border px-3 md:hidden">
          <button
            type="button"
            onClick={() => setMobileNavOpen(true)}
            aria-label="Open menu"
            className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Menu className="size-5" />
          </button>
        </div>
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </>
  );
}
