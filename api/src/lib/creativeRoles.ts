import { db } from '../db'
import { conversionConfigForNiche } from '../config/nicheVocabulary'
import { getConversionsForNiche } from './attributionModelComparison'

// Classifies every creative that appears in a converting journey by the job
// it actually did in that journey, not just its raw last-click conversion
// count - the same "opener ads look worthless under last-click, closer ads
// look worthless under first-click" problem the two comparison tabs already
// address, but at creative-position granularity instead of a whole-model
// swap. Spend/ROAS/CPA/AOV/CTR/CPC already exist on the Creative breakdown
// (GET /clients/:id/reports/funnel?breakdown=creative) - this endpoint
// deliberately returns ONLY the three role counts + a role label, merged
// into that existing table client-side by name+platform, rather than
// recomputing spend/revenue a third time.
export type CreativeRole = 'opener' | 'closer' | 'assist' | 'multi_role'

export interface CreativeRoleRow {
  name: string
  // Null when no ad_costs row could resolve this touch to a real creative -
  // the dashboard uses this the same way the two comparison tabs already do,
  // to decide whether the row can link anywhere.
  platform: string | null
  // Distinct converting journeys in which this creative was the very first
  // touch, the very last touch, or a touch in between, respectively. A
  // single-touch journey counts as both opener and closer for that one
  // creative (there's no meaningful "first vs last" distinction to draw when
  // there was only ever one ad involved) - matches uShapedWeights' own
  // count===1 collapse in attribution.ts.
  openerCount: number
  closerCount: number
  assistCount: number
  role: CreativeRole
}

interface AdCostsCreative {
  ad_id: string | null
  ad_name: string
  platform: string
}

const UNNAMED = '(no creative)'
const normalizePlatform = (s: string | null) => (s ?? '').trim().toLowerCase().replace(/_ads$/, '')

// Same id-or-name + platform matching convention as buyingJourney.ts's
// AD_COSTS_MATCH_LATERAL and attributionModelComparison.ts's resolveCampaign -
// utm_content is frequently the ad platform's raw numeric ad id, not a human
// name.
function resolveCreative(
  utmContent: string | null,
  utmSource: string | null,
  adCosts: AdCostsCreative[]
): { name: string; platform: string | null } {
  if (!utmContent) return { name: UNNAMED, platform: null }
  const normalizedSource = normalizePlatform(utmSource)
  const match = adCosts.find(
    (c) =>
      normalizePlatform(c.platform) === normalizedSource &&
      (c.ad_id === utmContent || c.ad_name.trim().toLowerCase() === utmContent.trim().toLowerCase())
  )
  return match ? { name: match.ad_name, platform: match.platform } : { name: utmContent, platform: null }
}

export function classifyRole(openerCount: number, closerCount: number, assistCount: number): CreativeRole {
  const max = Math.max(openerCount, closerCount, assistCount)
  const atMax = [
    openerCount === max ? ('opener' as const) : null,
    closerCount === max ? ('closer' as const) : null,
    assistCount === max ? ('assist' as const) : null,
  ].filter((r): r is 'opener' | 'closer' | 'assist' => r !== null)
  return atMax.length > 1 ? 'multi_role' : atMax[0]
}

export async function computeCreativeRoles(
  clientId: string,
  niche: string,
  from: string,
  to: string
): Promise<CreativeRoleRow[]> {
  const config = conversionConfigForNiche(niche)

  const [conversions, adCostsRows] = await Promise.all([
    getConversionsForNiche(clientId, config.eventType, from, to),
    db.query<AdCostsCreative>(
      `SELECT DISTINCT ad_id, ad_name, platform FROM ad_costs WHERE client_id = $1 AND ad_name IS NOT NULL`,
      [clientId]
    ),
  ])
  const adCosts = adCostsRows.rows

  interface Accum {
    name: string
    platform: string | null
    openerCount: number
    closerCount: number
    assistCount: number
  }
  const byKey = new Map<string, Accum>()
  // Keyed by name+platform, not name alone - the same creative name can exist
  // on two different platforms, and collapsing those into one row would
  // silently blend their role counts together.
  const get = (name: string, platform: string | null): Accum => {
    const key = `${name}::${platform ?? ''}`
    let row = byKey.get(key)
    if (!row) {
      row = { name, platform, openerCount: 0, closerCount: 0, assistCount: 0 }
      byKey.set(key, row)
    }
    return row
  }

  for (const { touches } of conversions) {
    if (touches.length === 0) continue

    const first = resolveCreative(touches[0].utm_content, touches[0].utm_source, adCosts)
    get(first.name, first.platform).openerCount += 1

    const last = resolveCreative(
      touches[touches.length - 1].utm_content,
      touches[touches.length - 1].utm_source,
      adCosts
    )
    get(last.name, last.platform).closerCount += 1

    // Middle touches only exist when there are 3+ touches - dedupe within
    // this one journey first (a creative clicked twice in the middle of one
    // path still only "assisted" that one sale once), same reasoning
    // attributionModelComparison.ts's touch-count-based weighting already
    // gives every position in between first and last.
    if (touches.length > 2) {
      const seenThisJourney = new Set<string>()
      for (let i = 1; i < touches.length - 1; i++) {
        const middle = resolveCreative(touches[i].utm_content, touches[i].utm_source, adCosts)
        const key = `${middle.name}::${middle.platform ?? ''}`
        if (seenThisJourney.has(key)) continue
        seenThisJourney.add(key)
        get(middle.name, middle.platform).assistCount += 1
      }
    }
  }

  return [...byKey.values()]
    .map((row) => ({ ...row, role: classifyRole(row.openerCount, row.closerCount, row.assistCount) }))
    .sort((a, b) => b.openerCount + b.closerCount + b.assistCount - (a.openerCount + a.closerCount + a.assistCount))
}
