"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Was previously a server component that fetched the client list to decide
// between an empty state and redirecting to /agency — that fetch ran on the
// server, where there's no access to the browser-stored auth token, so it always
// looked unauthenticated post-login. The Agency Overview page already handles the
// "no clients yet" empty state itself, so this just needs to get there.
export default function HomePage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/agency");
  }, [router]);
  return null;
}
