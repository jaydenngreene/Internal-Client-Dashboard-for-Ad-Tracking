import { AdCostRow } from './types'

const GRAPH_VERSION = process.env.FB_GRAPH_API_VERSION ?? 'v21.0'

interface FacebookActionValue {
  action_type: string
  value: string
}

interface FacebookInsightRow {
  campaign_id?: string
  campaign_name?: string
  adset_id?: string
  adset_name?: string
  ad_id: string
  ad_name?: string
  spend?: string
  impressions?: string
  clicks?: string
  date_start: string
  // Video engagement (Step 42) — only present on rows for video creatives; each is
  // an array (usually one entry) rather than a scalar, same shape as Facebook's
  // conversion action fields elsewhere in this app.
  video_play_actions?: FacebookActionValue[]
  video_p25_watched_actions?: FacebookActionValue[]
  video_p50_watched_actions?: FacebookActionValue[]
  video_p75_watched_actions?: FacebookActionValue[]
  video_p100_watched_actions?: FacebookActionValue[]
}

function sumActionValues(actions?: FacebookActionValue[]): number | null {
  if (!actions || actions.length === 0) return null
  return actions.reduce((sum, a) => sum + (parseInt(a.value, 10) || 0), 0)
}

interface FacebookInsightsResponse {
  data: FacebookInsightRow[]
  paging?: { cursors?: { after?: string }; next?: string }
  error?: { message: string; type: string; code: number }
}

interface FacebookCreative {
  thumbnailUrl: string | null
  assetUrl: string | null
  assetType: 'image' | 'video' | null
  headline: string | null
  primaryText: string | null
  description: string | null
  landingPageUrl: string | null
}

interface FacebookAdCreativeResponse {
  creative?: {
    image_url?: string
    thumbnail_url?: string
    object_type?: string
    video_id?: string
    title?: string
    body?: string
    object_story_spec?: { link_data?: { link?: string; message?: string; name?: string; description?: string } }
  }
  error?: { message: string }
}

interface FacebookVideoResponse {
  source?: string
  error?: { message: string }
}

// A video's actual playable file lives behind its own node (a separate, signed CDN
// URL) — the ad's creative object only ever carries the video_id, never the source
// itself.
async function fetchVideoSource(accessToken: string, videoId: string): Promise<string | null> {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${videoId}?fields=source&access_token=${encodeURIComponent(accessToken)}`
  const res = await fetch(url)
  const body = (await res.json()) as FacebookVideoResponse
  if (!res.ok || body.error) return null
  return body.source ?? null
}

const EMPTY_CREATIVE: FacebookCreative = {
  thumbnailUrl: null,
  assetUrl: null,
  assetType: null,
  headline: null,
  primaryText: null,
  description: null,
  landingPageUrl: null,
}

// The ad-level insights endpoint (used below) has no creative/asset/copy fields at
// all — the actual image/video and the ad copy (headline/primary text/description/
// landing page) only come from a separate per-ad lookup. Not part of the insights
// response's pagination, so this runs once per unique ad_id after the spend rows are
// collected, not once per day-row (the creative itself doesn't change daily the way
// spend does). `title`/`body` are the older top-level creative fields; `name`/
// `message`/`description`/`link` under `object_story_spec.link_data` are how a
// standard link ad actually carries headline/primary-text/description/destination —
// preferred when present, falling back to the older fields otherwise.
async function fetchCreativeInfo(accessToken: string, adId: string): Promise<FacebookCreative> {
  const url =
    `https://graph.facebook.com/${GRAPH_VERSION}/${adId}` +
    `?fields=${encodeURIComponent(
      'creative{image_url,thumbnail_url,object_type,video_id,title,body,object_story_spec{link_data{link,message,name,description}}}'
    )}` +
    `&access_token=${encodeURIComponent(accessToken)}`
  const res = await fetch(url)
  const body = (await res.json()) as FacebookAdCreativeResponse
  if (!res.ok || body.error || !body.creative) {
    return EMPTY_CREATIVE
  }
  const { creative } = body
  const linkData = creative.object_story_spec?.link_data
  const copy = {
    headline: linkData?.name ?? creative.title ?? null,
    primaryText: linkData?.message ?? creative.body ?? null,
    description: linkData?.description ?? null,
    landingPageUrl: linkData?.link ?? null,
  }

  if (creative.video_id) {
    const source = await fetchVideoSource(accessToken, creative.video_id)
    return { thumbnailUrl: creative.thumbnail_url ?? creative.image_url ?? null, assetUrl: source, assetType: 'video', ...copy }
  }
  if (creative.image_url) {
    return { thumbnailUrl: creative.thumbnail_url ?? creative.image_url, assetUrl: creative.image_url, assetType: 'image', ...copy }
  }
  return { thumbnailUrl: creative.thumbnail_url ?? null, assetUrl: null, assetType: null, ...copy }
}

// Pulls ad-level spend/impressions/clicks for [since, until] (inclusive), one row per ad per day.
export async function fetchFacebookAdCosts(
  accessToken: string,
  adAccountId: string,
  since: string,
  until: string
): Promise<AdCostRow[]> {
  const rows: AdCostRow[] = []
  const account = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`

  let url: string | null =
    `https://graph.facebook.com/${GRAPH_VERSION}/${account}/insights` +
    `?level=ad&time_increment=1` +
    `&time_range=${encodeURIComponent(JSON.stringify({ since, until }))}` +
    `&fields=${encodeURIComponent(
      'campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend,impressions,clicks,' +
        'video_play_actions,video_p25_watched_actions,video_p50_watched_actions,video_p75_watched_actions,video_p100_watched_actions'
    )}` +
    `&limit=500` +
    `&access_token=${encodeURIComponent(accessToken)}`

  while (url) {
    const res = await fetch(url)
    const body = (await res.json()) as FacebookInsightsResponse

    if (!res.ok || body.error) {
      throw new Error(`Facebook insights request failed: ${body.error?.message ?? res.statusText}`)
    }

    for (const r of body.data) {
      rows.push({
        date: r.date_start,
        campaign_id: r.campaign_id ?? null,
        campaign_name: r.campaign_name ?? null,
        adset_id: r.adset_id ?? null,
        adset_name: r.adset_name ?? null,
        ad_id: r.ad_id,
        ad_name: r.ad_name ?? null,
        spend: parseFloat(r.spend ?? '0'),
        impressions: parseInt(r.impressions ?? '0', 10),
        clicks: parseInt(r.clicks ?? '0', 10),
        video_plays: sumActionValues(r.video_play_actions),
        video_p25_watched: sumActionValues(r.video_p25_watched_actions),
        video_p50_watched: sumActionValues(r.video_p50_watched_actions),
        video_p75_watched: sumActionValues(r.video_p75_watched_actions),
        video_p100_watched: sumActionValues(r.video_p100_watched_actions),
      })
    }

    url = body.paging?.next ?? null
  }

  // One extra lookup per unique ad (not per day-row) to attach the real creative asset.
  // Sequential rather than parallel — deliberately conservative against Facebook's
  // per-app rate limits rather than optimized for large accounts; a client with
  // hundreds of ads syncing every 6 hours (see lib/scheduler.ts) would want this
  // batched via Facebook's batch API instead, a bigger lift not needed for this
  // feature's first version.
  const uniqueAdIds = Array.from(new Set(rows.map((r) => r.ad_id)))
  const creativeByAdId = new Map<string, FacebookCreative>()
  for (const adId of uniqueAdIds) {
    try {
      creativeByAdId.set(adId, await fetchCreativeInfo(accessToken, adId))
    } catch {
      creativeByAdId.set(adId, EMPTY_CREATIVE)
    }
  }
  for (const row of rows) {
    const creative = creativeByAdId.get(row.ad_id)
    row.creative_thumbnail_url = creative?.thumbnailUrl ?? null
    row.creative_asset_url = creative?.assetUrl ?? null
    row.creative_type = creative?.assetType ?? null
    row.creative_headline = creative?.headline ?? null
    row.creative_primary_text = creative?.primaryText ?? null
    row.creative_description = creative?.description ?? null
    row.creative_landing_page_url = creative?.landingPageUrl ?? null
  }

  return rows
}
