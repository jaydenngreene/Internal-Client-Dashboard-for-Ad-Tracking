import { ChatToolCall } from "@/lib/api";
import { formatCurrency, formatNumber, formatRoas } from "@/lib/format";

// Renders the real structured data behind a Gojo answer as a small widget inline
// in the chat thread, instead of leaving the user to trust a sentence of prose -
// this is the actual differentiator behind Triple Whale's Moby that research for
// the elite-dashboard pass called out (an inline rendered number/table, not the
// chat surface itself). One case per tool in api/src/lib/chatTools.ts; an unknown
// or malformed result renders nothing rather than guessing at a shape.

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-[88px]">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function StatRow({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap gap-4 rounded-md border border-border bg-card px-3 py-2.5">{children}</div>;
}

export function ChatToolResult({ call }: { call: ChatToolCall }) {
  const r = call.result;

  if (call.tool === "get_overview_metrics" && typeof r.cost === "number") {
    return (
      <StatRow>
        <Stat label="Ad Spend" value={formatCurrency(r.cost as number)} />
        <Stat label="Revenue" value={formatCurrency(r.revenue as number)} />
        <Stat label="Profit" value={formatCurrency(r.trueProfit as number)} />
        <Stat label="ROAS" value={formatRoas(r.roas as number | null)} />
        <Stat label="Leads" value={formatNumber(r.leads as number)} />
        <Stat label="Sales" value={formatNumber(r.sales as number)} />
      </StatRow>
    );
  }

  if (call.tool === "get_campaign_breakdown" && Array.isArray(r.campaigns)) {
    const campaigns = r.campaigns as { campaignName: string; platform: string; cost: number; revenue: number; roas: number | null }[];
    if (campaigns.length === 0) return null;
    return (
      <div className="overflow-hidden rounded-md border border-border">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-muted text-[10px] uppercase tracking-wide text-muted-foreground">
              <th className="px-2.5 py-1.5 text-left font-medium">Campaign</th>
              <th className="px-2.5 py-1.5 text-right font-medium">Spend</th>
              <th className="px-2.5 py-1.5 text-right font-medium">Revenue</th>
              <th className="px-2.5 py-1.5 text-right font-medium">ROAS</th>
            </tr>
          </thead>
          <tbody>
            {campaigns.slice(0, 5).map((c, i) => (
              <tr key={i} className="border-t border-border">
                <td className="max-w-40 truncate px-2.5 py-1.5 font-medium">{c.campaignName}</td>
                <td className="px-2.5 py-1.5 text-right tabular-nums">{formatCurrency(c.cost)}</td>
                <td className="px-2.5 py-1.5 text-right tabular-nums text-chart-1">{formatCurrency(c.revenue)}</td>
                <td className="px-2.5 py-1.5 text-right tabular-nums">{formatRoas(c.roas)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (call.tool === "get_ltv_summary" && Array.isArray(r.campaigns)) {
    const campaigns = r.campaigns as { campaign: string; avgLifetimeValue: number; customers: number }[];
    if (campaigns.length === 0) return null;
    return (
      <div className="overflow-hidden rounded-md border border-border">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-muted text-[10px] uppercase tracking-wide text-muted-foreground">
              <th className="px-2.5 py-1.5 text-left font-medium">Campaign</th>
              <th className="px-2.5 py-1.5 text-right font-medium">Avg LTV</th>
              <th className="px-2.5 py-1.5 text-right font-medium">Customers</th>
            </tr>
          </thead>
          <tbody>
            {campaigns.slice(0, 5).map((c, i) => (
              <tr key={i} className="border-t border-border">
                <td className="max-w-40 truncate px-2.5 py-1.5 font-medium">{c.campaign}</td>
                <td className="px-2.5 py-1.5 text-right tabular-nums text-chart-1">{formatCurrency(c.avgLifetimeValue)}</td>
                <td className="px-2.5 py-1.5 text-right tabular-nums">{formatNumber(c.customers)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (call.tool === "get_budget_pacing") {
    if (!r.hasBudgetTarget) return null;
    return (
      <StatRow>
        <Stat label="Monthly Target" value={formatCurrency(r.monthlyTarget as number)} />
        <Stat label="Spent This Month" value={formatCurrency(r.spendToDateThisMonth as number)} />
      </StatRow>
    );
  }

  if (call.tool === "get_forecast" && r.next7Days && r.next30Days) {
    const next7 = r.next7Days as { projectedCost: number; projectedRevenue: number };
    const next30 = r.next30Days as { projectedCost: number; projectedRevenue: number };
    return (
      <StatRow>
        <Stat label="Next 7d Spend" value={formatCurrency(next7.projectedCost)} />
        <Stat label="Next 7d Revenue" value={formatCurrency(next7.projectedRevenue)} />
        <Stat label="Next 30d Spend" value={formatCurrency(next30.projectedCost)} />
        <Stat label="Next 30d Revenue" value={formatCurrency(next30.projectedRevenue)} />
      </StatRow>
    );
  }

  return null;
}
