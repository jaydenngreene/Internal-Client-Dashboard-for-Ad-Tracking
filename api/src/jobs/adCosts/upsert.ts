import { db } from '../../db'
import { AdCostRow } from './types'

export async function upsertAdCosts(clientId: string, platform: string, rows: AdCostRow[]): Promise<void> {
  for (const row of rows) {
    await db.query(
      `INSERT INTO ad_costs
         (client_id, platform, campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name, date, spend, impressions, clicks,
          creative_thumbnail_url, creative_asset_url, creative_type,
          creative_headline, creative_primary_text, creative_description, creative_landing_page_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
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
         creative_landing_page_url = EXCLUDED.creative_landing_page_url`,
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
        row.spend,
        row.impressions,
        row.clicks,
        row.creative_thumbnail_url ?? null,
        row.creative_asset_url ?? null,
        row.creative_type ?? null,
        row.creative_headline ?? null,
        row.creative_primary_text ?? null,
        row.creative_description ?? null,
        row.creative_landing_page_url ?? null,
      ]
    )
  }
}
