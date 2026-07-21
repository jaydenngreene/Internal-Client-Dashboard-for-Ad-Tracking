const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export type Niche = "ecommerce" | "call" | "lead_gen" | "saas" | "info_product" | "other";

export interface Client {
  id: string;
  name: string;
  pixel_key: string;
  timezone: string;
  attribution_model: "first_click" | "last_click" | "linear";
  niche: Niche;
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
  viewContentCount: number;
  addToCartCount: number;
  initiateCheckoutCount: number;
  abandonedCartCount: number;
  abandonedCartValue: number;
  cartAbandonmentRate: number | null;
}

export interface CallsByCampaignRow {
  campaign_name: string;
  calls: number;
}

export interface CallsByDispositionRow {
  disposition: string;
  calls: number;
}

export interface CallsReport {
  from: string;
  to: string;
  totalCalls: number;
  qualifiedCalls: number;
  qualifiedRate: number | null;
  avgDurationSeconds: number | null;
  avgQualificationScore: number | null;
  byCampaign: CallsByCampaignRow[];
  byDisposition: CallsByDispositionRow[];
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

export type FunnelBreakdown = "campaign" | "source" | "keyword";

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

async function mutateJson<T>(path: string, method: "PATCH" | "POST"): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { method });
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

export function getCalls(clientId: string, range?: DateRange): Promise<CallsReport> {
  return fetchJson<CallsReport>(`/clients/${clientId}/reports/calls${rangeQuery(range)}`);
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

// Step 12 — AI remarketing agent. Candidates are deanonymized visitors (via Customers.ai)
// with an AI-drafted outreach message awaiting human review. Approve/reject only change
// review status here — nothing on this page ever sends anything to a real inbox; see
// api/src/routes/remarketing.ts for why dispatch is a separate, not-yet-wired-in step.
export type RemarketingStatus = "pending" | "approved" | "rejected" | "dispatched";

export interface RemarketingCandidate {
  id: string;
  client_id: string;
  source: string;
  email: string;
  phone: string | null;
  first_name: string | null;
  last_name: string | null;
  page_url: string | null;
  page_title: string | null;
  identified_at: string;
  status: RemarketingStatus;
  draft_subject: string | null;
  draft_body: string | null;
  draft_generated_at: string | null;
  draft_error: string | null;
}

export function getRemarketingCandidates(
  clientId: string,
  status: RemarketingStatus = "pending"
): Promise<RemarketingCandidate[]> {
  return fetchJson<RemarketingCandidate[]>(
    `/clients/${clientId}/remarketing/candidates${rangeQuery(undefined, { status })}`
  );
}

export function approveRemarketingCandidate(id: string): Promise<RemarketingCandidate> {
  return mutateJson<RemarketingCandidate>(`/remarketing/${id}/approve`, "PATCH");
}

export function rejectRemarketingCandidate(id: string): Promise<RemarketingCandidate> {
  return mutateJson<RemarketingCandidate>(`/remarketing/${id}/reject`, "PATCH");
}

// Step 30 — Cohorts. Pure re-aggregation of customer_ltv by acquisition month;
// no new data collection. `months` (not a DateRange) controls how far back to look.
export interface CohortRow {
  cohortMonth: string;
  customers: number;
  avgLtv30d: number;
  avgLtv60d: number;
  avgLtv90d: number;
  avgLtv180d: number;
  avgLtvLifetime: number;
  totalLtvLifetime: number;
}

export interface CohortsReport {
  months: number;
  cohorts: CohortRow[];
}

export function getCohorts(clientId: string, months = 12): Promise<CohortsReport> {
  return fetchJson<CohortsReport>(`/clients/${clientId}/reports/cohorts?months=${months}`);
}

// Step 26 — Custom Costs: manual ad-spend entry for platforms without a native
// cost-sync integration. Folded into the overview/campaigns/funnel reports server-side.
export interface CustomCost {
  id: string;
  client_id: string;
  platform_label: string;
  date: string;
  spend: number;
  notes: string | null;
  created_at: string;
}

export function addCustomCost(
  clientId: string,
  input: { platform_label: string; date: string; spend: number; notes?: string }
): Promise<CustomCost> {
  return fetch(`${API_URL}/clients/${clientId}/custom-costs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => {
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    return res.json();
  });
}
