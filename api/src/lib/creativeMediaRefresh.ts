import { db } from '../db'
import { fetchCreativeInfo } from '../jobs/adCosts/facebook'

// Meta's scontent/fbcdn media URLs are signed and die at the `oe` param (hex unix
// seconds), usually a few days after issue. ad_costs only re-pulls creatives for
// ads with spend in the trailing sync window, so paused/older ads keep dead links
// unless they're refreshed on view.
const EXPIRY_BUFFER_MS = 60 * 60 * 1000
const RETRY_AFTER_MS = 30 * 60 * 1000
const MAX_PER_REQUEST = 60
const CONCURRENCY = 6

const lastAttempt = new Map<string, number>()

export function fbCdnExpiry(url: string | null): number | null {
  if (!url) return null
  const match = url.match(/[?&]oe=([0-9A-Fa-f]+)/)
  return match ? parseInt(match[1], 16) * 1000 : null
}

function isStale(url: string | null, now: number): boolean {
  const expiry = fbCdnExpiry(url)
  return expiry !== null && expiry < now + EXPIRY_BUFFER_MS
}

interface MediaRow {
  ad_id: string
  creative_thumbnail_url: string | null
  creative_asset_url: string | null
  creative_type: string | null
}

export async function refreshCreativeMedia(clientId: string, adIds: (string | null)[]): Promise<void> {
  const ids = Array.from(new Set(adIds.filter((id): id is string => !!id && /^\d{10,20}$/.test(id))))
  if (ids.length === 0) return

  const now = Date.now()
  const { rows } = await db.query<MediaRow>(
    `SELECT DISTINCT ON (ad_id) ad_id, creative_thumbnail_url, creative_asset_url, creative_type
     FROM ad_costs
     WHERE client_id = $1 AND platform = 'facebook_ads' AND ad_id = ANY($2)
     ORDER BY ad_id, date DESC`,
    [clientId, ids]
  )
  const due = rows
    .filter((r) => {
      const needs =
        isStale(r.creative_thumbnail_url, now) ||
        isStale(r.creative_asset_url, now) ||
        (r.creative_type === 'video' && !r.creative_asset_url) ||
        (r.creative_type === null && !r.creative_asset_url)
      const key = `${clientId}:${r.ad_id}`
      return needs && now - (lastAttempt.get(key) ?? 0) > RETRY_AFTER_MS
    })
    .slice(0, MAX_PER_REQUEST)
  if (due.length === 0) return

  const { rows: integrationRows } = await db.query<{ config: { access_token?: string } }>(
    `SELECT config FROM client_integrations WHERE client_id = $1 AND platform = 'facebook_ads' LIMIT 1`,
    [clientId]
  )
  const accessToken = integrationRows[0]?.config?.access_token
  if (!accessToken) return

  const queue = [...due]
  const worker = async () => {
    for (let r = queue.shift(); r; r = queue.shift()) {
      lastAttempt.set(`${clientId}:${r.ad_id}`, Date.now())
      try {
        const creative = await fetchCreativeInfo(accessToken, r.ad_id)
        // A failed lookup comes back empty — never overwrite existing links with nulls.
        if (!creative.thumbnailUrl && !creative.assetUrl) continue
        await db.query(
          `UPDATE ad_costs
           SET creative_thumbnail_url = COALESCE($3, creative_thumbnail_url),
               creative_asset_url     = COALESCE($4, creative_asset_url),
               creative_type          = COALESCE($5, creative_type)
           WHERE client_id = $1 AND platform = 'facebook_ads' AND ad_id = $2`,
          [clientId, r.ad_id, creative.thumbnailUrl, creative.assetUrl, creative.assetType]
        )
      } catch (err) {
        console.error(`[creativeMediaRefresh] ad_id=${r.ad_id}:`, (err as Error).message)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, due.length) }, worker))
}
