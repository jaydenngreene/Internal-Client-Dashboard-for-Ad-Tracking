import { db } from '../db'

// Plain Levenshtein edit distance — no new dependency needed for something this
// small. Used to catch likely TYPOS between what's actually tagged in a session's
// UTM params and what an ad platform's own campaign name is, distinct from the
// funnel breakdown's existing exact-after-normalization "matched" flag (Step 27
// era) — that flag already tells you when something's unmatched; this tries to
// tell you WHY, when it's a near-miss rather than a totally different name.
export function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 0; j <= b.length; j++) dp[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1])
    }
  }
  return dp[a.length][b.length]
}

const normalizeSource = (s: string | null) => (s ?? '').trim().toLowerCase().replace(/_ads$/, '')
const normalizeCampaign = (s: string | null) => (s ?? '').trim().toLowerCase()

export interface UtmMismatch {
  sessionCampaign: string
  platform: string
  closestAdCostsCampaign: string
  editDistance: number
}

// Only flags a near-miss (edit distance 1-3, i.e. plausibly a typo) that has NO
// exact match already — an exact match means the funnel breakdown already
// resolves this row correctly, nothing to flag. Distance 0 would BE an exact
// match and can't reach here since exact matches are filtered out first.
const MAX_EDIT_DISTANCE = 3

export async function findUtmMismatches(clientId: string): Promise<UtmMismatch[]> {
  const [sessionRows, adCostRows] = await Promise.all([
    db.query<{ utm_source: string | null; utm_campaign: string | null }>(
      `SELECT DISTINCT utm_source, utm_campaign FROM sessions
       WHERE client_id = $1 AND utm_campaign IS NOT NULL AND started_at >= NOW() - INTERVAL '90 days'`,
      [clientId]
    ),
    db.query<{ platform: string; campaign_name: string | null }>(
      `SELECT DISTINCT platform, campaign_name FROM ad_costs
       WHERE client_id = $1 AND campaign_name IS NOT NULL AND date >= CURRENT_DATE - INTERVAL '90 days'`,
      [clientId]
    ),
  ])

  const adCostsByPlatform = new Map<string, string[]>()
  for (const r of adCostRows.rows) {
    const platform = normalizeSource(r.platform)
    if (!adCostsByPlatform.has(platform)) adCostsByPlatform.set(platform, [])
    adCostsByPlatform.get(platform)!.push(r.campaign_name!)
  }

  const mismatches: UtmMismatch[] = []
  for (const s of sessionRows.rows) {
    const platform = normalizeSource(s.utm_source)
    const campaigns = adCostsByPlatform.get(platform)
    if (!campaigns || campaigns.length === 0) continue

    const sessionCampaignNorm = normalizeCampaign(s.utm_campaign)
    const hasExactMatch = campaigns.some((c) => normalizeCampaign(c) === sessionCampaignNorm)
    if (hasExactMatch) continue

    let closest: { name: string; distance: number } | null = null
    for (const c of campaigns) {
      const distance = levenshtein(sessionCampaignNorm, normalizeCampaign(c))
      if (closest === null || distance < closest.distance) closest = { name: c, distance }
    }

    if (closest && closest.distance > 0 && closest.distance <= MAX_EDIT_DISTANCE) {
      mismatches.push({
        sessionCampaign: s.utm_campaign!,
        platform: s.utm_source ?? platform,
        closestAdCostsCampaign: closest.name,
        editDistance: closest.distance,
      })
    }
  }

  return mismatches.sort((a, b) => a.editDistance - b.editDistance)
}
