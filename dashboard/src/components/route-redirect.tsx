"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Client-side redirect (matches src/app/page.tsx's own root redirect) rather
// than a server-side `redirect()` — this app's auth token only lives in the
// browser, so a server component redirect would fire before it's readable.
// Used by routes folded into a hub page during the 2026-08-01 nav
// consolidation, so an old bookmark/link still lands somewhere real instead
// of 404ing.
export function RouteRedirect({ to }: { to: string }) {
  const router = useRouter();
  useEffect(() => {
    router.replace(to);
  }, [router, to]);
  return null;
}
