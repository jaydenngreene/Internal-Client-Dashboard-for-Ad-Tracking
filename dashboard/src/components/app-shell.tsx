"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
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

  if (isLoginPage) return <>{children}</>;
  if (!ready) return null;

  return (
    <>
      <Sidebar />
      <main className="flex-1 overflow-y-auto">{children}</main>
    </>
  );
}
