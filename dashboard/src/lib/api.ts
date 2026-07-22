import { getToken, redirectToLogin } from "./auth";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

// Drop-in replacement for fetch() — every call site in this file uses this instead
// so the auth token is attached automatically and a 401 (expired/invalid/missing
// token) bounces to /login in one place rather than needing every caller to check.
function apiRequest(input: string, init?: RequestInit): Promise<Response> {
  const token = getToken();
  const headers = new Headers(init?.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers }).then((res) => {
    if (res.status === 401) redirectToLogin();
    return res;
  });
}

export interface AuthUser {
  id: string;
  email: string;
  agency_name: string;
  email_verified: boolean;
}

export async function login(email: string, password: string): Promise<{ token: string; user: AuthUser }> {
  const res = await fetch(`${API_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    throw new Error(errorBody.error ?? `Request failed (${res.status})`);
  }
  return res.json();
}

async function publicPost(path: string, body: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data.error as string) ?? `Request failed (${res.status})`);
  return data;
}

export const forgotPassword = (email: string) => publicPost("/auth/forgot-password", { email });
export const resetPassword = (token: string, newPassword: string) =>
  publicPost("/auth/reset-password", { token, new_password: newPassword });
export const verifyEmail = (token: string) => publicPost("/auth/verify-email", { token });

export function resendVerificationEmail(): Promise<void> {
  return apiRequest(`${API_URL}/auth/resend-verification`, { method: "POST" }).then((res) => {
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
  });
}

export function getMe(): Promise<AuthUser> {
  return apiRequest(`${API_URL}/auth/me`).then((res) => {
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    return res.json();
  });
}

export function updateMe(body: { agency_name?: string; email?: string }): Promise<AuthUser> {
  return apiRequest(`${API_URL}/auth/me`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(async (res) => {
    if (!res.ok) {
      const errorBody = await res.json().catch(() => ({}));
      throw new Error(errorBody.error ?? `Request failed (${res.status})`);
    }
    return res.json();
  });
}

export function updatePassword(body: { current_password: string; new_password: string }): Promise<void> {
  return apiRequest(`${API_URL}/auth/password`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(async (res) => {
    if (!res.ok) {
      const errorBody = await res.json().catch(() => ({}));
      throw new Error(errorBody.error ?? `Request failed (${res.status})`);
    }
  });
}

export function deleteAccount(): Promise<void> {
  return apiRequest(`${API_URL}/auth/me`, { method: "DELETE" }).then((res) => {
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
  });
}

export interface JobRun {
  job_name: string;
  status: "success" | "failure";
  error: string | null;
  started_at: string;
  finished_at: string;
}

export function getJobStatus(): Promise<JobRun[]> {
  return fetchJson<JobRun[]>("/jobs/status");
}

export type Niche = "ecommerce" | "call" | "lead_gen" | "saas" | "info_product" | "other";

export interface Client {
  id: string;
  name: string;
  pixel_key: string;
  timezone: string;
  attribution_model: "first_click" | "last_click" | "linear" | "time_decay" | "u_shaped";
  niche: Niche;
  created_at: string;
  // True-profit inputs (Step 31) — % of revenue for cogs/payment_fee, flat $ per
  // order for fulfillment. All null until a client's Settings page configures them,
  // in which case every report's "profit" tile falls back to ad-cost-only profit.
  cogs_percent: number | null;
  payment_fee_percent: number | null;
  fulfillment_cost_flat: number | null;
  // Step 40 — null until Settings generates one; regenerating overwrites/revokes
  // the previous link.
  public_share_token: string | null;
  // Step 43 — account-wide, not per-campaign, matching this app's existing
  // "one number per client" simplicity (same level as the margin fields above).
  monthly_budget_target: number | null;
  // Step 48 — the client's reporting/base currency; ad spend and purchase
  // revenue in a different currency are converted to this at ingestion.
  currency: string;
  // False for a client shared with this login rather than owned by it (migration
  // 028) — gates owner-only UI (collaborator management, delete) client-side; the
  // backend enforces the same restriction independently, this is just so the
  // dashboard doesn't show controls that would 403.
  is_owner: boolean;
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
  return apiRequest(`${API_URL}/clients`, {
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
  return apiRequest(`${API_URL}/clients/${clientId}/integrations/${platform}`, {
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
  return apiRequest(`${API_URL}/clients/${clientId}/integrations`).then((res) => {
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    return res.json();
  });
}

export function updateClientName(clientId: string, name: string): Promise<Client> {
  return apiRequest(`${API_URL}/clients/${clientId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  }).then((res) => {
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    return res.json();
  });
}

export function updateClientNiche(clientId: string, niche: Niche): Promise<Client> {
  return apiRequest(`${API_URL}/clients/${clientId}/niche`, {
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
  return apiRequest(`${API_URL}/clients/${clientId}/attribution-model`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ attribution_model }),
  }).then((res) => {
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    return res.json();
  });
}

export function updateClientMargin(
  clientId: string,
  margin: { cogs_percent: number | null; payment_fee_percent: number | null; fulfillment_cost_flat: number | null }
): Promise<Client> {
  return apiRequest(`${API_URL}/clients/${clientId}/margin`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(margin),
  }).then(async (res) => {
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? `Request failed (${res.status})`);
    }
    return res.json();
  });
}

export function updateClientCurrency(clientId: string, currency: string): Promise<Client> {
  return apiRequest(`${API_URL}/clients/${clientId}/currency`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ currency }),
  }).then(async (res) => {
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? `Request failed (${res.status})`);
    }
    return res.json();
  });
}

export function updateBudgetTarget(clientId: string, monthly_budget_target: number | null): Promise<Client> {
  return apiRequest(`${API_URL}/clients/${clientId}/budget-target`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ monthly_budget_target }),
  }).then(async (res) => {
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? `Request failed (${res.status})`);
    }
    return res.json();
  });
}

export interface BudgetPacingReport {
  month: string;
  daysInMonth: number;
  dayOfMonth: number;
  target: number | null;
  spendToDate: number;
  expectedSpendToDate: number | null;
  projectedMonthEndSpend: number;
  paceStatus: "over" | "under" | "on_track" | null;
}

export function getBudgetPacing(clientId: string): Promise<BudgetPacingReport> {
  return fetchJson<BudgetPacingReport>(`/clients/${clientId}/reports/budget-pacing`);
}

// Step 49 — revenue/ROAS/CAC forecasting via a simple linear trend over the
// trailing 60 days, deliberately not a real time-series model.
export interface ForecastWindow {
  days: number;
  projectedRevenue: number;
  projectedCost: number;
  projectedRoas: number | null;
  projectedNewCustomers: number;
  projectedCac: number | null;
}

export interface ForecastReport {
  lookbackDays: number;
  from: string;
  to: string;
  forecast7d: ForecastWindow;
  forecast30d: ForecastWindow;
}

export function getForecast(clientId: string): Promise<ForecastReport> {
  return fetchJson<ForecastReport>(`/clients/${clientId}/reports/forecast`);
}

// Step 45 — time-based pause/holdout incrementality testing. The user manually
// pauses the campaign in their ad platform for the test window; this app only
// defines the test and computes the before/after analysis.
export interface IncrementalityTest {
  id: string;
  client_id: string;
  platform: string;
  campaign_name: string;
  pre_period_days: number;
  pause_start: string;
  pause_end: string;
  created_at: string;
}

export interface IncrementalityResult {
  status: "pending" | "running" | "completed";
  preperiodDailyTotalRevenue: number;
  preperiodDailyCampaignAttributedRevenue: number;
  projectedBaselineTotalRevenue: number | null;
  actualTotalRevenueDuringPause: number | null;
  incrementalRevenueEstimate: number | null;
  incrementalityRatio: number | null;
}

export interface IncrementalityTestWithResult {
  test: IncrementalityTest;
  result: IncrementalityResult;
}

// Step 46 — email/SMS marketing attribution via Klaviyo's own campaign reporting.
export interface EmailCampaignRow {
  campaignId: string;
  campaignName: string;
  channel: "email" | "sms";
  recipients: number;
  opens: number;
  clicks: number;
  revenue: number;
  orders: number;
  openRate: number | null;
  clickRate: number | null;
  revenuePerRecipient: number | null;
}

export interface EmailSmsReport {
  campaigns: EmailCampaignRow[];
  totals: { recipients: number; revenue: number; orders: number };
}

export function getEmailSmsReport(clientId: string): Promise<EmailSmsReport> {
  return fetchJson<EmailSmsReport>(`/clients/${clientId}/reports/email-sms`);
}

// Step 47 — creative fatigue: a declining-CTR-trend signal, advisory only (no
// confirm-and-pause action like pause candidates have).
export type FatigueStatus = "active" | "dismissed";

export interface CreativeFatigueSignal {
  id: string;
  client_id: string;
  platform: string;
  ad_id: string;
  ad_name: string | null;
  campaign_name: string | null;
  recent_ctr: number;
  prior_ctr: number;
  decline_pct: number;
  status: FatigueStatus;
  created_at: string;
  resolved_at: string | null;
}

export function getCreativeFatigueSignals(
  clientId: string,
  status: FatigueStatus = "active"
): Promise<CreativeFatigueSignal[]> {
  return fetchJson<CreativeFatigueSignal[]>(`/clients/${clientId}/creative-fatigue${rangeQuery(undefined, { status })}`);
}

export function dismissCreativeFatigueSignal(id: string): Promise<CreativeFatigueSignal> {
  return mutateJson<CreativeFatigueSignal>(`/creative-fatigue/${id}/dismiss`, "PATCH");
}

// Step 50 — confirm-first budget reallocation suggestions.
export type BudgetReallocationStatus = "pending" | "confirmed" | "dismissed" | "failed";

export interface BudgetReallocationSuggestion {
  id: string;
  client_id: string;
  platform: string;
  from_campaign_id: string;
  from_campaign_name: string | null;
  from_roas: number;
  to_campaign_id: string;
  to_campaign_name: string | null;
  to_roas: number;
  suggested_shift_amount: number;
  reasoning: string;
  status: BudgetReallocationStatus;
  error: string | null;
  created_at: string;
  resolved_at: string | null;
}

export function getBudgetReallocations(
  clientId: string,
  status: BudgetReallocationStatus = "pending"
): Promise<BudgetReallocationSuggestion[]> {
  return fetchJson<BudgetReallocationSuggestion[]>(`/clients/${clientId}/budget-reallocations${rangeQuery(undefined, { status })}`);
}

export function dismissBudgetReallocation(id: string): Promise<BudgetReallocationSuggestion> {
  return mutateJson<BudgetReallocationSuggestion>(`/budget-reallocations/${id}/dismiss`, "PATCH");
}

// Bespoke (not mutateJson), same reasoning as confirmPauseCandidate — a failed
// execution still returns a real body (the suggestion marked 'failed', with the
// actual platform error) on a non-2xx status.
export function confirmBudgetReallocation(id: string): Promise<BudgetReallocationSuggestion> {
  return apiRequest(`${API_URL}/budget-reallocations/${id}/confirm`, { method: "POST" }).then(async (res) => {
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
    return body;
  });
}

export function getIncrementalityTests(clientId: string): Promise<IncrementalityTestWithResult[]> {
  return fetchJson<IncrementalityTestWithResult[]>(`/clients/${clientId}/incrementality-tests`);
}

export function createIncrementalityTest(
  clientId: string,
  body: { platform: string; campaignName: string; pauseStart: string; pauseEnd: string; prePeriodDays?: number }
): Promise<IncrementalityTestWithResult> {
  return apiRequest(`${API_URL}/clients/${clientId}/incrementality-tests`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(async (res) => {
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.error ?? `Request failed (${res.status})`);
    }
    return res.json();
  });
}

export function deleteIncrementalityTest(testId: string): Promise<void> {
  return apiRequest(`${API_URL}/incrementality-tests/${testId}`, { method: "DELETE" }).then((res) => {
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
  });
}

export function generateShareLink(clientId: string): Promise<Client> {
  return mutateJson<Client>(`/clients/${clientId}/share-link`, "POST");
}

export function revokeShareLink(clientId: string): Promise<Client> {
  return apiRequest(`${API_URL}/clients/${clientId}/share-link`, { method: "DELETE" }).then((res) => {
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    return res.json();
  });
}

// Step 40 — the public share report itself needs no auth header (the token IS
// the credential), so this deliberately does NOT go through apiRequest()'s
// Authorization-header-attaching wrapper the way every other call in this file does.
export interface PublicShareOverview {
  clientName: string;
  from: string;
  to: string;
  cost: number;
  revenue: number;
  profit: number;
  roas: number | null;
  roi: number | null;
  sales: number;
  series: { date: string; cost: number; revenue: number }[];
}

// Step 41 — likely-typo UTM naming mismatches.
export interface UtmMismatch {
  sessionCampaign: string;
  platform: string;
  closestAdCostsCampaign: string;
  editDistance: number;
}

export function getUtmMismatches(clientId: string): Promise<UtmMismatch[]> {
  return fetchJson<UtmMismatch[]>(`/clients/${clientId}/utm-mismatches`);
}

export function getPublicShareOverview(token: string): Promise<PublicShareOverview> {
  return fetch(`${API_URL}/public/share/${token}/overview`).then(async (res) => {
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? `Request failed (${res.status})`);
    }
    return res.json();
  });
}

export function deleteClient(clientId: string): Promise<void> {
  return apiRequest(`${API_URL}/clients/${clientId}`, { method: "DELETE" }).then(async (res) => {
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? `Request failed (${res.status})`);
    }
  });
}

// Client sharing (migration 028) — a collaborator gets the exact same data access as
// the owner; only the owner can add/remove who else has it (enforced server-side,
// this UI just hides the controls for a non-owner rather than showing a 403).
export interface Collaborator {
  user_id: string;
  email: string;
  agency_name: string;
  added_at: string;
}

export function getCollaborators(clientId: string): Promise<Collaborator[]> {
  return fetchJson<Collaborator[]>(`/clients/${clientId}/collaborators`);
}

export function addCollaborator(clientId: string, email: string): Promise<{ user_id: string; email: string }> {
  return apiRequest(`${API_URL}/clients/${clientId}/collaborators`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  }).then(async (res) => {
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? `Request failed (${res.status})`);
    }
    return res.json();
  });
}

export function removeCollaborator(clientId: string, userId: string): Promise<void> {
  return apiRequest(`${API_URL}/clients/${clientId}/collaborators/${userId}`, { method: "DELETE" }).then(async (res) => {
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? `Request failed (${res.status})`);
    }
  });
}

export function generateTagWebhookSecret(clientId: string): Promise<IntegrationSummary & { config: { webhook_secret: string } }> {
  return apiRequest(`${API_URL}/clients/${clientId}/integrations/tag-webhook/generate`, { method: "POST" }).then((res) => {
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
  return apiRequest(`${API_URL}/clients/${clientId}/webhook-subscriptions`).then((res) => {
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    return res.json();
  });
}

export function createWebhookSubscription(
  clientId: string,
  body: { target_url: string; event_types: string[] }
): Promise<OutboundWebhookSubscription & { signing_secret: string }> {
  return apiRequest(`${API_URL}/clients/${clientId}/webhook-subscriptions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((res) => {
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    return res.json();
  });
}

export function deleteWebhookSubscription(subId: string): Promise<void> {
  return apiRequest(`${API_URL}/webhook-subscriptions/${subId}`, { method: "DELETE" }).then((res) => {
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
  });
}

export interface TrackingNumber {
  id: string;
  phone_number: string;
  forward_to: string;
  status: "available" | "assigned";
  assigned_at: string | null;
  created_at: string;
}

export function getTrackingNumbers(clientId: string): Promise<TrackingNumber[]> {
  return apiRequest(`${API_URL}/clients/${clientId}/tracking-numbers`).then((res) => {
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    return res.json();
  });
}

export function createTrackingNumber(
  clientId: string,
  body: { phone_number: string; forward_to: string }
): Promise<TrackingNumber> {
  return apiRequest(`${API_URL}/clients/${clientId}/tracking-numbers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((res) => {
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    return res.json();
  });
}

export interface IdentityLink {
  id: string;
  primary_identity_id: string;
  linked_identity_id: string;
  primary_email: string;
  linked_email: string;
  mechanism: "session_id" | "phone_number" | "ip" | "manual";
  confidence: number;
  created_at: string;
}

export function getIdentityLinks(clientId: string): Promise<IdentityLink[]> {
  return apiRequest(`${API_URL}/clients/${clientId}/identity-links`).then((res) => {
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    return res.json();
  });
}

export function createIdentityLink(
  clientId: string,
  body: { primary_email: string; linked_email: string }
): Promise<IdentityLink> {
  return apiRequest(`${API_URL}/clients/${clientId}/identity-links`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(async (res) => {
    if (!res.ok) {
      const errorBody = await res.json().catch(() => ({}));
      throw new Error(errorBody.error ?? `Request failed (${res.status})`);
    }
    return res.json();
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
  scope_type?: "client" | "platform" | "campaign" | "creative";
  scope_platform?: string | null;
  scope_key?: string | null;
}

export type InsightScope =
  | { type: "client" }
  | { type: "platform"; platform: string }
  | { type: "campaign"; platform: string; campaignName: string }
  | { type: "creative"; platform: string; campaignName: string; creativeName: string };

function scopeQuery(scope?: InsightScope): string {
  if (!scope || scope.type === "client") return "";
  const params = new URLSearchParams({ scope: scope.type, platform: scope.platform });
  if (scope.type === "campaign" || scope.type === "creative") params.set("campaign", scope.campaignName);
  if (scope.type === "creative") params.set("creative", scope.creativeName);
  return `?${params.toString()}`;
}

export function getInsights(clientId: string, scope?: InsightScope): Promise<ClientInsights | null> {
  return fetchJson<ClientInsights | null>(`/clients/${clientId}/insights${scopeQuery(scope)}`);
}

export function regenerateInsights(clientId: string, scope?: InsightScope): Promise<ClientInsights> {
  return mutateJson<ClientInsights>(`/clients/${clientId}/insights/regenerate${scopeQuery(scope)}`, "POST");
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
  trueProfit: number;
}

export interface OverviewReport {
  from: string;
  to: string;
  cost: number;
  revenue: number;
  profit: number;
  roas: number | null;
  roi: number | null;
  // True profit (Step 31) — profit after cogs_percent/payment_fee_percent/
  // fulfillment_cost_flat, falls back to equaling `profit` when a client hasn't
  // configured any margin inputs (hasMarginConfig tells the UI which is showing).
  trueProfit: number;
  trueRoi: number | null;
  hasMarginConfig: boolean;
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
  // Step 37 — cohort-curve extrapolation from this client's own matured customers,
  // null per-row if there weren't enough predicted values in that campaign, or
  // account-wide if the client doesn't have enough history yet (see
  // predictiveLtvAvailable below).
  predictedAvgLtv: number | null;
}

export interface LtvReport {
  from: string;
  to: string;
  predictiveLtvAvailable: boolean;
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
  trueProfit: number;
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
  trueProfit: number;
  trueRoi: number | null;
  roas: number | null;
  roi: number | null;
  revenueChangePct: number | null;
}

export interface AgencyOverviewReport {
  from: string;
  to: string;
  clients: AgencyClientRow[];
  totals: { cost: number; revenue: number; profit: number; trueProfit: number };
}

async function fetchJson<T>(path: string): Promise<T> {
  const res = await apiRequest(`${API_URL}${path}`);
  if (!res.ok) {
    throw new Error(`Request failed (${res.status}): ${path}`);
  }
  return res.json() as Promise<T>;
}

async function mutateJson<T>(path: string, method: "PATCH" | "POST"): Promise<T> {
  const res = await apiRequest(`${API_URL}${path}`, { method });
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
  return apiRequest(`${API_URL}/clients/${clientId}`).then((res) => {
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

export interface CampaignDetailKpis {
  cost: number;
  impressions: number;
  clicks: number;
  leads: number;
  sales: number;
  revenue: number;
  profit: number;
  trueProfit: number;
  roas: number | null;
  cpl: number | null;
  ctr: number | null;
}

export interface CampaignCreativeRow {
  name: string;
  cost: number;
  impressions: number;
  clicks: number;
  leads: number;
  sales: number;
  revenue: number;
  thumbnailUrl: string | null;
  assetUrl: string | null;
  assetType: "image" | "video" | null;
  cpl: number | null;
  roas: number | null;
  ctr: number | null;
  matched: boolean;
}

export interface CampaignDetail {
  platform: string;
  campaignName: string;
  from: string;
  to: string;
  kpis: CampaignDetailKpis;
  creatives: CampaignCreativeRow[];
}

export function getCampaignDetail(clientId: string, platform: string, campaignName: string, range?: DateRange): Promise<CampaignDetail> {
  return fetchJson<CampaignDetail>(
    `/clients/${clientId}/campaigns/${encodeURIComponent(platform)}/${encodeURIComponent(campaignName)}${rangeQuery(range)}`
  );
}

export interface CreativeDetailAsset {
  thumbnailUrl: string | null;
  assetUrl: string | null;
  assetType: "image" | "video" | null;
}

export interface CreativeDetailCustomer {
  email: string;
  purchasedAt: string;
  revenue: number;
}

export interface CreativeDetailCopy {
  headline: string | null;
  primaryText: string | null;
  description: string | null;
  landingPageUrl: string | null;
}

// Step 42 — Facebook only for now (null everywhere else), same disclosure as
// asset/copy. Rates are all "of everyone who pressed play," not "of impressions"
// (that's what hookRate already covers).
export interface CreativeVideoMetrics {
  plays: number;
  hookRate: number | null;
  p25Rate: number | null;
  p50Rate: number | null;
  p75Rate: number | null;
  p100Rate: number | null;
}

export interface CreativeDetail {
  platform: string;
  campaignName: string;
  creativeName: string;
  from: string;
  to: string;
  asset: CreativeDetailAsset;
  videoMetrics: CreativeVideoMetrics | null;
  copy: CreativeDetailCopy;
  kpis: CampaignDetailKpis;
  customers: CreativeDetailCustomer[];
}

export function getCreativeDetail(
  clientId: string,
  platform: string,
  campaignName: string,
  creativeName: string,
  range?: DateRange
): Promise<CreativeDetail> {
  return fetchJson<CreativeDetail>(
    `/clients/${clientId}/campaigns/${encodeURIComponent(platform)}/${encodeURIComponent(campaignName)}/creatives/${encodeURIComponent(creativeName)}${rangeQuery(range)}`
  );
}

export interface JourneySession {
  id: string;
  started_at: string;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  landing_page: string | null;
  referrer: string | null;
  fbclid: string | null;
  gclid: string | null;
  ttclid: string | null;
}

export interface JourneyPurchaseAttribution {
  session_id: string;
  model: string;
  credit_fraction: number;
  attributed_revenue: number;
}

export interface JourneyPurchase {
  id: string;
  revenue: number;
  product: string | null;
  order_id: string | null;
  processor: string | null;
  refunded: boolean;
  refunded_at: string | null;
  purchased_at: string;
  attributed: boolean;
  attributions: JourneyPurchaseAttribution[];
}

export interface JourneyTag {
  name: string;
  tag_type: TagType;
  applied_at: string;
  applied_by: string;
}

export interface JourneyCall {
  id: string;
  session_id: string | null;
  status: string | null;
  duration_seconds: number | null;
  qualified: boolean | null;
  disposition: string | null;
  started_at: string;
  // Step 36 — Twilio-transcribed + Claude-scored, a suggestion alongside the
  // human-set qualified/disposition above, never overwriting them.
  transcript: string | null;
  ai_qualification_score: number | null;
  ai_disposition: string | null;
  ai_summary: string | null;
}

export interface Journey {
  email: string;
  identified: boolean;
  identified_at: string | null;
  identified_on_page: string | null;
  sessions: JourneySession[];
  purchases: JourneyPurchase[];
  tags: JourneyTag[];
  calls: JourneyCall[];
}

export function getJourney(clientId: string, email: string): Promise<Journey> {
  return fetchJson<Journey>(`/clients/${clientId}/leads/${encodeURIComponent(email)}/journey`);
}

export type CallDisposition =
  | "new_lead"
  | "qualified"
  | "unqualified"
  | "existing_customer"
  | "wrong_number"
  | "voicemail"
  | "spam";

export const CALL_DISPOSITIONS: CallDisposition[] = [
  "new_lead",
  "qualified",
  "unqualified",
  "existing_customer",
  "wrong_number",
  "voicemail",
  "spam",
];

export function updateCallQualification(
  callId: string,
  body: { qualification_score?: number; disposition?: CallDisposition }
): Promise<JourneyCall> {
  return apiRequest(`${API_URL}/calls/${callId}/qualification`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((res) => {
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    return res.json();
  });
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

// The one action in this whole flow that reaches a real ESP — adds the candidate
// to a Klaviyo list, it does not itself trigger a send. Only callable once a
// candidate is already approved.
export function dispatchRemarketingCandidate(id: string): Promise<RemarketingCandidate & { klaviyo_profile_id: string }> {
  return mutateJson(`/remarketing/${id}/dispatch`, "POST");
}

// Step 35 — confirm-first review surface for ad-level anomaly detection. Confirming
// actually pauses the ad via that platform's API (Facebook only for now); dismissing
// just closes the candidate out with no action taken.
export type PauseCandidateStatus = "pending" | "confirmed" | "dismissed" | "failed";

export interface PauseCandidate {
  id: string;
  client_id: string;
  platform: string;
  ad_id: string;
  ad_name: string | null;
  campaign_name: string | null;
  reason: string;
  status: PauseCandidateStatus;
  error: string | null;
  created_at: string;
  resolved_at: string | null;
}

export function getPauseCandidates(
  clientId: string,
  status: PauseCandidateStatus = "pending"
): Promise<PauseCandidate[]> {
  return fetchJson<PauseCandidate[]>(`/clients/${clientId}/pause-candidates${rangeQuery(undefined, { status })}`);
}

// Bespoke (not mutateJson) because a failed pause attempt still returns a real body
// (the candidate marked 'failed', with the actual platform error) on a non-2xx
// status — worth surfacing that instead of a generic "Request failed (502)".
export function confirmPauseCandidate(id: string): Promise<PauseCandidate> {
  return apiRequest(`${API_URL}/pause-candidates/${id}/confirm`, { method: "POST" }).then(async (res) => {
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
    return body;
  });
}

export function dismissPauseCandidate(id: string): Promise<PauseCandidate> {
  return mutateJson<PauseCandidate>(`/pause-candidates/${id}/dismiss`, "PATCH");
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
  return apiRequest(`${API_URL}/clients/${clientId}/tags`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => {
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    return res.json();
  });
}

export function deleteTag(tagId: string): Promise<void> {
  return apiRequest(`${API_URL}/tags/${tagId}`, { method: "DELETE" }).then((res) => {
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
  });
}

export function getLeadTags(clientId: string, email: string): Promise<LeadTag[]> {
  return fetchJson<LeadTag[]>(`/clients/${clientId}/leads/${encodeURIComponent(email)}/tags`);
}

export function applyLeadTag(clientId: string, email: string, tagId: string): Promise<void> {
  return apiRequest(`${API_URL}/clients/${clientId}/leads/${encodeURIComponent(email)}/tags`, {
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
  return apiRequest(`${API_URL}/clients/${clientId}/audience-syncs`, {
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
  return apiRequest(`${API_URL}/clients/${clientId}/custom-costs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => {
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    return res.json();
  });
}
