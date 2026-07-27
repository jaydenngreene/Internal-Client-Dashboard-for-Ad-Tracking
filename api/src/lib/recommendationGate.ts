import { db } from '../db'
import { GUARDRAIL_CONFIG, EntityType, ConversionEvent } from '../config/recommendationGuardrails'

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
  const { rows } = await db.query<{ cost_per_purchase: string; is_fallback: boolean; conversion_event: ConversionEvent }>(
    `SELECT cost_per_purchase, is_fallback, conversion_event FROM client_cost_per_purchase WHERE client_id = $1`,
    [clientId]
  )
  if (rows.length === 0) {
    // costPerPurchase/run.ts hasn't run for this client yet (brand new client
    // before the next scheduled tick) - same fallback the job itself would
    // have written, so the gate never divides by an absent figure.
    return { costPerPurchase: GUARDRAIL_CONFIG.fallback.costPerPurchase, isFallback: true, event: null }
  }
  return {
    costPerPurchase: parseFloat(rows[0].cost_per_purchase),
    isFallback: rows[0].is_fallback,
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

// Shared "how long has this ad_id/campaign been live" helper - both consumers
// (creativeFatigue and insightsAgent) need this, and both were about to
// duplicate the same MIN(date) query, so it lives here instead. This is a
// proxy for the platform's real ad-creation date (not captured anywhere in
// this app - see docs/ISSUE_LOG.md), namely "the first day we have ad_costs
// spend data for it," which is the earliest available signal without an
// extra API call per entity.
export async function getDaysLive(
  clientId: string,
  platform: string,
  campaignName: string,
  adName?: string
): Promise<number> {
  const { rows } = await db.query<{ first_date: string | null }>(
    adName
      ? `SELECT MIN(date) AS first_date FROM ad_costs
         WHERE client_id = $1 AND LOWER(REGEXP_REPLACE(platform, '_ads$', '')) = LOWER(REGEXP_REPLACE($2, '_ads$', ''))
           AND LOWER(TRIM(campaign_name)) = LOWER(TRIM($3)) AND LOWER(TRIM(ad_name)) = LOWER(TRIM($4))`
      : `SELECT MIN(date) AS first_date FROM ad_costs
         WHERE client_id = $1 AND LOWER(REGEXP_REPLACE(platform, '_ads$', '')) = LOWER(REGEXP_REPLACE($2, '_ads$', ''))
           AND LOWER(TRIM(campaign_name)) = LOWER(TRIM($3))`,
    adName ? [clientId, platform, campaignName, adName] : [clientId, platform, campaignName]
  )
  if (!rows[0]?.first_date) return 0
  const days = Math.floor((Date.now() - new Date(rows[0].first_date).getTime()) / 86400000)
  return Math.max(days, 0)
}

// Same "days live" concept as getDaysLive above, but keyed by the exact
// (platform, ad_id) pair a system-wide batch job already has on hand (e.g.
// creativeFatigue) instead of a name it would need to fuzzy-match — avoids a
// redundant re-match against ad_costs when the caller already has the id.
export async function getDaysLiveByAdId(clientId: string, platform: string, adId: string): Promise<number> {
  const { rows } = await db.query<{ first_date: string | null }>(
    `SELECT MIN(date) AS first_date FROM ad_costs WHERE client_id = $1 AND platform = $2 AND ad_id = $3`,
    [clientId, platform, adId]
  )
  if (!rows[0]?.first_date) return 0
  const days = Math.floor((Date.now() - new Date(rows[0].first_date).getTime()) / 86400000)
  return Math.max(days, 0)
}
