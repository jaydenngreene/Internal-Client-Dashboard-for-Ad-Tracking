"use client";

import { useQuery } from "@tanstack/react-query";
import { getEmailSmsReport } from "@/lib/api";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/format";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ClientKicker } from "@/components/client-kicker";

// Step 46 — Klaviyo's own campaign reporting (opens/clicks/revenue per campaign),
// previously nowhere in this app. Trailing 30 days, re-synced every 6 hours, no
// date-range picker — matches how the Klaviyo sync job itself pulls a rolling
// window rather than a report-time date filter.
export function EmailSmsClient({ clientId }: { clientId: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["email-sms", clientId],
    queryFn: () => getEmailSmsReport(clientId),
  });

  return (
    <div className="flex flex-col gap-4 p-6">
      <div>
        <ClientKicker clientId={clientId} />
        <h1 className="text-lg font-semibold">Email & SMS</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Campaign performance from Klaviyo (trailing 30 days). Needs a Klaviyo integration connected in Settings.
        </p>
      </div>

      {isError && <p className="text-sm text-status-critical">Failed to load report. Is the API running?</p>}
      {isLoading && <Skeleton className="h-64 w-full" />}

      {data && data.campaigns.length === 0 && (
        <Card className="px-4 py-8">
          <CardContent className="px-0 text-center text-sm text-muted-foreground">
            No email/SMS campaign data yet. Connect Klaviyo in Settings, or wait for the next sync.
          </CardContent>
        </Card>
      )}

      {data && data.campaigns.length > 0 && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Card className="px-4">
              <CardContent className="px-0">
                <p className="text-xs font-medium text-muted-foreground">Total Recipients</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{formatNumber(data.totals.recipients)}</p>
              </CardContent>
            </Card>
            <Card className="px-4">
              <CardContent className="px-0">
                <p className="text-xs font-medium text-muted-foreground">Total Revenue</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums text-chart-1">{formatCurrency(data.totals.revenue)}</p>
              </CardContent>
            </Card>
            <Card className="px-4">
              <CardContent className="px-0">
                <p className="text-xs font-medium text-muted-foreground">Total Orders</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{formatNumber(data.totals.orders)}</p>
              </CardContent>
            </Card>
          </div>

          <Card className="px-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Campaign</TableHead>
                  <TableHead className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Channel</TableHead>
                  <TableHead className="text-right text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Recipients</TableHead>
                  <TableHead className="text-right text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Open Rate</TableHead>
                  <TableHead className="text-right text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Click Rate</TableHead>
                  <TableHead className="text-right text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Orders</TableHead>
                  <TableHead className="text-right text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Revenue</TableHead>
                  <TableHead className="text-right text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Rev / Recipient</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.campaigns.map((c) => (
                  <TableRow key={c.campaignId}>
                    <TableCell className="max-w-64 truncate font-medium">{c.campaignName}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px] capitalize">{c.channel}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(c.recipients)}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.openRate === null ? "-" : formatPercent(c.openRate)}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.clickRate === null ? "-" : formatPercent(c.clickRate)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(c.orders)}</TableCell>
                    <TableCell className="text-right tabular-nums text-chart-1">{formatCurrency(c.revenue)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {c.revenuePerRecipient === null ? "-" : formatCurrency(c.revenuePerRecipient)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </>
      )}
    </div>
  );
}
