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

// Which funnel-stage metrics matter depends on what the client is actually selling.
// A call/lead_gen/saas business is optimizing for cost per lead; ecommerce/
// info_product/other are optimizing for cost per purchase and order value.
const LEAD_GOAL_NICHES: Niche[] = ["call", "lead_gen", "saas"];

export function campaignGoalForNiche(niche: Niche): "leads" | "sales" {
  return LEAD_GOAL_NICHES.includes(niche) ? "leads" : "sales";
}

export const NICHES: Niche[] = ["ecommerce", "call", "lead_gen", "saas", "info_product", "other"];

// Add Client wizard — ports the scripts/setup-*.ts CLI wizards into the dashboard.
// Every one of these calls an endpoint that already existed for the CLI scripts;
// no backend changes needed, this is purely a new frontend surface on top of them.
export function createClient(input: { name: string; niche: Niche; timezone?: string }): Promise<Client> {
  return fetch(`${API_URL}/clients`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => {
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    return res.json();
  });
}

export type ProcessorPlatform = "shopify" | "stripe" | "paypal" | "square" | "gohighlevel";

function postIntegration(clientId: string, platform: string, body: Record<string, unknown>): Promise<unknown> {
  return fetch(`${API_URL}/clients/${clientId}/integrations/${platform}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((res) => {
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    return res.json();
  });
}

// Generic version of the above for Settings — every ad-platform/CRM integration
// (17 of them) already shares the same upsertIntegration() shape on the backend,
// so one function covers all of them instead of a bespoke wrapper per platform.
export const saveIntegration = postIntegration;

export interface IntegrationSummary {
  platform: string;
  created_at: string;
  config: Record<string, unknown>;
}

export function getIntegrations(clientId: string): Promise<IntegrationSummary[]> {
  return fetch(`${API_URL}/clients/${clientId}/integrations`).then((res) => {
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    return res.json();
  });
}

export function updateClientName(clientId: string, name: string): Promise<Client> {
  return fetch(`${API_URL}/clients/${clientId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  }).then((res) => {
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    return res.json();
  });
}

export function updateClientNiche(clientId: string, niche: Niche): Promise<Client> {
  return fetch(`${API_URL}/clients/${clientId}/niche`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ niche }),
  }).then((res) => {
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    return res.json();
  });
}

export function updateAttributionModel(
  clientId: string,
  attribution_model: Client["attribution_model"]
): Promise<Client> {
  return fetch(`${API_URL}/clients/${clientId}/attribution-model`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ attribution_model }),
  }).then((res) => {
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    return res.json();
  });
}

export function deleteClient(clientId: string): Promise<void> {
  return fetch(`${API_URL}/clients/${clientId}`, { method: "DELETE" }).then((res) => {
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
  });
}

export function generateTagWebhookSecret(clientId: string): Promise<IntegrationSummary & { config: { webhook_secret: string } }> {
  return fetch(`${API_URL}/clients/${clientId}/integrations/tag-webhook/generate`, { method: "POST" }).then((res) => {
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    return res.json();
  });
}

export interface OutboundWebhookEventType {
  value: "sale.attributed" | "lead.opted.in" | "call.qualified";
  label: string;
}

export const OUTBOUND_WEBHOOK_EVENT_TYPES: OutboundWebhookEventType[] = [
  { value: "sale.attributed", label: "Sale attributed" },
  { value: "lead.opted.in", label: "Lead opted in" },
  { value: "call.qualified", label: "Call qualified" },
];

export interface OutboundWebhookSubscription {
  id: string;
  client_id: string;
  target_url: string;
  event_types: string[];
  active: boolean;
  created_at: string;
}

export function getWebhookSubscriptions(clientId: string): Promise<OutboundWebhookSubscription[]> {
  return fetch(`${API_URL}/clients/${clientId}/webhook-subscriptions`).then((res) => {
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    return res.json();
  });
}

export function createWebhookSubscription(
  clientId: string,
  body: { target_url: string; event_types: string[] }
): Promise<OutboundWebhookSubscription & { signing_secret: string }> {
  return fetch(`${API_URL}/clients/${clientId}/webhook-subscriptions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((res) => {
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    return res.json();
  });
}

export function deleteWebhookSubscription(subId: string): Promise<void> {
  return fetch(`${API_URL}/webhook-subscriptions/${subId}`, { method: "DELETE" }).then((res) => {
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
  });
}

export const saveShopifyIntegration = (clientId: string, body: { webhook_secret: string; shop_domain: string }) =>
  postIntegration(clientId, "shopify", body);

export const saveStripeIntegration = (clientId: string, body: { webhook_secret: string }) =>
  postIntegration(clientId, "stripe", body);

export const savePaypalIntegration = (
  clientId: string,
  body: { client_id: string; client_secret: string; webhook_id: string; sandbox?: boolean }
) => postIntegration(clientId, "paypal", body);

export const saveSquareIntegration = (clientId: string, body: { signature_key: string; notification_url: string }) =>
  postIntegration(clientId, "square", body);

export const saveGoHighLevelIntegration = (clientId: string, body: { webhook_secret: string }) =>
  postIntegration(clientId, "gohighlevel", body);

// AI Insights — on-demand + cached (not a nightly job), so a stale generated_at is
// visible to the user rather than silently refreshing overnight.
export interface Insight {
  title: string;
  detail: string;
  priority: "high" | "medium" | "low";
}

export interface ClientInsights {
  client_id: string;
  generated_at: string;
  insights: Insight[];
  model: string;
  error: string | null;
}

export function getInsights(clientId: string): Promise<ClientInsights | null> {
  return fetchJson<ClientInsights | null>(`/clients/${clientId}/insights`);
}

export function regenerateInsights(clientId: string): Promise<ClientInsights> {
  return mutateJson<ClientInsights>(`/clients/${clientId}/insights/regenerate`, "POST");
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

export type FunnelBreakdown = "campaign" | "source" | "keyword" | "creative";

export interface FunnelRow {
  name: string;
  platform: string | null;
  cost: number;
  impressions: number;
  clicks: number;
  leads: number;
  cpl: number | null;
  sales: number;
  costPerPurchase: number | null;
  aov: number | null;
  revenue: number;
  profit: number;
  roas: number | null;
  ctr: number | null;
  cpc: number | null;
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

export function getClient(clientId: string): Promise<Client> {
  return fetch(`${API_URL}/clients/${clientId}`).then((res) => {
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    return res.json();
  });
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

// Step 22 — MRR/churn/trial reporting, SaaS vertical (niche === 'saas').
export interface SubscriptionsSeriesPoint {
  date: string;
  mrr: number;
}

export interface SubscriptionsReport {
  from: string;
  to: string;
  currentMrr: number;
  activeCount: number;
  newMrr: number;
  churnedMrr: number;
  trialsStarted: number;
  trialsConverted: number;
  trialConversionRate: number | null;
  canceledCount: number;
  churnRate: number | null;
  series: SubscriptionsSeriesPoint[];
}

export function getSubscriptions(clientId: string, range?: DateRange): Promise<SubscriptionsReport> {
  return fetchJson<SubscriptionsReport>(`/clients/${clientId}/reports/subscriptions${rangeQuery(range)}`);
}

// Step 24/25 — Tags & Stages. 'product'-type tags auto-generate a Sale server-side
// when newly applied to a lead (see api/src/lib/tagAutomation.ts) — the dashboard
// never computes that itself, it just calls the apply endpoint.
export type TagType = "freeform" | "funnel_stage" | "product";

export interface Tag {
  id: string;
  client_id: string;
  name: string;
  tag_type: TagType;
  stage_order: number | null;
  product_value: number | null;
  created_at: string;
}

export interface LeadTag extends Tag {
  applied_at: string;
  applied_by: string;
}

export function getTags(clientId: string): Promise<Tag[]> {
  return fetchJson<Tag[]>(`/clients/${clientId}/tags`);
}

export function createTag(
  clientId: string,
  input: { name: string; tag_type: TagType; stage_order?: number; product_value?: number }
): Promise<Tag> {
  return fetch(`${API_URL}/clients/${clientId}/tags`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => {
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    return res.json();
  });
}

export function deleteTag(tagId: string): Promise<void> {
  return fetch(`${API_URL}/tags/${tagId}`, { method: "DELETE" }).then((res) => {
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
  });
}

export function getLeadTags(clientId: string, email: string): Promise<LeadTag[]> {
  return fetchJson<LeadTag[]>(`/clients/${clientId}/leads/${encodeURIComponent(email)}/tags`);
}

export function applyLeadTag(clientId: string, email: string, tagId: string): Promise<void> {
  return fetch(`${API_URL}/clients/${clientId}/leads/${encodeURIComponent(email)}/tags`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tag_id: tagId }),
  }).then((res) => {
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
  });
}

// Step 28 — Audience Sync. Segments are re-evaluated against live data on every
// sync, not a frozen snapshot at creation time.
export type AudiencePlatform = "facebook_custom_audience" | "google_customer_match";
export type SegmentType = "all_customers" | "ltv_above" | "tag";

export interface SegmentDefinition {
  type: SegmentType;
  threshold?: number;
  tag_name?: string;
}

export interface AudienceSync {
  id: string;
  client_id: string;
  platform: AudiencePlatform;
  name: string;
  segment_definition: SegmentDefinition;
  external_audience_id: string | null;
  last_synced_at: string | null;
  last_sync_count: number | null;
  last_sync_error: string | null;
  created_at: string;
}

export function getAudienceSyncs(clientId: string): Promise<AudienceSync[]> {
  return fetchJson<AudienceSync[]>(`/clients/${clientId}/audience-syncs`);
}

export function createAudienceSync(
  clientId: string,
  input: { platform: AudiencePlatform; name: string; segment_definition: SegmentDefinition }
): Promise<AudienceSync> {
  return fetch(`${API_URL}/clients/${clientId}/audience-syncs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => {
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    return res.json();
  });
}

export function runAudienceSync(syncId: string): Promise<AudienceSync> {
  return mutateJson<AudienceSync>(`/audience-syncs/${syncId}/run`, "POST");
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
