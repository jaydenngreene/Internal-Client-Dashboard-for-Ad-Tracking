import { db } from '../db'
import { GUARDRAIL_CONFIG, EntityType, ConversionEvent } from '../config/recommendationGuardrails'
import { benchmarkForNiche } from '../config/industryBenchmarks'

export type { EntityType, ConversionEvent }

export interface GateResult {
  passed: boolean
  daysLive: number
  spend: number
  costPerPurchase: number
  isFallbackCostPerPurchase: boolean
  conversionEventBasis: ConversionEvent | null
  spendThreshold: number
  openedByDaysLive: boolean
  openedBySpend: boolean
  // Which side of the OR is reported as "the" reason it passed - if both
  // cleared, spend is reported since actual conversion-relative spend is a
  // stronger signal than time alone having passed.
  openedBy: 'days_live' | 'spend' | null
  // Only meaningful when passed=true. Band definitions (documented here since
  // the spec left the exact cutoffs to us): 'high' when BOTH sides of the OR
  // clear, or spend alone clears at 2x the threshold; 'medium' when exactly
  // one side clears; forced to 'low' when the optional min-conversions check
  // is enabled and this entity's conversion count falls short of it, no matter
  // how comfortably the spend/days-live side cleared.
  confidence: 'low' | 'medium' | 'high' | null
  conversionCount: number | null
  belowMinConversions: boolean
  // Human-readable, matches the product's required "insufficient data — X days
  // live, $Y spent, needs $Z (3x this client's 30-day cost per purchase of $N)"
  // shape when passed=false; a short pass-summary otherwise.
  reason: string
}

export interface CostContext {
  costPerPurchase: number
  isFallback: boolean
  event: ConversionEvent | null
}

// Fetched once per client, then reused (via evaluateGate below) across however
// many creatives/campaigns need a gate check in one pass — e.g. insightsAgent's
// whole-account/platform scope annotates ~10-20 entities per call and would
// otherwise re-query this single-row table once per entity for no reason.
export async function getCostContext(clientId: string): Promise<CostContext> {
  const { rows } = await db.query<{
    cost_per_purchase: string | null
    is_fallback: boolean | null
    conversion_event: ConversionEvent | null
    niche: string
  }>(
    `SELECT cc.cost_per_purchase, cc.is_fallback, cc.conversion_event, c.niche
     FROM clients c LEFT JOIN client_cost_per_purchase cc ON cc.client_id = c.id
     WHERE c.id = $1`,
    [clientId]
  )
  if (rows.length === 0 || rows[0].cost_per_purchase === null) {
    // costPerPurchase/run.ts hasn't run for this client yet (brand new client
    // before the next scheduled tick) - same niche-based industry-benchmark
    // fallback the job itself would have written, so the gate never divides
    // by an absent figure and never uses a flat number across every business
    // type (review fix, 2026-07-28).
    return {
      costPerPurchase: benchmarkForNiche(rows[0]?.niche ?? 'other').typicalCostPerConversion,
      isFallback: true,
      event: null,
    }
  }
  return {
    costPerPurchase: parseFloat(rows[0].cost_per_purchase),
    isFallback: rows[0].is_fallback ?? false,
    event: rows[0].conversion_event,
  }
}

// Pure gate math, no DB access — split out from checkGate so a caller that
// already has the client's CostContext (see getCostContext above) can evaluate
// many entities in a loop without a round-trip per entity.
export function evaluateGate(
  ctx: CostContext,
  entityType: EntityType,
  daysLive: number,
  spend: number,
  conversionCount: number | null = null
): GateResult {
  const spendThreshold = ctx.costPerPurchase * GUARDRAIL_CONFIG.spendMultiplier
  const daysLiveThreshold = GUARDRAIL_CONFIG.daysLive[entityType]

  const openedByDaysLive = daysLive >= daysLiveThreshold
  const openedBySpend = spend >= spendThreshold
  const passed = openedByDaysLive || openedBySpend

  const { enabled: minConvEnabled, minConversions } = GUARDRAIL_CONFIG.minConversionCheck
  const belowMinConversions = minConvEnabled && conversionCount !== null && conversionCount < minConversions

  let confidence: GateResult['confidence'] = null
  let openedBy: GateResult['openedBy'] = null
  if (passed) {
    openedBy = openedBySpend ? 'spend' : 'days_live'
    if (openedByDaysLive && openedBySpend) confidence = 'high'
    else if (openedBySpend && spend >= spendThreshold * 2) confidence = 'high'
    else confidence = 'medium'
    if (belowMinConversions) confidence = 'low'
  }

  const reason = passed
    ? `Passed on ${openedBy === 'spend' ? 'spend' : 'days live'} (${daysLive} days live, $${spend.toFixed(2)} spent vs. $${spendThreshold.toFixed(2)} threshold).`
    : `insufficient data — ${daysLive} days live, $${spend.toFixed(2)} spent, needs $${spendThreshold.toFixed(2)} (${GUARDRAIL_CONFIG.spendMultiplier}× this client's ${GUARDRAIL_CONFIG.lookbackDays}-day cost per purchase of $${ctx.costPerPurchase.toFixed(2)})`

  return {
    passed,
    daysLive,
    spend,
    costPerPurchase: ctx.costPerPurchase,
    isFallbackCostPerPurchase: ctx.isFallback,
    conversionEventBasis: ctx.event,
    spendThreshold,
    openedByDaysLive,
    openedBySpend,
    openedBy,
    confidence,
    conversionCount,
    belowMinConversions,
    reason,
  }
}

export async function checkGate(
  clientId: string,
  entityType: EntityType,
  daysLive: number,
  spend: number,
  conversionCount: number | null = null
): Promise<GateResult> {
  const ctx = await getCostContext(clientId)
  return evaluateGate(ctx, entityType, daysLive, spend, conversionCount)
}

export interface GateAnnotation {
  daysLive: number
  dataSufficient: boolean
  confidence: GateResult['confidence']
  gateReason: string
}

// Thin wrapper around evaluateGate for the "annotate a whole list of rows"
// call sites (insightsAgent's whole-account/platform scope, chatTools' campaign
// breakdown) — every consumer that needs to attach a gate verdict to a row
// without re-deriving the GateResult shape uses this, so the annotation fields
// stay identical everywhere they show up (dataSufficient/confidence/daysLive).
export function annotateEntityGate(
  ctx: CostContext,
  entityType: EntityType,
  daysLive: number,
  spend: number,
  conversionCount: number | null = null
): GateAnnotation {
  const gate = evaluateGate(ctx, entityType, daysLive, spend, conversionCount)
  return { daysLive, dataSufficient: gate.passed, confidence: gate.confidence, gateReason: gate.reason }
}

// Shared "how long has this ad_id/campaign actually been live" helper - both
// consumers (creativeFatigue and insightsAgent) need this, and both were about
// to duplicate the same query, so it lives here instead.
//
// Deliberately COUNT(DISTINCT date) WHERE spend > 0, not MIN(date) subtracted
// from today (2026-07-27 fix — the original calendar-elapsed version let a
// creative that ran 5 days in March, paused, and resumed yesterday read as
// ~4 months live, sailing through the days-live side of the gate on 6 days of
// real data). This is still a proxy for the platform's real ad-creation date
// (not captured anywhere in this app — see docs/ISSUE_LOG.md), but now
// counts actual days with spend rather than calendar span since first seen.
export async function getDaysLive(
  clientId: string,
  platform: string,
  campaignName: string,
  adName?: string
): Promise<number> {
  const { rows } = await db.query<{ days_with_spend: string }>(
    adName
      ? `SELECT COUNT(DISTINCT date) FILTER (WHERE spend > 0) AS days_with_spend FROM ad_costs
         WHERE client_id = $1 AND LOWER(REGEXP_REPLACE(platform, '_ads$', '')) = LOWER(REGEXP_REPLACE($2, '_ads$', ''))
           AND LOWER(TRIM(campaign_name)) = LOWER(TRIM($3)) AND LOWER(TRIM(ad_name)) = LOWER(TRIM($4))`
      : `SELECT COUNT(DISTINCT date) FILTER (WHERE spend > 0) AS days_with_spend FROM ad_costs
         WHERE client_id = $1 AND LOWER(REGEXP_REPLACE(platform, '_ads$', '')) = LOWER(REGEXP_REPLACE($2, '_ads$', ''))
           AND LOWER(TRIM(campaign_name)) = LOWER(TRIM($3))`,
    adName ? [clientId, platform, campaignName, adName] : [clientId, platform, campaignName]
  )
  return parseInt(rows[0]?.days_with_spend ?? '0', 10)
}

// Same "days live" concept as getDaysLive above, but keyed by the exact
// (platform, ad_id) pair a system-wide batch job already has on hand (e.g.
// creativeFatigue) instead of a name it would need to fuzzy-match — avoids a
// redundant re-match against ad_costs when the caller already has the id.
export async function getDaysLiveByAdId(clientId: string, platform: string, adId: string): Promise<number> {
  const { rows } = await db.query<{ days_with_spend: string }>(
    `SELECT COUNT(DISTINCT date) FILTER (WHERE spend > 0) AS days_with_spend FROM ad_costs
     WHERE client_id = $1 AND platform = $2 AND ad_id = $3`,
    [clientId, platform, adId]
  )
  return parseInt(rows[0]?.days_with_spend ?? '0', 10)
}

// Bulk "days live per entity" lookup for callers annotating a whole LIST of
// campaign/creative rows in one pass (insightsAgent's whole-account/platform
// scope, chatTools' campaign breakdown) — one all-time query instead of one
// getDaysLive() call per row. Keyed by both id and lowercased/trimmed name so
// a row can match on whichever it has, same fallback convention used
// everywhere else in this app for campaign_id/ad_id vs. name.
export async function getDaysLiveMap(
  clientId: string,
  entityType: EntityType,
  platform?: string
): Promise<Map<string, number>> {
  const nameCol = entityType === 'campaign' ? 'campaign_name' : 'ad_name'
  const idCol = entityType === 'campaign' ? 'campaign_id' : 'ad_id'
  const platformFilter = platform
    ? `AND LOWER(REGEXP_REPLACE(platform, '_ads$', '')) = LOWER(REGEXP_REPLACE($2, '_ads$', ''))`
    : ''
  const params = platform ? [clientId, platform] : [clientId]
  const { rows } = await db.query<{ name: string | null; id: string | null; days_live: string }>(
    `SELECT ${nameCol} AS name, ${idCol} AS id, COUNT(DISTINCT date) FILTER (WHERE spend > 0) AS days_live
     FROM ad_costs WHERE client_id = $1 ${platformFilter}
     GROUP BY ${nameCol}, ${idCol}`,
    params
  )
  const map = new Map<string, number>()
  for (const r of rows) {
    const days = parseInt(r.days_live, 10)
    if (r.id) map.set(`id:${r.id}`, days)
    if (r.name) map.set(`name:${r.name.toLowerCase().trim()}`, days)
  }
  return map
}

export function lookupDaysLive(map: Map<string, number>, id: string | null, name: string | null): number {
  if (id && map.has(`id:${id}`)) return map.get(`id:${id}`)!
  if (name && map.has(`name:${name.toLowerCase().trim()}`)) return map.get(`name:${name.toLowerCase().trim()}`)!
  return 0
}
