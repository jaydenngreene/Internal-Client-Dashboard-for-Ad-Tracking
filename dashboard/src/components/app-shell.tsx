"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Menu } from "lucide-react";
import { Sidebar } from "./sidebar";
import { getToken } from "@/lib/auth";

// The login page gets no sidebar/chrome at all; every other page requires a
// token to even attempt rendering — an invalid/expired token still gets caught
// reactively by apiRequest()'s 401 handler in lib/api.ts once a real request goes
// out, this only guards against "no token at all."
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isLoginPage = pathname === "/login";
  const [ready, setReady] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    if (isLoginPage) {
      setReady(true);
      return;
    }
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    setReady(true);
  }, [pathname, isLoginPage, router]);

  // A navigation should always close the mobile drawer, even though most clicks
  // inside Sidebar already call onClose themselves.
  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  if (isLoginPage) return <>{children}</>;
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
