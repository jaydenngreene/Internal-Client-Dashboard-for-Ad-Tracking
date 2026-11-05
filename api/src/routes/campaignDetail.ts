import { FastifyInstance } from 'fastify'
import { db } from '../db'
import { computeTrueProfit, MarginConfig } from '../lib/margin'
import { resolveAdObjectFallback } from '../lib/adObjectFallback'
import { refreshCreativeMedia } from '../lib/creativeMediaRefresh'

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

      // Blended numbers: every real (non-refunded) Shopify order in the range, not
      // just the ones a click could be traced to. Total store revenue is spread across
      // campaigns, ad sets and ads by each one's share of ad-traced sales, using one
      // store-wide factor (total / ad-traced). So everything adds back up to real
      // store revenue, and the account-level ROAS matches Overview's Blended ROAS.
      // "Ad-traced" = sessions from any ad platform this client has spend on.
      const { rows: storeRows } = await db.query<{ revenue: string; orders: string }>(
        `SELECT COALESCE(SUM(revenue), 0) AS revenue, COUNT(*) AS orders
         FROM purchases
         WHERE client_id = $1 AND purchased_at::date BETWEEN $2 AND $3 AND NOT COALESCE(refunded, false)`,
        [clientId, from, to]
      )
      const { rows: paidRows } = await db.query<{ revenue: string; sales: string }>(
        `SELECT COALESCE(SUM(a.attributed_revenue), 0) AS revenue, COUNT(DISTINCT a.purchase_id) AS sales
         FROM attributions a
         JOIN sessions s ON s.id = a.session_id
         JOIN purchases p ON p.id = a.purchase_id
         WHERE a.client_id = $1 AND p.purchased_at::date BETWEEN $2 AND $3
           AND LOWER(REGEXP_REPLACE(s.utm_source, '_ads$', '')) IN (
             SELECT DISTINCT LOWER(REGEXP_REPLACE(platform, '_ads$', '')) FROM ad_costs WHERE client_id = $1
           )`,
        [clientId, from, to]
      )
      const storeRevenue = parseFloat(storeRows[0].revenue)
      const storeOrders = parseInt(storeRows[0].orders, 10)
      const paidRevenue = parseFloat(paidRows[0].revenue)
      const paidSales = parseInt(paidRows[0].sales, 10)
      const revenueFactor = paidRevenue > 0 ? storeRevenue / paidRevenue : null
      const salesFactor = paidSales > 0 ? storeOrders / paidSales : null
      const blend = (rowRevenue: number, rowSales: number, rowCost: number) => {
        if (revenueFactor === null || salesFactor === null) {
          return { blendedRevenue: null, blendedSales: null, blendedTrueProfit: null, blendedRoas: null, blendedCostPerSale: null }
        }
        const blendedRevenue = rowRevenue * revenueFactor
        const blendedSales = rowSales * salesFactor
        return {
          blendedRevenue,
          blendedSales,
          blendedTrueProfit: computeTrueProfit(marginConfig, blendedRevenue, rowCost, Math.round(blendedSales)).trueProfit,
          blendedRoas: rowCost > 0 ? blendedRevenue / rowCost : null,
          blendedCostPerSale: blendedSales > 0 ? rowCost / blendedSales : null,
        }
      }

      // Creative rows within this one campaign — spend side carries the real ad asset
      // columns (populated only where an ad-cost-sync fetcher pulls them; Facebook first,
      // null elsewhere until those fetchers are extended the same way), lead/revenue side
      // matches by utm_content the same way the funnel breakdown's creative mode already
      // does, additionally scoped to this campaign+platform so a same-named creative in a
      // DIFFERENT campaign doesn't bleed into this one's list.
      const { rows: campaignAdIds } = await db.query<{ ad_id: string | null }>(
        `SELECT DISTINCT ad_id FROM ad_costs
         WHERE client_id = $1 AND date BETWEEN $2 AND $3
           AND LOWER(REGEXP_REPLACE(platform, '_ads$', '')) = LOWER(REGEXP_REPLACE($4, '_ads$', ''))
           AND LOWER(TRIM(campaign_name)) = LOWER(TRIM($5))`,
        [clientId, from, to, platform, campaignName]
      )
      await refreshCreativeMedia(clientId, campaignAdIds.map((r) => r.ad_id))
      const { rows: creativeSpendRows } = await db.query<{
        ad_id: string | null
        ad_name: string | null
        adset_id: string | null
        adset_name: string | null
        cost: string
        impressions: string
        clicks: string
        creative_thumbnail_url: string | null
        creative_asset_url: string | null
        creative_type: string | null
      }>(
        `SELECT ad_id, ad_name, adset_id, MAX(adset_name) AS adset_name,
                SUM(spend) AS cost, SUM(impressions) AS impressions, SUM(clicks) AS clicks,
                MAX(creative_thumbnail_url) AS creative_thumbnail_url,
                MAX(creative_asset_url) AS creative_asset_url,
                MAX(creative_type) AS creative_type
         FROM ad_costs
         WHERE client_id = $1 AND date BETWEEN $2 AND $3
           AND LOWER(REGEXP_REPLACE(platform, '_ads$', '')) = LOWER(REGEXP_REPLACE($4, '_ads$', ''))
           AND LOWER(TRIM(campaign_name)) = LOWER(TRIM($5))
         GROUP BY ad_id, ad_name, adset_id`,
        [clientId, from, to, platform, campaignName]
      )
      // utm_term carries the ad set ({{adset.id}} or {{adset.name}}) on Meta links,
      // so it's grouped alongside utm_content to credit each lead/sale to its ad set.
      const { rows: creativeLeadRows } = await db.query<{ utm_content: string | null; utm_term: string | null; leads: string }>(
        `SELECT s.utm_content, s.utm_term, COUNT(DISTINCT l.id) AS leads
         FROM leads l
         JOIN identities i ON i.client_id = l.client_id AND i.email = l.email
         JOIN LATERAL (
           SELECT utm_content, utm_term, utm_source, utm_campaign FROM sessions
           WHERE visitor_id = i.visitor_id AND started_at <= l.created_at AND started_at >= l.created_at - INTERVAL '90 days'
           ORDER BY started_at ASC LIMIT 1
         ) s ON true
         WHERE l.client_id = $1 AND l.created_at::date BETWEEN $2 AND $3
           AND LOWER(REGEXP_REPLACE(s.utm_source, '_ads$', '')) = LOWER(REGEXP_REPLACE($4, '_ads$', ''))
           AND (LOWER(TRIM(s.utm_campaign)) = LOWER(TRIM($5)) OR ($6::text IS NOT NULL AND s.utm_campaign = $6))
         GROUP BY s.utm_content, s.utm_term`,
        [clientId, from, to, platform, campaignName, campaignId]
      )
      const { rows: creativeRevRows } = await db.query<{ utm_content: string | null; utm_term: string | null; revenue: string; sales: string }>(
        `SELECT s.utm_content, s.utm_term, SUM(a.attributed_revenue) AS revenue, COUNT(DISTINCT a.purchase_id) AS sales
         FROM attributions a
         JOIN sessions s ON s.id = a.session_id
         JOIN purchases p ON p.id = a.purchase_id
         WHERE a.client_id = $1 AND p.purchased_at::date BETWEEN $2 AND $3
           AND LOWER(REGEXP_REPLACE(s.utm_source, '_ads$', '')) = LOWER(REGEXP_REPLACE($4, '_ads$', ''))
           AND (LOWER(TRIM(s.utm_campaign)) = LOWER(TRIM($5)) OR ($6::text IS NOT NULL AND s.utm_campaign = $6))
         GROUP BY s.utm_content, s.utm_term`,
        [clientId, from, to, platform, campaignName, campaignId]
      )

      // Rows are grouped Campaign -> Ad set -> Ad, the same shape as Meta Ads
      // Manager. A creative's key includes its ad set, so the same ad name running
      // in two ad sets shows up once under each instead of being merged into one.
      interface AdsetRow {
        key: string
        id: string | null
        name: string
        cost: number
        impressions: number
        clicks: number
        leads: number
        sales: number
        revenue: number
        adCount: number
      }
      interface CreativeRow {
        name: string
        adsetKey: string
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
      const norm = (s: string | null) => (s ?? '').trim().toLowerCase()
      const NO_ADSET_KEY = '__no_adset__'

      const adsets = new Map<string, AdsetRow>()
      // Lookup-only (never iterated): a link's utm_term can hold the ad set's id OR name.
      const adsetIndex = new Map<string, AdsetRow>()
      const getOrCreateAdset = (id: string | null, name: string | null): AdsetRow => {
        const key = norm(id) || norm(name) || NO_ADSET_KEY
        let row = adsets.get(key)
        if (!row) {
          row = {
            key,
            id: id || null,
            name: name || id || '(no ad set)',
            cost: 0, impressions: 0, clicks: 0, leads: 0, sales: 0, revenue: 0, adCount: 0,
          }
          adsets.set(key, row)
        }
        if (id) adsetIndex.set(norm(id), row)
        if (name) adsetIndex.set(norm(name), row)
        return row
      }

      const creatives = new Map<string, CreativeRow>()
      // Same idIndex pattern as reports.ts's funnel breakdown: a client's ad
      // URLs can carry the raw ad_id in utm_content instead of the ad name, so
      // a lead/revenue row matched by id needs to land on the same object a
      // spend row registered by name. Both indexes are lookup-only, never
      // iterated, so a row found through them can't get double-counted.
      const idIndex = new Map<string, CreativeRow>()
      const nameIndex = new Map<string, CreativeRow[]>()
      const getOrCreate = (adset: AdsetRow, name: string | null): CreativeRow => {
        const key = `${adset.key}::${norm(name)}`
        let row = creatives.get(key)
        if (!row) {
          row = {
            name: name || '(unnamed creative)',
            adsetKey: adset.key,
            cost: 0, impressions: 0, clicks: 0, leads: 0, sales: 0, revenue: 0,
            thumbnailUrl: null, assetUrl: null, assetType: null,
          }
          creatives.set(key, row)
          adset.adCount += 1
          const list = nameIndex.get(norm(name)) ?? []
          list.push(row)
          nameIndex.set(norm(name), list)
        }
        return row
      }
      for (const r of creativeSpendRows) {
        const adset = getOrCreateAdset(r.adset_id, r.adset_name)
        const row = getOrCreate(adset, r.ad_name)
        const c = parseFloat(r.cost)
        const imp = parseInt(r.impressions, 10)
        const clk = parseInt(r.clicks, 10)
        row.cost += c
        row.impressions += imp
        row.clicks += clk
        adset.cost += c
        adset.impressions += imp
        adset.clicks += clk
        row.thumbnailUrl = r.creative_thumbnail_url
        row.assetUrl = r.creative_asset_url
        row.assetType = (r.creative_type as 'image' | 'video' | null) ?? null
        if (r.ad_id && norm(r.ad_id) !== norm(r.ad_name)) idIndex.set(norm(r.ad_id), row)
      }

      // Where a lead/sale lands: an exact ad id in utm_content wins (an ad id
      // belongs to exactly one ad set). Otherwise the ad set comes from utm_term,
      // and the ad is matched by name inside that ad set. Anything with no
      // traceable ad set goes to a "(no ad set)" row so the ad sets still add up
      // to the campaign totals.
      const resolve = (content: string | null, term: string | null): { adset: AdsetRow; creative: CreativeRow | null } => {
        const byId = content ? idIndex.get(norm(content)) : undefined
        if (byId) return { adset: adsets.get(byId.adsetKey)!, creative: byId }
        const termAdset = term ? adsetIndex.get(norm(term)) : undefined
        if (content) {
          const candidates = nameIndex.get(norm(content)) ?? []
          const match = (termAdset && candidates.find((c) => c.adsetKey === termAdset.key)) || candidates[0]
          if (match) return { adset: adsets.get(match.adsetKey)!, creative: match }
          const adset = termAdset ?? getOrCreateAdset(null, null)
          return { adset, creative: getOrCreate(adset, content) }
        }
        // No ad on the link at all: credit the ad set only (the creative list
        // never showed content-less rows before either).
        return { adset: termAdset ?? getOrCreateAdset(null, null), creative: null }
      }
      for (const r of creativeLeadRows) {
        const { adset, creative } = resolve(r.utm_content, r.utm_term)
        const n = parseInt(r.leads, 10)
        adset.leads += n
        if (creative) creative.leads += n
      }
      for (const r of creativeRevRows) {
        const { adset, creative } = resolve(r.utm_content, r.utm_term)
        const rev = parseFloat(r.revenue)
        const n = parseInt(r.sales, 10)
        adset.revenue += rev
        adset.sales += n
        if (creative) {
          creative.revenue += rev
          creative.sales += n
        }
      }

      const creativesOut = Array.from(creatives.values())
        .map((r) => ({
          ...r,
          cpl: r.leads > 0 ? r.cost / r.leads : null,
          roas: r.cost > 0 ? r.revenue / r.cost : null,
          cpm: r.impressions > 0 ? (r.cost / r.impressions) * 1000 : null,
          ctr: r.impressions > 0 ? (r.clicks / r.impressions) * 100 : null,
          matched: r.cost > 0,
          ...blend(r.revenue, r.sales, r.cost),
        }))
        .sort((a, b) => b.revenue - a.revenue)

      const adsetsOut = Array.from(adsets.values())
        .filter((a) => a.cost > 0 || a.revenue > 0 || a.leads > 0 || a.sales > 0)
        .map((a) => ({
          ...a,
          profit: a.revenue - a.cost,
          trueProfit: computeTrueProfit(marginConfig, a.revenue, a.cost, a.sales).trueProfit,
          roas: a.cost > 0 ? a.revenue / a.cost : null,
          cpl: a.leads > 0 ? a.cost / a.leads : null,
          costPerSale: a.sales > 0 ? a.cost / a.sales : null,
          cpm: a.impressions > 0 ? (a.cost / a.impressions) * 1000 : null,
          ctr: a.impressions > 0 ? (a.clicks / a.impressions) * 100 : null,
          matched: a.cost > 0,
          ...blend(a.revenue, a.sales, a.cost),
        }))
        // Real ad sets by spend, the "(no ad set)" catch-all always last.
        .sort((a, b) => (a.key === NO_ADSET_KEY ? 1 : 0) - (b.key === NO_ADSET_KEY ? 1 : 0) || b.cost - a.cost)

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
          ...blend(revenue, sales, cost),
        },
        blendedBasis: { storeRevenue, storeOrders, paidRevenue, paidSales },
        adsets: adsetsOut,
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
      await refreshCreativeMedia(clientId, [adId ?? creativeName])

      let { rows: assetRows } = await db.query<{
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

      // ad-object-fallback (docs/ISSUE_LOG.md "Proposed enhancements"): no ad_costs
      // row at all means resolveAdId above also came back null, which happens for
      // an ad that's too new for Insights to have reported on yet, or paused and
      // dropped from it — in both cases a client using Meta's dynamic {{ad.id}} URL
      // token lands the raw ad_id directly in creativeName instead of a real name.
      // Try it as one; resolveAdObjectFallback no-ops for anything that isn't
      // Facebook-ad-id-shaped or that Meta itself 400s on (genuinely deleted ads).
      if (assetRows.length === 0 && !adId) {
        await resolveAdObjectFallback(clientId, creativeName)
        const { rows: fallbackRows } = await db.query<(typeof assetRows)[number]>(
          `SELECT creative_thumbnail_url, creative_asset_url, creative_type,
                  creative_headline, creative_primary_text, creative_description, creative_landing_page_url
           FROM ad_costs
           WHERE client_id = $1 AND ad_id = $2
           ORDER BY date DESC
           LIMIT 1`,
          [clientId, creativeName]
        )
        assetRows = fallbackRows
      }

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
