import { db } from '../db'
import { fetchAdObjectFallback } from '../jobs/adCosts/facebook'
import { upsertAdCosts } from '../jobs/adCosts/upsert'

function isFacebookAdId(value: string): boolean {
  return /^\d{10,20}$/.test(value)
}

// docs/ISSUE_LOG.md "Proposed enhancements" (2026-07-26). Called from a report
// route when a purchase/session's ad_id has no ad_costs row at all — recovers
// the real name/creative via a direct ad-object lookup instead of showing the
// raw numeric id. Writes a $0-spend ad_costs row on success so this is a
// one-time live API call per ad_id, not one per report page load; the routine
// Insights sync will overwrite it with real spend once the ad actually starts
// reporting there. Returns nothing — callers re-query ad_costs by ad_id
// afterward, same as they would for a normally-synced row.
export async function resolveAdObjectFallback(clientId: string, adId: string): Promise<void> {
  if (!isFacebookAdId(adId)) return // only Meta has this dual Insights/ad-object API split; not worth a network call for anything else

  const { rows: existing } = await db.query<{ id: string }>(
    `SELECT id FROM ad_costs WHERE client_id = $1 AND ad_id = $2 LIMIT 1`,
    [clientId, adId]
  )
  if (existing.length > 0) return // already synced, or already cached by a prior fallback call

  const { rows: integrationRows } = await db.query<{ config: { access_token?: string } }>(
    `SELECT config FROM client_integrations WHERE client_id = $1 AND platform = 'facebook_ads' LIMIT 1`,
    [clientId]
  )
  const accessToken = integrationRows[0]?.config?.access_token
  if (!accessToken) return // no Facebook integration configured for this client, nothing to fall back to

  let result
  try {
    result = await fetchAdObjectFallback(accessToken, adId)
  } catch (err) {
    console.error(`[adObjectFallback] lookup failed for ad_id=${adId}:`, (err as Error).message)
    return
  }
  if (!result) return // deleted, or any other failure — caller's existing raw-id display stands

  const today = new Date().toISOString().slice(0, 10)
  await upsertAdCosts(clientId, 'facebook_ads', [
    {
      date: today,
      campaign_id: result.campaign_id,
      campaign_name: result.campaign_name,
      adset_id: result.adset_id,
      adset_name: result.adset_name,
      ad_id: adId,
      ad_name: result.ad_name,
      spend: 0,
      impressions: 0,
      clicks: 0,
      creative_thumbnail_url: result.creative.thumbnailUrl,
      creative_asset_url: result.creative.assetUrl,
      creative_type: result.creative.assetType,
      creative_headline: result.creative.headline,
      creative_primary_text: result.creative.primaryText,
      creative_description: result.creative.description,
      creative_landing_page_url: result.creative.landingPageUrl,
    },
  ])
}
