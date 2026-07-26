# Kado — Issue Log

**Purpose:** a running record of real bugs found in this app and how they were diagnosed and fixed — as distinct from `TECHNICAL_SPEC.md` (what the system is) and git log (every feature/change). Read this *first* when a client reports something like "attribution looks wrong" or "orders aren't showing up" — the root cause may already be diagnosed below, or may be a known, currently-unverified gap rather than a new bug.

Newest entries first. Each entry: what was reported, what was actually true, the fix, and the commit(s) with full technical detail.

---

## 2026-07-26 — Two catalog ads' spend "missing" from Kado — investigated, not a bug

**Reported:** two Advantage+ catalog ads (`Abandoned_Cart_Retargeting`, `Abandoned_Cart_Retargeting_2`) confirmed in Ads Manager to have real spend and purchases, but purchases attributed to their `ad_id` resolved to no creative name in Kado.

**Investigated, in order:** (1) confirmed via a direct replay of the exact sync query against Meta's live API that Facebook does return both ads' data correctly — ruled out a broken/wrong query. (2) Hypothesized `upsertAdCosts`'s per-row loop (no per-row try/catch — one throwing row could silently drop every row after it in the same batch) as the cause. (3) Tested that hypothesis directly by calling the real `upsertAdCosts` function with the actual rows Facebook returns — **it inserted cleanly, no error.** Hypothesis disproven, not just assumed fine.

**What was actually true, once checked fully:** `Abandoned_Cart_Retargeting` (ad_id `120248579004850253`) was never missing — full unbroken 29-day sync history the whole time. `Abandoned_Cart_Retargeting_2` (ad_id `120249405436560253`) has had spend on exactly one day, ever: the day this was investigated. Kado's routine sync deliberately never pulls "today" (`runAdCostSync`'s `until = yesterday`, ad platforms finalize same-day numbers late) — this was never lost, just not synced yet by design; the next routine run would have picked it up. A **third**, unrelated ad_id (`120249034033030253`, a different purchase's attribution) genuinely has zero data in Meta's own Insights API even queried directly for its exact click date — not a Kado-side gap, Meta itself isn't returning delivery data for that specific ad (most likely deleted or a short-lived automated variant).

**No code changed.** Recorded here specifically so a future session doesn't re-chase the same "maybe it's a batch-upsert bug" theory — it was checked directly and disproven, not just plausible-sounding.

---

## 2026-07-26 — Ad-click data trapped in `document.referrer`, lost entirely

**Reported:** user asked to double-check that Nothing But Buckets' "Direct/Organic" bucket was genuinely organic and not masking a real bug.

**Found:** it mostly was genuine (82 sessions/7d: 52 no-referrer, 15 bare `facebook.com`/`m.facebook.com` referrer with no params — real organic social shares, not ads — plus a handful of search-engine referrals). But a real, distinct bug existed for a small slice: a session with `fbclid`/`utm_source`/`utm_campaign` all null, whose `referrer` was a Shopify checkout URL carrying every one of those params intact. Root cause: `pixel.js`'s `getParams()` only ever read `window.location.search`, never `document.referrer`. A "Buy Now"/dynamic-checkout ad click can land a visitor directly on Shopify's checkout (ad params in *that* URL) before this pixel ever runs on a page it can see — by the time it does, the current URL is clean but the referrer still has everything. Measured: 3 of 30 days' worth of sessions actually hit this — a real but small recovery, not the bulk of the Direct/Organic bucket.

**Fix:** `getParams()` now falls back to parsing the same ad params out of `document.referrer` when the current URL has none. Verified with 4 scenarios (real bug case, current-URL-wins case, two genuinely-organic cases) before shipping — doesn't reclassify real organic traffic.

**Commit:** `c709624`

---

## 2026-07-26 — Nothing But Buckets: most real orders (guest checkout) never getting attributed

**Reported:** "still active orders on nothing but buckets that arent getting attributed... after we had made all those changes, i added UTMs."

**Found:** three separate, unrelated causes stacked on top of each other. This took real digging — don't assume it's just one thing if it recurs on another client.

1. **UTM tagging itself was NOT the problem** — confirmed 62% of sessions carried full fbclid+UTM data, up from before. The user's Meta Ads Manager URL Parameters fix was working correctly.
2. **The actual blocker:** 18 of 27 recent orders had *zero* identity record ever — not a timing/race issue (that was already fixed, see the "attribution race" entry in git log, `f7aa51d`), genuinely never linked. Traced to the Shopify checkout custom pixel's `checkout_completed` → `/track/identify` POST having no `keepalive: true`. Shopify redirects to the thank-you page almost immediately after that event fires; without keepalive the browser can cancel the in-flight fetch mid-navigation. Shopify's own docs cite a 3-7% loss from this specific gap — real, but far short of the ~67% failure rate observed, so this wasn't the whole story.
3. **The real majority cause:** the client's own "Kado" custom pixel in Shopify's Customer Events had **Data sale: "Data collected qualifies as data sale"** set. That silently blocks the pixel entirely (no error, no identity, nothing) for any visitor from California/Colorado/~13 other US states who has opted out of data sale — including automatically via **Global Privacy Control (GPC)**, a browser-level signal that Firefox, Brave, and many privacy extensions send by default now, with zero visible banner. This is legally required to be honored, so it's not a bug in the platform config — it's a *classification* question: is this pixel's data collection actually a "sale/share"? For Nothing But Buckets, Kado has no `facebook_capi`/audience-sync integration connected (verified via `client_integrations` — confirmed real, not assumed) — the pixel only feeds Kado's own first-party attribution reporting, nothing shared with Meta/Google. So "does not qualify as data sale" is the *accurate* classification, not a workaround. **Important:** the shop's separate native Facebook & Instagram sales-channel app has its own, different pixel entry in the same Shopify list — that one genuinely does send data to Meta and should stay "qualifies as data sale". Don't conflate the two when checking another client.

**Fix:** (1) added `keepalive: true` to the pixel template's fetch call — fixed at the source (`shopifyCustomPixelSnippet` in `settings-client.tsx`), so it's correct for every client going forward automatically, but **existing clients' already-pasted Shopify code doesn't auto-update** — each one needs the snippet re-copied from Kado Settings and re-pasted into Shopify's Customer Events editor by hand. Done for BlackB4U, Nothing But Buckets, and Starstruckofficiall (2026-07-26) — check `client_integrations` for any *other* Shopify client and confirm the same before assuming it's fixed everywhere. (2) Data Sale classification corrected on Nothing But Buckets, BlackB4U, and Starstruckofficiall (all three confirmed to have no `facebook_capi`/audience-sync). **A future client that DOES have Kado's own CAPI or Audience Sync connected should almost certainly keep "qualifies as data sale"** — check `client_integrations` for that client before ever recommending this change, don't copy the answer from this entry blindly.

**Commit:** `8ace08e` (keepalive). The Data Sale fix is a Shopify admin setting, not code — no commit, but recorded here since it's the majority root cause.

**Still open / worth knowing:** the Customer Events custom-pixel "Permission: Not required" setting was left as-is for all three clients on the reasoning that their traffic is US-only (GDPR opt-in consent only matters for the ~16 EU/UK regions Shopify's cookie banner covers) — revisit if any of these clients starts getting real EU/UK order volume.

---

## Known unverified / open risk (not bugs, just not yet confirmed)

- **Universal Flooring Solutions' GoHighLevel funnel → identify() flow** (pixel on funnel pages, form redirects to `?email={{contact.email}}`, thank-you page reads it) was built and reasoned through carefully, but never confirmed with a real submitted lead end-to-end. Before trusting this client's attribution numbers, submit one real test lead through the live funnel and check Kado's Leads page for that email.
- **Housecall Pro webhook payload field names** (`invoice.customer.email`, `total_amount`, etc. in `api/src/routes/webhooks/housecallpro.ts`) are based on the best available public documentation, not a live delivery — confirm against a real webhook log (HCP Settings → Webhooks → the webhook → view a delivery) the first time a client on this integration gets a real paid invoice.
- **The plain "generic" processor option** in `scripts/setup-generic-client.ts` prints a webhook URL (`/webhooks/generic/:client_id`) with no route ever registered for it — a standing dead end. Found 2026-07-25, not yet fixed (Housecall Pro got its own real route instead, sidestepping the need for it that one time — a different client picking "generic" will still hit this).

---

## Operational gotchas (not code bugs — Kado-specific environment/process facts worth knowing)

- **Local API dev server (`tsx watch`) sometimes doesn't restart on file save** — a stale process can keep serving old code indefinitely with no visible error. If a fix "doesn't seem to work" locally, check `netstat -ano | grep :3001`'s PID start time against when the file was last saved; if the process predates the edit, kill it and restart `npm run dev:api`.
- **Deploys are manual, not automatic**, on both sides: pushing to `origin/main` does *not* deploy anything by itself. Railway (API) and Vercel (dashboard) each need a manual redeploy triggered separately after a push. A fix can be committed, pushed, and fully verified against the real database while the live site still shows the old broken behavior — always check which of the two (or both) actually need redeploying before concluding a fix "isn't working."
