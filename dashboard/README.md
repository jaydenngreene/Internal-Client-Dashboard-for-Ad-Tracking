# Dashboard

Next.js 16 (App Router) frontend for the Internal Ad Tracking platform — see the [repo root README](../README.md) for
the full project overview, setup steps, and architecture.

This workspace on its own is just the UI; it talks to the `api/` workspace over HTTP (`NEXT_PUBLIC_API_URL` in
`.env.local`, not committed) and has no database access or business logic of its own.

## Run locally

From the repo root (needs `api/` running too — see the root README):

```
npm run dev:dashboard
```

Opens on http://localhost:3000.

## Structure

- `src/app/login/`, `src/app/account/` — auth and the logged-in user's own account settings
- `src/app/agency/` — the multi-client rollup (landing page after login)
- `src/app/clients/[clientId]/` — every per-client report tab; `settings/` holds that client's integrations,
  webhooks, tracking numbers, and identity links
- `src/lib/api.ts` — every backend call, all going through one `apiRequest()` wrapper (attaches the auth token,
  redirects to `/login` on a 401)
- `src/components/ui/` — shared primitives (Button, Select, Card, etc.) built on `@base-ui/react`
