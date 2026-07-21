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
