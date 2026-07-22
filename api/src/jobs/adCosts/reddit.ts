import { AdCostRow } from './types'

// Unverified against a live account — same disclosure as tiktok.ts/snapchat.ts/
// pinterest.ts/linkedin.ts.
interface RedditReportRow {
  ad_id: string
  date: string
  metrics: { spend?: number; impressions?: number; clicks?: number }
}

interface RedditReportResponse {
  data?: RedditReportRow[]
}

interface RedditCopy {
  headline: string | null
  primaryText: string | null
  description: string | null
  landingPageUrl: string | null
}

const EMPTY_COPY: RedditCopy = { headline: null, primaryText: null, description: null, landingPageUrl: null }

interface RedditAdEntity {
  id: string
  click_url?: string
  post_id?: string
}

interface RedditAdResponse {
  data?: RedditAdEntity
}

interface RedditPostEntity {
  id: string
  title?: string
  body?: string
}

interface RedditPostResponse {
  data?: RedditPostEntity
}

// A Reddit ad references a Post (what's actually shown to users) — the ad itself only
// carries the destination click_url, the visible title/body text lives on the Post.
// Two-hop, per ad, same sequential trade-off as facebook.ts/snapchat.ts/linkedin.ts
// (no documented bulk-by-ids fetch for either entity). `title` maps to headline
// (Reddit ad units are headline-first, similar to a link post) and `body` (only
// present on text posts, not link posts) maps to primaryText; Reddit has no separate
// description field, so that one stays null.
async function fetchRedditCopy(accessToken: string, accountId: string, adId: string): Promise<RedditCopy> {
  const adRes = await fetch(`https://ads-api.reddit.com/api/v2.0/ad_accounts/${accountId}/ads/${adId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!adRes.ok) return EMPTY_COPY
  const adBody = (await adRes.json()) as RedditAdResponse
  const ad = adBody.data
  if (!ad) return EMPTY_COPY

  let headline: string | null = null
  let primaryText: string | null = null
  if (ad.post_id) {
    const postRes = await fetch(`https://ads-api.reddit.com/api/v2.0/ad_accounts/${accountId}/posts/${ad.post_id}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (postRes.ok) {
      const postBody = (await postRes.json()) as RedditPostResponse
      headline = postBody.data?.title ?? null
      primaryText = postBody.data?.body ?? null
    }
  }

  return { headline, primaryText, description: null, landingPageUrl: ad.click_url ?? null }
}

export async function fetchRedditAdCosts(
  accessToken: string,
  accountId: string,
  since: string,
  until: string
): Promise<AdCostRow[]> {
  const params = new URLSearchParams({
    starts_at: `${since}T00:00:00Z`,
    ends_at: `${until}T23:59:59Z`,
    breakdown: 'ad_id',
    'metrics.spend': 'true',
    'metrics.impressions': 'true',
    'metrics.clicks': 'true',
  })

  const res = await fetch(`https://ads-api.reddit.com/api/v2.0/ad_accounts/${accountId}/reports?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Reddit ads report request failed (${res.status}): ${text}`)
  }

  const body = (await res.json()) as RedditReportResponse
  const rows: AdCostRow[] = []

  for (const r of body.data ?? []) {
    rows.push({
      date: r.date.slice(0, 10),
      campaign_id: null,
      campaign_name: null,
      adset_id: null,
      adset_name: null,
      ad_id: r.ad_id,
      ad_name: null,
      // Reddit reports spend in hundredths of a cent (micro-currency units).
      spend: (r.metrics.spend ?? 0) / 1_000_000,
      impressions: r.metrics.impressions ?? 0,
      clicks: r.metrics.clicks ?? 0,
    })
  }

  const uniqueAdIds = Array.from(new Set(rows.map((r) => r.ad_id)))
  const copyByAdId = new Map<string, RedditCopy>()
  for (const adId of uniqueAdIds) {
    try {
      copyByAdId.set(adId, await fetchRedditCopy(accessToken, accountId, adId))
    } catch {
      copyByAdId.set(adId, EMPTY_COPY)
    }
  }
  for (const row of rows) {
    const copy = copyByAdId.get(row.ad_id) ?? EMPTY_COPY
    row.creative_headline = copy.headline
    row.creative_primary_text = copy.primaryText
    row.creative_description = copy.description
    row.creative_landing_page_url = copy.landingPageUrl
  }

  return rows
}
