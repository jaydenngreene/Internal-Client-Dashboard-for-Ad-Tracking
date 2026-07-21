"use client";

import { useEffect } from "react";
import { recordRecentClient } from "@/lib/recent-clients";

export function RecentClientTracker({ clientId }: { clientId: string }) {
  useEffect(() => {
    recordRecentClient(clientId);
  }, [clientId]);

  return null;
}
