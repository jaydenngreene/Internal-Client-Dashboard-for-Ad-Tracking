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

export interface CampaignRow {
  campaign_name: string;
  platform: string | null;
  cost: number;
  impressions: number;
  clicks: number;
  revenue: number;
  sales: number;
  profit: number;
  roas: number | null;
  matched: boolean;
}

export interface CampaignsReport {
  from: string;
  to: string;
  campaigns: CampaignRow[];
}

export interface LeadCampaignRow {
  campaign_name: string;
  platform: string | null;
  cost: number;
  leads: number;
  cpl: number | null;
  matched: boolean;
}

export interface LeadsReport {
  from: string;
  to: string;
  totalLeads: number;
  cpl: number | null;
  campaigns: LeadCampaignRow[];
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

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`);
  if (!res.ok) {
    throw new Error(`Request failed (${res.status}): ${path}`);
  }
  return res.json() as Promise<T>;
}

function rangeQuery(range?: DateRange): string {
  if (!range) return "";
  return `?from=${range.from}&to=${range.to}`;
}

export function getClients(): Promise<Client[]> {
  return fetchJson<Client[]>("/clients");
}

export function getOverview(clientId: string, range?: DateRange): Promise<OverviewReport> {
  return fetchJson<OverviewReport>(`/clients/${clientId}/reports/overview${rangeQuery(range)}`);
}

export function getCampaigns(clientId: string, range?: DateRange): Promise<CampaignsReport> {
  return fetchJson<CampaignsReport>(`/clients/${clientId}/reports/campaigns${rangeQuery(range)}`);
}

export function getLeads(clientId: string, range?: DateRange): Promise<LeadsReport> {
  return fetchJson<LeadsReport>(`/clients/${clientId}/reports/leads${rangeQuery(range)}`);
}

export function getBof(clientId: string, range?: DateRange): Promise<BofReport> {
  return fetchJson<BofReport>(`/clients/${clientId}/reports/bof${rangeQuery(range)}`);
}

export function getLtv(clientId: string, range?: DateRange): Promise<LtvReport> {
  return fetchJson<LtvReport>(`/clients/${clientId}/reports/ltv${rangeQuery(range)}`);
}
