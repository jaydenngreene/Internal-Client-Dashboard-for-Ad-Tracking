import { db } from '../../db'
import { AdCostRow } from './types'
import { convertToBaseCurrency, getClientCurrency } from '../../lib/currency'

// Step 48 — an ad account has one fixed currency; declared by the user per
// integration (Settings), not detected dynamically per-request (would mean a
// different lookup per platform's own API shape for something that never
// changes). Missing entirely means "already in the client's base currency,"
// same as every other currency-optional field in this app.
async function getIntegrationCurrency(clientId: string, platform: string): Promise<string | null> {
  const { rows } = await db.query<{ currency: string | null }>(
    `SELECT config->>'currency' AS currency FROM client_integrations WHERE client_id = $1 AND platform = $2`,
    [clientId, platform]
  )
  return rows[0]?.currency ?? null
}

export async function upsertAdCosts(clientId: string, platform: string, rows: AdCostRow[]): Promise<void> {
  if (rows.length === 0) return

  const [baseCurrency, adAccountCurrency] = await Promise.all([
    getClientCurrency(clientId),
    getIntegrationCurrency(clientId, platform),
  ])

  for (const row of rows) {
    const spend = await convertToBaseCurrency(row.spend, adAccountCurrency, baseCurrency)
    await db.query(
      `INSERT INTO ad_costs
         (client_id, platform, campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name, date, spend, impressions, clicks,
          creative_thumbnail_url, creative_asset_url, creative_type,
          creative_headline, creative_primary_text, creative_description, creative_landing_page_url,
          video_plays, video_p25_watched, video_p50_watched, video_p75_watched, video_p100_watched)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)
       ON CONFLICT (client_id, platform, ad_id, date)
       DO UPDATE SET
         campaign_id               = EXCLUDED.campaign_id,
         campaign_name             = EXCLUDED.campaign_name,
         adset_id                  = EXCLUDED.adset_id,
         adset_name                = EXCLUDED.adset_name,
         ad_name                   = EXCLUDED.ad_name,
         spend                     = EXCLUDED.spend,
         impressions               = EXCLUDED.impressions,
         clicks                    = EXCLUDED.clicks,
         creative_thumbnail_url    = EXCLUDED.creative_thumbnail_url,
         creative_asset_url        = EXCLUDED.creative_asset_url,
         creative_type             = EXCLUDED.creative_type,
         creative_headline         = EXCLUDED.creative_headline,
         creative_primary_text     = EXCLUDED.creative_primary_text,
         creative_description      = EXCLUDED.creative_description,
         creative_landing_page_url = EXCLUDED.creative_landing_page_url,
         video_plays               = EXCLUDED.video_plays,
         video_p25_watched         = EXCLUDED.video_p25_watched,
         video_p50_watched         = EXCLUDED.video_p50_watched,
         video_p75_watched         = EXCLUDED.video_p75_watched,
         video_p100_watched        = EXCLUDED.video_p100_watched`,
      [
        clientId,
        platform,
        row.campaign_id,
        row.campaign_name,
        row.adset_id,
        row.adset_name,
        row.ad_id,
        row.ad_name,
        row.date,
        spend,
        row.impressions,
        row.clicks,
        row.creative_thumbnail_url ?? null,
        row.creative_asset_url ?? null,
        row.creative_type ?? null,
        row.creative_headline ?? null,
        row.creative_primary_text ?? null,
        row.creative_description ?? null,
        row.creative_landing_page_url ?? null,
        row.video_plays ?? null,
        row.video_p25_watched ?? null,
        row.video_p50_watched ?? null,
        row.video_p75_watched ?? null,
        row.video_p100_watched ?? null,
      ]
    )
  }
}
