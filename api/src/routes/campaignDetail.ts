import { FastifyInstance } from 'fastify'
import { db } from '../db'
import { computeTrueProfit, MarginConfig } from '../lib/margin'

async function getMarginConfig(clientId: string): Promise<MarginConfig | null> {
  const { rows } = await db.query<MarginConfig>(
    `SELECT cogs_percent, payment_fee_percent, fulfillment_cost_flat FROM clients WHERE id = $1`,
    [clientId]
  )
  return rows[0] ?? null
}

// A client's ad URLs can carry Meta's dynamic {{campaign.id}}/{{ad.id}} tokens
// in utm_campaign/utm_content instead of {{campaign.name}}/{{ad.name}} -
// confirmed live (see reports.ts's funnel breakdown, which already handles
// this for the Campaigns list). This page's queries all matched by name only,
// so a client in that situation saw the list page count purchases correctly
// (post-fix) but the drill-down page it links to show zero - name-matching a
// URL param built from the display name against a session whose utm_campaign
// is actually the raw id. Resolving the real id up front lets every query
// below match on EITHER, the same fallback the list page already has.
async function resolveCampaignId(clientId: string, platform: string, campaignName: string): Promise<string | null> {
  const { rows } = await db.query<{ campaign_id: string | null }>(
    `SELECT campaign_id FROM ad_costs
     WHERE client_id = $1
       AND LOWER(REGEXP_REPLACE(platform, '_ads$', '')) = LOWER(REGEXP_REPLACE($2, '_ads$', ''))
       AND LOWER(TRIM(campaign_name)) = LOWER(TRIM($3))
       AND campaign_id IS NOT NULL
     LIMIT 1`,
    [clientId, platform, campaignName]
  )
  return rows[0]?.campaign_id ?? null
}

async function resolveAdId(
  clientId: string,
  platform: string,
  campaignName: string,
  creativeName: string
): Promise<string | null> {
  const { rows } = await db.query<{ ad_id: string | null }>(
    `SELECT ad_id FROM ad_costs
     WHERE client_id = $1
       AND LOWER(REGEXP_REPLACE(platform, '_ads$', '')) = LOWER(REGEXP_REPLACE($2, '_ads$', ''))
       AND LOWER(TRIM(campaign_name)) = LOWER(TRIM($3))
       AND LOWER(TRIM(ad_name)) = LOWER(TRIM($4))
       AND ad_id IS NOT NULL
     LIMIT 1`,
    [clientId, platform, campaignName, creativeName]
  )
  return rows[0]?.ad_id ?? null
}

function defaultRange(from?: string, to?: string): { from: string; to: string } {
  if (from && to) return { from, to }
  const toDate = new Date()
  const fromDate = new Date(toDate)
  fromDate.setUTCDate(fromDate.getUTCDate() - 29)
  return { from: fromDate.toISOString().slice(0, 10), to: toDate.toISOString().slice(0, 10) }
}

interface RangeQuery {
  from?: string
  to?: string
}

interface CampaignParams {
  id: string
  platform: string
  campaignName: string
}

interface CreativeParams extends CampaignParams {
  creativeName: string
}

// Campaign/creative drill-down (a client running the same campaign name on multiple
// platforms, or multiple campaigns on the same platform, needs its OWN page, not a
// blended row) — reuses the same platform/campaign-name matching convention as
// reports.ts's funnel breakdown (strip a trailing "_ads", lowercase+trim both sides)
// but as self-contained queries scoped to one campaign, since the funnel route's own
// getSpendByCampaign/getSpendByCreative functions return every campaign/creative for
// the whole client with no per-row scoping hook to reuse.
export async function campaignDetailRoutes(app: FastifyInstance) {
  app.get<{ Params: CampaignParams; Querystring: RangeQuery }>(
    '/clients/:id/campaigns/:platform/:campaignName',
    async (req, reply) => {
      const { id: clientId, platform, campaignName } = req.params
      const { from, to } = defaultRange(req.query.from, req.query.to)
      const campaignId = await resolveCampaignId(clientId, platform, campaignName)

      const { rows: kpiRows } = await db.query<{ cost: string; impressions: string; clicks: string }>(
        `SELECT COALESCE(SUM(spend), 0) AS cost, COALESCE(SUM(impressions), 0) AS impressions, COALESCE(SUM(clicks), 0) AS clicks
         FROM ad_costs
         WHERE client_id = $1 AND date BETWEEN $2 AND $3
           AND LOWER(REGEXP_REPLACE(platform, '_ads$', '')) = LOWER(REGEXP_REPLACE($4, '_ads$', ''))
           AND LOWER(TRIM(campaign_name)) = LOWER(TRIM($5))`,
        [clientId, from, to, platform, campaignName]
      )
      const { rows: leadRows } = await db.query<{ leads: string }>(
        `SELECT COUNT(DISTINCT l.id) AS leads
         FROM leads l
         JOIN identities i ON i.client_id = l.client_id AND i.email = l.email
         JOIN LATERAL (
           SELECT utm_source, utm_campaign FROM sessions
           WHERE visitor_id = i.visitor_id AND started_at <= l.created_at AND started_at >= l.created_at - INTERVAL '90 days'
           ORDER BY started_at ASC LIMIT 1
         ) s ON true
         WHERE l.client_id = $1 AND l.created_at::date BETWEEN $2 AND $3
           AND LOWER(REGEXP_REPLACE(s.utm_source, '_ads$', '')) = LOWER(REGEXP_REPLACE($4, '_ads$', ''))
           AND (LOWER(TRIM(s.utm_campaign)) = LOWER(TRIM($5)) OR ($6::text IS NOT NULL AND s.utm_campaign = $6))`,
        [clientId, from, to, platform, campaignName, campaignId]
      )
      const { rows: revRows } = await db.query<{ revenue: string; sales: string }>(
        `SELECT COALESCE(SUM(a.attributed_revenue), 0) AS revenue, COUNT(DISTINCT a.purchase_id) AS sales
         FROM attributions a
         JOIN sessions s ON s.id = a.session_id
         JOIN purchases p ON p.id = a.purchase_id
         WHERE a.client_id = $1 AND p.purchased_at::date BETWEEN $2 AND $3
           AND LOWER(REGEXP_REPLACE(s.utm_source, '_ads$', '')) = LOWER(REGEXP_REPLACE($4, '_ads$', ''))
           AND (LOWER(TRIM(s.utm_campaign)) = LOWER(TRIM($5)) OR ($6::text IS NOT NULL AND s.utm_campaign = $6))`,
        [clientId, from, to, platform, campaignName, campaignId]
      )

      const cost = parseFloat(kpiRows[0].cost)
      const impressions = parseInt(kpiRows[0].impressions, 10)
      const clicks = parseInt(kpiRows[0].clicks, 10)
      const leads = parseInt(leadRows[0].leads, 10)
      const revenue = parseFloat(revRows[0].revenue)
      const sales = parseInt(revRows[0].sales, 10)
      const marginConfig = await getMarginConfig(clientId)
      const { trueProfit } = computeTrueProfit(marginConfig, revenue, cost, sales)

      // Creative rows within this one campaign — spend side carries the real ad asset
      // columns (populated only where an ad-cost-sync fetcher pulls them; Facebook first,
      // null elsewhere until those fetchers are extended the same way), lead/revenue side
      // matches by utm_content the same way the funnel breakdown's creative mode already
      // does, additionally scoped to this campaign+platform so a same-named creative in a
      // DIFFERENT campaign doesn't bleed into this one's list.
      const { rows: creativeSpendRows } = await db.query<{
        ad_id: string | null
        ad_name: string | null
        cost: string
        impressions: string
        clicks: string
        creative_thumbnail_url: string | null
        creative_asset_url: string | null
        creative_type: string | null
      }>(
        `SELECT ad_id, ad_name, SUM(spend) AS cost, SUM(impressions) AS impressions, SUM(clicks) AS clicks,
                MAX(creative_thumbnail_url) AS creative_thumbnail_url,
                MAX(creative_asset_url) AS creative_asset_url,
                MAX(creative_type) AS creative_type
         FROM ad_costs
         WHERE client_id = $1 AND date BETWEEN $2 AND $3
           AND LOWER(REGEXP_REPLACE(platform, '_ads$', '')) = LOWER(REGEXP_REPLACE($4, '_ads$', ''))
           AND LOWER(TRIM(campaign_name)) = LOWER(TRIM($5))
         GROUP BY ad_id, ad_name`,
        [clientId, from, to, platform, campaignName]
      )
      const { rows: creativeLeadRows } = await db.query<{ utm_content: string | null; leads: string }>(
        `SELECT s.utm_content, COUNT(DISTINCT l.id) AS leads
         FROM leads l
         JOIN identities i ON i.client_id = l.client_id AND i.email = l.email
         JOIN LATERAL (
           SELECT utm_content, utm_source, utm_campaign FROM sessions
           WHERE visitor_id = i.visitor_id AND started_at <= l.created_at AND started_at >= l.created_at - INTERVAL '90 days'
           ORDER BY started_at ASC LIMIT 1
         ) s ON true
         WHERE l.client_id = $1 AND l.created_at::date BETWEEN $2 AND $3
           AND LOWER(REGEXP_REPLACE(s.utm_source, '_ads$', '')) = LOWER(REGEXP_REPLACE($4, '_ads$', ''))
           AND (LOWER(TRIM(s.utm_campaign)) = LOWER(TRIM($5)) OR ($6::text IS NOT NULL AND s.utm_campaign = $6))
         GROUP BY s.utm_content`,
        [clientId, from, to, platform, campaignName, campaignId]
      )
      const { rows: creativeRevRows } = await db.query<{ utm_content: string | null; revenue: string; sales: string }>(
        `SELECT s.utm_content, SUM(a.attributed_revenue) AS revenue, COUNT(DISTINCT a.purchase_id) AS sales
         FROM attributions a
         JOIN sessions s ON s.id = a.session_id
         JOIN purchases p ON p.id = a.purchase_id
         WHERE a.client_id = $1 AND p.purchased_at::date BETWEEN $2 AND $3
           AND LOWER(REGEXP_REPLACE(s.utm_source, '_ads$', '')) = LOWER(REGEXP_REPLACE($4, '_ads$', ''))
           AND (LOWER(TRIM(s.utm_campaign)) = LOWER(TRIM($5)) OR ($6::text IS NOT NULL AND s.utm_campaign = $6))
         GROUP BY s.utm_content`,
        [clientId, from, to, platform, campaignName, campaignId]
      )

      interface CreativeRow {
        name: string
        cost: number
        impressions: number
        clicks: number
        leads: number
        sales: number
        revenue: number
        thumbnailUrl: string | null
        assetUrl: string | null
        assetType: 'image' | 'video' | null
      }
      const creatives = new Map<string, CreativeRow>()
      // Same idIndex pattern as reports.ts's funnel breakdown: a client's ad
      // URLs can carry the raw ad_id in utm_content instead of the ad name, so
      // a lead/revenue row matched by id needs to land on the same object a
      // spend row registered by name - idIndex is lookup-only, never iterated,
      // so a row found through it can't get double-counted in the output below.
      const idIndex = new Map<string, CreativeRow>()
      const norm = (s: string | null) => (s ?? '').trim().toLowerCase()
      const getOrCreate = (name: string | null): CreativeRow => {
        const key = norm(name)
        let row = creatives.get(key)
        if (!row) {
          row = {
            name: name || '(unnamed creative)',
            cost: 0,
            impressions: 0,
            clicks: 0,
            leads: 0,
            sales: 0,
            revenue: 0,
            thumbnailUrl: null,
            assetUrl: null,
            assetType: null,
          }
          creatives.set(key, row)
        }
        return row
      }
      const findCreative = (name: string | null): CreativeRow | undefined =>
        creatives.get(norm(name)) ?? idIndex.get(norm(name))
      for (const r of creativeSpendRows) {
        const row = getOrCreate(r.ad_name)
        row.cost += parseFloat(r.cost)
        row.impressions += parseInt(r.impressions, 10)
        row.clicks += parseInt(r.clicks, 10)
        row.thumbnailUrl = r.creative_thumbnail_url
        row.assetUrl = r.creative_asset_url
        row.assetType = (r.creative_type as 'image' | 'video' | null) ?? null
        if (r.ad_id && norm(r.ad_id) !== norm(r.ad_name)) idIndex.set(norm(r.ad_id), row)
      }
      for (const r of creativeLeadRows) {
        if (!r.utm_content) continue
        const row = findCreative(r.utm_content) ?? getOrCreate(r.utm_content)
        row.leads += parseInt(r.leads, 10)
      }
      for (const r of creativeRevRows) {
        if (!r.utm_content) continue
        const row = findCreative(r.utm_content) ?? getOrCreate(r.utm_content)
        row.revenue += parseFloat(r.revenue)
        row.sales += parseInt(r.sales, 10)
      }

      const creativesOut = Array.from(creatives.values())
        .map((r) => ({
          ...r,
          cpl: r.leads > 0 ? r.cost / r.leads : null,
          roas: r.cost > 0 ? r.revenue / r.cost : null,
          cpm: r.impressions > 0 ? (r.cost / r.impressions) * 1000 : null,
          ctr: r.impressions > 0 ? (r.clicks / r.impressions) * 100 : null,
          matched: r.cost > 0,
        }))
        .sort((a, b) => b.revenue - a.revenue)

      return reply.send({
        platform,
        campaignName,
        from,
        to,
        kpis: {
          cost,
          impressions,
          clicks,
          leads,
          sales,
          revenue,
          profit: revenue - cost,
          trueProfit,
          roas: cost > 0 ? revenue / cost : null,
          cpl: leads > 0 ? cost / leads : null,
          cpm: impressions > 0 ? (cost / impressions) * 1000 : null,
          ctr: impressions > 0 ? (clicks / impressions) * 100 : null,
        },
        creatives: creativesOut,
      })
    }
  )

  app.get<{ Params: CreativeParams; Querystring: RangeQuery }>(
    '/clients/:id/campaigns/:platform/:campaignName/creatives/:creativeName',
    async (req, reply) => {
      const { id: clientId, platform, campaignName, creativeName } = req.params
      const { from, to } = defaultRange(req.query.from, req.query.to)
      const campaignId = await resolveCampaignId(clientId, platform, campaignName)
      const adId = await resolveAdId(clientId, platform, campaignName, creativeName)

      const { rows: assetRows } = await db.query<{
        creative_thumbnail_url: string | null
        creative_asset_url: string | null
        creative_type: string | null
        creative_headline: string | null
        creative_primary_text: string | null
        creative_description: string | null
        creative_landing_page_url: string | null
      }>(
        `SELECT creative_thumbnail_url, creative_asset_url, creative_type,
                creative_headline, creative_primary_text, creative_description, creative_landing_page_url
         FROM ad_costs
         WHERE client_id = $1
           AND LOWER(REGEXP_REPLACE(platform, '_ads$', '')) = LOWER(REGEXP_REPLACE($2, '_ads$', ''))
           AND LOWER(TRIM(campaign_name)) = LOWER(TRIM($3))
           AND LOWER(TRIM(ad_name)) = LOWER(TRIM($4))
           AND (creative_asset_url IS NOT NULL OR creative_thumbnail_url IS NOT NULL
                OR creative_headline IS NOT NULL OR creative_primary_text IS NOT NULL)
         ORDER BY date DESC
         LIMIT 1`,
        [clientId, platform, campaignName, creativeName]
      )

      const { rows: kpiRows } = await db.query<{ cost: string; impressions: string; clicks: string }>(
        `SELECT COALESCE(SUM(spend), 0) AS cost, COALESCE(SUM(impressions), 0) AS impressions, COALESCE(SUM(clicks), 0) AS clicks
         FROM ad_costs
         WHERE client_id = $1 AND date BETWEEN $2 AND $3
           AND LOWER(REGEXP_REPLACE(platform, '_ads$', '')) = LOWER(REGEXP_REPLACE($4, '_ads$', ''))
           AND LOWER(TRIM(campaign_name)) = LOWER(TRIM($5))
           AND LOWER(TRIM(ad_name)) = LOWER(TRIM($6))`,
        [clientId, from, to, platform, campaignName, creativeName]
      )

      // Video engagement (Step 42) — null across the board for image creatives and
      // every platform besides Facebook, same disclosure as the asset/copy fields.
      const { rows: videoRows } = await db.query<{
        video_plays: string | null
        video_p25_watched: string | null
        video_p50_watched: string | null
        video_p75_watched: string | null
        video_p100_watched: string | null
      }>(
        `SELECT SUM(video_plays) AS video_plays, SUM(video_p25_watched) AS video_p25_watched,
                SUM(video_p50_watched) AS video_p50_watched, SUM(video_p75_watched) AS video_p75_watched,
                SUM(video_p100_watched) AS video_p100_watched
         FROM ad_costs
         WHERE client_id = $1 AND date BETWEEN $2 AND $3
           AND LOWER(REGEXP_REPLACE(platform, '_ads$', '')) = LOWER(REGEXP_REPLACE($4, '_ads$', ''))
           AND LOWER(TRIM(campaign_name)) = LOWER(TRIM($5))
           AND LOWER(TRIM(ad_name)) = LOWER(TRIM($6))`,
        [clientId, from, to, platform, campaignName, creativeName]
      )
      const { rows: leadRows } = await db.query<{ leads: string }>(
        `SELECT COUNT(DISTINCT l.id) AS leads
         FROM leads l
         JOIN identities i ON i.client_id = l.client_id AND i.email = l.email
         JOIN LATERAL (
           SELECT utm_content, utm_source, utm_campaign FROM sessions
           WHERE visitor_id = i.visitor_id AND started_at <= l.created_at AND started_at >= l.created_at - INTERVAL '90 days'
           ORDER BY started_at ASC LIMIT 1
         ) s ON true
         WHERE l.client_id = $1 AND l.created_at::date BETWEEN $2 AND $3
           AND LOWER(REGEXP_REPLACE(s.utm_source, '_ads$', '')) = LOWER(REGEXP_REPLACE($4, '_ads$', ''))
           AND (LOWER(TRIM(s.utm_campaign)) = LOWER(TRIM($5)) OR ($7::text IS NOT NULL AND s.utm_campaign = $7))
           AND (LOWER(TRIM(s.utm_content)) = LOWER(TRIM($6)) OR ($8::text IS NOT NULL AND s.utm_content = $8))`,
        [clientId, from, to, platform, campaignName, creativeName, campaignId, adId]
      )
      const { rows: revRows } = await db.query<{ revenue: string; sales: string }>(
        `SELECT COALESCE(SUM(a.attributed_revenue), 0) AS revenue, COUNT(DISTINCT a.purchase_id) AS sales
         FROM attributions a
         JOIN sessions s ON s.id = a.session_id
         JOIN purchases p ON p.id = a.purchase_id
         WHERE a.client_id = $1 AND p.purchased_at::date BETWEEN $2 AND $3
           AND LOWER(REGEXP_REPLACE(s.utm_source, '_ads$', '')) = LOWER(REGEXP_REPLACE($4, '_ads$', ''))
           AND (LOWER(TRIM(s.utm_campaign)) = LOWER(TRIM($5)) OR ($7::text IS NOT NULL AND s.utm_campaign = $7))
           AND (LOWER(TRIM(s.utm_content)) = LOWER(TRIM($6)) OR ($8::text IS NOT NULL AND s.utm_content = $8))`,
        [clientId, from, to, platform, campaignName, creativeName, campaignId, adId]
      )

      // Which customers actually converted having seen this specific creative — the other
      // half of the customer-lifetime-journey link: the Leads page shows a customer's full
      // ad-touch history, this is the reverse direction (creative -> which customers it
      // touched), so a row here can deep-link straight into that customer's journey.
      const { rows: customerRows } = await db.query<{ email: string; purchased_at: string; revenue: string }>(
        `SELECT p.email, p.purchased_at, SUM(a.attributed_revenue) AS revenue
         FROM attributions a
         JOIN sessions s ON s.id = a.session_id
         JOIN purchases p ON p.id = a.purchase_id
         WHERE a.client_id = $1 AND p.purchased_at::date BETWEEN $2 AND $3
           AND LOWER(REGEXP_REPLACE(s.utm_source, '_ads$', '')) = LOWER(REGEXP_REPLACE($4, '_ads$', ''))
           AND (LOWER(TRIM(s.utm_campaign)) = LOWER(TRIM($5)) OR ($7::text IS NOT NULL AND s.utm_campaign = $7))
           AND (LOWER(TRIM(s.utm_content)) = LOWER(TRIM($6)) OR ($8::text IS NOT NULL AND s.utm_content = $8))
         GROUP BY p.email, p.purchased_at
         ORDER BY p.purchased_at DESC
         LIMIT 50`,
        [clientId, from, to, platform, campaignName, creativeName, campaignId, adId]
      )

      const cost = parseFloat(kpiRows[0].cost)
      const impressions = parseInt(kpiRows[0].impressions, 10)
      const clicks = parseInt(kpiRows[0].clicks, 10)
      const leads = parseInt(leadRows[0].leads, 10)
      const revenue = parseFloat(revRows[0].revenue)
      const sales = parseInt(revRows[0].sales, 10)
      const marginConfig = await getMarginConfig(clientId)
      const { trueProfit } = computeTrueProfit(marginConfig, revenue, cost, sales)

      const videoPlays = videoRows[0]?.video_plays ? parseInt(videoRows[0].video_plays, 10) : null
      const p25 = videoRows[0]?.video_p25_watched ? parseInt(videoRows[0].video_p25_watched, 10) : null
      const p50 = videoRows[0]?.video_p50_watched ? parseInt(videoRows[0].video_p50_watched, 10) : null
      const p75 = videoRows[0]?.video_p75_watched ? parseInt(videoRows[0].video_p75_watched, 10) : null
      const p100 = videoRows[0]?.video_p100_watched ? parseInt(videoRows[0].video_p100_watched, 10) : null
      // Hook rate: of everyone who SAW the ad, what fraction pressed play at all.
      // View-through rates: of everyone who started watching, what fraction reached
      // each quartile — the standard "completion funnel" framing, not "of impressions."
      const videoMetrics =
        videoPlays === null
          ? null
          : {
              plays: videoPlays,
              hookRate: impressions > 0 ? (videoPlays / impressions) * 100 : null,
              p25Rate: p25 !== null && videoPlays > 0 ? (p25 / videoPlays) * 100 : null,
              p50Rate: p50 !== null && videoPlays > 0 ? (p50 / videoPlays) * 100 : null,
              p75Rate: p75 !== null && videoPlays > 0 ? (p75 / videoPlays) * 100 : null,
              p100Rate: p100 !== null && videoPlays > 0 ? (p100 / videoPlays) * 100 : null,
            }

      return reply.send({
        platform,
        campaignName,
        creativeName,
        from,
        to,
        asset: {
          thumbnailUrl: assetRows[0]?.creative_thumbnail_url ?? null,
          assetUrl: assetRows[0]?.creative_asset_url ?? null,
          assetType: (assetRows[0]?.creative_type as 'image' | 'video' | null) ?? null,
        },
        videoMetrics,
        copy: {
          headline: assetRows[0]?.creative_headline ?? null,
          primaryText: assetRows[0]?.creative_primary_text ?? null,
          description: assetRows[0]?.creative_description ?? null,
          landingPageUrl: assetRows[0]?.creative_landing_page_url ?? null,
        },
        kpis: {
          cost,
          impressions,
          clicks,
          leads,
          sales,
          revenue,
          profit: revenue - cost,
          trueProfit,
          roas: cost > 0 ? revenue / cost : null,
          cpl: leads > 0 ? cost / leads : null,
          cpm: impressions > 0 ? (cost / impressions) * 1000 : null,
          ctr: impressions > 0 ? (clicks / impressions) * 100 : null,
        },
        customers: customerRows.map((r) => ({
          email: r.email,
          purchasedAt: r.purchased_at,
          revenue: parseFloat(r.revenue),
        })),
      })
    }
  )
}
