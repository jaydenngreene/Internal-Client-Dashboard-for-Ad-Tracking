"use client";

import { useQuery } from "@tanstack/react-query";
import { AuditLogEntry } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

// Step 54 — shared between per-client Settings and Account Settings. Generic
// route+method+status rows, not a bespoke shape per action type — the "what
// happened" is whatever the route path itself says.
export function AuditLogSection({
  queryKey,
  fetcher,
  showClientColumn,
}: {
  queryKey: string[];
  fetcher: () => Promise<AuditLogEntry[]>;
  showClientColumn?: boolean;
}) {
  const { data, isLoading } = useQuery({ queryKey, queryFn: fetcher });

  return (
    <Card className="px-4">
      <CardHeader className="px-0">
        <CardTitle>Audit Log</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 px-0">
        {isLoading && <Skeleton className="h-32 w-full" />}
        {!isLoading && (!data || data.length === 0) && (
          <p className="text-xs text-muted-foreground">Nothing recorded yet.</p>
        )}
        {data && data.length > 0 && (
          <div className="flex flex-col gap-1 overflow-y-auto" style={{ maxHeight: 320 }}>
            {data.map((entry) => (
              <div key={entry.id} className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-1.5 text-xs">
                <div className="flex min-w-0 items-center gap-2">
                  <Badge variant={entry.status_code >= 400 ? "destructive" : "outline"} className="shrink-0 text-[10px]">
                    {entry.method}
                  </Badge>
                  <span className="truncate text-foreground/90">{entry.route}</span>
                  {showClientColumn && entry.client_name && (
                    <span className="shrink-0 text-muted-foreground">&middot; {entry.client_name}</span>
                  )}
                  {entry.details && <span className="truncate text-muted-foreground">&middot; {entry.details}</span>}
                </div>
                <div className="flex shrink-0 items-center gap-2 text-muted-foreground">
                  <span>{entry.user_email ?? "unknown"}</span>
                  <span>{formatDateTime(entry.created_at)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
