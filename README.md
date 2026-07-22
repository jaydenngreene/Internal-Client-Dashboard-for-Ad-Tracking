# Internal Ad Tracking

A self-hosted, multi-tenant ad-attribution platform (a Hyros-style tool) — full-funnel tracking, cross-device identity
resolution, ad-cost sync, subscription/MRR reporting, an AI remarketing agent, and per-client dashboards. Each user
who registers gets their own isolated set of clients; nobody sees another user's data.

## Stack

- **API**: Node.js + Fastify v5 (TypeScript), PostgreSQL (via `pg`), hosted on Supabase
- **Pixel**: vanilla JS tracking snippet (`pixel/src/pixel.js`)
- **Dashboard**: Next.js 16 (App Router), Tailwind v4, `@base-ui/react` component primitives, TanStack Query, Recharts
- **Chrome extension** (prototype, unpublished): `extension/` — plain unbundled Manifest V3, not an npm workspace

npm workspaces: `api/`, `pixel/`, `dashboard/`, plus `scripts/` (CLI onboarding scripts) and `extension/` (standalone).

## Local setup

1. **Install dependencies** (from the repo root):
   ```
   npm install
   ```
2. **Environment**: copy `.env.example` to `.env` at the repo root and fill in at minimum `DATABASE_URL` (a Postgres
   connection string — this project uses Supabase), `JWT_SECRET`, and `API_SECRET` (any long random strings for the
   latter two). Everything else in `.env.example` is optional — it's per-integration credentials (Facebook, Google
   Ads, Bing, Shopify's OAuth app, Anthropic for AI Insights/remarketing) that only need to be filled in once you're
   ready to connect a real client's ad accounts. The dashboard also needs its own env file:
   ```
   echo "NEXT_PUBLIC_API_URL=http://localhost:3001" > dashboard/.env.local
   ```
3. **Run migrations**:
   ```
   npm run migrate
   ```
4. **Start both dev servers** (separate terminals):
   ```
   npm run dev:api        # http://localhost:3001
   npm run dev:dashboard  # http://localhost:3000
   ```
5. Open http://localhost:3000, register an account (this is the only account you'll need — no invite system, anyone
   who registers gets their own empty workspace), then add a client from the dashboard (`+ Add` in the sidebar) or one
   of the `scripts/setup-*.ts` CLI wizards.

## Repo layout

- `api/src/routes/` — one file per resource; `webhooks/` holds one file per third-party payment/CRM processor
- `api/src/lib/` — shared logic: `attribution.ts` (recordPurchase/recordRefund, the attribution-model math),
  `conversionSignals.ts` (outbound signals to 8 ad platforms), `auth.ts`/`ownership.ts` (login + per-route data
  isolation), `scheduler.ts` (the node-cron jobs), `validation.ts`
- `api/src/jobs/` — background jobs: `adCosts/` (8-platform spend sync), `ltv/` (nightly LTV refresh),
  `audienceSync/` (nightly Custom Audience/Customer Match refresh) — all three run automatically while the API
  process is alive (see `lib/scheduler.ts`), not via an external cron
- `api/migrations/` — plain numbered SQL files, run in order by `npm run migrate`
- `dashboard/src/app/` — `login/`, `account/` (your own login's settings), `agency/` (multi-client rollup), and
  `clients/[clientId]/` (every per-client report tab, including `settings/` for that client's integrations)
- `dashboard/src/lib/api.ts` — every API call the dashboard makes, all routed through one `apiRequest()` wrapper that
  attaches the auth token and handles 401s
- `scripts/` — CLI onboarding wizards (`setup-shopify-client.ts`, `setup-stripe-client.ts`, etc.), an alternative to
  the in-dashboard "Add Client" flow

## Multi-tenant auth

Every dashboard-facing API route requires a logged-in user and is scoped to that user's own clients — see
`api/src/lib/ownership.ts` for the full per-route table of how each route's data ownership is checked. Registration
is open (anyone can create an account); there's no admin/team-sharing concept — each login is a fully separate,
isolated workspace.

## What's not wired up yet

- No password-reset-by-email flow (there's no email-sending provider configured) — see `.env.example` for what would
  be needed if this is added later
- No automated test suite
- Desktop-first; not fully mobile-responsive throughout

## Before this produces real numbers

Nothing here reaches a real ad platform, payment processor, or telephony provider until real credentials exist for
each integration you want to use — every one of them degrades gracefully (logs and continues) with none configured.
See the per-client **Settings** tab for where to enter credentials once you have them.
