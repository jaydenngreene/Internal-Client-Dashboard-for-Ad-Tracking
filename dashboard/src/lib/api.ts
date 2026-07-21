const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export interface Client {
  id: string;
  name: string;
  pixel_key: string;
  timezone: string;
  attribution_model: "first_click" | "last_click" | "linear";
  created_at: string;
}

export interface DateRange {
  from: string;
  to: string;
}

export interface OverviewSeriesPoint {
  date: string;
  cost: number;
  revenue: number;
  profit: number;
}

export interface OverviewReport {
  from: string;
  to: string;
  cost: number;
  revenue: number;
  profit: number;
  roas: number | null;
  roi: number | null;
  leads: number;
  sales: number;
  series: OverviewSeriesPoint[];
}

export interface AovBySourceRow {
  source: string;
  aov: number;
  sales: number;
}

export interface BofReport {
  from: string;
  to: string;
  totalLeads: number;
  convertedLeads: number;
  leadToBuyerRate: number | null;
  avgDaysToConvert: number | null;
  totalOrders: number;
  refundedOrders: number;
  refundRate: number | null;
  aovBySource: AovBySourceRow[];
}

export interface TofReport {
  from: string;
  to: string;
  totalLeads: number;
  cpl: number | null;
}

export interface MofReport {
  from: string;
  to: string;
  totalSessions: number;
  totalPageviews: number;
  engagedSessions: number;
  avgPageviewsPerSession: number | null;
  engagementRate: number | null;
}

export interface LtvCampaignRow {
  campaign_name: string;
  customers: number;
  avgLtv30d: number;
  avgLtv60d: number;
  avgLtv90d: number;
  avgLtv180d: number;
  avgLtvLifetime: number;
  totalLtvLifetime: number;
}

export interface LtvReport {
  from: string;
  to: string;
  campaigns: LtvCampaignRow[];
}

export type FunnelBreakdown = "campaign" | "source";

export interface FunnelRow {
  name: string;
  platform: string | null;
  cost: number;
  leads: number;
  cpl: number | null;
  sales: number;
  revenue: number;
  profit: number;
  roas: number | null;
  matched: boolean;
}

export interface FunnelReport {
  from: string;
  to: string;
  breakdown: FunnelBreakdown;
  campaigns: FunnelRow[];
}

export interface AgencyClientRow {
  id: string;
  name: string;
  cost: number;
  revenue: number;
  profit: number;
  roas: number | null;
  roi: number | null;
  revenueChangePct: number | null;
}

export interface AgencyOverviewReport {
  from: string;
  to: string;
  clients: AgencyClientRow[];
  totals: { cost: number; revenue: number; profit: number };
}

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`);
  if (!res.ok) {
    throw new Error(`Request failed (${res.status}): ${path}`);
  }
  return res.json() as Promise<T>;
}

function rangeQuery(range?: DateRange, extra?: Record<string, string>): string {
  const params = new URLSearchParams({ ...(range ? { from: range.from, to: range.to } : {}), ...extra });
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function getClients(): Promise<Client[]> {
  return fetchJson<Client[]>("/clients");
}

export function getOverview(clientId: string, range?: DateRange): Promise<OverviewReport> {
  return fetchJson<OverviewReport>(`/clients/${clientId}/reports/overview${rangeQuery(range)}`);
}

export function getBof(clientId: string, range?: DateRange): Promise<BofReport> {
  return fetchJson<BofReport>(`/clients/${clientId}/reports/bof${rangeQuery(range)}`);
}

export function getTof(clientId: string, range?: DateRange): Promise<TofReport> {
  return fetchJson<TofReport>(`/clients/${clientId}/reports/leads${rangeQuery(range)}`);
}

export function getMof(clientId: string, range?: DateRange): Promise<MofReport> {
  return fetchJson<MofReport>(`/clients/${clientId}/reports/mof${rangeQuery(range)}`);
}

export function getLtv(clientId: string, range?: DateRange): Promise<LtvReport> {
  return fetchJson<LtvReport>(`/clients/${clientId}/reports/ltv${rangeQuery(range)}`);
}

export function getFunnel(
  clientId: string,
  range?: DateRange,
  breakdown: FunnelBreakdown = "campaign"
): Promise<FunnelReport> {
  return fetchJson<FunnelReport>(`/clients/${clientId}/reports/funnel${rangeQuery(range, { breakdown })}`);
}

export function getAgencyOverview(range?: DateRange): Promise<AgencyOverviewReport> {
  return fetchJson<AgencyOverviewReport>(`/reports/agency-overview${rangeQuery(range)}`);
}
