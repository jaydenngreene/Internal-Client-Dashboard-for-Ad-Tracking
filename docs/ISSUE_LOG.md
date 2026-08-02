# Kado — Issue Log

**Purpose:** a running record of real bugs found in this app and how they were diagnosed and fixed — as distinct from `TECHNICAL_SPEC.md` (what the system is) and git log (every feature/change). Read this *first* when a client reports something like "attribution looks wrong" or "orders aren't showing up" — the root cause may already be diagnosed below, or may be a known, currently-unverified gap rather than a new bug.

Newest entries first. Each entry: what was reported, what was actually true, the fix, and the commit(s) with full technical detail.

---

## 2026-08-01 (later still #5) — Test coverage for the Facebook/Google ad-cost sync jobs and the lead-capture routes

**Ask:** Priority 3 from the same platform-wide audit. The audit found the API's 101 (now 128) tests covered pure logic only — attribution math, auth, bot detection, etc. — and **zero** test files ever touched `adCosts/facebook.ts`, `adCosts/google.ts`, `/track/identify`, or `webhooks/gohighlevel.ts`. Everything on those paths had only ever been checked by hand against live data, recorded as spot-checks in this log rather than as regression tests — meaning a fix confirmed working today has no guardrail against silently breaking again later.

**Built**, 27 new tests across 4 new files, all against real exported functions/routes (no new test-only abstractions):
- `api/src/jobs/adCosts/__tests__/facebook.test.ts` (8 tests) — `fetchFacebookAdCosts` and `fetchAdObjectFallback` against a stubbed `global.fetch`. Covers spend/frequency/video-watch-time parsing, the `act_` account-id prefix logic, `paging.next` pagination, an Insights-API error surfacing as a thrown error, and — the one that matters most — **a single ad's creative lookup throwing on a malformed/non-JSON response does not crash the whole sync**, the same failure class that actually broke Snapchat's sync (fixed 2026-07-28, see that entry) before anything caught it. Also confirms `fetchAdObjectFallback` returns `null` for a genuinely deleted ad, matching the documented tested-live limit from 2026-07-27.
- `api/src/jobs/adCosts/__tests__/google.test.ts` (4 tests) — `fetchGoogleAdCosts` against a mocked `getGoogleAdsCustomer`. Covers `cost_micros` → dollars conversion, campaign/ad-group/ad field mapping, Responsive Search Ad headline/description taking priority over the legacy Expanded Text Ad fields when both exist, the ETA fallback when RSA data is absent, and that the client's config (customer_id/login_customer_id/refresh_token) passes through to `getGoogleAdsCustomer` unchanged — the exact MCC-vs-independent-account routing the new Google Ads setup guide (previous entry) had to explain because getting it backwards fails silently.
- `api/src/routes/__tests__/identify.test.ts` (8 tests) — `/track/identify` via `app.inject()` with `db`/`sendConversionSignals`/`lookupVisitorId`/`identityLinking`/`dispatchEvent`/`attemptRetroactiveAttribution` all mocked. Covers the 400/401/404 validation chain, email normalization, that a Lead conversion signal carries the most recent session's click IDs, that `attemptRetroactiveAttribution` fires with the right args (the retry this route added specifically for the Shopify order-webhook-before-identify race, 2026-07-25), and — explicitly, since it's a documented design guarantee — that a cross-device-linking failure or a retroactive-attribution failure never blocks the 200 response.
- `api/src/routes/webhooks/__tests__/gohighlevel.test.ts` (8 tests) — covers the shared-secret check (401 on wrong secret, any secret accepted while unconfigured — the same bootstrap convention Shopify/Stripe use), `contact.email`/`contact.phone` taking priority over top-level fallback fields, charge → `recordPurchase` vs. refund → `recordRefund` routing, the zero-amount/missing-email silent no-op, and phone-linking only firing when both email and phone are present, with a linking failure not blocking the response.

**Verified:** `npm test` now 128/128 passing (21 test files, up from 17/101), `tsc --noEmit` clean.

**Not built this pass:** GoHighLevel's own live-lead-submission gap (still flagged as "never confirmed end-to-end with a real submitted lead" in the "Known unverified / open risk" section below) isn't closed by this — these are unit-level regression tests against the route's own logic, not a substitute for that live confirmation.

---

## 2026-08-01 (later still #4) — Site-wide integration help: robust hover tooltips + setup guides for all 17 integrations

**Ask:** Priority 2 from a platform-wide audit (tests/attribution integrity/UX/docs pass, same session). Google Ads' Settings row had zero help text — the single biggest self-serve onboarding gap the audit found for a non-technical media buyer. The ask expanded to fixing this site-wide: a consistent hover-tooltip pattern everywhere, click-through to a full guide when a description is too long for a bubble, and a hard requirement that the tooltip never get clipped or blocked by anything.

**Found:** the existing `InfoTooltip` (used on 4 KPI labels) was pure CSS, `absolute`-positioned *inside* whatever container held it — silently clipped by any `Card` (all cards are `overflow-hidden`, see `card.tsx`) or a viewport edge, exactly the failure mode flagged. Only 3 of 17 Settings integrations (`housecallpro`, `facebook-ads`, `facebook-capi`) had any help text at all; the rest — including Google Ads, PayPal, GoHighLevel, Bing, BigQuery, several with real multi-step OAuth/app-creation flows — had none.

**Built:**
- Rebuilt `InfoTooltip` (`dashboard/src/components/ui/info-tooltip.tsx`) on Base UI's Tooltip primitive (already a dependency via `select.tsx`'s Select) instead of hand-rolled CSS — Portal renders into `document.body`, Positioner auto-flips/shifts to stay on-screen, so it can no longer be clipped by an ancestor `Card`. Kept the existing `text` prop for the 4 KPI call sites; added optional `href`/`linkLabel` — when set, the icon itself becomes a real link (not a link *inside* the tooltip bubble, which would violate the ARIA tooltip role) and the popup appends a "Full setup guide →" hint.
- `INTEGRATIONS` array in `settings-client.tsx`: added `helpText` for every platform that lacked one (Google Ads, Bing, TikTok, Snapchat, Pinterest, LinkedIn, Reddit, Twilio, Customers.ai, Klaviyo, BigQuery, Shopify, Stripe, Square, GoHighLevel, PayPal), plus a new `guideSlug` field on the 7 platforms whose real setup needs more than a hover bubble can hold (Google Ads, Bing Ads, PayPal, GoHighLevel, Housecall Pro, Customers.ai, BigQuery). Google Ads' tooltip/guide specifically calls out the two setup paths (client under the agency's shared MCC vs. a client with their own independent login) — filling in the wrong field combination previously failed to sync with zero visible error, per the audit.
- Row header restructured so the tooltip icon sits as a sibling of the row's toggle button, not nested inside it (a `<button>`/`<Link>` inside a `<button>` is invalid HTML and breaks click handling); removed the old always-visible helpText paragraph under an expanded row now that the same content lives in the hover tooltip — net effect is a cleaner row list.
- `help-content.ts`: new "Integration Setup Guides" section, one entry per guide-linked platform with real step-by-step instructions (webhook URLs, where to find each ID, OAuth-flow notes).
- `help-client.tsx` + `help/page.tsx`: added `?topic=<slug>` deep-linking — lands on a `HelpEntry`, force-opens it, scrolls it into view, and rings it with a highlight, so a tooltip's "Full setup guide" link drops the user directly on the right guide instead of a flat unstructured page. `page.tsx` wrapped in `<Suspense>` per this app's existing convention for any client component using `useSearchParams` (matches `campaigns/page.tsx`).

**Verified:** `tsc --noEmit` clean, `next build` clean (Turbopack, all routes compiled). Live-tested against real Nothing But Buckets data: Google Ads' tooltip renders fully on-screen with no clipping near the right viewport edge (the old component's exact failure mode); clicking its "Full setup guide" link lands on Help & Info with "Connecting Google Ads" auto-expanded and ring-highlighted; repeated for Housecall Pro's guide link on a fresh navigation, confirming the scroll-into-view actually fires rather than just working when already-scrolled.

**Not built this pass, by design:** the remaining 10 platforms with only a short tooltip (Shopify, Stripe, Square, Facebook Ads/CAPI, TikTok, Snapchat, Pinterest, LinkedIn, Reddit, Twilio, Klaviyo, Alerts) don't have a guide page — their setup genuinely fits in 1-3 sentences, a guide would be padding. Revisit only if one of these turns out to need more explanation in practice.

---

## 2026-08-01 (later still #3) — Opener/Closer/Assist role badges now also show on the campaign detail page

**Ask:** the role badges only appeared on the Campaigns page's account-wide Creative tab. Wanted them to also show up when clicking into a specific campaign and seeing its own creatives — which is also where clicking a campaign name from the First-Touch vs Last-Touch (or U-Shaped vs Time-Decay) comparison tables lands, so fixing the one page covers both asks.

**Fix:** extracted the `RoleBadge`/`ROLE_LABEL`/`ROLE_BADGE_CLASS` that were only defined inline in `campaigns-client.tsx` into a new shared `dashboard/src/components/role-badge.tsx`, since this is now a second consumer. `campaign-detail-client.tsx` fetches the same `getCreativeRoles` data and merges it into its own `Creatives (N)` list by name+platform, same key convention already used everywhere else in this work.

**Verified:** dashboard typechecks clean. Live-verified: role badges (Opener/Multi-Role/Assist) render correctly on Nothing_But_Buckets_Cold_V1's creative list; confirmed by navigating there directly AND by clicking through from the First-Touch vs Last-Touch table's campaign link - same page, same badges, zero console errors either way.

---

## 2026-08-01 (later still #2) — Built: Customer Journey path clustering ("N% of buyers touched only this one campaign")

**Ask:** the second, deliberately-deferred half of the Customer Journey work (see the entry below) - visualize the actual sequence of ads a buyer touched before purchasing, clustered into common patterns, e.g. "60% of buyers see this UGC ad first, then this retargeting offer, then buy."

**Prototyped against real data first, before writing any product code** (a throwaway script, deleted after): the first run showed 63-100% "unique" paths per client at every grain, which would have made the feature look useless. The reason: seeing the same ad/campaign 3-5x in a row before buying (ordinary retargeting behavior) was being counted as 3-5 distinct steps, inflating apparent path diversity. Re-ran after collapsing consecutive repeats of the same step - real, clean majority patterns appeared immediately: Nothing But Buckets, **69-70% of buyers touched exactly one campaign** (`Nothing_But_Buckets_Cold_V1`, repeated any number of times) and nothing else; BlackB4U, **65%** on `Main Campaign (TOF)`. Creative grain was real but more spread out (top single-creative paths in the 12-16% range, multi-creative sequences capping around 3%). Source/platform grain was almost trivially dominant ("just Facebook" 72-85%) and was dropped as not worth a whole view - confirmed this experimentally rather than assuming it going in.

**Built:** `api/src/lib/journeyPaths.ts` - reuses `getConversionsForNiche` (same shared fetcher `creativeRoles.ts` already uses), builds a collapsed step sequence per converting journey at both campaign and creative grain, and aggregates by exact sequence. A "pattern" requires **at least 2 distinct buyers** actually walked that exact path - a path only one person ever took is folded into a `singletonJourneys` count instead of listed as if it were a real pattern (same reasoning, one level up, as the whole-account gate below). New route `GET /clients/:id/reports/journey-paths`, added to `ownership.ts` immediately.

**Frontend:** new `JourneyPathsCard` on the Campaigns page's Campaign tab (below the existing two comparison tables), with a Campaign/Creative toggle defaulting to Campaign grain (where the real signal was, per the prototype). Each pattern renders as a chain of badges joined by `→`, with buyer count/percentage and total value. Below **5 total converting journeys in the range**, the card shows "not enough yet to reliably call anything a common pattern" instead of a chart built on 1-2 data points - verified live against Starstruckofficiall (1 purchase on record).

**Caught during live verification:** a JSX whitespace-collapsing gotcha - text immediately following a `{expression}` that then wraps to a new source line lost its separating space ("3 other journeyswhose exact path…"), because JSX trims the leading whitespace of a text node that starts a new line. Fixed with an explicit `{" "}` between the expression and the wrapped text; the same pattern used earlier in the Opener/Closer/Assist caption (a `</span>` tag rather than a `{expression}`) wasn't affected and needed no change.

**Verified:** both workspaces typecheck clean, 101/101 API tests pass. Live-verified against real Nothing But Buckets and BlackB4U data - numbers matched the prototype script's findings closely; toggled Campaign/Creative grain; confirmed the whole-account minimum-data gate on Starstruckofficiall; confirmed a zero-conversion client (Universal Flooring Solutions) renders no card at all rather than an empty one, consistent with the other two comparison tables; zero console errors throughout.

---

## 2026-08-01 (later still) — Built: Customer Journey / Ad Role breakdown (Opener/Closer/Assist)

**Ask:** last-click alone makes cold-traffic "opener" ads look worthless (even though they're feeding the whole funnel), and first-click alone undervalues the "closer"/retargeting ads that actually convert warm traffic - risking cutting the wrong ads. Wanted, per campaign/creative: a role tag (Opener/Closer/Assist/Multi-Role) based on where each creative shows up in real converting journeys, alongside the existing spend/ROAS/CPA/AOV/revenue metrics already on the Campaigns page. Explicitly asked for an honest read on whether this was worth building before starting - flagged two real caveats (role/path signal quality scales with purchase volume; a separate journey-path-clustering visualization is much higher-risk to deliver well than role-tagging) and the user chose to build role-tagging first, treating path-clustering as a second, prototype-first pass.

**Built:** `api/src/lib/creativeRoles.ts` - for every converting journey (purchase/lead/qualified_call/subscription_conversion, whichever the niche uses, same generalization as the U-Shaped/Time-Decay comparison), classifies every touch by position: `touches[0]` is the Opener, `touches[length-1]` the Closer, anything in between an Assist (deduped within one journey, so a creative clicked twice in the middle of one path only counts once). A single-touch journey counts as both opener and closer for that one creative. Tallies are **counts of distinct converting journeys touched in that role**, not a credit split - a deliberately different, complementary metric shape from the other two comparison tabs (which split revenue/credit across touches; this instead answers "how many sales did this ad touch, and in what capacity," the same shape as platforms' own "assisted conversions" reporting). Role badge is whichever count is highest; a tie is `multi_role`.

**Reused rather than duplicated:** `getConversionsForNiche` was extracted out of `attributionModelComparison.ts` (previously an inline switch inside that one function) so this file didn't need a third copy of the same four per-niche touch-fetching queries. Spend/ROAS/CPA/AOV/revenue/CTR/CPC are NOT recomputed here at all - `campaign-breakdown-table.tsx` gained a generic `extraColumns`/`renderExtraCell` prop pair so the Creative tab's existing table (already fetching all of that) can have the three role counts + badge merged into it client-side by name+platform, instead of a second, separate table duplicating those metrics.

**Verified:** both workspaces typecheck clean, 101/101 API tests pass (added 3 for `classifyRole`'s tie-breaking, including the single-touch-journey case). Live-verified against real Nothing But Buckets creative data: real, varied role distribution across Opener/Closer/Assist/Multi-Role, resolved creative names carried through correctly, existing drill-through to the creative detail page still works, zero console errors, Campaign tab (untouched) still renders exactly as before.

**Deliberately not built yet:** the journey-path visualization/clustering piece (e.g. "Ad A → Ad B → Ad C → Purchase," grouped into common patterns) - flagged as the higher-risk part of the original ask, since real paths are expected to be extremely long-tailed at full creative granularity with this app's current data volumes. Queued as a prototype-against-real-data pass rather than committing to a specific output shape up front.

---

## 2026-08-01 (later) — Both comparison tabs: resolve campaign names, link through to creatives

**Ask:** the two comparison tabs shipped earlier today showed raw `utm_campaign` values, which for several real campaigns is the ad platform's numeric campaign id, not a human name (e.g. `120245194137140253` instead of `Nothing_But_Buckets_Cold_V1`) — "still very vague." Also wanted to click a row and drill into that campaign's creatives, same as the main Campaigns table already allows.

**Fix:** both `attributionComparison.ts` and `attributionModelComparison.ts` now resolve each touch's `utm_campaign` against that client's `ad_costs` rows (id-or-name + platform match, the same convention buyingJourney.ts's creative resolution and campaignDetail.ts's own campaign lookup already use) before grouping — a numeric id or an unresolvable value both still degrade to their raw string rather than erroring. Grouping key is now name+platform (not name alone), since the same campaign name can legitimately exist on two different platforms. Both API responses now carry a `platform` field per row; the dashboard renders the campaign name as a link to the existing `/clients/:id/campaigns/:platform/:campaignName` detail page (same creatives-list page the main Campaigns table already links to) whenever a platform resolved, plain text otherwise (nothing to link to for a genuinely unmatched/no-campaign row).

**Verified:** both workspaces typecheck clean, 98/98 API tests pass. Live-verified against real Nothing But Buckets data: the API response for the id-tagged campaign now returns `"name":"Nothing_But_Buckets_Cold_V1","platform":"facebook_ads"` instead of the raw id; screenshotted the comparison table showing the resolved name as a blue link, clicked it, and confirmed it lands on that campaign's real detail page with its full creative breakdown, zero console errors.

---

## 2026-08-01 — Built: niche-based attribution model defaults + a second comparison tab (U-Shaped vs Time-Decay)

**Ask:** ecommerce/Shopify clients are high-volume and impulse-driven, so Last Click (matching Meta's own default and Shopify's "last non-direct click" dashboard) should be the starting attribution model, not First Click. Lead-driven niches (lead_gen/call/saas) have longer, multi-touch cycles, so U-Shaped (40/40/20) should be their starting default instead. Both must stay fully switchable per client from Settings — this only changes what a client *starts* on. Also: extend the existing First-Touch vs Last-Touch comparison tab with a second one for the leads side, U-Shaped vs Time-Decay.

**Defaults:** new `api/src/lib/attributionDefaults.ts` maps niche → starting model (`ecommerce`/`info_product` → `last_click`; `lead_gen`/`call`/`saas`/`other` → `u_shaped`). Wired into `POST /clients` only — changing a client's niche later deliberately does not re-trigger this, so it can never silently override a model someone already picked by hand.

**Retroactive backfill (user explicitly requested this apply to existing clients immediately, not just new ones):** confirmed first that flipping `attribution_model` is not retroactive to past numbers — `recordPurchase()` reads the client's model at the moment each purchase is ingested and never rewrites old `attributions` rows, so this only changes how *future* purchases get attributed. Ran a one-time backfill updating all 5 existing clients to their niche's new default (all 5 were on the old universal default, `first_click`): BlackB4U/Nothing But Buckets/Report Schedule Test Client/Starstruckofficiall → `last_click`, Universal Flooring Solutions → `u_shaped`. Verified directly against the DB afterward.

**Second comparison tab:** new `api/src/lib/attributionModelComparison.ts`, generalizing the existing first-touch/last-touch pattern (`attributionComparison.ts`, 2026-07-30) to U-Shaped vs Time-Decay for the lead-driven niches. Reuses the exact same `timeDecayWeights`/`uShapedWeights` functions production purchases already use (`attribution.ts`), applied live across every touch in the 90-day window for whichever event type the niche actually uses (lead/qualified_call/subscription_conversion/purchase) — same "recompute from raw sessions, don't touch the purchase-only `attributions` table" reasoning as the first comparison tab, since leads/calls/subscriptions have no rows in that table under any model. Credit is a dollar figure for niches that have one (saas' `mrr_delta`) and a fractional conversion count for the niches that don't (leads/calls), matching `nicheVocabulary.ts`'s existing `hasValue` split. New route `GET /clients/:id/reports/attribution-model-comparison`, added to `ownership.ts`'s `RESOLVERS` table immediately (learned from the previous entry's bug) rather than as an afterthought.

**Frontend:** `campaigns-client.tsx`'s Campaign tab now shows one of the two comparison tables based on niche — First-Touch vs Last-Touch for ecommerce/info_product, U-Shaped vs Time-Decay for everything else.

**Verified:** both workspaces typecheck clean, 98/98 API tests pass. Live-tested against real data: Nothing But Buckets' Settings now shows Last Click, Universal Flooring Solutions shows U-Shaped; screenshotted the First-Touch vs Last-Touch table rendering real numbers. Universal Flooring Solutions has zero real leads on record, so its U-Shaped vs Time-Decay table couldn't be screenshotted with real data - instead verified the underlying computation directly against Nothing But Buckets' real purchases (sane, non-zero weighted credit in the expected range between the first/last-touch numbers) and confirmed the zero-data path returns a clean empty array with no error. Also verified `POST /clients` applies the right default for a fresh ecommerce and a fresh lead_gen test client, then deleted both.

---

## 2026-07-30 — Buying Journey tab: avg days/sessions to convert and the "Customers Who Purchased" tab were blank

**Reported:** on the Customer Buying Journey tab, "Avg days to convert" and "Avg sessions to convert" showed `—`, and the "Customers Who Purchased" tab showed its empty state ("No customers converted in this range"), for a client that has real purchases in the selected window.

**Root cause:** `requireOwnership` (`api/src/lib/ownership.ts`) is an intentionally exhaustive, fail-closed table — any dashboard-facing route not listed in `RESOLVERS` gets a `500 {"error":"Server misconfiguration"}` rather than being silently left unprotected. `GET /clients/:id/reports/buying-journey` was added in Phase 2 (`603dd46`, 2026-07-28) but was never added to `RESOLVERS`, so every request to it has 500'd since the feature shipped two days ago. The dashboard's `buyingJourney` React Query call has no explicit error handling (unlike the `journey` lookup query, which does), so the failure was invisible — the stat tiles just rendered their normal null-state `—`/empty-state UI instead of surfacing an error.

**Confirmed live:** called `computeBuyingJourneySummary()` directly against the real Supabase data first — it returned correct non-null numbers for BlackB4U, Nothing But Buckets, and Starstruckofficiall, proving the computation itself was never broken. Then hit the actual HTTP route with a minted valid session token and reproduced the exact `500 Server misconfiguration` from `requireOwnership`, confirming the gap was in the auth/ownership layer, not the report logic.

**Also found while auditing the table for the same class of gap:** `POST /clients/:id/integrations/housecallpro` (`api/src/routes/clients.ts`) had the identical problem — also missing from `RESOLVERS`, also 500ing on every call since it was added. A full diff of every literal `/clients/:id/...` route registered across `api/src/routes/*.ts` against `RESOLVERS`'s keys confirmed these were the only two gaps; the table is now exhaustive again.

**Fix:** added `'/clients/:id/reports/buying-journey': 'client'` and `'/clients/:id/integrations/housecallpro': 'client'` to `RESOLVERS`.

**Verified:** both routes return `200` with a real auth token post-fix (buying-journey confirmed for BlackB4U and Nothing But Buckets); `npm test` 98/98 still passing. A stray test `housecallpro` integration row written to BlackB4U during verification (BlackB4U is a Shopify/ecom brand — Housecall Pro is Universal Flooring Solutions' processor, not BlackB4U's) was deleted afterward.

**Not yet committed** — sitting as a working-tree change in `api/src/lib/ownership.ts`, pending the user's go-ahead to commit.

---

## 2026-07-28 (later still) — The real identify() bug, finally found: sendBeacon sent text/plain, not JSON

**How this was found:** every prior pass at "why doesn't identify() ever succeed" reasoned from DB aggregates (attributed-rate, identity counts) and from Railway's *history* view, which turned out to have unreliable deployment boundaries and a search filter that returns "No logs found" even for `/track/pageview`, which fires constantly - don't trust that filter. What actually worked: the user watched two real orders land live (6:36pm and 7:13pm) and gave exact timestamps, and Railway's raw unfiltered log stream (scrolled to, not searched to) showed the ground truth directly.

**What the logs showed, both times:** `POST /track/identify` arrived at the server within 1 second of the purchase, every time - `sendBeacon` reaching the server reliably was never in question. Both got **`400`** in ~1.4ms - before any DB query, the earliest possible failure (the route's `if (!pixel_key || !anonymous_id || !email) return 400` check).

**Root cause:** `postBeacon()` in the Customer Events checkout pixel (`shopifyCustomPixelSnippet`, `settings-client.tsx`) called `browser.sendBeacon(url, payload)` with `payload` as a raw `JSON.stringify(...)` string, not a `Blob`. Per the Beacon API, a string payload defaults to `Content-Type: text/plain`, not `application/json` - Fastify never parses that as JSON, so every field the route destructures off `req.body` read as `undefined`. **This bug was introduced by yesterday's own `sendBeacon` fix** (`6354a67`), which correctly solved the fetch+keepalive navigation-race problem - but the old fetch path explicitly set `Content-Type: application/json`, so on the rare occasion it *did* arrive intact, it worked; `sendBeacon` fires every single time but was arriving broken every single time. Net effect looked identical from the DB side (near-zero real identities) but for a completely different reason than diagnosed.

**Fix:** wrap the beacon payload in `new Blob([payload], { type: 'application/json' })`, matching the pattern `pixel.js` and this same file's `shopifyCheckoutSnippet` already used correctly (only `postBeacon` had the bug - `pixel.js`'s own `send()` was never affected, confirmed by reading it directly rather than assuming). Also added a `text/plain` content-type parser in `api/src/index.ts` that attempts `JSON.parse` server-side - defense in depth, so the same class of mistake anywhere else in this app (or a future one) degrades gracefully instead of silently 400ing with zero visible symptom in the DB.

**Verified:** both workspaces typecheck clean, `npm test` (98 tests) passing, the text/plain parser logic checked standalone against both a real payload shape and garbage input. **Not yet verified against a real live order** - needs the next real checkout after this deploys to confirm an actual `identities` row gets created, the same way the bug itself was confirmed: watch it happen, don't infer it from an aggregate.

**Commit:** `e2ec1b4`

---

## 2026-07-28 (later) — Stopped aggregate monitoring, found a real fix by reading individual rows instead

**Context:** a session-local recurring check (every 2h) had been reporting the NBB attributed-rate for over a day without landing on anything new — user correctly pushed back that repeating the same "still ~50%, still investigating" number had no value. Stopped the cron job and did a one-time deep read of every individual `source_name: web` order instead of re-running the same aggregate query.

**Found two real things by actually reading the rows:**
1. **`identity_id` is null on every single `source_name: web` order in the sample (0/8).** Every order that did attribute got there entirely through the landing_site/referring_site fallback (session `started_at` == `purchased_at`, the fallback's signature) — not through a real `/track/identify` call ever succeeding, even on the legitimate storefront channel. This means the `sendBeacon` fix's real-world effectiveness still hasn't been confirmed working even once, despite being deployed and re-pasted. **Not yet root-caused** — worth a live network-tab capture of a real checkout next, not more DB polling.
2. **A second, fixable fallback gap**, confirmed with real data: `rusmed6@gmail.com`'s order had an empty `landing_site` but a full ad-click URL (`utm_campaign` + `fbclid` intact) sitting in Shopify's `referring_site` field instead — `parseAdParamsFromLandingSite`'s caller in `attribution.ts` never checked it. Same shape as the pixel.js `document.referrer` fix from 07-26 (`c709624`), one layer over. Fixed: tries `referring_site` second, only when `landing_site` has no usable ad signal. Verified the exact real string parses correctly, and that a bare no-query referrer (the genuinely-organic case) still correctly returns nothing.

**Commit:** `6018372`

**Still open, honestly:** item 1 above is the real remaining mystery and is not fixed by this commit — this only recovers cases where Shopify's own fields *have* the data somewhere. Next step if this comes up again: capture one live checkout's network traffic directly rather than inferring from aggregate DB stats after the fact.

---

## 2026-07-28 — Nothing But Buckets identify() gap, continued: never checked which sales channel the order came through

**Context:** the `sendBeacon` fix (`6354a67`) was confirmed deployed on both Railway and Vercel (checked live via each dashboard — both serving the current `main` tip). User confirmed, and double-checked, that the updated Customer Events snippet was re-pasted into Shopify Admin. Despite all of that, the attributed rate hadn't moved (still ~10/16, and 4 of the last 6 orders landed with zero session/identity) — meaning the standing "it just needs a redeploy/re-paste" theory was wrong, or at least incomplete.

**What hadn't been checked:** every investigation so far assumed these orders went through Shopify's normal storefront/checkout, where *some* Kado pixel (theme snippet or Customer Events) should have a chance to run. Nobody had verified that assumption. Shopify's order webhook payload already carries `source_name` (which sales channel placed the order — `"web"` is the real storefront; other values are POS, the Facebook/Instagram Shop channel, etc.) and `referring_site`, but this app never captured either field — `ShopifyOrder` parsed them and then discarded them. An order placed through Meta's native in-app checkout (Instagram/Facebook Shop's own "Buy Now" flow) never loads a single Shopify storefront or checkout page — so no pixel of any kind, ours or Shopify's own, ever gets a chance to fire, completely independent of what code is deployed or pasted where.

**Change:** migration `057_purchase_source_channel.sql` adds `purchases.source_name`/`referring_site`; threaded through `NormalizedConversion` → `recordPurchase` → the Shopify order webhook handler. Purely additive/diagnostic for now — no behavior change, just capturing a signal that already existed in every webhook payload and was being thrown away.

**Not yet confirmed** — needs a batch of new orders to land with this column populated before it can actually be checked. Next step: once there's a real sample, compare `source_name` against attribution status for the currently-unattributed customers (`realisjones9@gmail.com`, `robincaldwell3100@comcast.net`, `ashleydopson83@gmail.com`, `rastalg54@gmail.com`, and any new ones) — if they cluster on a non-`web` source_name, this whole "identify() is broken" line of investigation has been chasing the wrong layer, and the real conversation becomes whether/how to track that channel at all (may not even be feasible — Meta's native checkout may not expose a pixel hook the way Shopify's own checkout does).

**Commit:** `9a98c39`

---

## 2026-07-28 (later still) — Built: Phase 3, generalize the Buying Journey tab to every niche

**Ask:** Phase 2 (`603dd46`) only built the "Customer Buying Journey" tab for ecom. Generalize it to lead-gen, call funnels, SaaS, and info products — one shared component driven by a per-niche config, not four forked pages.

**Recon confirmed:** `clients.niche` is `TEXT NOT NULL DEFAULT 'other'` with a `CHECK` constraint covering exactly `ecommerce/call/lead_gen/saas/info_product/other` — no true "unset" state exists. Live data check (queried directly): the only non-ecom client, Universal Flooring Solutions (`lead_gen`), has **zero conversion records of any kind** (0 leads, 0 purchases, 0 calls, 0 subscriptions) — its GoHighLevel identify() flow was never confirmed end-to-end (a still-open risk noted elsewhere in this log). **No live `call`, `saas`, or `info_product` clients exist at all.** `jobs/costPerPurchase/run.ts`'s `resolveConversionCount()` was confirmed NOT directly reusable: it tries purchases first for every niche regardless of label (right for the gate's "most meaningful economic signal," wrong for this feature's explicit "niche drives the label, not the resolved event" requirement), returns only an aggregate count, and is bound to a rolling window rather than the dashboard's arbitrary date range. Factored out just the niche→event mapping into a new shared config instead.

**Architecture:** `api/src/config/nicheVocabulary.ts` (data side: which table/event counts as a conversion, whether a value figure exists) + `dashboard/src/lib/niche-vocabulary.ts` (presentation side: labels, headers, conversions-tab wording) — separate files since api/ and dashboard/ share no package, both keyed by the same niche strings. `lib/buyingJourney.ts` rebuilt around one generic aggregation function fed by four small per-event-type fetchers (purchase/lead/subscription_conversion/qualified_call) — each resolves its own visitor (a call's `session_id` is a direct FK, no email/identity walk needed, unlike the other three) and its own "top converting creative" (real `attributions` rows for purchases — the only event type that has them — vs. nearest-preceding-session-in-a-90-day-window for leads/subscriptions, matching how `insightsAgent.ts` already attributes leads elsewhere, vs. the call's own exact session). The negative-days-to-convert exclusion from Phase 2 was extracted into this shared layer so it applies to every niche's event, not just Shopify purchases.

**Real bug caught during verification (not shipped):** the sidebar-label mechanism from Phase 2 (`nav-items.ts`'s `nicheLabels`) only listed `ecommerce` — every other niche fell through to the base label `"Leads"`, while the page header now reads the new vocabulary's `pageLabel`. For `niche = 'other'` specifically this meant sidebar `"Leads"` vs. page `"Conversions"` — the exact mismatch class Phase 2 already got bitten by once. Caught by writing a small script that checks all six niche values programmatically rather than eyeballing two files side by side; fixed by listing every niche's override explicitly instead of relying on two independent fallbacks to agree by coincidence.

**Per-niche calls out, as asked:**
- Conversion count is universal, value is conditional: `lib/niche-vocabulary.ts`'s `valueColumnLabel` is `null` for `call`/`lead_gen` (hides the column entirely, doesn't render an empty one) — `call`'s "Deal value if tracked" from the spec's own table is `null` today specifically because no `deal_value` field exists on `calls` yet, not a judgment call.
- Multiple conversion types on one client: never summed. The niche's single declared event type is the only thing that drives the tab; a client with both leads and purchases only ever sees whichever one their niche maps to.
- No live label/data-mismatch case exists among real clients today (checked directly — see the empty-UFS finding above).
- A qualified call with no linked identity (pure phone lead, no email ever captured) displays its phone number in the "Email" column rather than being dropped — and is rendered as non-clickable plain text, since the single-person lookup route is email-keyed and there's nothing to look up for a bare phone number.
- Product images remain ecom-only and unbuilt, as flagged in Phase 2 — this pass didn't touch that gap.
- The single-customer detail view's hardcoded "Purchases" card became a generic "Conversions" card reading from whichever table matches the niche (purchases/subscriptions/leads); the existing "Calls" card is left as the call niche's conversions section rather than duplicated into a second generic card.
- `BestPathsCallouts` (Rockerbox-style best/fastest path) stays scoped to the two purchase-event niches (ecommerce, info_product) — its own SQL in `bestPaths.ts` is purchases-hardcoded, and regeneralizing that is a separate piece of work, not attempted here.

**Verification depth, disclosed honestly:** ecommerce was verified thoroughly against real data (exact regression match against Phase 2's known-good numbers for BlackB4U/Nothing But Buckets/Starstruckofficiall). `lead_gen` was verified structurally only — Universal Flooring Solutions has no real records to check against, so its empty-state path was confirmed clean (no crash, no NaN) but its populated path could not be. `call` and `saas` have no live clients at all — verified via temporary synthetic clients and rows (a real DB, real INSERTs, all cleaned up after), covering: creative-name resolution with and without an `ad_costs` match, the phone-number identifier fallback, MRR-as-value for subscriptions, and the negative-days exclusion firing on a `lead_gen` conversion (not just a Shopify purchase, per the explicit verification ask). `info_product` shares ecommerce's exact code path (`eventType: 'purchase'`) with no niche-specific branching, so it's covered by the same proof, though also with no live client of its own to double-check against.

**Verified:** both workspaces typecheck clean, `npm test` 98/98, all temp clients/rows deleted after each check.

---

## 2026-07-28 (later still) — Built: Phase 2, Leads → Customer Buying Journey (ecom only)

**Ask:** rebuild the Leads tab as "Customer Buying Journey" for ecom clients — two new summary metrics (avg days/sessions to convert), fix numeric creative/ad ids showing instead of names, drop `medium: cpc` if unused, pull in product images if the data supports it, and add a new "Customers Who Purchased" tab. Non-ecom clients keep the existing Leads page untouched.

**Backend:**
- `journey.ts`: `utm_content` now resolves to the real creative name via a `LEFT JOIN LATERAL` against `ad_costs` (same id-or-name matching convention every other report in this app already uses) — verified live against real Nothing But Buckets sessions (`120245594915910253` → `Howard_UGC_Ad`, etc.). `utm_medium` dropped entirely — confirmed via a full-codebase grep that it's captured everywhere sessions are written but read by nothing.
- New `lib/buyingJourney.ts` + `GET /clients/:id/reports/buying-journey`: avg days/sessions to convert (measured from a customer's first-ever tracked session to their first purchase in the selected range), top 3 converting creatives, and the per-customer table.
- **Real bug caught during verification, not shipped:** the first cut produced a negative `avgDaysToConvert` (-2.05 days) for BlackB4U — a purchase timestamped before the customer's first tracked session, which is impossible for a genuine conversion. Root cause: this app's own well-documented identify()-at-checkout gaps (see multiple entries below) mean a purchase can go completely untracked, and a LATER touch (e.g. a marketing-email click) is what eventually creates the identity→visitor link — so "first session for this visitor_id" can legitimately postdate the purchase. Fixed by excluding these from the average the same way a fully untracked purchase already is (not a real days-to-convert, a tracking-gap artifact) rather than presenting a number that reads as broken.
- **Not built — genuine gap, flagged rather than faked:** product images. `purchases.product` is just the first line item's title (`api/src/routes/webhooks/shopify.ts`); no `product_id` is even captured, let alone an image URL, and no Shopify Admin API call fetches one. Doing this properly needs a schema change, a `ShopifyOrder` type update to capture `product_id`, and an Admin API call — which additionally only works for clients onboarded via the Step 11 native app flow (an access token), not the older manually-pasted-webhook-secret clients. Flagged instead of building a half-measure.

**Frontend (`leads-client.tsx`):** ecom clients get a niche-conditional header ("Customer Buying Journey"), two `StatTile`s for the new summary metrics, and a segmented toggle between the renamed "Look up one customer" view and the new "Customers Who Purchased" tab (top-3-creatives cards + a sortable-by-nothing-yet table; clicking an email hands off to the lookup view via the same `?email=` deep-link mechanism the campaign/creative detail pages already use). Non-ecom clients render exactly as before — same component, branches on niche. Also made the **sidebar nav label** niche-aware (`nav-items.ts`'s new `nicheLabels` field) so it reads "Customer Buying Journey" to match the page header instead of just the page content changing under a sidebar that still says "Leads" — command palette search results were left showing the generic label (not client-scoped, so a single niche-aware label isn't well-defined there); a minor, acceptable inconsistency.

**Verified:** both workspaces typecheck clean, 98/98 API tests pass, live-verified against real Supabase data (creative-name resolution, corrected buying-journey averages for BlackB4U/Nothing But Buckets/Starstruckofficiall) with temp scripts deleted after.

---

## 2026-07-28 (later) — Item 8 wasn't actually fixed: creative_fatigue_signals still wrote CTR at the source

**Reported:** the previous pass's item 8 fix only changed the UI headline (`creative-fatigue-client.tsx`) — `run.ts`'s INSERT still always wrote `recent_ctr`/`prior_ctr`/`decline_pct` from CTR regardless of which metric actually triggered. An ad flagged solely on ROAS could write a `decline_pct` reading as zero or negative — a false claim about why it was flagged at the data level, not just a display bug.

**Confirmed** by re-reading `run.ts:284-286` — exactly as described.

**Fix:** new `primary_metric` column (migration `056_fatigue_primary_metric.sql`). `choosePrimaryMetric()` picks whichever of ROAS/CPA/CTR actually triggered (priority order ROAS > CPA > CTR when more than one does), and `worsePercent()` computes a direction-aware "how much worse" percentage (handles both decline-type metrics like ROAS and increase-type metrics like CPA correctly) — verified against synthetic cases (ROAS 3.0→2.0 = 33.33%, CPA $50→$65 = 30.00%) since no live ad currently triggers a real flag to exercise the INSERT path end-to-end. The legacy `recent_ctr`/`prior_ctr`/`decline_pct` columns now hold that chosen metric's real values, with `primary_metric` recording which one they are — old rows (before this fix) have `primary_metric: null` and are genuinely CTR, so the frontend's fallback path was updated to check `primary_metric` before formatting rather than assuming CTR unconditionally.

**Also cleaned up:** a stale, gitignored `api/dist/` build artifact (not tracked, not mine, safe to remove) was causing `npm test` to double-discover compiled test files and report spurious failures — removed, confirmed the 98 real tests were passing the whole time.

**Verified:** both workspaces typecheck clean, migration applied, `npm test` 98/98 passing, `detectCreativeFatigue()` runs cleanly against real data (0 new flags currently — nothing live crosses the tightened thresholds from the previous pass).

---

## 2026-07-28 — Review pass on Phase 1 guardrails: 10 fixes, 1 industry-benchmark build, 1 unrelated crash bug found

A thorough review of the Phase 1 guardrail work (previous entry below) surfaced 10 concrete issues, all confirmed against the real code/DB before fixing, not taken on faith:

1. **Gojo was mis-identified.** The chat nav item (`api/src/lib/chatAgent.ts` + `chatTools.ts`) is the actual "Gojo" surface — `insightsAgent.ts`'s Insights tab is a separate feature that happens to share the same AI-persona branding. The chat was completely ungated. Fixed: `chatAgent.ts`'s system prompt now has a judgment-gating rule (facts always answered; verdicts/recommendations require `dataSufficient`), `get_campaign_breakdown` rows carry `dataSufficient`/`confidence`/`daysLive`, and a new `get_creative_fatigue_signals` tool reads Kado's real fatigue verdict instead of leaving the model to improvise one from aggregates.
2. **Creative fatigue let CPM/frequency trigger alone.** CPM is auction/seasonality-driven (a Q4 spend spike would flag every ad account-wide); rising frequency is expected behavior for any ad left running. Fixed: only ROAS/CPA/CTR can raise a flag now; CPM/frequency compute and report the same as before but only corroborate.
3. **Volume floor only covered prior windows**, and impressions was the wrong unit for ROAS/CPA (a window can have heavy impressions and 0-1 sales, swinging both wildly). Fixed: impressions floor now applies to recent windows too; added a separate 3-sales floor before trusting ROAS/CPA in any window.
4. **"Days live" was calendar-elapsed, not spend-days** — a creative that ran 5 days in March, paused, and resumed yesterday read as ~4 months live. Fixed everywhere (`recommendationGate.ts`, `creativeFatigue/run.ts`, `insightsAgent.ts`'s row annotations): `COUNT(DISTINCT date) WHERE spend > 0`, all-time.
5. **N+1 in the fatigue loop** — `checkGate` was called per-ad, re-querying `client_cost_per_purchase` every time, despite `evaluateGate` having been split out from `checkGate` specifically to avoid this. Fixed: one `CostContext` per distinct client, fetched before the loop.
6. **Whole-account gate compliance was soft-instructed only.** Fixed: `insightsAgent.ts` now post-validates the model's output against `dataSufficient:false` row names (strips any recommendation naming one) and corrects confidence/daysLive against the source row rather than trusting the model's echo — closes the same gap for single-entity scope too (was also trusting the model's echoed values there).
7. **`creative_fatigue_signals` always wrote CTR into the "reason" columns** regardless of which metric actually triggered — an ad flagged solely on CPM read as a false CTR claim. Fixed: the UI headline is now built from whichever metric(s) actually triggered (`creative-fatigue-client.tsx`).
8. **Fallback cost-per-purchase was a flat $17.59 for every client regardless of business type.** Replaced with a real industry-benchmark system (**Phase 1.3, previously unbuilt** — see `api/src/config/industryBenchmarks.ts`, sourced from 2026 Meta/Google Ads benchmark research, one line of citation per niche): ecommerce/info_product/saas/call/lead_gen/other each get their own typical cost-per-conversion, CTR range, and ROAS range where relevant. Confirmed this never touched BlackB4U or Nothing But Buckets — both clear the 10-conversion trust threshold and use their own real figures ($30.11 and ~$5.02); only clients below that threshold use the niche benchmark. Also wired into `insightsAgent.ts`'s prompt: recommendations are now judged against the client's own niche benchmark rather than one universal standard.
9. **Found independently, unrelated to any review item:** `insightsAgent.ts`'s `FULL OUTER JOIN ... ON name-match OR id-match` pattern (4 sites) is a genuine PostgreSQL planner limitation — confirmed via a minimal repro independent of any client's data ("FULL JOIN is only supported with merge-joinable or hash-joinable join conditions"). This means Gojo's whole-account/platform/campaign-scope insight generation **could never execute, for any client, since this file was written** — discovered only because this review's fixes finally exercised that code path against real data. Fixed by resolving the name-or-id match inside a CTE first, so the FULL JOIN itself only needs a plain equality condition. Verified against real data for all 5 clients post-fix, including a case where it correctly surfaces revenue with no matching ad-spend row (Nothing But Buckets, $948.45 unmatched revenue).

**Verified:** both workspaces typecheck clean; all 98 existing API tests still pass; live-tested against the real Supabase DB (days-live counts, chat tool payloads, fatigue re-run, benchmark fallback per niche) with temp scripts deleted after each check.

---

## 2026-07-28 — Built: zero-downtime Railway deploys (healthcheck + overlap + graceful shutdown)

**Ask:** user recalled the earlier-documented risk (see the 07-27 follow-up entry below, "found a real deploy-boundary gap") — a redeploy could plausibly drop a sale — and asked to close it so redeployments can't cost real orders.

**What was actually missing, confirmed by reading the live config/code, not assumed:** `railway.json`'s `deploy` block had no `healthcheckPath` — Railway had no way to know when the new container was actually ready, so (per the 07-27 entry) it could mark a deploy "Active" ~3.5 minutes before the container was really listening. Separately, `api/src/index.ts` had zero `SIGTERM`/`SIGINT` handling — the process would die immediately on Railway's termination signal, severing any in-flight request (e.g. mid-DB-write on a Shopify order) rather than finishing it.

**Important context, not a new problem:** the Shopify order webhook itself was already reasonably safe even before this — `shopify.ts`'s handler awaits `recordPurchase` before ever responding 200, and `purchases` has a `(client_id, order_id)` unique constraint with `ON CONFLICT DO NOTHING` (migration 003), so a request that fails/times out during a deploy gap gets safely retried by Shopify's own automatic webhook-retry mechanism without risk of a duplicate. The real gap was the *window itself* being unnecessarily large and unmanaged, not unsafe request handling.

**Fix:**
- `railway.json`: added `healthcheckPath: "/health"` + `healthcheckTimeout: 30` (Railway won't cut traffic to a new deploy until it actually answers healthy) and `overlapSeconds: 30` (the previous deploy keeps serving until the new one passes that check — true zero-downtime instead of a gap) + `drainingSeconds: 15` (grace window before the old container is SIGKILLed).
- `api/src/index.ts`: added a `SIGTERM`/`SIGINT` handler calling `app.close()` (stops accepting new connections, waits for in-flight ones to finish) before exiting, so the `drainingSeconds` window is actually used instead of the process dying on the spot.
- Confirmed exact Railway schema field names/semantics against `railway.schema.json` before writing the config, rather than guessing.

**Verified:** `railway.json` is valid JSON; `api` workspace (`tsc`) builds clean with the new shutdown handler.

**Not yet live:** same as any `api/` change — needs a Railway redeploy (ironically, this next deploy will still cross the un-fixed gap once, since the old behavior is what's live until the new config takes effect).

**Commit:** `6354a67`

---

## 2026-07-27 (later) — Nothing But Buckets: identify() still dropping most orders — sendBeacon fix

**Reported:** user flagged two new NBB orders with no attribution (`realisjones9@gmail.com`, `robincaldwell3100@comcast.net`) while the order right before them (`rharris@towerhill.org`) landed fine.

**Confirmed directly against the real DB, not assumed:** all three are real NBB orders (`purchases` rows exist for all three — Shopify webhook is fine). `rharris` has a matching `identities` row created 8 seconds before their purchase and two clean `attributions` rows. The other two have **zero** `identities`/`attributions` rows. Checked the full session window around all three (19:45–20:25 UTC): 15 real ad-click sessions (fbclid + utm present) landed in that window, but only **one** `/track/identify` call succeeded the entire time — `rharris`'s. This is the same "~50% of purchases have no session/identity" gap flagged as still-open in the entry below (2026-07-27, "(no utm_campaign)" investigation) — confirmed still happening in real time, at a worse-than-50% rate, not improved by the keepalive fix from `8ace08e`.

**Root cause:** the Shopify Customer Events custom pixel (`shopifyCustomPixelSnippet` in `settings-client.tsx`) sent `checkout_completed`'s `/track/identify` call via `fetch(..., {keepalive:true})`. `keepalive` reduces but doesn't eliminate the race — the call is still tied to the sandboxed pixel worker's own request lifecycle, and `checkout_completed` fires right as Shopify tears that context down to redirect to the thank-you page. Live evidence above shows it losing the race the large majority of the time for this client.

**Fix:** added `postBeacon()` using `browser.sendBeacon()` — the Shopify Web Pixels sandbox's dedicated primitive for exactly this "about to navigate away" case (queued by the browser itself, independent of the pixel context's lifetime), falling back to the old fetch+keepalive path only if `sendBeacon` is unavailable. Wired `checkout_completed`'s identify call to use it. Verified: dashboard workspace builds clean, extracted-and-stubbed the generated snippet through `node --check` for syntax validity.

**Not yet fixed live:** same limitation as the 07-26 keepalive fix — editing the template here does **not** update Nothing But Buckets' already-pasted Shopify Customer Events code. The updated snippet needs to be re-copied from Kado Settings → this client and re-pasted into Shopify Admin → Customer Events by hand, and the dashboard needs a fresh Vercel deploy (this file lives in `dashboard/`, not `api/`) before it takes effect. Until that re-paste happens, expect this to keep failing at roughly the same rate.

**Commit:** `6354a67`

**Also worth checking, not yet done:** whether NBB has the *other*, already-more-reliable identify path (`shopifyCheckoutSnippet`, the order-status-page "Additional scripts" version using `sendBeacon` directly at the top level, not inside the Web Pixels sandbox) installed at all — that path isn't racing a navigation the same way and may be a faster/simpler fix than waiting on the Customer Events re-paste.

---

## 2026-07-27 — Built: Phase 1 recommendation guardrails (Gojo gate + Kado creative-fatigue rebuild)

**Ask:** the AI/native recommendation surfaces were making calls on campaigns/creatives too new or too under-spent to have earned one. Build a shared data-sufficiency gate, apply it to both Gojo (the LLM insights engine, `api/src/lib/insightsAgent.ts`) and Kado's native creative-fatigue detector (`api/src/jobs/creativeFatigue/run.ts`) — confirmed as two separate, explicitly-named targets, not the same thing.

**The gate** (`api/src/lib/recommendationGate.ts` + `api/src/config/recommendationGuardrails.ts`): passes if `daysLive >= 7 (creative) / 14 (campaign)` **OR** `spend >= 3× that client's own trailing-30-day cost-per-purchase`. Either side alone opens it. Cost-per-purchase is never a flat number — computed per client, per Phase 1's explicit requirement — by a new daily job (`api/src/jobs/costPerPurchase/run.ts`, new `client_cost_per_purchase` table) that resolves "a purchase" per client rather than by a fixed niche switch: real purchases tried first for every niche, falling back to SaaS trial-conversions/qualified calls only when a client has zero purchases in the window, and to a global $50 default (config, flagged `TODO(user)` — placeholder pending the real number) below 5 conversions of any kind. "Days live" is a proxy (`MIN(date)` in `ad_costs` for that entity) — this app has never captured the platform's real ad-creation date.

**Applied to Gojo:** single campaign/creative scope gates before Claude is ever called — a gate failure returns a canned `"insufficient data — X days live, $Y spent, needs $Z..."` object and skips the API call entirely (real cost savings, not just correctness). Whole-account/platform scope can't gate "the account" the same way, so instead every campaign/creative row fed into the prompt now carries `dataSufficient`/`confidence`/`daysLive`, and the prompt is instructed not to recommend action on any row marked insufficient, and to copy the given confidence/daysLive verbatim rather than invent them.

**Applied to Kado (creative fatigue):** full rebuild, not just gated. Previously: CTR-only, one 3-day-vs-7-day comparison, gated only by a flat prior-impressions floor. Now: gate must pass first, then checks ROAS/CTR/CPA/CPM/frequency (frequency is new — added to the Facebook Insights API pull and a new `ad_costs.frequency` column; Facebook-only for now) across **two** window pairs (3d-vs-7d short, 7d-vs-14d long) — a metric only counts as fatigue if it crosses its threshold (30%+ decline for ROAS/CTR, 30%+ increase for CPA/CPM/frequency) in **both** pairs, not a single-day blip. No baseline history in the longer window → skipped, not flagged.

**Verified against the real Supabase DB** (5 live clients — BlackB4U, Nothing But Buckets, Report Schedule Test Client, Starstruckofficiall, Universal Flooring Solutions; temp verification script deleted after): all 4 gate cases (new+low-spend/new+high-spend/old+low-spend/old+high-spend) behaved correctly; BlackB4U ($30.11 CPP → $90.33 gate) vs. Nothing But Buckets ($5.06 CPP → $15.18 gate) confirmed genuinely per-client, not shared; two near-zero-purchase clients fell back to the $50 default cleanly, no divide-by-zero; cost-per-purchase is structurally independent of the dashboard's date-range picker (the job takes no range argument). Both workspaces (`api`, `dashboard`) typecheck clean.

**Not yet committed** — sitting as working-tree changes pending review; Phase 2 (Leads → Customer Buying Journey tab) is queued to follow in the same pass.

---

## 2026-07-27 (follow-up) — Verified live: identify()/attribution is working post-deploy; found a real deploy-boundary gap

Follow-up to the "(no utm_campaign)" entry below, same day. After shipping the `campaign_id`/`ad_id` fallback fix (commit `f37ee50`), dug into why the *daily* attributed-purchase rate for Nothing But Buckets had stayed flat around 30-37% for several days even across the 07-26 keepalive/Data-Sale fix — wanted to know if `/track/identify` itself was still broken.

**Confirmed via Railway (browser-driven) + direct DB checks, not assumed:**
- Railway's "Active" badge timestamp is **not** when the container starts serving traffic. Deployment `99aacbc1` showed "Active" at 11:48 AM EDT in the UI, but its own Deploy Logs show `Starting Container` / `Server listening` only at **11:51:28 AM EDT** — a ~3.5 minute gap. A real NBB sale at 11:50:42 AM (order `6082135064627`) landed 46 seconds *before* the new container was listening — initially misread as a live identify() failure, corrected once the container-start log line was found. This is a real, separate risk (single-replica Railway service, no explicit healthcheck configured in `railway.json` — a checkout completing during a deploy's boot window could plausibly drop `/track/identify` or the Shopify webhook) but wasn't the cause of the historical gap, since that gap predates today's deploys.
- Once the container was confirmed stable (post 11:51:28), asked the user to place real orders and checked three live ones directly against the DB: `ingak305@gmail.com` (Bethune Cookman hat), `roddrew@mchsi.com` (NC Central hat), `kayjaylove@aol.com` (Norfolk State hat). **All three fully attributed**: identity created 1-2 seconds before the purchase record (the expected checkout_completed → /track/identify → order-webhook sequence), real session with `fbclid`/`utm_source`/`utm_campaign`, and `utm_content` (the ad's raw `ad_id`) matched a real row in `ad_costs` — resolving to actual creative names (`Abandoned_Cart_Retargeting_2`, `NCAT_UGC_Ad_2` under campaign `Nothing_But_Buckets_Cold_V1`), confirming creative-level attribution, not just campaign-level.

**Conclusion:** no active identify()/pixel bug found on a clean (non-deploy-boundary) live test — 3/3 real orders attributed correctly end-to-end, including creative-level resolution. The likely explanation for the flat ~30-37%/day historical average is a mix of (a) whatever was broken before the 07-26 fix, averaged into the same daily bucket, and (b) deploy-boundary gaps like the one caught here — not an ongoing client-side failure. Set up a session-local recurring check (cron job `cc40b016`, every 2 hours, session-only — dies if this session ends) to keep tracking the attributed rate for orders since the 11:51:28 deploy and flag any real ad-click purchase that still lands unattributed, which would indicate this conclusion is wrong.

**No code changed in this follow-up** — recorded so a future session doesn't re-chase "identify() is broken" from the daily aggregate alone without checking whether a deploy boundary or the pre-fix period is skewing it.

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

## Proposed enhancements (validated technically sound, not yet built — pick up in a separate session)

_(none currently — see "Fall back to a direct ad-object lookup" below, built 2026-07-27)_

---

## 2026-07-27 — Built: ad-object-fallback creative resolution

Built the enhancement proposed in the previous session (see the git history of this file for the original write-up). Summary of what shipped:

- `fetchAdObjectFallback(accessToken, adId)` in `api/src/jobs/adCosts/facebook.ts` — hits the ad object endpoint (`name,campaign{id,name},adset{id,name},creative{...}`) directly, sharing creative-parsing logic with the existing `fetchCreativeInfo` via an extracted `parseCreative()`.
- `resolveAdObjectFallback(clientId, adId)` in new `api/src/lib/adObjectFallback.ts` — the caching/orchestration layer: skips anything not shaped like a Facebook numeric ad id, skips if `ad_costs` already has a row for that `(client_id, ad_id)` (cache hit), looks up the client's `facebook_ads` access token from `client_integrations`, calls the fetch above, and on success writes a `$0`-spend `ad_costs` row via the existing `upsertAdCosts` (so it's a one-time live lookup per ad_id — the routine Insights sync overwrites it with real spend once the ad actually starts reporting).
- Wired into `campaignDetail.ts`'s creative-detail route (`assetRows.length === 0 && !adId` → try the URL's `creativeName` as a raw ad_id) and `reports.ts`'s `/reports/funnel?breakdown=creative` (any unmatched row — `cost === 0` — whose `name` is numeric-ad-id-shaped gets its `name`/`campaignName` upgraded in place).

**Verified against the real Supabase DB and live Meta API** (temp test client cloned from Nothing But Buckets' real `facebook_ads` integration, cleaned up after):
1. The confirmed-deleted ad (`120249034033030253`) → no row created, route returns the same graceful null-asset response as before. Limit holds as documented.
2. A real ad with no `ad_costs` row for the test client (`120249405436560253`, `Abandoned_Cart_Retargeting_2`) → recovered real name, campaign name, thumbnail, and copy through both `campaignDetail.ts`'s creative-detail route and `reports.ts`'s creative breakdown (unmatched row's `name` upgraded from the raw id to the real ad name).
3. Re-running against the same ad_id → cache hit, no duplicate row, no second live API call.
4. A non-numeric name (e.g. a real UTM-tagged creative name) → skipped without any network call, confirming this doesn't add live-API latency to the common case.

**Commit:** (see git log for the commit hash following this entry)

---

## 2026-07-27 — Nothing But Buckets: real ad clicks landing in "(no utm_campaign)" Direct/Organic

**Reported:** sales still showing up under "(no utm_campaign)" Direct/Organic for Nothing But Buckets specifically — user noted BlackB4U wasn't showing the same symptom, and UTMs were confirmed present in the ad setup.

**Investigated directly against the real Supabase DB** (not assumed): pulled Nothing But Buckets' most recent purchases joined through `attributions`→`sessions`. Found the exact mechanism, not just a plausible theory:
- Some of the client's Facebook ad URLs carry `utm_source`/`utm_medium` **plus Meta's raw dynamic URL params `campaign_id`/`ad_id`**, but no `utm_campaign`/`utm_content` at all — e.g. `?utm_source=facebook&utm_medium=paid&campaign_id=120245194137140253&ad_id=120248578723770253`. Other ads in the same account *do* tag `utm_campaign`/`utm_content` (redundantly, alongside `campaign_id`/`ad_id`) — the account's ad templates are simply inconsistent.
- Both places that parse ad params out of a URL — `pixel.js`'s `extractAdParams()` (live pageviews) and `session.ts`'s `parseAdParamsFromLandingSite()` (the Shopify `landing_site` server-side fallback, see the 2026-07-25 entry below) — only ever read `utm_campaign`/`utm_content`. Neither had a fallback to the raw `campaign_id`/`ad_id` params, so a session from one of these ads permanently had `utm_campaign: null` even though `utm_source`/`fbclid` proved it was a real, identifiable ad click. Confirmed a live example of exactly this via the fallback path (a session whose `started_at` == the purchase's `purchased_at`, `campaign_id`/`ad_id` present, `utm_campaign` null).
- Compared against BlackB4U's same-shape query: every session that existed there already had a `utm_campaign` — consistent with the user's report that this symptom is Nothing But Buckets-specific (their ad account's URL tagging, not a Kado-wide bug).
- The reports layer (`reports.ts`'s `idIndex`) already knows how to match a *raw numeric id* sitting in `utm_campaign`/`utm_content` against `ad_costs.campaign_id`/`ad_id` — that logic just never got a value to match on for these sessions.

**Fix:** both `extractAdParams()` (pixel.js) and `parseAdParamsFromLandingSite()` (session.ts) now fall back to `campaign_id`/`ad_id` when `utm_campaign`/`utm_content` are absent from the URL. Verified the fallback resolves both real NBB URL shapes correctly (campaign_id-only, and utm_campaign+campaign_id together) via a standalone check before shipping. `npm run test` (98 tests) and `tsc --noEmit` stayed clean.

**Separate, larger issue found while investigating, not yet fixed:** roughly half of both clients' recent purchases have **zero session or identity record at all** (not even landing in "(no utm_campaign)" — excluded from every campaign/source report entirely, since `getRevenueByCampaign` inner-joins `attributions`). Spot-checked several such emails against `identities` — zero rows, meaning `/track/identify` never successfully linked them. This affects BlackB4U equally, so it's not what the user reported this session, but it's the bigger revenue-visibility gap of the two. Matches the shape of the 2026-07-26 "most real orders never getting attributed" entry above (keepalive + Shopify Data Sale gating) — but fresh 2026-07-27 data still shows it at the same ~50% rate one day after that was marked fixed, which means either the keepalive code fix was never actually redeployed on Railway, or the Shopify Customer Events custom-pixel snippet re-paste / Data Sale setting change didn't actually take for one or both clients (or reverted). Needs checking directly in Shopify Admin (Settings → Customer events) and confirming Railway shows a deploy after commit `8ace08e`, not just re-diagnosing from scratch — not something fixable from this repo alone.

**Commit:** (see git log for the commit hash following this entry)

---

## Operational gotchas (not code bugs — Kado-specific environment/process facts worth knowing)

- **Local API dev server (`tsx watch`) sometimes doesn't restart on file save** — a stale process can keep serving old code indefinitely with no visible error. If a fix "doesn't seem to work" locally, check `netstat -ano | grep :3001`'s PID start time against when the file was last saved; if the process predates the edit, kill it and restart `npm run dev:api`.
- **Deploys are manual, not automatic**, on both sides: pushing to `origin/main` does *not* deploy anything by itself. Railway (API) and Vercel (dashboard) each need a manual redeploy triggered separately after a push. A fix can be committed, pushed, and fully verified against the real database while the live site still shows the old broken behavior — always check which of the two (or both) actually need redeploying before concluding a fix "isn't working."
