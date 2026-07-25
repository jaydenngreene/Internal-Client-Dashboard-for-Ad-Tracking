# Kado — Requirements & Functionality Document

**Status:** living document, reflects the product as of 2026-07-25
**Audience:** anyone who needs to understand what Kado does and why, without reading the code — new team members, stakeholders, or a future maintainer

---

## 1. Product Overview

Kado is a full-funnel ad attribution and reporting platform, built for a marketing agency (Greene Consulting Group) to manage paid-advertising performance across all of its clients in one place. It plays the same role as Hyros, Triple Whale, or Northbeam: an independent, cross-platform source of truth for "what is our ad spend actually producing," sitting alongside — not replacing — the ad platforms themselves (Meta Ads Manager, Google Ads, etc.).

Kado is multi-tenant: one agency login manages many clients ("brands"/"accounts"), each with its own tracking pixel, integrations, and reporting.

### Why it exists (the problem it solves)

1. **No ad platform tells the truth about itself.** Facebook's reported ROAS is known to over-credit Facebook; Google's reports over-credit Google. An agency running spend across multiple platforms has no neutral, blended view of total spend vs. total revenue.
2. **Ad platforms don't know your real profit.** They report revenue, not profit — no visibility into COGS, payment processing fees, or fulfillment costs.
3. **Tracking is degrading industry-wide.** iOS App Tracking Transparency, Safari ITP, and third-party cookie deprecation all erode what ad platforms' own pixels can see. First-party, server-side-capable tracking (this app's own pixel + Conversions API integrations) is more resilient.
4. **No platform shows the whole funnel.** Ad platforms report on ad-click-to-conversion; they have no visibility into on-site behavior (product views, cart abandonment, checkout completion) that explains *why* a campaign is or isn't converting.
5. **No platform tracks LTV.** Ad platforms optimize for the immediate conversion event; they have no concept of which campaigns bring high-lifetime-value repeat customers vs. cheap one-time buyers.
6. **Agencies need a cross-client rollup.** Managing multiple client ad accounts natively means constant context-switching between platforms and accounts; there is no single "how is everything doing" view.

---

## 2. Target Users

- **Agency owner / operator** (primary user) — logs in once, manages every client account, needs both per-client depth and a cross-client rollup.
- **Agency collaborators** — team members given access to specific client accounts (not owner-level actions like billing/deletion).
- **The client themselves** — never logs into the dashboard directly, but may receive a read-only public share link with the agency's own branding, showing their own performance.

---

## 3. Multi-Tenancy & Access Model

- **Agency (user) level**: one login (`users` table) represents one agency. Has its own name and logo (white-label branding for the app chrome itself), email/password + optional TOTP 2FA, and an `agency_name` shown throughout the UI in place of the app's own identity.
- **Client level**: each client ("Nothing But Buckets," "BlackB4U," etc.) is a fully isolated tenant — its own pixel key, its own integrations, its own data. A client is owned by one agency user (`owner_user_id`) and can be shared with collaborators (`client_collaborators`) who get identical data access but not owner-only actions (deleting the client, managing who else has access).
- **Ownership enforcement**: every dashboard-facing API route is checked against an explicit, exhaustive per-route ownership table — a route with no registered resolver fails closed (500), rather than silently allowing unscoped access. This is a deliberate security design choice: routes must be *added* to the allow-list, not merely omitted from a deny-list.
- **Public share links**: a per-client, revocable token-based link exposes a read-only Overview-style report with no login required — for handing a client their own numbers without giving them dashboard access. Branding on this page is overridable per client (see §5.7).

---

## 4. Functional Requirements by Module

### 4.1 Tracking & Attribution

**Requirement**: capture every marketing touchpoint (ad click, organic visit, direct visit) and every conversion event (purchase, lead, subscription), and connect them — even when third-party tracking fails.

- A first-party JavaScript pixel (installed on the client's own website) captures pageviews, sessions, ad-click IDs (`fbclid`, `gclid`, `ttclid`, `msclkid`) and UTM parameters, device fingerprint (for cookie-loss resilience), and ecommerce funnel events (product view, add-to-cart, checkout-initiated).
- Identity resolution: an anonymous visitor becomes a known customer once identified by email (checkout, form submit, lead capture) — that link is what allows a later purchase to be traced back to the ad session that drove it.
- **Attribution models** (selectable per client): first-click, last-click, linear, time-decay, and U-shaped. All revenue-splitting logic is model-aware.
- **Attribution fallback for Shopify**: Shopify's checkout runs in a sandboxed environment whose own cookie behavior is not reliable for connecting a purchase back to its originating ad session. Kado independently recovers this using Shopify's own first-party `landing_site` field (the customer's real first-landing URL, tracked server-side by Shopify itself) whenever the pixel-based match comes up empty — so attribution degrades gracefully instead of failing silently.
- **Cross-device / cookie-loss resilience**: device fingerprinting plus a visitor-alias table reconnects a returning visitor whose cookie was cleared or who switched devices, without creating a duplicate visitor record.
- **Invalid traffic detection**: sessions are flagged as suspected bot traffic at the point of ad-click session creation (not retroactively), keeping obviously invalid clicks out of attribution and funnel metrics while remaining visible for audit.
- **Server-side conversion signals (CAPI/Enhanced Conversions)**: purchase, lead, and funnel-stage events are sent back to Meta, Google, TikTok, Snapchat, Pinterest, LinkedIn, Reddit, and Bing/Microsoft using each platform's own server-side API (hashed PII, click-ID matching), independent of whether the browser pixel fired. This both recovers otherwise-lost conversions and improves each ad platform's own optimization.
  - Facebook CAPI specifically supports de-duplication against a client's own native Meta pixel (shared `event_id`, keyed on order ID) — but a client already running Shopify's official "Facebook & Instagram" channel app (which has its own complete pixel + CAPI integration) should disconnect Kado's own Facebook CAPI to avoid double-reporting the same purchase to Meta.

### 4.2 Core Reporting

**Requirement**: give an agency owner every number needed to judge ad performance, at both the account-wide and campaign/creative level.

- **Overview** — the account-wide daily dashboard: Ad Spend, Total Revenue (every non-refunded sale, attributed or not), Attributed Revenue, Profit (COGS/fee/fulfillment-adjusted if configured), ROAS (attributed-revenue basis — the ad-spend-caused view), Blended ROAS (total-revenue basis — the "trust the real bank balance over what Meta claims" view), ROI, trend charts, and a "Recently Viewed" clients list. Two date-range-scoped views: Basic (headline numbers) and Pro (full breakdown with budget pacing, forecast, best-performing creatives, AI insights).
- **Funnel (TOF / MOF / BOF)** — three-stage funnel health view:
  - *TOF* (leads/purchases in, cost per acquisition)
  - *MOF* (sessions, pageviews, engagement; for ecommerce: product views → add-to-cart → checkout-initiated → cart abandonment, each with real trend sparklines)
  - *BOF* (bottom-of-funnel outcomes) — niche-aware: ecommerce clients see repeat-purchase rate, new-vs-returning customer split, and time-from-first-click-to-purchase; lead-gen clients see lead-to-buyer conversion rate and average days to convert. Refund rate and AOV-by-source are shown for every niche.
- **Campaigns** — spend/revenue/ROAS breakdown by Campaign, Source, Keyword, or Creative, matched between real ad-platform spend data and attributed on-site revenue. Matching tolerates a client's ad URLs using either human-readable names or a platform's raw numeric campaign/ad IDs in their UTM tags — both resolve to the same row instead of fragmenting into a "campaign" of raw numbers.
- **LTV / Cohorts** — customer lifetime value by acquisition campaign across 30/60/90/180-day and lifetime windows, plus month-of-acquisition cohort views.
- **Leads** — lead-level detail and named "best paths" (which touchpoint sequences most often lead to a sale).
- **Email & SMS** — Klaviyo campaign performance folded into the same attribution model.
- **Subscriptions** (SaaS niche only) — MRR, churn rate, trial conversion rate, and subscription lifecycle events (trial started/converted, reactivated, canceled, past due).
- **Calls** (call/lead-gen niches) — dynamic number insertion (DNI) call tracking, call-to-campaign attribution, manual qualification tagging with a disposition/quality score.

### 4.3 Advanced Statistical Analysis

**Requirement**: answer harder questions than simple last-click reporting can — the kind of analysis normally requiring a data team or an expensive specialist tool.

- **Media Mix Model (MMM)** — regression-based modeling of each channel's real contribution to revenue, including a diminishing-returns (log-spend) budget scenario simulator ("what happens if I shift $50/day from Google to Facebook").
- **Data-Driven Attribution (Markov chain)** — removal-effect modeling of channel importance, an alternative to rule-based attribution models.
- **Geo-Lift Testing** — holdout-region incrementality testing (pause ads in region A, compare revenue-per-visit against untouched regions).
- **Incrementality Testing** — treatment/holdout group testing to estimate true incremental lift from ad spend, separate from what would have converted anyway.
- **Forecasting** — straight-line trend projection (7-day / 30-day) for revenue, spend, ROAS, new customers, and CAC — explicitly framed as directional, not a precise prediction.
- **Predictive LTV** — maturity-curve-based projection of a cohort's eventual lifetime value before the full window has elapsed.
- All statistical outputs are written in plain business language (no raw stats jargon like R², p-value, regression coefficient) — this is a standing content rule, not a one-time pass.

### 4.4 Automation & Monitoring

**Requirement**: surface what needs a human decision, without requiring the agency to remember to check every page.

- **Insights (AI-generated)** — narrative, on-demand explanations of what changed and why, generated per client or per campaign.
- **Pause Candidates** — flags campaigns/ads likely worth pausing based on sustained poor performance, with outcome-framed dollar impact and a confirm/dismiss workflow.
- **Budget Reallocation** — suggests shifting budget from an underperforming campaign to an overperforming one, with an estimated ROAS/revenue impact.
- **Creative Fatigue** — detects declining creative performance over time (rising CPM/falling CTR trend) before it becomes an obvious problem.
- **Tracking Health** — detects tracking breakage itself: pixel gone silent, an unexplained traffic drop, or one specific ad platform's spend with zero matching tracked sessions (catching a single broken integration that account-wide checks would miss).
- **Invalid Traffic** — reporting view over the sessions already flagged as suspected bot/invalid traffic.
- **Notifications** — a single bell icon aggregating counts across all four advisory signal types (pause candidates, creative fatigue, tracking health, budget reallocation) so nothing requires remembering to check four separate pages.
- **Scheduled reports** — opt-in recurring performance summary emails per client.

### 4.5 AI Features

- **Gojo** — Kado's named conversational AI assistant (its own branded identity, not a generic "chat" button). Answers real questions about a client's performance by querying live data through tool use — never guesses or fabricates numbers.
- **AI Insights** — see §4.4.
- **AI Remarketing** — for a connected identity-resolution source (Customers.ai), drafts outreach copy for site visitors who didn't convert, strictly from vendor-provided data (never fabricates browsing history or urgency claims not actually observed). Deliberately **review-and-approve only** — nothing sends automatically; dispatch to Klaviyo is a separate, explicit, manual action.
- **AI Creative Tagging** — classifies each creative's hook type/angle/tone from its ad copy, then aggregates real spend/ROAS performance by tag to surface which creative patterns actually work.

### 4.6 Integrations

**Ecommerce / payment processors**: Shopify (webhook + native app OAuth install flow), Stripe, PayPal, Square, GoHighLevel, plus a generic webhook path for any other processor.

**Ad platforms** (cost sync + conversion signals both ways): Facebook/Meta, Google Ads, TikTok, Snapchat, Pinterest, LinkedIn, Reddit, Bing/Microsoft Advertising.

**Other**: Twilio (call tracking/DNI), Klaviyo (email/SMS performance + remarketing dispatch), Customers.ai (identity resolution for remarketing), BigQuery (data export), Slack/email/SMS (alert delivery).

**Historical data import**: a one-time CSV upload path backfills Shopify order history from before the live webhook was registered — deduplicated against anything the webhook already captured, using the order's real historical date rather than the upload time.

**Disconnecting an integration**: any integration can be removed from a client (e.g., to stop a redundant/duplicate Facebook CAPI signal when the client already runs Shopify's own official Meta channel app) without affecting the client's own tracking pixel or Shopify order webhook.

### 4.7 Branding / White-Label

- **App-level branding**: Kado's own name/logo/favicon, consistent across the dashboard, login screen, public share pages, and the pixel install snippet.
- **Agency-level branding**: an agency's own name and logo replace Kado's default mark in the sidebar and wherever the agency's own identity is shown.
- **Client-level branding**: a client's public share link can show that client's own logo/accent color instead of Kado's or the agency's.
- **Logo upload**: any branding logo (agency or client) can be either a pasted URL the agency hosts themselves, or uploaded directly from the user's device.

### 4.8 Account & Security

- Email/password authentication with persistent ("remember me") sessions that opportunistically refresh before expiry.
- Optional TOTP-based two-factor authentication (QR-code setup, backup codes, disable-with-password).
- Password reset via emailed token; email-change requires re-verification.
- Full audit log of every mutating action taken on an account or a client, including who, what, and when.
- Collaborator management: share a client with another login by email; only the owner can revoke access or delete the client.

---

## 5. Niche-Aware Behavior

Every client is assigned a niche — **ecommerce, call, lead_gen, saas, info_product,** or **other** — which changes what several report pages surface, without changing the underlying data model:

| Niche | TOF metric | BOF framing | Extra sections |
|---|---|---|---|
| ecommerce | Purchases / cost-per-purchase | Repeat purchase rate, new vs. returning | Cart funnel (MOF), Creatives |
| call | Leads / cost-per-lead | Lead-to-buyer rate | Call tracking (DNI, qualification) |
| lead_gen | Leads / cost-per-lead | Lead-to-buyer rate | — |
| saas | Leads / cost-per-lead | Lead-to-buyer rate | Subscriptions (MRR, churn) |
| info_product | Purchases / cost-per-purchase | Repeat purchase rate, new vs. returning | — |
| other | Leads / cost-per-lead | Lead-to-buyer rate | — |

---

## 6. Non-Functional Requirements

- **Security**: every credential/secret field is redacted from API responses once saved (write-only from the client's perspective); webhook signatures are verified per-platform; rate limiting on all endpoints (stricter on login/register); ownership checks fail closed by default.
- **Data integrity**: idempotency guards prevent duplicate purchase rows on webhook retries; currency conversion normalizes multi-currency revenue into each client's own base currency for reporting.
- **Resilience**: every outbound integration call (ad-cost sync, conversion signals, remarketing dispatch) is isolated per-client and never lets one client's bad credentials or one platform's outage block anything else.
- **Transparency over guessing**: every statistical/AI feature that can't produce a confident answer says so explicitly (e.g., "not enough spend variance to separate channels' contributions") rather than returning a misleading number.
- **Plain-language reporting**: no raw statistical jargon in anything a non-technical agency owner reads.

---

## 7. Known Limitations / Deliberate Scope Cuts

These are intentional, not oversights — documented so they aren't "rediscovered" as bugs later:

- No native mobile app.
- No general-purpose file storage system — uploads are scoped specifically to small branding images.
- Remarketing AI never sends automatically; dispatch is always an explicit manual step.
- MMM is a diminishing-returns regression model, not a full Bayesian adstock model.
- Creative tagging classifies ad *copy*, not computer-vision analysis of the actual image/video asset.
- No Zapier or generic no-code automation connector.

---

## 8. Glossary

- **TOF / MOF / BOF** — Top / Middle / Bottom of funnel.
- **Attributed Revenue** — revenue from purchases with at least one matched ad-click/session.
- **Blended Revenue** — total revenue from every non-refunded purchase, attributed or not.
- **ROAS** — Return on Ad Spend (attributed revenue ÷ ad spend).
- **Blended ROAS** — total revenue ÷ ad spend, account-wide only.
- **CAPI** — Conversions API (Meta's server-side conversion reporting mechanism); the equivalent concept exists per-platform under different names (Enhanced Conversions for Google, etc.).
- **DNI** — Dynamic Number Insertion (call tracking).
- **LTV** — Customer Lifetime Value.
- **Gojo** — Kado's named AI chat assistant.
