import { db } from '../db'
import { conversionConfigForNiche } from '../config/nicheVocabulary'
import { getConversionsForNiche, TouchSession } from './attributionModelComparison'

// Customer Journey path clustering - "60% of buyers see this UGC ad first,
// then this retargeting offer, then buy" - the second, prototype-first half
// of the Customer Journey / Ad Role work (creativeRoles.ts is the first
// half). Prototyped directly against real client data before building this:
// the same ad/campaign shown 3-5x in a row before a purchase is extremely
// common (retargeting), which inflates "unique path" rates to 60-100% if you
// don't collapse consecutive repeats of the same step first - collapsed, a
// clean majority pattern actually emerges (one client's data showed 69% of
// buyers touched exactly one campaign, repeated, and nothing else). Creative
// grain is real but messier; source/platform grain is almost trivially
// dominant (usually just "facebook") and wasn't worth building.
//
// A "pattern" requires at least 2 distinct buyers actually walked it - a
// path only one person ever took isn't a pattern, it's one data point
// dressed up as one. Those are rolled into a single "singletonJourneys"
// count instead of listed individually, so the total always accounts for
// every journey without implying false confidence on n=1.
export type PathGrain = 'campaign' | 'creative'

export interface JourneyPathRow {
  steps: string[]
  count: number
  percentage: number
  totalValue: number
}

export interface JourneyPathsForGrain {
  patterns: JourneyPathRow[]
  singletonJourneys: number
}

export interface JourneyPathsResult {
  totalJourneys: number
  hasValue: boolean
  campaign: JourneyPathsForGrain
  creative: JourneyPathsForGrain
}

const MIN_PATTERN_COUNT = 2
const MAX_PATTERNS_RETURNED = 8

interface AdCostsRow {
  ad_id: string | null
  ad_name: string | null
  campaign_id: string | null
  campaign_name: string | null
  platform: string
}

const normalizePlatform = (s: string | null) => (s ?? '').trim().toLowerCase().replace(/_ads$/, '')

function resolveStep(touch: TouchSession, grain: PathGrain, adCosts: AdCostsRow[]): string {
  const normalizedSource = normalizePlatform(touch.utm_source)
  if (grain === 'creative') {
    if (!touch.utm_content) return '(no creative)'
    const match = adCosts.find(
      (c) =>
        normalizePlatform(c.platform) === normalizedSource &&
        (c.ad_id === touch.utm_content || (c.ad_name ?? '').trim().toLowerCase() === touch.utm_content!.trim().toLowerCase())
    )
    return match?.ad_name ?? touch.utm_content
  }
  if (!touch.utm_campaign) return '(no campaign)'
  const match = adCosts.find(
    (c) =>
      normalizePlatform(c.platform) === normalizedSource &&
      (c.campaign_id === touch.utm_campaign || (c.campaign_name ?? '').trim().toLowerCase() === touch.utm_campaign!.trim().toLowerCase())
  )
  return match?.campaign_name ?? touch.utm_campaign
}

// Collapses consecutive repeats of the same step - seeing the same ad/campaign
// several times in a row before buying is one touchpoint reinforced, not
// several distinct steps in the journey (see this file's own top comment).
function collapsedPath(touches: TouchSession[], grain: PathGrain, adCosts: AdCostsRow[]): string[] {
  const steps: string[] = []
  for (const touch of touches) {
    const step = resolveStep(touch, grain, adCosts)
    if (steps[steps.length - 1] !== step) steps.push(step)
  }
  return steps
}

function buildPathsForGrain(
  conversions: { touches: TouchSession[]; value: number }[],
  grain: PathGrain,
  adCosts: AdCostsRow[],
  totalJourneys: number
): JourneyPathsForGrain {
  interface Agg {
    steps: string[]
    count: number
    totalValue: number
  }
  const byPath = new Map<string, Agg>()

  for (const { touches, value } of conversions) {
    if (touches.length === 0) continue
    const steps = collapsedPath(touches, grain, adCosts)
    const key = steps.join(' -> ')
    let agg = byPath.get(key)
    if (!agg) {
      agg = { steps, count: 0, totalValue: 0 }
      byPath.set(key, agg)
    }
    agg.count += 1
    agg.totalValue += value
  }

  const all = [...byPath.values()]
  const patterns = all
    .filter((p) => p.count >= MIN_PATTERN_COUNT)
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_PATTERNS_RETURNED)
    .map((p) => ({ steps: p.steps, count: p.count, percentage: (p.count / totalJourneys) * 100, totalValue: p.totalValue }))

  const singletonJourneys = all.filter((p) => p.count < MIN_PATTERN_COUNT).reduce((sum, p) => sum + p.count, 0)

  return { patterns, singletonJourneys }
}

export async function computeJourneyPaths(
  clientId: string,
  niche: string,
  from: string,
  to: string
): Promise<JourneyPathsResult> {
  const config = conversionConfigForNiche(niche)

  const [conversions, adCostsRows] = await Promise.all([
    getConversionsForNiche(clientId, config.eventType, from, to),
    db.query<AdCostsRow>(
      `SELECT DISTINCT ad_id, ad_name, campaign_id, campaign_name, platform FROM ad_costs WHERE client_id = $1`,
      [clientId]
    ),
  ])
  const adCosts = adCostsRows.rows
  const totalJourneys = conversions.length

  if (totalJourneys === 0) {
    return {
      totalJourneys: 0,
      hasValue: config.hasValue,
      campaign: { patterns: [], singletonJourneys: 0 },
      creative: { patterns: [], singletonJourneys: 0 },
    }
  }

  return {
    totalJourneys,
    hasValue: config.hasValue,
    campaign: buildPathsForGrain(conversions, 'campaign', adCosts, totalJourneys),
    creative: buildPathsForGrain(conversions, 'creative', adCosts, totalJourneys),
  }
}
