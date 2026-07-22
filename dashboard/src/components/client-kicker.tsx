"use client";

import { useQuery } from "@tanstack/react-query";
import { getClients } from "@/lib/api";

// A small label above each report page's title so it's clear whose data is on
// screen — useful once you're several tabs deep and the sidebar's active-client
// highlight has scrolled out of view.
export function ClientKicker({ clientId }: { clientId: string }) {
  const { data: clients } = useQuery({ queryKey: ["clients"], queryFn: getClients });
  const name = clients?.find((c) => c.id === clientId)?.name;
  if (!name) return null;
  return <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{name}</p>;
}
