import { AdCostRow, AdBreakdownRow } from './types'

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
  // Meta computes this directly (impressions/reach) per requested row — Phase 1
  // creative-fatigue guardrails (2026-07-27) watch it for audience over-exposure.
  frequency?: string
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
    object_story_spec?: {
      link_data?: { link?: string; message?: string; name?: string; description?: string }
      // Video and photo-only ads (as opposed to standard link ads) carry their copy
      // and landing page under these siblings of link_data instead — a video ad's
      // object_story_spec never populates link_data at all, which is why creatives
      // like this were showing up with no landing page and copy silently falling
      // back to the older top-level title/body fields.
      video_data?: { title?: string; message?: string; call_to_action?: { value?: { link?: string } } }
      photo_data?: { caption?: string; call_to_action?: { value?: { link?: string } } }
    }
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
  if (!res.ok || body.error) {
    // Logged rather than silently swallowed — a missing video source falls back to
    // rendering the (much lower-resolution) static thumbnail in the dashboard, which
    // looks like a rendering bug but is actually this request failing upstream, most
    // often a permissions gap on the token rather than anything wrong in this app.
    console.error(`[facebook] video source fetch failed for ${videoId}:`, body.error?.message ?? res.statusText)
    return null
  }
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
// Shared by fetchCreativeInfo (Insights-side enrichment, run per unique ad_id
// after a sync) and fetchAdObjectFallback (Step "ad-object-fallback" — recovers
// a creative with zero Insights data at all) so both go through the same
// video/link/photo field-precedence logic instead of drifting apart.
async function parseCreative(accessToken: string, creative: FacebookAdCreativeResponse['creative']): Promise<FacebookCreative> {
  if (!creative) return EMPTY_CREATIVE
  const linkData = creative.object_story_spec?.link_data
  const videoData = creative.object_story_spec?.video_data
  const photoData = creative.object_story_spec?.photo_data
  const copy = {
    headline: linkData?.name ?? videoData?.title ?? creative.title ?? null,
    primaryText: linkData?.message ?? videoData?.message ?? photoData?.caption ?? creative.body ?? null,
    description: linkData?.description ?? null,
    landingPageUrl: linkData?.link ?? videoData?.call_to_action?.value?.link ?? photoData?.call_to_action?.value?.link ?? null,
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

async function fetchCreativeInfo(accessToken: string, adId: string): Promise<FacebookCreative> {
  const url =
    `https://graph.facebook.com/${GRAPH_VERSION}/${adId}` +
    `?fields=${encodeURIComponent(
      'creative{image_url,thumbnail_url,object_type,video_id,title,body,' +
        'object_story_spec{link_data{link,message,name,description},' +
        'video_data{title,message,call_to_action},photo_data{caption,call_to_action}}}'
    )}` +
    `&access_token=${encodeURIComponent(accessToken)}`
  const res = await fetch(url)
  const body = (await res.json()) as FacebookAdCreativeResponse
  if (!res.ok || body.error || !body.creative) {
    return EMPTY_CREATIVE
  }
  return parseCreative(accessToken, body.creative)
}

interface FacebookAdObjectResponse {
  name?: string
  campaign?: { id?: string; name?: string }
  adset?: { id?: string; name?: string }
  creative?: FacebookAdCreativeResponse['creative']
  error?: { message: string; type?: string; code?: number; error_subcode?: number }
}

export interface AdObjectFallback {
  ad_name: string | null
  campaign_id: string | null
  campaign_name: string | null
  adset_id: string | null
  adset_name: string | null
  creative: FacebookCreative
}

// docs/ISSUE_LOG.md "Proposed enhancements" (2026-07-26): the Insights API only
// returns a row for an ad+date with actual measurable delivery, so a brand-new
// ad (not yet synced) or a paused ad (Insights stopped reporting it) resolves to
// nothing there even though the ad object itself still exists. This hits the ad
// object endpoint directly instead — same fields fetchCreativeInfo already pulls
// for enrichment, plus name/campaign/adset since there's no Insights row here to
// supply those.
//
// Confirmed limit, tested live against a genuinely deleted ad_id
// (120249034033030253, error_subcode 33 "does not exist"): this does NOT recover
// a fully-deleted ad — that 400s here exactly like it does on Insights. Returns
// null for that case (and any other failure) so the caller falls back to its
// existing raw-ad_id display; only returns non-null for the "not yet synced" /
// "paused and dropped from Insights" case this is actually meant to fix.
export async function fetchAdObjectFallback(accessToken: string, adId: string): Promise<AdObjectFallback | null> {
  const url =
    `https://graph.facebook.com/${GRAPH_VERSION}/${adId}` +
    `?fields=${encodeURIComponent(
      'name,campaign{id,name},adset{id,name},' +
        'creative{image_url,thumbnail_url,object_type,video_id,title,body,' +
        'object_story_spec{link_data{link,message,name,description},' +
        'video_data{title,message,call_to_action},photo_data{caption,call_to_action}}}'
    )}` +
    `&access_token=${encodeURIComponent(accessToken)}`
  const res = await fetch(url)
  const body = (await res.json()) as FacebookAdObjectResponse
  if (!res.ok || body.error) {
    return null
  }
  const creative = await parseCreative(accessToken, body.creative)
  return {
    ad_name: body.name ?? null,
    campaign_id: body.campaign?.id ?? null,
    campaign_name: body.campaign?.name ?? null,
    adset_id: body.adset?.id ?? null,
    adset_name: body.adset?.name ?? null,
    creative,
  }
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
      'campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend,impressions,clicks,frequency,' +
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
        frequency: r.frequency ? parseFloat(r.frequency) : null,
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

interface FacebookBreakdownRow {
  campaign_id?: string
  campaign_name?: string
  ad_id: string
  ad_name?: string
  date_start: string
  age?: string
  gender?: string
  platform_position?: string
  actions?: FacebookActionValue[]
}

interface FacebookBreakdownResponse {
  data: FacebookBreakdownRow[]
  paging?: { cursors?: { after?: string }; next?: string }
  error?: { message: string; type: string; code: number }
}

// Meta reports pixel purchases under 'omni_purchase' (web+app+offline combined
// — what Ads Manager's own "Results" column uses for a purchase-objective
// campaign) whenever it's present; older/pixel-only setups only ever populate
// the narrower 'offsite_conversion.fb_pixel_purchase' action instead. Falls
// back to that only when omni_purchase never shows up in the row at all —
// never summed together with it, which would double-count the same purchase
// under both action types.
function purchaseCount(actions?: FacebookActionValue[]): number {
  if (!actions || actions.length === 0) return 0
  const omni = actions.find((a) => a.action_type === 'omni_purchase')
  if (omni) return parseInt(omni.value, 10) || 0
  const pixel = actions.find((a) => a.action_type === 'offsite_conversion.fb_pixel_purchase')
  return pixel ? parseInt(pixel.value, 10) || 0 : 0
}

// The `breakdowns` query param sent to Meta — NOT the same as the value read
// back off each row. `platform_position` is rejected as a standalone
// breakdown (confirmed live, 2026-08-06: error #100 "Current combination of
// data breakdown columns (action_type, platform_position) is invalid") — it
// must always be requested alongside `publisher_platform`, even though only
// platform_position's own value ends up stored (its values already read as
// the platform, e.g. "instagram_reels", "facebook_reels" — publisher_platform
// itself is fetched but discarded). age/gender have no such restriction.
const BREAKDOWN_QUERY_PARAM: Record<AdBreakdownRow['breakdown_type'], string> = {
  age: 'age',
  gender: 'gender',
  placement: 'publisher_platform,platform_position',
}

// Ad Breakdown tab (2026-08-04): purchase counts per ad per day, split by one
// dimension at a time — never crossed into one age x gender x placement
// matrix, which would multiply row volume combinatorially for no benefit here
// (the dashboard tab shows each dimension separately via its own toggle, so a
// single-dimension breakdown is all it ever needs).
async function fetchFacebookBreakdown(
  accessToken: string,
  adAccountId: string,
  since: string,
  until: string,
  type: AdBreakdownRow['breakdown_type']
): Promise<AdBreakdownRow[]> {
  const rows: AdBreakdownRow[] = []
  const account = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`

  let url: string | null =
    `https://graph.facebook.com/${GRAPH_VERSION}/${account}/insights` +
    `?level=ad&time_increment=1` +
    `&time_range=${encodeURIComponent(JSON.stringify({ since, until }))}` +
    `&breakdowns=${BREAKDOWN_QUERY_PARAM[type]}` +
    `&fields=${encodeURIComponent('campaign_id,campaign_name,ad_id,ad_name,actions')}` +
    `&limit=500` +
    `&access_token=${encodeURIComponent(accessToken)}`

  while (url) {
    const res = await fetch(url)
    const body = (await res.json()) as FacebookBreakdownResponse

    if (!res.ok || body.error) {
      throw new Error(`Facebook ${type} breakdown request failed: ${body.error?.message ?? res.statusText}`)
    }

    for (const r of body.data) {
      const value = (type === 'age' ? r.age : type === 'gender' ? r.gender : r.platform_position) ?? 'unknown'
      rows.push({
        date: r.date_start,
        campaign_id: r.campaign_id ?? null,
        campaign_name: r.campaign_name ?? null,
        ad_id: r.ad_id,
        ad_name: r.ad_name ?? null,
        breakdown_type: type,
        breakdown_value: value,
        purchases: purchaseCount(r.actions),
      })
    }

    url = body.paging?.next ?? null
  }

  return rows
}

// Three separate single-dimension requests, sequential — same deliberately
// conservative-against-rate-limits reasoning as the per-ad creative lookups in
// fetchFacebookAdCosts above, not run in parallel. Each dimension is caught
// independently (2026-08-06 fix): the original version awaited all three into
// one array and returned it in a single statement, so one dimension throwing
// (platform_position's #100 error) discarded the other two dimensions' already-
// fetched rows too, along with the exception silently getting swallowed by
// runAdCostSync's per-integration try/catch — the sync job kept reporting
// "success" while ad_breakdowns stayed completely empty for every client.
export async function fetchFacebookAdBreakdowns(
  accessToken: string,
  adAccountId: string,
  since: string,
  until: string
): Promise<AdBreakdownRow[]> {
  const rows: AdBreakdownRow[] = []
  for (const type of ['age', 'gender', 'placement'] as const) {
    try {
      rows.push(...(await fetchFacebookBreakdown(accessToken, adAccountId, since, until, type)))
    } catch (err) {
      console.error(`[facebook] ${type} breakdown fetch failed:`, (err as Error).message)
    }
  }
  return rows
}
