# Kado — Technical Specification

**Status:** living document, reflects the codebase as of 2026-07-25
**Audience:** engineers working on or maintaining this codebase

---

## 1. Architecture Overview

Kado is an npm-workspaces monorepo with three deployable units and one shared Postgres database:

```
internal-ad-tracking/
├── api/         Fastify + TypeScript backend — the entire system's brain
├── pixel/       Vanilla JS tracking pixel — built once, served statically
├── dashboard/   Next.js 16 (App Router) frontend
├── scripts/     One-off CLI setup scripts (npm run setup:*)
└── docs/        This document and its companion (REQUIREMENTS.md)
```

- `api` and `pixel` are independently built (`tsc` / a bundler respectively); `pixel`'s build output is served by `api` at `/pixel.js` — one universal file, configured per page via `window.ADT_CONFIG` rather than rebuilt per client.
- `dashboard` is a fully separate deployable app with no server-side dependency on `api` beyond calling its HTTP API.
- All three talk to one Postgres database directly from `api` — `dashboard` never queries the database itself.

## 2. Tech Stack

| Layer | Technology |
|---|---|
| API | Node.js, Fastify 5, TypeScript, `pg` (raw SQL, no ORM) |
| Database | PostgreSQL (hosted on Supabase) |
| Dashboard | Next.js 16 (App Router), React 19, Tailwind CSS v4, shadcn/ui, TanStack Query, Recharts |
| Pixel | Vanilla JavaScript, no framework, no build-time per-client templating |
| Auth | JWT (`jsonwebtoken`), bcrypt password hashing, TOTP (`qrcode` for setup) |
| AI | `@anthropic-ai/sdk` (Claude) — powers Gojo chat, Insights, Remarketing drafts, Creative Tagging |
| Image processing | `sharp` |
| Error tracking | Sentry (`@sentry/node`) |
| Email | Resend |

## 3. Deployment Topology

| Component | Host | Notes |
|---|---|---|
| API | Railway | Auto-deploys on push to `main`. Builds via `railway.json` (`npm install && npm run build --workspace=pixel && npm run build --workspace=api`), runs `npm run start --workspace=api`. No OS-level cron — scheduled jobs (§9) only run while this process is alive. |
| Dashboard | Vercel | Auto-deploys on push to `main`, independently of the API's deploy — **these two are not synchronized**; a frontend release can go live seconds to minutes before or after its corresponding backend release. Code that depends on both should tolerate a brief window of version skew (e.g., a new response field defaulting gracefully on the frontend if the API hasn't redeployed yet). |
| Database | Supabase (managed Postgres) | Single database backs the entire application; no read replicas or per-tenant database splitting. |

**Environment separation**: there is one production database and one production deployment per service — no separate staging environment. Local development runs `api` and `dashboard` against the *same* production database (`DATABASE_URL` is shared), with `dashboard` pointed at a local `api` instance via `NEXT_PUBLIC_API_URL=http://localhost:3001`. This means local dev work reads/writes real production data — verification scripts must clean up any test rows they create.

## 4. Data Model

41 tables in the `public` schema (54 migrations as of this writing, tracked in `api/migrations/`, applied via `npm run migrate`, which skips already-applied files). Core entity groups:

**Identity & tracking**
`clients`, `visitors`, `visitor_aliases` (fingerprint-based re-identification), `sessions` (one row per ad-click or organic landing — carries UTM/click-IDs, geo, bot-detection flag), `pageviews`, `identities` (email → visitor_id link), `identity_links` (cross-device stitching), `cart_events` (ecommerce funnel: view/add-to-cart/checkout-started).

**Conversion & revenue**
`leads`, `purchases`, `attributions` (purchase ↔ session, with `credit_fraction` for split-credit models), `customer_ltv` (rolling-window snapshots, refreshed nightly), `subscriptions` / `subscription_events` (SaaS).

**Ad spend & campaigns**
`ad_costs` (campaign/adset/ad-level daily spend from 8 platforms, keyed by `(client_id, platform, ad_id, date)`), `custom_costs` (manual entries for platforms with no native sync), `creative_tags`, `creative_fatigue_signals`, `email_campaign_stats`.

**Integrations & config**
`client_integrations` (one row per `(client_id, platform)`, credentials in a JSON `config` column, secret fields redacted on read), `tracking_numbers` + `calls` (DNI), `tags` + `lead_tags`, `outbound_webhook_subscriptions` + `_deliveries`, `audience_syncs`, `uploaded_images` (branding logo blobs).

**Automation & monitoring**
`pause_candidates`, `budget_reallocation_suggestions`, `tracking_health_signals`, `remarketing_candidates`, `client_insights`, `job_runs` (scheduled-job execution log).

**Testing/analysis**
`incrementality_tests`, `geo_lift_tests`.

**Platform**
`users` (agency logins), `client_collaborators`, `audit_log`, `chat_messages` (Gojo history), `exchange_rates`, `_migrations` (migration tracking).

**Key design conventions**:
- Every child table carries `client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE` — deleting a client cleanly cascades everything.
- `purchases(client_id, order_id)` has a unique index (where `order_id IS NOT NULL`) enforcing webhook-retry idempotency.
- Money columns are `NUMERIC(10,2)`, never floating point.
- `attributions.credit_fraction` sums to 1.0 across all touches for a given purchase under any model.

## 5. Core Algorithms

### 5.1 Attribution engine (`api/src/lib/attribution.ts`, `recordPurchase`)

Single entry point used by **every** conversion source (all payment-processor webhooks, the direct pixel `/track/conversion` call, the historical CSV importer, tag-triggered sales). Flow:

1. Insert the purchase (idempotent on `(client_id, order_id)`).
2. Resolve the purchaser's identity → visitor_id → sessions within a 90-day lookback window, bounded above by the purchase time (not "now" — critical for historical/backdated imports, which pass an explicit `purchased_at`).
3. **Fallback**: if no session is found this way (e.g., Shopify's checkout-pixel cookie unreliability — see §6), parse the order's `landing_site` field (Shopify-specific, tracked server-side by Shopify itself) for click-IDs/UTMs and synthesize a single-touch session from it.
4. Split revenue credit across the resolved touches per the client's configured attribution model (first-click, last-click, linear, time-decay, U-shaped).
5. Roll the purchase into `customer_ltv` (acquisition fields always reflect true first touch, regardless of attribution model — the model only changes revenue *credit* distribution).
6. Fire server-side conversion signals (CAPI/Enhanced Conversions) to every connected ad platform, using the *last*-touch session's click IDs (matching how each platform's own pixel behaves).
7. Dispatch an outbound webhook event (`sale.attributed`) to any client-configured subscriber.

Every step from 3 onward is best-effort and independently fault-isolated — a failure sending a conversion signal to one ad platform never blocks purchase recording or attribution to the others.

### 5.2 Visitor/session resolution (`api/src/lib/session.ts`, `visitorResolution.ts`)

- `resolveSession`: a hit carrying ad-click data (`fbclid`/`gclid`/etc. or `utm_source`) always starts a **new** session (a fresh ad click is, by definition, a new touchpoint); a hit with none attaches to the visitor's most recent existing session, or creates a baseline organic session if none exists.
- `resolveVisitor`: get-or-create by `(client_id, anonymous_id)`; if the cookie is missing, falls back to matching a device fingerprint hash before creating a genuinely new visitor — recorded as an alias so future lookups route directly to the canonical visitor without re-matching.

### 5.3 Revenue basis: Attributed vs. Total (Blended)

Two genuinely different numbers are surfaced side by side, on purpose, rather than picking one:

- **Attributed revenue** = `SUM(attributions.attributed_revenue)` — only revenue with a matched ad-click/session. This is what ROAS/ROI are computed against, since it's the only revenue actually caused by measured ad spend.
- **Total (Blended) revenue** = `SUM(purchases.revenue) WHERE NOT refunded` — every real sale, whether or not it has a tracked touchpoint (organic, direct, a historical import, or a session lost to tracking degradation). This is what the headline Revenue/Profit tiles and Blended ROAS use.

Mixing these bases into a single "revenue" number is a known historical bug class in this codebase (Overview's headline tiles once silently used the attributed-only basis for everything) — any new report touching revenue must decide explicitly which basis it needs and must not casually reuse a query written for the other.

## 6. Known Platform-Level Tracking Limitation (Shopify)

Confirmed live (two independent test orders, different browsers, one in fresh incognito, both landing on an identical stale visitor id): Shopify's checkout Web Pixel sandbox (`browser.cookie` inside a custom pixel's `checkout_completed` handler) does **not** reliably return the same visitor cookie the storefront pixel set on the rest of the site. This is a Shopify platform behavior, not a bug in this codebase, and it silently breaks checkout-time identity linking for any Shopify client — the §5.1 `landing_site` fallback exists specifically to route around it.

## 7. API Surface

All dashboard-facing routes live under one Fastify instance (`api/src/index.ts`), split into distinct trust boundaries:

| Route group | Auth | Notes |
|---|---|---|
| Pixel-facing (`/track/*`, `/pixel.js`) | `pixel_key` in payload | Unrestricted CORS (`origin: true`) — must work from any client website, never known in advance |
| Webhooks (Shopify, Stripe, PayPal, Square, GHL, Twilio, Customers.ai) | Per-platform signature verification | Server-to-server, not subject to browser CORS |
| `/auth/*`, public share report, `/uploads/logo` serving | Dashboard-origin restricted | No user auth needed for these specific routes |
| Everything else (`/clients/*`, `/reports/*`, etc.) | JWT (`authenticate`) + per-route ownership check (`requireOwnership`) | See §8 |
| `/api/v1/*` | Bearer token (`API_SECRET`) | The same report routes, mounted a second time for external tool integration, independent of dashboard login |

Route catalog highlights (non-exhaustive — see `api/src/routes/`):
- **Reports**: `overview`, `funnel` (campaign/source/keyword/creative breakdown, one endpoint with a `breakdown` query param), `mof`, `bof`, `leads`, `ltv`, `cohorts`, `calls`, `subscriptions`, `email-sms`, `mmm` + `mmm-scenario`, `markov-attribution`, `forecast`, `invalid-traffic`, `budget-pacing`, `best-paths`, plus `/reports/agency-overview` (cross-client rollup).
- **Integrations**: one `POST /clients/:id/integrations/:platform` per platform (18 platforms) for connect/update, one generic `DELETE /clients/:id/integrations/:platform` for disconnect.
- **Uploads**: `POST /uploads/logo` (authenticated, multipart) / `GET /uploads/:id` (public, serves the stored bytes).

## 8. Security Model

- **Password auth**: bcrypt-hashed, JWT session tokens valid 30 days, opportunistically refreshed by the frontend once within 3 days of expiry so an actively-used account is never forced to re-login; a genuinely abandoned token still expires on schedule.
- **MFA**: optional TOTP (RFC 6238), QR-code setup via `qrcode`, backup codes, disable requires password re-entry.
- **Ownership enforcement** (`api/src/lib/ownership.ts`): an explicit, exhaustive `Record<path, resolver>` table — every dashboard route must be registered with either `'client'` (the `:id` param *is* the client id), `'skip'` (no single client scope — create/list/agency-aggregate, self-scoped in the handler), or a resolver function (the id belongs to some other row — a call, a tag, a webhook subscription — one extra lookup finds the owning client). **A route with no entry fails closed with a 500**, by design — a regression here is a security bug, not a UX bug, and is guarded by a dedicated test (`ownership.test.ts`) checking the table's shape.
- **Webhook signature verification**: HMAC (Shopify, Square), Stripe SDK's own verification, PayPal's `verify-webhook-signature` API, Twilio signature — each fails closed (401) once a client has configured a secret, but accepts unverified during the bootstrap window before one is set (matches the setup-script UX).
- **Secret redaction**: `GET /clients/:id/integrations` strips every credential-shaped key (`webhook_secret`, `access_token`, `refresh_token`, `client_secret`, `signature_key`, `auth_token`, `api_key`, `service_account_key`) before the response ever leaves the server — an edit form re-submitting an untouched field falls back to whatever's already stored rather than needing the secret retyped.
- **Rate limiting**: global 300 req/min, with a stricter dedicated limit on `/auth/login` and `/auth/register` specifically.
- **Audit log**: every non-GET request that succeeds is logged (user, client, method, route, status, IP) via a generic `onResponse` hook — no route-by-route instrumentation needed.

## 9. Background Jobs

No OS-level cron — `node-cron` schedules run inside the long-lived API process (`api/src/lib/scheduler.ts`), which is why the API must run on something that stays up continuously (Railway), not a machine that sleeps.

| Cadence | Job | Purpose |
|---|---|---|
| Every 6h | `sync:ad-costs` | Pulls trailing 3-day spend/impressions/clicks from all 8 ad platforms (re-pulls the window to catch platforms' late-finalized numbers) |
| Every 6h (offset) | Klaviyo sync | Email/SMS campaign performance |
| Every 2 min | Outbound webhook retry | Backoff-scheduled redelivery of failed client webhook subscriptions |
| Every 15 min | Call transcription | Requests/polls Twilio async transcription |
| Nightly 2am | LTV refresh | Recomputes `customer_ltv` rolling windows |
| Nightly 3am | Audience sync | Refreshes Custom Audience/Customer Match exports |
| Nightly 4am | (reserved slot) | — |
| Daily 7:00am | Anomaly detection | Reads previous day's finalized `ad_costs` |
| Daily 7:05am | Creative fatigue detection | Same daily-health-check family |
| Daily 7:10am | Pause-candidate / budget-reallocation detection | Same family |
| Daily 7:15am | Tracking health detection | Pixel-silent, traffic-drop, orphaned-platform-spend checks |
| Weekly, Mon 8am | Scheduled report emails | Per-client opt-in performance summary |
| Monthly, 1st 8am | Monthly report emails | Same, monthly cadence |

Every job is wrapped in per-client try/catch isolation and recorded in `job_runs` — one client's bad credentials or one platform's outage never blocks the run for anyone else, and `GET /jobs/status` surfaces last-run/last-error per job.

## 10. Pixel Architecture

`pixel/src/pixel.js` — single vanilla-JS file, no build-time per-client customization. Configured per page via an inline `window.ADT_CONFIG = { apiUrl, pixelKey }` snippet the client pastes alongside `<script src="{apiUrl}/pixel.js">`.

- **Visitor ID**: first-party cookie (`_adt_vid`, 180-day expiry), regenerated only if absent.
- **Device fingerprint**: canvas/WebGL/AudioContext/UA/timezone/screen composite, hashed (SHA-256 via `crypto.subtle`, FNV-1a fallback for non-secure contexts), cached in `sessionStorage` so only the first pageview per session pays the collection cost.
- **Transport**: `navigator.sendBeacon` where available (survives page unload), falls back to a synchronous-style XHR.
- **Public API**: `ADT.identify(email)`, `ADT.trackConversion(...)`, `ADT.trackViewContent/AddToCart/InitiateCheckout(...)`, `ADT.applyTag(tagName)`, `ADT.enableDNI(selector)`.
- **Shopify-specific pieces** (beyond the universal pixel): a theme-injected snippet (pageviews on the storefront), an order-status-page checkout script (legacy, unreliable on stores migrated to Shopify Checkout Extensibility — see §6), and a Customer Events "Web Pixel" (`analytics.subscribe`) for add-to-cart/checkout-started/checkout-completed, which is the currently-reliable path.

## 11. Known Technical Debt / Deliberate Trade-offs

- **No ORM** — raw parameterized SQL throughout (`pg`). Deliberate: keeps query behavior fully explicit for an app whose value proposition is data trustworthiness.
- **No staging environment** — local dev reads/writes the production database directly.
- **Frontend/backend deploy independence** — Vercel and Railway are not coordinated; new-field additions on one side must tolerate a brief window where the other side hasn't deployed yet (see §3).
- **Small-image blob storage in Postgres** (`uploaded_images`, bytea) rather than a dedicated object-storage service — a deliberate scope decision for branding-logo-sized assets, not a pattern intended to generalize to arbitrary file uploads.
- **MMM is a diminishing-returns regression, not full Bayesian adstock modeling.**
- **Bing/Microsoft Advertising integration is unverified against a live account** (no maintained npm wrapper exists; hand-rolled against the documented Reporting API).
