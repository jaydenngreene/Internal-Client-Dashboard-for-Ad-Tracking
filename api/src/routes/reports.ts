import { FastifyInstance } from 'fastify'
import { db } from '../db'
import { computeTrueProfit, MarginConfig } from '../lib/margin'
import { computeMaturityCurve, predictLifetimeValue } from '../lib/predictiveLtv'
import { projectSum } from '../lib/forecasting'
import { computeMMM } from '../lib/mmm'
import { computeMmmScenario, ScenarioAdjustment } from '../lib/mmmScenario'
import { computeBestPaths } from '../lib/bestPaths'
import { computeBuyingJourneySummary } from '../lib/buyingJourney'
import { computeAttributionComparison } from '../lib/attributionComparison'
import { computeAttributionModelComparison } from '../lib/attributionModelComparison'
import { computeCreativeRoles } from '../lib/creativeRoles'
import { computeJourneyPaths } from '../lib/journeyPaths'
import { getOverviewSummary } from '../lib/overviewSummary'
import { computeMarkovAttribution } from '../lib/markovAttribution'
import { resolveAdObjectFallback } from '../lib/adObjectFallback'

export function defaultRange(from?: string, to?: string): { from: string; to: string } {
  if (from && to) return { from, to }
  const toDate = new Date()
  const fromDate = new Date(toDate)
  fromDate.setUTCDate(fromDate.getUTCDate() - 29)
  return { from: fromDate.toISOString().slice(0, 10), to: toDate.toISOString().slice(0, 10) }
}

// Same-length window immediately preceding [from, to] — for period-over-period deltas.
export function previousPeriod(from: string, to: string): { prevFrom: string; prevTo: string } {
  const fromDate = new Date(from + 'T00:00:00Z')
  const toDate = new Date(to + 'T00:00:00Z')
  const lengthDays = Math.round((toDate.getTime() - fromDate.getTime()) / 86400000) + 1
  const prevTo = new Date(fromDate)
  prevTo.setUTCDate(prevTo.getUTCDate() - 1)
  const prevFrom = new Date(prevTo)
  prevFrom.setUTCDate(prevFrom.getUTCDate() - (lengthDays - 1))
  return { prevFrom: prevFrom.toISOString().slice(0, 10), prevTo: prevTo.toISOString().slice(0, 10) }
}

function dateList(from: string, to: string): string[] {
  const dates: string[] = []
  const cur = new Date(from + 'T00:00:00Z')
  const end = new Date(to + 'T00:00:00Z')
  while (cur <= end) {
    dates.push(cur.toISOString().slice(0, 10))
    cur.setUTCDate(cur.getUTCDate() + 1)
  }
  return dates
}

interface OverviewQuery {
  from?: string
  to?: string
}


interface LeadsQuery {
  from?: string
  to?: string
}

interface BofQuery {
  from?: string
  to?: string
}

interface LtvQuery {
  from?: string
  to?: string
}

interface MofQuery {
  from?: string
  to?: string
}

interface CartProductsQuery {
  from?: string
  to?: string
}

interface CallsQuery {
  from?: string
  to?: string
}

interface FunnelQuery {
  from?: string
  to?: string
  breakdown?: 'campaign' | 'source' | 'keyword' | 'creative'
}

interface AgencyOverviewQuery {
  from?: string
  to?: string
}

interface CohortsQuery {
  months?: string
}

interface SubscriptionsQuery {
  from?: string
  to?: string
}

interface SpendRow {
  campaign_id: string | null
  campaign_name: string | null
  platform: string
  cost: string
  impressions: string
  clicks: string
}

// Custom Costs (Step 26) have no campaign/ad structure, just a free-text label — they
// fold in as their own unmatched row (platform_label doubling as both name and
// platform), same "matched: false when there's no revenue counterpart" convention
// every other unmatched row in this file already uses.
function getSpendByCampaign(clientId: string, from: string, to: string) {
  return db.query<SpendRow>(
    `SELECT campaign_id, campaign_name, platform,
            SUM(spend) AS cost, SUM(impressions) AS impressions, SUM(clicks) AS clicks
     FROM ad_costs
     WHERE client_id = $1 AND date BETWEEN $2 AND $3
     GROUP BY campaign_id, campaign_name, platform
     UNION ALL
     SELECT NULL AS campaign_id, platform_label AS campaign_name, platform_label AS platform,
            SUM(spend) AS cost, 0 AS impressions, 0 AS clicks
     FROM custom_costs
     WHERE client_id = $1 AND date BETWEEN $2 AND $3
     GROUP BY platform_label`,
    [clientId, from, to]
  )
}

// Attributes each lead to the visitor's most recent session at-or-before the lead
// was created (first-touch-per-lead, same acquisition convention as customer_ltv) —
// independent of the client's purchase attribution_model, since a lead isn't
// revenue to split, just a single acquisition event.
// utm_source travels alongside utm_campaign here (not just utm_campaign) so the
// funnel route below can key on (campaign, platform) together, not campaign name
// alone — otherwise a client running same-named campaigns on two platforms (e.g.
// "Summer Sale" on both Facebook and Google) would collapse into one blended row.
function getLeadsByCampaign(clientId: string, from: string, to: string) {
  return db.query<{ utm_campaign: string | null; utm_source: string | null; leads: string }>(
    `SELECT s.utm_campaign, s.utm_source, COUNT(DISTINCT l.id) AS leads
     FROM leads l
     JOIN identities i ON i.client_id = l.client_id AND i.email = l.email
     JOIN LATERAL (
       SELECT utm_campaign, utm_source FROM sessions
       WHERE visitor_id = i.visitor_id
         AND started_at <= l.created_at
         AND started_at >= l.created_at - INTERVAL '90 days'
       ORDER BY started_at ASC
       LIMIT 1
     ) s ON true
     WHERE l.client_id = $1 AND l.created_at::date BETWEEN $2 AND $3
     GROUP BY s.utm_campaign, s.utm_source`,
    [clientId, from, to]
  )
}

function getRevenueByCampaign(clientId: string, from: string, to: string) {
  return db.query<{ utm_campaign: string | null; utm_source: string | null; revenue: string; sales: string }>(
    `SELECT s.utm_campaign, s.utm_source, SUM(a.attributed_revenue) AS revenue, COUNT(DISTINCT a.purchase_id) AS sales
     FROM attributions a
     JOIN sessions s ON s.id = a.session_id
     JOIN purchases p ON p.id = a.purchase_id
     WHERE a.client_id = $1 AND p.purchased_at::date BETWEEN $2 AND $3
     GROUP BY s.utm_campaign, s.utm_source`,
    [clientId, from, to]
  )
}

// "Source" breakdown pairs ad_costs.platform ('facebook_ads') against
// sessions.utm_source ('facebook') — different vocabularies for the same thing.
// Strip a trailing "_ads" and lowercase both sides so 'facebook_ads' and
// 'facebook' merge into one row instead of showing up as two.
function getSpendBySource(clientId: string, from: string, to: string) {
  return db.query<{ platform: string; cost: string; impressions: string; clicks: string }>(
    `SELECT platform, SUM(spend) AS cost, SUM(impressions) AS impressions, SUM(clicks) AS clicks
     FROM ad_costs
     WHERE client_id = $1 AND date BETWEEN $2 AND $3
     GROUP BY platform
     UNION ALL
     SELECT platform_label AS platform, SUM(spend) AS cost, 0 AS impressions, 0 AS clicks
     FROM custom_costs
     WHERE client_id = $1 AND date BETWEEN $2 AND $3
     GROUP BY platform_label`,
    [clientId, from, to]
  )
}

function getLeadsBySource(clientId: string, from: string, to: string) {
  return db.query<{ utm_source: string | null; leads: string }>(
    `SELECT s.utm_source, COUNT(DISTINCT l.id) AS leads
     FROM leads l
     JOIN identities i ON i.client_id = l.client_id AND i.email = l.email
     JOIN LATERAL (
       SELECT utm_source FROM sessions
       WHERE visitor_id = i.visitor_id
         AND started_at <= l.created_at
         AND started_at >= l.created_at - INTERVAL '90 days'
       ORDER BY started_at ASC
       LIMIT 1
     ) s ON true
     WHERE l.client_id = $1 AND l.created_at::date BETWEEN $2 AND $3
     GROUP BY s.utm_source`,
    [clientId, from, to]
  )
}

function getRevenueBySource(clientId: string, from: string, to: string) {
  return db.query<{ utm_source: string | null; revenue: string; sales: string }>(
    `SELECT s.utm_source, SUM(a.attributed_revenue) AS revenue, COUNT(DISTINCT a.purchase_id) AS sales
     FROM attributions a
     JOIN sessions s ON s.id = a.session_id
     JOIN purchases p ON p.id = a.purchase_id
     WHERE a.client_id = $1 AND p.purchased_at::date BETWEEN $2 AND $3
     GROUP BY s.utm_source`,
    [clientId, from, to]
  )
}

// Keyword/search-term breakdown (Step 27) — utm_term was already captured on every
// session (Step 1) but never surfaced in a report until now. No keyword-level
// ad_costs exists (ad_costs is ad-level, not keyword-level, from any current
// cost-sync fetcher), so this breakdown has no spend query at all — cost/matched
// degrade to 0/false for every row, same "no cost counterpart" convention every
// other unmatched row in this file already uses. True keyword-level ROAS would need
// a separate Google Ads keyword_view pull into a new table — a bigger lift, not this.
function getLeadsByKeyword(clientId: string, from: string, to: string) {
  return db.query<{ utm_term: string | null; leads: string }>(
    `SELECT s.utm_term, COUNT(DISTINCT l.id) AS leads
     FROM leads l
     JOIN identities i ON i.client_id = l.client_id AND i.email = l.email
     JOIN LATERAL (
       SELECT utm_term FROM sessions
       WHERE visitor_id = i.visitor_id
         AND started_at <= l.created_at
         AND started_at >= l.created_at - INTERVAL '90 days'
       ORDER BY started_at ASC
       LIMIT 1
     ) s ON true
     WHERE l.client_id = $1 AND l.created_at::date BETWEEN $2 AND $3
     GROUP BY s.utm_term`,
    [clientId, from, to]
  )
}

function getRevenueByKeyword(clientId: string, from: string, to: string) {
  return db.query<{ utm_term: string | null; revenue: string; sales: string }>(
    `SELECT s.utm_term, SUM(a.attributed_revenue) AS revenue, COUNT(DISTINCT a.purchase_id) AS sales
     FROM attributions a
     JOIN sessions s ON s.id = a.session_id
     JOIN purchases p ON p.id = a.purchase_id
     WHERE a.client_id = $1 AND p.purchased_at::date BETWEEN $2 AND $3
     GROUP BY s.utm_term`,
    [clientId, from, to]
  )
}

// Creative/ad-level breakdown — the ad_costs table has carried ad_id/ad_name since
// Step 1, but no report ever grouped by it (only campaign/platform roll-ups). Spend
// keys off ad_id (a real unique id per platform, unlike campaign_name which can
// collide) with ad_name as the display label; leads/revenue match against
// sessions.utm_content (captured since Step 1, never surfaced — same situation
// utm_term was in before the Step 27 keyword breakdown), normalized the same way
// source/keyword already are since both sides are marketer-set labels, not a shared id.
function getSpendByCreative(clientId: string, from: string, to: string) {
  return db.query<{
    ad_id: string
    ad_name: string | null
    campaign_name: string | null
    platform: string
    cost: string
    impressions: string
    clicks: string
  }>(
    `SELECT ad_id, ad_name, campaign_name, platform,
            SUM(spend) AS cost, SUM(impressions) AS impressions, SUM(clicks) AS clicks
     FROM ad_costs
     WHERE client_id = $1 AND date BETWEEN $2 AND $3
     GROUP BY ad_id, ad_name, campaign_name, platform`,
    [clientId, from, to]
  )
}

function getLeadsByCreative(clientId: string, from: string, to: string) {
  return db.query<{ utm_content: string | null; utm_source: string | null; leads: string }>(
    `SELECT s.utm_content, s.utm_source, COUNT(DISTINCT l.id) AS leads
     FROM leads l
     JOIN identities i ON i.client_id = l.client_id AND i.email = l.email
     JOIN LATERAL (
       SELECT utm_content, utm_source FROM sessions
       WHERE visitor_id = i.visitor_id
         AND started_at <= l.created_at
         AND started_at >= l.created_at - INTERVAL '90 days'
       ORDER BY started_at ASC
       LIMIT 1
     ) s ON true
     WHERE l.client_id = $1 AND l.created_at::date BETWEEN $2 AND $3
     GROUP BY s.utm_content, s.utm_source`,
    [clientId, from, to]
  )
}

function getRevenueByCreative(clientId: string, from: string, to: string) {
  return db.query<{ utm_content: string | null; utm_source: string | null; revenue: string; sales: string }>(
    `SELECT s.utm_content, s.utm_source, SUM(a.attributed_revenue) AS revenue, COUNT(DISTINCT a.purchase_id) AS sales
     FROM attributions a
     JOIN sessions s ON s.id = a.session_id
     JOIN purchases p ON p.id = a.purchase_id
     WHERE a.client_id = $1 AND p.purchased_at::date BETWEEN $2 AND $3
     GROUP BY s.utm_content, s.utm_source`,
    [clientId, from, to]
  )
}

const normalizeCreative = (name: string | null) => (name ?? '').trim().toLowerCase()
const normalizeKeyword = (name: string | null) => (name ?? '').trim().toLowerCase()
const normalizeCampaignName = (name: string | null) => (name ?? '').trim().toLowerCase()
const normalizeSource = (name: string | null) => (name ?? '').trim().toLowerCase().replace(/_ads$/, '')

export async function reportRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string }; Querystring: OverviewQuery }>(
    '/clients/:id/reports/overview',
    async (req, reply) => {
      const clientId = req.params.id
      const { from, to } = defaultRange(req.query.from, req.query.to)

      const [summary, marginConfig, costByDay, revenueByDay, attributedRevenueByDay, salesByDay, attributedSalesByDay] = await Promise.all([
        getOverviewSummary(clientId, from, to),
        db.query<MarginConfig>(
          `SELECT cogs_percent, payment_fee_percent, fulfillment_cost_flat FROM clients WHERE id = $1`,
          [clientId]
        ),
        db.query<{ date: string; total: string }>(
          `SELECT date::text, SUM(spend) AS total FROM (
             SELECT date, spend FROM ad_costs WHERE client_id = $1 AND date BETWEEN $2 AND $3
             UNION ALL
             SELECT date, spend FROM custom_costs WHERE client_id = $1 AND date BETWEEN $2 AND $3
           ) combined
           GROUP BY date`,
          [clientId, from, to]
        ),
        // Total revenue per day (every non-refunded purchase, attributed or not) —
        // matches the headline `revenue`/`profit` from getOverviewSummary, not the
        // attribution-only figure. Attributed-only revenue is still the campaign/
        // creative breakdown pages' job, not this account-wide trend chart's.
        db.query<{ date: string; total: string }>(
          `SELECT purchased_at::date::text AS date, SUM(revenue) AS total FROM purchases
           WHERE client_id = $1 AND purchased_at::date BETWEEN $2 AND $3 AND NOT refunded
           GROUP BY purchased_at::date`,
          [clientId, from, to]
        ),
        // Same, but attribution-only — feeds the ROAS/ROI sparklines so they track
        // the same attributed-revenue basis as their headline numbers instead of
        // the total-revenue series above.
        db.query<{ date: string; total: string }>(
          `SELECT p.purchased_at::date::text AS date, SUM(a.attributed_revenue) AS total
           FROM attributions a JOIN purchases p ON p.id = a.purchase_id
           WHERE a.client_id = $1 AND p.purchased_at::date BETWEEN $2 AND $3
           GROUP BY p.purchased_at::date`,
          [clientId, from, to]
        ),
        db.query<{ date: string; total: string }>(
          `SELECT purchased_at::date::text AS date, COUNT(*) AS total FROM purchases
           WHERE client_id = $1 AND purchased_at::date BETWEEN $2 AND $3 AND NOT refunded
           GROUP BY purchased_at::date`,
          [clientId, from, to]
        ),
        // How many of each day's sales actually have a matched session — feeds
        // the Attribution Rate tile's trend line (2026-07-25).
        db.query<{ date: string; total: string }>(
          `SELECT p.purchased_at::date::text AS date, COUNT(DISTINCT a.purchase_id) AS total
           FROM attributions a JOIN purchases p ON p.id = a.purchase_id
           WHERE a.client_id = $1 AND p.purchased_at::date BETWEEN $2 AND $3 AND NOT p.refunded
           GROUP BY p.purchased_at::date`,
          [clientId, from, to]
        ),
      ])

      const {
        cost,
        revenue,
        attributedRevenue,
        profit,
        roas,
        blendedRoas,
        roi,
        trueProfit,
        trueRoi,
        leads,
        sales,
        attributedSales,
        attributionRate,
      } = summary
      const margin = marginConfig.rows[0] ?? null

      const costByDate = new Map(costByDay.rows.map((r) => [r.date, parseFloat(r.total)]))
      const revenueByDate = new Map(revenueByDay.rows.map((r) => [r.date, parseFloat(r.total)]))
      const attributedRevenueByDate = new Map(attributedRevenueByDay.rows.map((r) => [r.date, parseFloat(r.total)]))
      const salesByDate = new Map(salesByDay.rows.map((r) => [r.date, parseInt(r.total, 10)]))
      const attributedSalesByDate = new Map(attributedSalesByDay.rows.map((r) => [r.date, parseInt(r.total, 10)]))

      const series = dateList(from, to).map((date) => {
        const dailyCost = costByDate.get(date) ?? 0
        const dailyRevenue = revenueByDate.get(date) ?? 0
        const dailyAttributedRevenue = attributedRevenueByDate.get(date) ?? 0
        const dailySales = salesByDate.get(date) ?? 0
        const dailyAttributedSales = attributedSalesByDate.get(date) ?? 0
        return {
          date,
          cost: dailyCost,
          revenue: dailyRevenue,
          attributedRevenue: dailyAttributedRevenue,
          profit: dailyRevenue - dailyCost,
          trueProfit: computeTrueProfit(margin, dailyRevenue, dailyCost, dailySales).trueProfit,
          trueProfitAttributed: computeTrueProfit(margin, dailyAttributedRevenue, dailyCost, dailySales).trueProfit,
          attributionRate: dailySales > 0 ? (dailyAttributedSales / dailySales) * 100 : 0,
        }
      })

      return reply.send({
        from,
        to,
        cost,
        revenue,
        attributedRevenue,
        profit,
        roas,
        blendedRoas,
        roi,
        trueProfit,
        trueRoi,
        hasMarginConfig: Boolean(margin && (margin.cogs_percent || margin.payment_fee_percent || margin.fulfillment_cost_flat)),
        leads,
        sales,
        attributedSales,
        attributionRate,
        series,
      })
    }
  )

  app.get<{ Params: { id: string }; Querystring: LeadsQuery }>(
    '/clients/:id/reports/leads',
    async (req, reply) => {
      const clientId = req.params.id
      const { from, to } = defaultRange(req.query.from, req.query.to)

      const [totalRow, purchasesRow, spendRows, leadsByCampaign] = await Promise.all([
        db.query<{ total: string }>(
          `SELECT COUNT(*) AS total FROM leads WHERE client_id = $1 AND created_at::date BETWEEN $2 AND $3`,
          [clientId, from, to]
        ),
        db.query<{ total: string }>(
          `SELECT COUNT(*) AS total FROM purchases
           WHERE client_id = $1 AND purchased_at::date BETWEEN $2 AND $3 AND NOT refunded`,
          [clientId, from, to]
        ),
        getSpendByCampaign(clientId, from, to),
        getLeadsByCampaign(clientId, from, to),
      ])

      const totalLeads = parseInt(totalRow.rows[0].total, 10)
      // Ecommerce/info-product clients don't think in "leads" — TOF's entry-funnel
      // outcome for them is purchases, not opt-ins. Same totalCost either way.
      const totalPurchases = parseInt(purchasesRow.rows[0].total, 10)
      const totalCost = spendRows.rows.reduce((sum, r) => sum + parseFloat(r.cost), 0)
      const cpl = totalLeads > 0 ? totalCost / totalLeads : null
      const costPerPurchase = totalPurchases > 0 ? totalCost / totalPurchases : null

      interface Row {
        campaign_name: string
        platform: string | null
        cost: number
        leads: number
        matched: boolean
      }

      const rows = new Map<string, Row>()

      for (const r of spendRows.rows) {
        const key = normalizeCampaignName(r.campaign_name)
        rows.set(key, {
          campaign_name: r.campaign_name ?? '(unnamed campaign)',
          platform: r.platform,
          cost: parseFloat(r.cost),
          leads: 0,
          matched: false,
        })
      }

      for (const r of leadsByCampaign.rows) {
        const key = normalizeCampaignName(r.utm_campaign)
        const existing = rows.get(key)
        if (existing) {
          existing.leads = parseInt(r.leads, 10)
          existing.matched = true
        } else {
          rows.set(key, {
            campaign_name: r.utm_campaign ?? '(no utm_campaign)',
            platform: null,
            cost: 0,
            leads: parseInt(r.leads, 10),
            matched: false,
          })
        }
      }

      const campaigns = Array.from(rows.values())
        .map((r) => ({ ...r, cpl: r.leads > 0 ? r.cost / r.leads : null }))
        .sort((a, b) => b.leads - a.leads)

      return reply.send({ from, to, totalLeads, cpl, totalPurchases, costPerPurchase, campaigns })
    }
  )

  app.get<{ Params: { id: string }; Querystring: BofQuery }>(
    '/clients/:id/reports/bof',
    async (req, reply) => {
      const clientId = req.params.id
      const { from, to } = defaultRange(req.query.from, req.query.to)

      const [conversionRow, orderRow, aovBySource, newVsReturningRow, firstClickDaysRow, orderSeriesRow, newVsReturningSeriesRow] =
        await Promise.all([
          // For each lead in range, find their first purchase at or after the lead —
          // gives lead->buyer rate and avg time-to-convert regardless of when the
          // purchase itself landed.
          db.query<{ total_leads: string; converted_leads: string; avg_days: string | null }>(
            `WITH lead_conversions AS (
               SELECT l.id,
                      l.created_at AS lead_at,
                      (SELECT MIN(p.purchased_at) FROM purchases p
                       WHERE p.client_id = l.client_id AND p.email = l.email AND p.purchased_at >= l.created_at
                      ) AS first_purchase_at
               FROM leads l
               WHERE l.client_id = $1 AND l.created_at::date BETWEEN $2 AND $3
             )
             SELECT
               COUNT(*) AS total_leads,
               COUNT(first_purchase_at) AS converted_leads,
               AVG(EXTRACT(EPOCH FROM (first_purchase_at - lead_at)) / 86400)
                 FILTER (WHERE first_purchase_at IS NOT NULL) AS avg_days
             FROM lead_conversions`,
            [clientId, from, to]
          ),
          db.query<{ total: string; refunded: string }>(
            `SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE refunded) AS refunded
             FROM purchases
             WHERE client_id = $1 AND purchased_at::date BETWEEN $2 AND $3`,
            [clientId, from, to]
          ),
          // AOV by source uses each purchase's first-touch session (same acquisition
          // convention as customer_ltv), not the attributions table — under the linear
          // model a purchase can have several attribution rows, which would fragment
          // and double-count order value here.
          db.query<{ utm_source: string | null; aov: string; sales: string }>(
            `SELECT src.utm_source, AVG(p.revenue) AS aov, COUNT(*) AS sales
             FROM purchases p
             JOIN identities i ON i.client_id = p.client_id AND i.email = p.email
             JOIN LATERAL (
               SELECT utm_source FROM sessions
               WHERE visitor_id = i.visitor_id AND started_at <= p.purchased_at
               ORDER BY started_at ASC
               LIMIT 1
             ) src ON true
             WHERE p.client_id = $1 AND p.purchased_at::date BETWEEN $2 AND $3 AND NOT p.refunded
             GROUP BY src.utm_source
             ORDER BY COUNT(*) DESC`,
            [clientId, from, to]
          ),
          // Ecommerce BOF (2026-07-25): "lead -> buyer" doesn't mean anything for a
          // store where the only "lead" is the checkout-identify call itself, near-
          // simultaneous with the purchase it's supposedly predicting. New vs
          // returning is the real bottom-of-funnel ecommerce question - computed
          // live off `purchases` directly (not customer_ltv.purchase_count, which
          // only refreshes on the nightly LTV job and would be stale intraday).
          db.query<{ new_count: string; returning_count: string }>(
            `SELECT
               COUNT(*) FILTER (WHERE NOT EXISTS (
                 SELECT 1 FROM purchases p2
                 WHERE p2.client_id = p.client_id AND p2.email = p.email
                   AND p2.purchased_at < p.purchased_at AND NOT p2.refunded
               )) AS new_count,
               COUNT(*) FILTER (WHERE EXISTS (
                 SELECT 1 FROM purchases p2
                 WHERE p2.client_id = p.client_id AND p2.email = p.email
                   AND p2.purchased_at < p.purchased_at AND NOT p2.refunded
               )) AS returning_count
             FROM purchases p
             WHERE p.client_id = $1 AND p.purchased_at::date BETWEEN $2 AND $3 AND NOT p.refunded`,
            [clientId, from, to]
          ),
          // Ecommerce's equivalent of "avg days to convert" - time from the buyer's
          // actual first tracked touch (not a leads-table row) to their purchase.
          db.query<{ avg_days: string | null }>(
            `SELECT AVG(EXTRACT(EPOCH FROM (p.purchased_at - first_sess.started_at)) / 86400) AS avg_days
             FROM purchases p
             JOIN identities i ON i.client_id = p.client_id AND i.email = p.email
             JOIN LATERAL (
               SELECT started_at FROM sessions
               WHERE visitor_id = i.visitor_id AND started_at <= p.purchased_at
               ORDER BY started_at ASC LIMIT 1
             ) first_sess ON true
             WHERE p.client_id = $1 AND p.purchased_at::date BETWEEN $2 AND $3 AND NOT p.refunded`,
            [clientId, from, to]
          ),
          db.query<{ date: string; total: string; refunded: string }>(
            `SELECT purchased_at::date::text AS date, COUNT(*) AS total, COUNT(*) FILTER (WHERE refunded) AS refunded
             FROM purchases WHERE client_id = $1 AND purchased_at::date BETWEEN $2 AND $3
             GROUP BY purchased_at::date`,
            [clientId, from, to]
          ),
          db.query<{ date: string; new_count: string; returning_count: string }>(
            `SELECT p.purchased_at::date::text AS date,
               COUNT(*) FILTER (WHERE NOT EXISTS (
                 SELECT 1 FROM purchases p2
                 WHERE p2.client_id = p.client_id AND p2.email = p.email
                   AND p2.purchased_at < p.purchased_at AND NOT p2.refunded
               )) AS new_count,
               COUNT(*) FILTER (WHERE EXISTS (
                 SELECT 1 FROM purchases p2
                 WHERE p2.client_id = p.client_id AND p2.email = p.email
                   AND p2.purchased_at < p.purchased_at AND NOT p2.refunded
               )) AS returning_count
             FROM purchases p
             WHERE p.client_id = $1 AND p.purchased_at::date BETWEEN $2 AND $3 AND NOT p.refunded
             GROUP BY p.purchased_at::date`,
            [clientId, from, to]
          ),
        ])

      const totalLeads = parseInt(conversionRow.rows[0].total_leads, 10)
      const convertedLeads = parseInt(conversionRow.rows[0].converted_leads, 10)
      const leadToBuyerRate = totalLeads > 0 ? (convertedLeads / totalLeads) * 100 : null
      const avgDaysToConvert = conversionRow.rows[0].avg_days !== null ? parseFloat(conversionRow.rows[0].avg_days) : null

      const totalOrders = parseInt(orderRow.rows[0].total, 10)
      const refundedOrders = parseInt(orderRow.rows[0].refunded, 10)
      const refundRate = totalOrders > 0 ? (refundedOrders / totalOrders) * 100 : null

      const newCustomerOrders = parseInt(newVsReturningRow.rows[0].new_count, 10)
      const returningCustomerOrders = parseInt(newVsReturningRow.rows[0].returning_count, 10)
      const repeatPurchaseRate =
        newCustomerOrders + returningCustomerOrders > 0
          ? (returningCustomerOrders / (newCustomerOrders + returningCustomerOrders)) * 100
          : null
      const avgDaysFirstClickToPurchase =
        firstClickDaysRow.rows[0].avg_days !== null ? parseFloat(firstClickDaysRow.rows[0].avg_days) : null

      const orderByDate = new Map(orderSeriesRow.rows.map((r) => [r.date, r]))
      const newVsReturningByDate = new Map(newVsReturningSeriesRow.rows.map((r) => [r.date, r]))
      const series = dateList(from, to).map((date) => {
        const orderDay = orderByDate.get(date)
        const nvrDay = newVsReturningByDate.get(date)
        const dayTotal = orderDay ? parseInt(orderDay.total, 10) : 0
        const dayRefunded = orderDay ? parseInt(orderDay.refunded, 10) : 0
        const dayNew = nvrDay ? parseInt(nvrDay.new_count, 10) : 0
        const dayReturning = nvrDay ? parseInt(nvrDay.returning_count, 10) : 0
        return {
          date,
          totalOrders: dayTotal,
          refundRate: dayTotal > 0 ? (dayRefunded / dayTotal) * 100 : 0,
          repeatPurchaseRate: dayNew + dayReturning > 0 ? (dayReturning / (dayNew + dayReturning)) * 100 : 0,
        }
      })

      return reply.send({
        from,
        to,
        totalLeads,
        convertedLeads,
        leadToBuyerRate,
        avgDaysToConvert,
        totalOrders,
        refundedOrders,
        refundRate,
        newCustomerOrders,
        returningCustomerOrders,
        repeatPurchaseRate,
        avgDaysFirstClickToPurchase,
        aovBySource: aovBySource.rows.map((r) => ({
          source: r.utm_source ?? '(unknown)',
          aov: parseFloat(r.aov),
          sales: parseInt(r.sales, 10),
        })),
        series,
      })
    }
  )

  // MOF (middle of funnel): engagement between the first click and a lead/purchase —
  // the one funnel stage with no existing report, using pageviews/sessions as the
  // proxy signal since add-to-cart tracking doesn't exist yet (Step 11 backlog).
  app.get<{ Params: { id: string }; Querystring: MofQuery }>(
    '/clients/:id/reports/mof',
    async (req, reply) => {
      const clientId = req.params.id
      const { from, to } = defaultRange(req.query.from, req.query.to)

      const [sessionsRow, pageviewsRow, engagedRow, cartCountsRow, abandonedRow, sessionsByDay, pageviewsByDay, cartEventsByDay] =
        await Promise.all([
          db.query<{ total: string }>(
            `SELECT COUNT(*) AS total FROM sessions WHERE client_id = $1 AND started_at::date BETWEEN $2 AND $3`,
            [clientId, from, to]
          ),
          db.query<{ total: string }>(
            `SELECT COUNT(*) AS total FROM pageviews WHERE client_id = $1 AND timestamp::date BETWEEN $2 AND $3`,
            [clientId, from, to]
          ),
          // "Engaged" means the visitor looked at more than just the landing page -
          // requiring 2+ pageviews, not merely 1. A session can't exist without at
          // least one pageview at all, so counting "any pageview" made this read
          // ~100% for virtually any real traffic and never actually distinguished
          // engagement level.
          db.query<{ total: string }>(
            `SELECT COUNT(*) AS total FROM (
               SELECT pv.session_id FROM pageviews pv JOIN sessions s ON s.id = pv.session_id
               WHERE pv.client_id = $1 AND s.started_at::date BETWEEN $2 AND $3
               GROUP BY pv.session_id HAVING COUNT(*) > 1
             ) engaged`,
            [clientId, from, to]
          ),
          db.query<{ event_type: string; total: string }>(
            `SELECT event_type, COUNT(*) AS total FROM cart_events
             WHERE client_id = $1 AND created_at::date BETWEEN $2 AND $3
             GROUP BY event_type`,
            [clientId, from, to]
          ),
          // A cart is "abandoned" if there's an add_to_cart with no purchase by that
          // visitor's identified email afterward. No background job/state needed — this
          // is computed live at report time, same style as the BOF lead-conversion query.
          db.query<{ total: string; value: string }>(
            `SELECT COUNT(*) AS total, COALESCE(SUM(ce.value), 0) AS value
             FROM cart_events ce
             JOIN sessions s ON s.id = ce.session_id
             WHERE ce.client_id = $1 AND ce.event_type = 'add_to_cart' AND ce.created_at::date BETWEEN $2 AND $3
               AND NOT EXISTS (
                 SELECT 1 FROM identities i
                 JOIN purchases p ON p.client_id = i.client_id AND p.email = i.email
                 WHERE i.client_id = ce.client_id AND i.visitor_id = s.visitor_id
                   AND p.purchased_at >= ce.created_at
               )`,
            [clientId, from, to]
          ),
          // Day-by-day series (2026-07-25) — powers the KPI tiles' trend sparklines,
          // same visual treatment Overview's hero row already gets.
          db.query<{ date: string; total: string }>(
            `SELECT started_at::date::text AS date, COUNT(*) AS total FROM sessions
             WHERE client_id = $1 AND started_at::date BETWEEN $2 AND $3 GROUP BY started_at::date`,
            [clientId, from, to]
          ),
          db.query<{ date: string; total: string }>(
            `SELECT timestamp::date::text AS date, COUNT(*) AS total FROM pageviews
             WHERE client_id = $1 AND timestamp::date BETWEEN $2 AND $3 GROUP BY timestamp::date`,
            [clientId, from, to]
          ),
          db.query<{ date: string; event_type: string; total: string }>(
            `SELECT created_at::date::text AS date, event_type, COUNT(*) AS total FROM cart_events
             WHERE client_id = $1 AND created_at::date BETWEEN $2 AND $3 GROUP BY created_at::date, event_type`,
            [clientId, from, to]
          ),
        ])

      const totalSessions = parseInt(sessionsRow.rows[0].total, 10)
      const totalPageviews = parseInt(pageviewsRow.rows[0].total, 10)
      const engagedSessions = parseInt(engagedRow.rows[0].total, 10)

      const cartCounts = Object.fromEntries(cartCountsRow.rows.map((r) => [r.event_type, parseInt(r.total, 10)]))
      const viewContentCount = cartCounts.view_item ?? 0
      const addToCartCount = cartCounts.add_to_cart ?? 0
      const initiateCheckoutCount = cartCounts.begin_checkout ?? 0
      const abandonedCartCount = parseInt(abandonedRow.rows[0].total, 10)

      const sessionsByDate = new Map(sessionsByDay.rows.map((r) => [r.date, parseInt(r.total, 10)]))
      const pageviewsByDate = new Map(pageviewsByDay.rows.map((r) => [r.date, parseInt(r.total, 10)]))
      const cartByDate = new Map<string, Record<string, number>>()
      for (const r of cartEventsByDay.rows) {
        const entry = cartByDate.get(r.date) ?? {}
        entry[r.event_type] = parseInt(r.total, 10)
        cartByDate.set(r.date, entry)
      }

      const series = dateList(from, to).map((date) => {
        const daySessions = sessionsByDate.get(date) ?? 0
        const dayPageviews = pageviewsByDate.get(date) ?? 0
        const dayCart = cartByDate.get(date) ?? {}
        return {
          date,
          sessions: daySessions,
          pageviews: dayPageviews,
          avgPageviewsPerSession: daySessions > 0 ? dayPageviews / daySessions : 0,
          viewContentCount: dayCart.view_item ?? 0,
          addToCartCount: dayCart.add_to_cart ?? 0,
          initiateCheckoutCount: dayCart.begin_checkout ?? 0,
        }
      })

      return reply.send({
        from,
        to,
        totalSessions,
        totalPageviews,
        engagedSessions,
        avgPageviewsPerSession: totalSessions > 0 ? totalPageviews / totalSessions : null,
        engagementRate: totalSessions > 0 ? (engagedSessions / totalSessions) * 100 : null,
        viewContentCount,
        addToCartCount,
        initiateCheckoutCount,
        abandonedCartCount,
        abandonedCartValue: parseFloat(abandonedRow.rows[0].value),
        cartAbandonmentRate: addToCartCount > 0 ? (abandonedCartCount / addToCartCount) * 100 : null,
        series,
      })
    }
  )

  // Per-product breakdown of the same cart_events MOF already aggregates by
  // event_type only — every distinct product that was viewed/added/abandoned in
  // the range, not just a top-N slice. Grouped by product_id (the more reliable
  // identifier — the fallback theme-snippet path only ever sends an id, no
  // name), with product_name picked via MAX() since it should be stable per id.
  // Abandonment reuses the exact same per-visitor "no purchase after this add"
  // heuristic as the MOF cartAbandonmentRate above, just grouped by product too.
  app.get<{ Params: { id: string }; Querystring: CartProductsQuery }>(
    '/clients/:id/reports/cart-products',
    async (req, reply) => {
      const clientId = req.params.id
      const { from, to } = defaultRange(req.query.from, req.query.to)

      const [countsRows, abandonedRows] = await Promise.all([
        db.query<{ product_id: string; product_name: string | null; event_type: string; total: string; value: string }>(
          `SELECT COALESCE(product_id, '(no product id)') AS product_id,
                  MAX(product_name) AS product_name,
                  event_type,
                  COUNT(*) AS total,
                  COALESCE(SUM(value), 0) AS value
           FROM cart_events
           WHERE client_id = $1 AND created_at::date BETWEEN $2 AND $3
           GROUP BY COALESCE(product_id, '(no product id)'), event_type`,
          [clientId, from, to]
        ),
        db.query<{ product_id: string; total: string }>(
          `SELECT COALESCE(ce.product_id, '(no product id)') AS product_id, COUNT(*) AS total
           FROM cart_events ce
           JOIN sessions s ON s.id = ce.session_id
           WHERE ce.client_id = $1 AND ce.event_type = 'add_to_cart' AND ce.created_at::date BETWEEN $2 AND $3
             AND NOT EXISTS (
               SELECT 1 FROM identities i
               JOIN purchases p ON p.client_id = i.client_id AND p.email = i.email
               WHERE i.client_id = ce.client_id AND i.visitor_id = s.visitor_id
                 AND p.purchased_at >= ce.created_at
             )
           GROUP BY COALESCE(ce.product_id, '(no product id)')`,
          [clientId, from, to]
        ),
      ])

      interface ProductAgg {
        productId: string
        productName: string | null
        viewCount: number
        addToCartCount: number
        initiateCheckoutCount: number
        cartValue: number
        abandonedCount: number
      }
      const byProduct = new Map<string, ProductAgg>()
      const getEntry = (productId: string): ProductAgg => {
        let entry = byProduct.get(productId)
        if (!entry) {
          entry = {
            productId,
            productName: null,
            viewCount: 0,
            addToCartCount: 0,
            initiateCheckoutCount: 0,
            cartValue: 0,
            abandonedCount: 0,
          }
          byProduct.set(productId, entry)
        }
        return entry
      }
      for (const r of countsRows.rows) {
        const entry = getEntry(r.product_id)
        entry.productName = entry.productName ?? r.product_name
        const total = parseInt(r.total, 10)
        if (r.event_type === 'view_item') entry.viewCount = total
        else if (r.event_type === 'add_to_cart') {
          entry.addToCartCount = total
          entry.cartValue = parseFloat(r.value)
        } else if (r.event_type === 'begin_checkout') entry.initiateCheckoutCount = total
      }
      for (const r of abandonedRows.rows) {
        getEntry(r.product_id).abandonedCount = parseInt(r.total, 10)
      }

      const products = Array.from(byProduct.values())
        .filter((p) => p.addToCartCount > 0 || p.viewCount > 0 || p.initiateCheckoutCount > 0)
        .map((p) => ({
          ...p,
          productName: p.productName ?? '(unnamed product)',
          abandonmentRate: p.addToCartCount > 0 ? (p.abandonedCount / p.addToCartCount) * 100 : null,
        }))
        .sort((a, b) => b.addToCartCount - a.addToCartCount)

      return reply.send({ from, to, products })
    }
  )

  // Step 43 — budget pacing. Always the CURRENT calendar month (not the report's
  // usual date-range presets) — pacing is inherently "this month so far," a custom
  // range wouldn't mean anything for it. Timezone: uses server-local calendar days
  // via plain Date, matching how the rest of this app buckets spend by date already.
  app.get<{ Params: { id: string } }>('/clients/:id/reports/budget-pacing', async (req, reply) => {
    const clientId = req.params.id
    const { rows: clientRows } = await db.query<{ monthly_budget_target: string | null }>(
      `SELECT monthly_budget_target FROM clients WHERE id = $1`,
      [clientId]
    )
    if (clientRows.length === 0) return reply.code(404).send({ error: 'Not found' })
    const target = clientRows[0].monthly_budget_target === null ? null : parseFloat(clientRows[0].monthly_budget_target)

    const now = new Date()
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0))
    const daysInMonth = monthEnd.getUTCDate()
    const dayOfMonth = now.getUTCDate()

    const { rows: spendRows } = await db.query<{ total: string }>(
      `SELECT
         (SELECT COALESCE(SUM(spend), 0) FROM ad_costs WHERE client_id = $1 AND date >= $2 AND date <= $3) +
         (SELECT COALESCE(SUM(spend), 0) FROM custom_costs WHERE client_id = $1 AND date >= $2 AND date <= $3)
         AS total`,
      [clientId, monthStart.toISOString().slice(0, 10), now.toISOString().slice(0, 10)]
    )
    const spendToDate = parseFloat(spendRows[0].total)
    const expectedSpendToDate = target === null ? null : (target / daysInMonth) * dayOfMonth
    const projectedMonthEndSpend = dayOfMonth > 0 ? (spendToDate / dayOfMonth) * daysInMonth : spendToDate
    const paceStatus =
      target === null
        ? null
        : projectedMonthEndSpend > target * 1.05
          ? 'over'
          : projectedMonthEndSpend < target * 0.95
            ? 'under'
            : 'on_track'

    return reply.send({
      month: monthStart.toISOString().slice(0, 7),
      daysInMonth,
      dayOfMonth,
      target,
      spendToDate,
      expectedSpendToDate,
      projectedMonthEndSpend,
      paceStatus,
    })
  })

  // Step 46 — email/SMS marketing attribution. Klaviyo's own campaign reporting
  // (opens/clicks/revenue per campaign), previously nowhere in this app — the
  // existing 'klaviyo' integration (Step 12) only ever added a person to a list,
  // no visibility into campaign performance existed at all.
  app.get<{ Params: { id: string } }>('/clients/:id/reports/email-sms', async (req, reply) => {
    const { rows } = await db.query<{
      campaign_id: string
      campaign_name: string | null
      channel: string
      recipients: string
      opens: string
      clicks: string
      revenue: string
      orders: string
    }>(
      `SELECT campaign_id, campaign_name, channel,
              SUM(recipients) AS recipients, SUM(opens) AS opens, SUM(clicks) AS clicks,
              SUM(revenue) AS revenue, SUM(orders) AS orders
       FROM email_campaign_stats WHERE client_id = $1
       GROUP BY campaign_id, campaign_name, channel
       ORDER BY SUM(revenue) DESC`,
      [req.params.id]
    )

    const campaigns = rows.map((r) => {
      const recipients = parseInt(r.recipients, 10)
      const opens = parseInt(r.opens, 10)
      const clicks = parseInt(r.clicks, 10)
      const revenue = parseFloat(r.revenue)
      const orders = parseInt(r.orders, 10)
      return {
        campaignId: r.campaign_id,
        campaignName: r.campaign_name ?? '(unnamed campaign)',
        channel: r.channel as 'email' | 'sms',
        recipients,
        opens,
        clicks,
        revenue,
        orders,
        openRate: recipients > 0 ? (opens / recipients) * 100 : null,
        clickRate: recipients > 0 ? (clicks / recipients) * 100 : null,
        revenuePerRecipient: recipients > 0 ? revenue / recipients : null,
      }
    })

    const totals = campaigns.reduce(
      (acc, c) => ({
        recipients: acc.recipients + c.recipients,
        revenue: acc.revenue + c.revenue,
        orders: acc.orders + c.orders,
      }),
      { recipients: 0, revenue: 0, orders: 0 }
    )

    return reply.send({ campaigns, totals })
  })

  // Step 49 — revenue/ROAS/CAC forecasting via a simple linear trend (see
  // lib/forecasting.ts) over the trailing 60 days, projected 7 and 30 days
  // forward. Always the trailing 60 days, not the report's date-range presets —
  // a forecast needs a fixed, sufficiently long lookback to fit a trend against.
  app.get<{ Params: { id: string } }>('/clients/:id/reports/forecast', async (req, reply) => {
    const clientId = req.params.id
    const LOOKBACK_DAYS = 60
    const until = new Date()
    const since = new Date(until)
    since.setUTCDate(since.getUTCDate() - (LOOKBACK_DAYS - 1))
    const sinceStr = since.toISOString().slice(0, 10)
    const untilStr = until.toISOString().slice(0, 10)

    const [costByDay, revenueByDay, customersByDay] = await Promise.all([
      db.query<{ date: string; total: string }>(
        `SELECT date::text, SUM(spend) AS total FROM (
           SELECT date, spend FROM ad_costs WHERE client_id = $1 AND date BETWEEN $2 AND $3
           UNION ALL
           SELECT date, spend FROM custom_costs WHERE client_id = $1 AND date BETWEEN $2 AND $3
         ) combined GROUP BY date`,
        [clientId, sinceStr, untilStr]
      ),
      db.query<{ date: string; total: string }>(
        `SELECT p.purchased_at::date::text AS date, SUM(a.attributed_revenue) AS total
         FROM attributions a JOIN purchases p ON p.id = a.purchase_id
         WHERE a.client_id = $1 AND p.purchased_at::date BETWEEN $2 AND $3
         GROUP BY p.purchased_at::date`,
        [clientId, sinceStr, untilStr]
      ),
      db.query<{ date: string; total: string }>(
        `SELECT first_purchase_date::date::text AS date, COUNT(*) AS total
         FROM customer_ltv WHERE client_id = $1 AND first_purchase_date::date BETWEEN $2 AND $3
         GROUP BY first_purchase_date::date`,
        [clientId, sinceStr, untilStr]
      ),
    ])

    const costMap = new Map(costByDay.rows.map((r) => [r.date, parseFloat(r.total)]))
    const revenueMap = new Map(revenueByDay.rows.map((r) => [r.date, parseFloat(r.total)]))
    const customersMap = new Map(customersByDay.rows.map((r) => [r.date, parseInt(r.total, 10)]))

    const dailyCost: number[] = []
    const dailyRevenue: number[] = []
    const dailyCustomers: number[] = []
    for (let d = new Date(since); d <= until; d.setUTCDate(d.getUTCDate() + 1)) {
      const key = d.toISOString().slice(0, 10)
      dailyCost.push(costMap.get(key) ?? 0)
      dailyRevenue.push(revenueMap.get(key) ?? 0)
      dailyCustomers.push(customersMap.get(key) ?? 0)
    }

    const buildForecast = (daysAhead: number) => {
      const cost = projectSum(dailyCost, daysAhead)
      const revenue = projectSum(dailyRevenue, daysAhead)
      const newCustomers = projectSum(dailyCustomers, daysAhead)
      return {
        days: daysAhead,
        projectedRevenue: revenue,
        projectedCost: cost,
        projectedRoas: cost > 0 ? revenue / cost : null,
        projectedNewCustomers: Math.round(newCustomers),
        projectedCac: newCustomers > 0 ? cost / newCustomers : null,
      }
    }

    return reply.send({
      lookbackDays: LOOKBACK_DAYS,
      from: sinceStr,
      to: untilStr,
      forecast7d: buildForecast(7),
      forecast30d: buildForecast(30),
    })
  })

  // Step 52 — Media Mix Modeling. See lib/mmm.ts for the full methodology
  // disclosure (a straightforward multiple linear regression, not Northbeam-style
  // Bayesian MMM+ with adstock/saturation curves).
  app.get<{ Params: { id: string } }>('/clients/:id/reports/mmm', async (req, reply) => {
    return reply.send(await computeMMM(req.params.id))
  })

  // Saturation-curve budget scenario simulator — see lib/mmmScenario.ts for the
  // full methodology. A POST (not GET) because the proposed reallocation is a
  // real request body, not a cacheable report query.
  app.post<{ Params: { id: string }; Body: { adjustments: ScenarioAdjustment[] } }>(
    '/clients/:id/reports/mmm-scenario',
    async (req, reply) => {
      const adjustments = Array.isArray(req.body?.adjustments) ? req.body.adjustments : []
      return reply.send(await computeMmmScenario(req.params.id, adjustments))
    }
  )

  // Named, curated "best path" callouts (Rockerbox's Marketing Paths pattern) for
  // the Leads page - see lib/bestPaths.ts for the full methodology.
  app.get<{ Params: { id: string }; Querystring: { from?: string; to?: string } }>(
    '/clients/:id/reports/best-paths',
    async (req, reply) => {
      const { from, to } = defaultRange(req.query.from, req.query.to)
      return reply.send(await computeBestPaths(req.params.id, from, to))
    }
  )

  // Phase 2 (2026-07-28), generalized to every niche in Phase 3: the
  // "Customer Buying Journey" tab and its per-niche equivalents (Leads,
  // Subscribers, Booked Calls, Customers). Avg days/sessions to convert, top
  // converting creatives, and the per-person table. See lib/buyingJourney.ts
  // for the full methodology — which event type counts as "a conversion" is
  // driven entirely by the client's niche, not hardcoded to purchases.
  app.get<{ Params: { id: string }; Querystring: { from?: string; to?: string } }>(
    '/clients/:id/reports/buying-journey',
    async (req, reply) => {
      const { from, to } = defaultRange(req.query.from, req.query.to)
      const { rows } = await db.query<{ niche: string }>('SELECT niche FROM clients WHERE id = $1', [req.params.id])
      const niche = rows[0]?.niche ?? 'other'
      return reply.send(await computeBuyingJourneySummary(req.params.id, niche, from, to))
    }
  )

  // First-touch vs last-touch revenue, side by side, per campaign — the
  // account-wide `attribution_model` setting only ever lets a report reflect
  // one model at a time; this recomputes both directly from raw session data
  // (see lib/attributionComparison.ts) so they can be compared without
  // switching that setting back and forth.
  app.get<{ Params: { id: string }; Querystring: { from?: string; to?: string } }>(
    '/clients/:id/reports/attribution-comparison',
    async (req, reply) => {
      const { from, to } = defaultRange(req.query.from, req.query.to)
      return reply.send({ campaigns: await computeAttributionComparison(req.params.id, from, to) })
    }
  )

  // U-Shaped vs Time-Decay comparison for the lead-driven niches (see
  // attributionDefaults.ts) - the equivalent of attribution-comparison above,
  // but for niches whose conversion event (lead/qualified call/subscription)
  // never has rows in the purchase-only `attributions` table at all.
  app.get<{ Params: { id: string }; Querystring: { from?: string; to?: string } }>(
    '/clients/:id/reports/attribution-model-comparison',
    async (req, reply) => {
      const { from, to } = defaultRange(req.query.from, req.query.to)
      const { rows } = await db.query<{ niche: string }>('SELECT niche FROM clients WHERE id = $1', [req.params.id])
      const niche = rows[0]?.niche ?? 'other'
      return reply.send({ campaigns: await computeAttributionModelComparison(req.params.id, niche, from, to) })
    }
  )

  // Customer Journey / Ad Role breakdown - every creative that appears in a
  // converting journey, tagged by whether it was the opener (first touch),
  // the closer (last touch), or an assist (a middle touch), so a cold-traffic
  // opener doesn't get judged - and cut - purely on last-click revenue. See
  // lib/creativeRoles.ts for the full methodology.
  app.get<{ Params: { id: string }; Querystring: { from?: string; to?: string } }>(
    '/clients/:id/reports/creative-roles',
    async (req, reply) => {
      const { from, to } = defaultRange(req.query.from, req.query.to)
      const { rows } = await db.query<{ niche: string }>('SELECT niche FROM clients WHERE id = $1', [req.params.id])
      const niche = rows[0]?.niche ?? 'other'
      return reply.send({ creatives: await computeCreativeRoles(req.params.id, niche, from, to) })
    }
  )

  // Customer Journey path clustering - "N% of buyers touched only this one
  // campaign/creative before buying." See lib/journeyPaths.ts for the full
  // methodology, including why consecutive-repeat collapsing was essential
  // once this was prototyped against real data.
  app.get<{ Params: { id: string }; Querystring: { from?: string; to?: string } }>(
    '/clients/:id/reports/journey-paths',
    async (req, reply) => {
      const { from, to } = defaultRange(req.query.from, req.query.to)
      const { rows } = await db.query<{ niche: string }>('SELECT niche FROM clients WHERE id = $1', [req.params.id])
      const niche = rows[0]?.niche ?? 'other'
      return reply.send(await computeJourneyPaths(req.params.id, niche, from, to))
    }
  )

  // Step 59 — data-driven ("algorithmic") attribution via a Markov chain
  // removal-effect model. See lib/markovAttribution.ts for the full methodology
  // disclosure — this is a channel-level comparison view computed over the
  // account's aggregate history, deliberately separate from whichever rule-based
  // model (Steps 6/30) actually drives the revenue numbers shown everywhere else.
  app.get<{ Params: { id: string }; Querystring: OverviewQuery }>(
    '/clients/:id/reports/markov-attribution',
    async (req, reply) => {
      const { from, to } = defaultRange(req.query.from, req.query.to)
      return reply.send(await computeMarkovAttribution(req.params.id, from, to))
    }
  )

  // Step 56 — invalid-traffic visibility. Advisory only, same "flag, don't
  // silently act" pattern as pause candidates/creative fatigue — nothing here
  // excludes anything from other reports automatically. Note honestly disclosed
  // in the response: this app's ad_costs (spend/clicks/impressions) come from
  // each ad platform's own reported numbers, not this pixel, so invalid traffic
  // here mainly corrupts funnel/engagement metrics, not ad spend efficiency.
  app.get<{ Params: { id: string }; Querystring: OverviewQuery }>(
    '/clients/:id/reports/invalid-traffic',
    async (req, reply) => {
      const clientId = req.params.id
      const { from, to } = defaultRange(req.query.from, req.query.to)

      const [totalRow, botRow, reasonRows] = await Promise.all([
        db.query<{ total: string }>(
          `SELECT COUNT(*) AS total FROM sessions WHERE client_id = $1 AND started_at::date BETWEEN $2 AND $3`,
          [clientId, from, to]
        ),
        db.query<{ total: string }>(
          `SELECT COUNT(*) AS total FROM sessions WHERE client_id = $1 AND started_at::date BETWEEN $2 AND $3 AND is_suspected_bot`,
          [clientId, from, to]
        ),
        db.query<{ bot_reason: string; count: string }>(
          `SELECT bot_reason, COUNT(*) AS count FROM sessions
           WHERE client_id = $1 AND started_at::date BETWEEN $2 AND $3 AND is_suspected_bot
           GROUP BY bot_reason ORDER BY COUNT(*) DESC LIMIT 20`,
          [clientId, from, to]
        ),
      ])

      const totalSessions = parseInt(totalRow.rows[0].total, 10)
      const suspectedBotSessions = parseInt(botRow.rows[0].total, 10)

      return reply.send({
        from,
        to,
        totalSessions,
        suspectedBotSessions,
        suspectedBotRate: totalSessions > 0 ? (suspectedBotSessions / totalSessions) * 100 : null,
        topReasons: reasonRows.rows.map((r) => ({ reason: r.bot_reason, count: parseInt(r.count, 10) })),
      })
    }
  )

  app.get<{ Params: { id: string }; Querystring: LtvQuery }>(
    '/clients/:id/reports/ltv',
    async (req, reply) => {
      const clientId = req.params.id
      const { from, to } = defaultRange(req.query.from, req.query.to)

      // customer_ltv already carries acquisition_campaign (set at first-purchase time
      // by recordPurchase) and revenue_30d/60d/90d/180d/lifetime (kept current by the
      // nightly refresh:ltv job — Step 10) — no joins needed, just aggregate by cohort.
      const { rows } = await db.query<{
        acquisition_campaign: string | null
        customers: string
        avg_30d: string
        avg_60d: string
        avg_90d: string
        avg_180d: string
        avg_lifetime: string
        total_lifetime: string
      }>(
        `SELECT
           acquisition_campaign,
           COUNT(*) AS customers,
           AVG(revenue_30d) AS avg_30d,
           AVG(revenue_60d) AS avg_60d,
           AVG(revenue_90d) AS avg_90d,
           AVG(revenue_180d) AS avg_180d,
           AVG(revenue_lifetime) AS avg_lifetime,
           SUM(revenue_lifetime) AS total_lifetime
         FROM customer_ltv
         WHERE client_id = $1 AND first_purchase_date::date BETWEEN $2 AND $3
         GROUP BY acquisition_campaign
         ORDER BY SUM(revenue_lifetime) DESC`,
        [clientId, from, to]
      )

      // Predictive LTV (Step 37) — cohort-curve extrapolation from this client's own
      // matured customers (see lib/predictiveLtv.ts), not a trained model. The curve
      // itself is computed from the client's WHOLE history, not just this date range,
      // for the largest sample; per-customer predictions are then averaged per campaign.
      const curve = await computeMaturityCurve(clientId)
      const { rows: customerRows } = await db.query<{
        acquisition_campaign: string | null
        revenue_30d: string
        revenue_180d: string
        revenue_lifetime: string
        first_purchase_date: string
      }>(
        `SELECT acquisition_campaign, revenue_30d, revenue_180d, revenue_lifetime, first_purchase_date
         FROM customer_ltv WHERE client_id = $1 AND first_purchase_date::date BETWEEN $2 AND $3`,
        [clientId, from, to]
      )
      const predictedByCampaign = new Map<string, number[]>()
      for (const c of customerRows) {
        const key = c.acquisition_campaign ?? '(unknown)'
        const predicted = predictLifetimeValue(curve, {
          revenue_30d: parseFloat(c.revenue_30d),
          revenue_180d: parseFloat(c.revenue_180d),
          revenue_lifetime: parseFloat(c.revenue_lifetime),
          first_purchase_date: c.first_purchase_date,
        })
        if (predicted === null) continue
        if (!predictedByCampaign.has(key)) predictedByCampaign.set(key, [])
        predictedByCampaign.get(key)!.push(predicted)
      }
      const avgPredicted = (key: string): number | null => {
        const values = predictedByCampaign.get(key)
        if (!values || values.length === 0) return null
        return values.reduce((a, b) => a + b, 0) / values.length
      }

      return reply.send({
        from,
        to,
        predictiveLtvAvailable: curve.multiplier180From30 !== null && curve.multiplierLifetimeFrom180 !== null,
        campaigns: rows.map((r) => {
          const key = r.acquisition_campaign ?? '(unknown)'
          return {
            campaign_name: key,
            customers: parseInt(r.customers, 10),
            avgLtv30d: parseFloat(r.avg_30d),
            avgLtv60d: parseFloat(r.avg_60d),
            avgLtv90d: parseFloat(r.avg_90d),
            avgLtv180d: parseFloat(r.avg_180d),
            avgLtvLifetime: parseFloat(r.avg_lifetime),
            totalLtvLifetime: parseFloat(r.total_lifetime),
            predictedAvgLtv: avgPredicted(key),
          }
        }),
      })
    }
  )

  // Cohorts (Step 30): customer_ltv already carries every revenue-window snapshot
  // needed here — this is pure re-aggregation by acquisition month, no new data
  // collection. Deliberately not using defaultRange()/from-to like other reports:
  // a 30-day default window would show at most one partial cohort, which defeats
  // the point of a month-over-month cohort comparison — `months` controls how many
  // acquisition months back to include instead.
  app.get<{ Params: { id: string }; Querystring: CohortsQuery }>(
    '/clients/:id/reports/cohorts',
    async (req, reply) => {
      const clientId = req.params.id
      const months = Math.max(1, parseInt(req.query.months ?? '12', 10) || 12)

      const { rows } = await db.query<{
        cohort_month: string
        customers: string
        avg_30d: string
        avg_60d: string
        avg_90d: string
        avg_180d: string
        avg_lifetime: string
        total_lifetime: string
      }>(
        `SELECT
           DATE_TRUNC('month', first_purchase_date)::date::text AS cohort_month,
           COUNT(*) AS customers,
           AVG(revenue_30d) AS avg_30d,
           AVG(revenue_60d) AS avg_60d,
           AVG(revenue_90d) AS avg_90d,
           AVG(revenue_180d) AS avg_180d,
           AVG(revenue_lifetime) AS avg_lifetime,
           SUM(revenue_lifetime) AS total_lifetime
         FROM customer_ltv
         WHERE client_id = $1
           AND first_purchase_date IS NOT NULL
           AND first_purchase_date >= DATE_TRUNC('month', NOW()) - ($2 || ' months')::interval
         GROUP BY cohort_month
         ORDER BY cohort_month DESC`,
        [clientId, months]
      )

      return reply.send({
        months,
        cohorts: rows.map((r) => ({
          cohortMonth: r.cohort_month,
          customers: parseInt(r.customers, 10),
          avgLtv30d: parseFloat(r.avg_30d),
          avgLtv60d: parseFloat(r.avg_60d),
          avgLtv90d: parseFloat(r.avg_90d),
          avgLtv180d: parseFloat(r.avg_180d),
          avgLtvLifetime: parseFloat(r.avg_lifetime),
          totalLtvLifetime: parseFloat(r.total_lifetime),
        })),
      })
    }
  )

  // Subscriptions (Step 22) — MRR/churn/trial-conversion reporting for the SaaS
  // vertical (niche='saas'). Current MRR is a live snapshot (not date-scoped);
  // new/churned MRR and trial conversion are scoped to [from, to] via
  // subscription_events. The trend series is a running-total reconstruction —
  // MRR isn't a per-day metric like ad spend, it's cumulative, so every delta
  // up to and including the display range gets summed, then forward-filled across
  // days with no events (same "carry the last known value" as any balance-style metric).
  app.get<{ Params: { id: string }; Querystring: SubscriptionsQuery }>(
    '/clients/:id/reports/subscriptions',
    async (req, reply) => {
      const clientId = req.params.id
      const { from, to } = defaultRange(req.query.from, req.query.to)

      const [currentMrrRow, rangeStatsRow, deltaRows] = await Promise.all([
        db.query<{ current_mrr: string; active_count: string }>(
          `SELECT COALESCE(SUM(mrr_amount), 0) AS current_mrr, COUNT(*) AS active_count
           FROM subscriptions WHERE client_id = $1 AND status = 'active'`,
          [clientId]
        ),
        db.query<{
          trials_started: string
          trials_converted: string
          canceled_count: string
          new_mrr: string
          churned_mrr: string
          expansion_mrr: string
          contraction_mrr: string
        }>(
          `SELECT
             COUNT(*) FILTER (WHERE event_type = 'trial_started') AS trials_started,
             COUNT(*) FILTER (WHERE event_type = 'trial_converted') AS trials_converted,
             COUNT(*) FILTER (WHERE event_type = 'canceled') AS canceled_count,
             COALESCE(SUM(mrr_delta) FILTER (WHERE event_type IN ('created', 'trial_converted', 'reactivated')), 0) AS new_mrr,
             COALESCE(SUM(mrr_delta) FILTER (WHERE event_type = 'canceled'), 0) AS churned_mrr,
             COALESCE(SUM(mrr_delta) FILTER (WHERE event_type = 'plan_changed' AND mrr_delta > 0), 0) AS expansion_mrr,
             COALESCE(SUM(mrr_delta) FILTER (WHERE event_type = 'plan_changed' AND mrr_delta < 0), 0) AS contraction_mrr
           FROM subscription_events
           WHERE client_id = $1 AND occurred_at::date BETWEEN $2 AND $3`,
          [clientId, from, to]
        ),
        db.query<{ date: string; delta: string }>(
          `SELECT occurred_at::date::text AS date, SUM(mrr_delta) AS delta
           FROM subscription_events
           WHERE client_id = $1 AND occurred_at::date <= $2
           GROUP BY occurred_at::date
           ORDER BY occurred_at::date`,
          [clientId, to]
        ),
      ])

      const deltaByDate = new Map(deltaRows.rows.map((r) => [r.date, parseFloat(r.delta)]))
      const allDates = Array.from(deltaByDate.keys()).sort()
      let running = 0
      let dateIdx = 0
      const cumulativeByDate = new Map<string, number>()
      for (const date of allDates) {
        running += deltaByDate.get(date) ?? 0
        cumulativeByDate.set(date, running)
      }

      let lastKnown = 0
      const series = dateList(from, to).map((date) => {
        while (dateIdx < allDates.length && allDates[dateIdx] <= date) {
          lastKnown = cumulativeByDate.get(allDates[dateIdx])!
          dateIdx++
        }
        return { date, mrr: lastKnown }
      })

      // Starting MRR for Net Revenue Retention — the running total as of the last
      // event strictly before `from` (0 if this client has no subscription history
      // that far back). allDates/cumulativeByDate already cover every event up to
      // `to` with no lower bound, so this is the same reconstruction the trend
      // series above already does, just read at one specific point instead of
      // forward-filled across the whole range.
      let startingMrr = 0
      for (const date of allDates) {
        if (date >= from) break
        startingMrr = cumulativeByDate.get(date)!
      }

      const trialsStarted = parseInt(rangeStatsRow.rows[0].trials_started, 10)
      const trialsConverted = parseInt(rangeStatsRow.rows[0].trials_converted, 10)
      const canceledCount = parseInt(rangeStatsRow.rows[0].canceled_count, 10)
      const currentMrr = parseFloat(currentMrrRow.rows[0].current_mrr)
      const activeCount = parseInt(currentMrrRow.rows[0].active_count, 10)
      const expansionMrr = parseFloat(rangeStatsRow.rows[0].expansion_mrr)
      const contractionMrr = parseFloat(rangeStatsRow.rows[0].contraction_mrr)
      const churnedMrr = parseFloat(rangeStatsRow.rows[0].churned_mrr)
      // Logo churn rate: canceled-in-range / (currently active + canceled-in-range) —
      // an approximation of "active at the start of the period" without needing a
      // point-in-time historical snapshot, same simplicity as the BOF report's
      // refund-rate math elsewhere in this file.
      const churnBase = activeCount + canceledCount
      // Net Revenue Retention: what happened to the STARTING cohort's revenue
      // over the range — expansion/contraction/churn only, new-customer MRR
      // deliberately excluded (NRR measures retention of who was already there,
      // not new growth). Simple standard approximation, not cohort-exact: a
      // customer who both signed up AND churned within the same range still
      // counts its churned_mrr against the starting base here, same "simple
      // method, clearly disclosed" tradeoff as this app's forecast/predictive-LTV.
      const nrr = startingMrr > 0 ? ((startingMrr + expansionMrr + contractionMrr + churnedMrr) / startingMrr) * 100 : null

      return reply.send({
        from,
        to,
        currentMrr,
        arr: currentMrr * 12,
        activeCount,
        newMrr: parseFloat(rangeStatsRow.rows[0].new_mrr),
        expansionMrr,
        contractionMrr,
        churnedMrr,
        nrr,
        trialsStarted,
        trialsConverted,
        trialConversionRate: trialsStarted > 0 ? (trialsConverted / trialsStarted) * 100 : null,
        canceledCount,
        churnRate: churnBase > 0 ? (canceledCount / churnBase) * 100 : null,
        series,
      })
    }
  )

  app.get<{ Params: { id: string }; Querystring: FunnelQuery }>(
    '/clients/:id/reports/funnel',
    async (req, reply) => {
      const clientId = req.params.id
      const { from, to } = defaultRange(req.query.from, req.query.to)
      const breakdown =
        req.query.breakdown === 'source'
          ? 'source'
          : req.query.breakdown === 'keyword'
            ? 'keyword'
            : req.query.breakdown === 'creative'
              ? 'creative'
              : 'campaign'

      const marginConfigRow = await db.query<MarginConfig>(
        `SELECT cogs_percent, payment_fee_percent, fulfillment_cost_flat FROM clients WHERE id = $1`,
        [clientId]
      )
      const marginConfig = marginConfigRow.rows[0] ?? null

      const [spendRows, leadRows, revenueRows] =
        breakdown === 'source'
          ? await Promise.all([
              getSpendBySource(clientId, from, to),
              getLeadsBySource(clientId, from, to),
              getRevenueBySource(clientId, from, to),
            ])
          : breakdown === 'keyword'
            ? await Promise.all([
                Promise.resolve({ rows: [] as SpendRow[] }),
                getLeadsByKeyword(clientId, from, to),
                getRevenueByKeyword(clientId, from, to),
              ])
            : breakdown === 'creative'
              ? await Promise.all([
                  getSpendByCreative(clientId, from, to),
                  getLeadsByCreative(clientId, from, to),
                  getRevenueByCreative(clientId, from, to),
                ])
              : await Promise.all([
                  getSpendByCampaign(clientId, from, to),
                  getLeadsByCampaign(clientId, from, to),
                  getRevenueByCampaign(clientId, from, to),
                ])

      const normalize =
        breakdown === 'source'
          ? normalizeSource
          : breakdown === 'keyword'
            ? normalizeKeyword
            : breakdown === 'creative'
              ? normalizeCreative
              : normalizeCampaignName

      // Campaign and creative names are frequently reused across ad platforms (e.g.
      // "Summer Sale" on both Facebook and Google) — keying on the name alone made
      // those platforms silently overwrite each other's cost/leads/revenue in one
      // blended row. For these two breakdowns the key also folds in the platform
      // (ad_costs.platform on the spend side, utm_source on the lead/revenue side,
      // both run through normalizeSource so "facebook_ads" and "facebook" compare
      // equal) so same-named campaigns/creatives on different platforms land in
      // separate rows. Source breakdown already keys on platform alone (the name IS
      // the platform), and keyword breakdown never carries ad_costs/platform data,
      // so neither needs this.
      const keyIncludesPlatform = breakdown === 'campaign' || breakdown === 'creative'
      const buildKey = (name: string | null, platformValue: string | null): string => {
        const base = normalize(name)
        if (!keyIncludesPlatform) return base
        return `${base}::${platformValue ? normalizeSource(platformValue) : ''}`
      }

      interface Row {
        name: string
        platform: string | null
        // Only ever set for the creative breakdown, from the matching ad_costs row —
        // the campaign a specific ad belongs to, so the dashboard can link straight to
        // that ad's detail page. A creative row with no spend backing it (unmatched,
        // leads/revenue only) has no campaign to point at, stays null.
        campaignName: string | null
        cost: number
        impressions: number
        clicks: number
        leads: number
        sales: number
        revenue: number
      }

      const rows = new Map<string, Row>()
      // Lookup-only index from an ad platform's raw numeric campaign_id/ad_id to the
      // same Row objects as `rows` above — never iterated directly (only `rows` is,
      // at the end), just a second way to find a row. Exists because a client's ad
      // URLs can carry Meta's dynamic {{campaign.id}}/{{ad.id}} token instead of
      // {{campaign.name}}/{{ad.name}} in utm_campaign/utm_content - when that
      // happens, matching by name alone always misses (a session's utm_campaign is
      // a raw id like "120245194137140253", ad_costs.campaign_name is real text),
      // and the purchase lands in its own unmatched row labeled with that raw id
      // instead of merging into the real campaign/creative. ad_costs already has
      // the id from the Marketing API sync either way, so this needs no change to
      // how the client tags their ads.
      const idIndex = new Map<string, Row>()
      const findRow = (key: string): Row | undefined => rows.get(key) ?? idIndex.get(key)

      const getOrCreate = (key: string, fallbackName: string): Row => {
        let row = rows.get(key)
        if (!row) {
          row = {
            name: fallbackName,
            platform: null,
            campaignName: null,
            cost: 0,
            impressions: 0,
            clicks: 0,
            leads: 0,
            sales: 0,
            revenue: 0,
          }
          rows.set(key, row)
        }
        return row
      }

      for (const r of spendRows.rows) {
        const name =
          breakdown === 'source'
            ? (r as { platform: string }).platform
            : breakdown === 'creative'
              ? (r as unknown as { ad_name: string | null }).ad_name
              : (r as SpendRow).campaign_name
        const idValue =
          breakdown === 'campaign'
            ? (r as SpendRow).campaign_id
            : breakdown === 'creative'
              ? (r as unknown as { ad_id: string | null }).ad_id
              : null
        const platform = breakdown === 'source' ? (r as { platform: string }).platform : (r as SpendRow).platform
        const key = buildKey(name, platform)
        const row = getOrCreate(key, name ?? (breakdown === 'creative' ? '(unnamed creative)' : '(unnamed campaign)'))
        row.platform = platform
        if (breakdown === 'creative') row.campaignName = (r as unknown as { campaign_name: string | null }).campaign_name
        row.cost = parseFloat(r.cost)
        row.impressions = parseInt((r as { impressions: string }).impressions ?? '0', 10)
        row.clicks = parseInt((r as { clicks: string }).clicks ?? '0', 10)
        if (idValue) {
          const idKey = buildKey(idValue, platform)
          if (idKey !== key) idIndex.set(idKey, row)
        }
      }

      const fieldFor = (r: unknown): string | null =>
        breakdown === 'source'
          ? (r as { utm_source: string | null }).utm_source
          : breakdown === 'keyword'
            ? (r as { utm_term: string | null }).utm_term
            : breakdown === 'creative'
              ? (r as { utm_content: string | null }).utm_content
              : (r as { utm_campaign: string | null }).utm_campaign
      const fallbackFor = () =>
        breakdown === 'source'
          ? '(no utm_source)'
          : breakdown === 'keyword'
            ? '(no utm_term)'
            : breakdown === 'creative'
              ? '(no utm_content)'
              : '(no utm_campaign)'

      // Only campaign/creative rows carry a separate utm_source column (added
      // alongside utm_campaign/utm_content specifically so this key can be built) —
      // source breakdown's own utm_source IS fieldFor(r) already, and keyword rows
      // never had one to begin with.
      const sourceFieldFor = (r: unknown): string | null =>
        keyIncludesPlatform ? (r as { utm_source: string | null }).utm_source : null

      for (const r of leadRows.rows) {
        const name = fieldFor(r)
        const source = sourceFieldFor(r)
        const key = buildKey(name, source)
        const row = findRow(key) ?? getOrCreate(key, name ?? fallbackFor())
        // Rows with no matching ad_costs (never hit the spend loop above) would
        // otherwise show no platform badge at all, even though the raw utm_source
        // tells us what platform the lead actually came from.
        if (row.platform === null && source) row.platform = source
        row.leads = parseInt(r.leads, 10)
      }

      for (const r of revenueRows.rows) {
        const name = fieldFor(r)
        const source = sourceFieldFor(r)
        const key = buildKey(name, source)
        const row = findRow(key) ?? getOrCreate(key, name ?? fallbackFor())
        if (row.platform === null && source) row.platform = source
        row.revenue = parseFloat(r.revenue)
        row.sales = parseInt(r.sales, 10)
      }

      // ad-object-fallback (docs/ISSUE_LOG.md "Proposed enhancements"): an unmatched
      // creative row with no ad_costs backing shows its raw utm_content as `name` —
      // for a client using Meta's dynamic {{ad.id}} URL token, that raw value IS the
      // ad's real id. Try recovering the real name/campaign for those specifically
      // (skips anything not shaped like a Facebook ad id, and anything Meta itself
      // reports as truly deleted) so the table shows a real ad name instead of a
      // bare numeric id, same fix as the campaign-detail drill-down page.
      if (breakdown === 'creative') {
        const unmatched = Array.from(rows.values()).filter((r) => r.cost === 0 && /^\d{10,20}$/.test(r.name))
        for (const row of unmatched) {
          await resolveAdObjectFallback(clientId, row.name)
        }
        if (unmatched.length > 0) {
          const { rows: recovered } = await db.query<{ ad_id: string; ad_name: string | null; campaign_name: string | null }>(
            `SELECT ad_id, ad_name, campaign_name FROM ad_costs
             WHERE client_id = $1 AND ad_id = ANY($2::text[]) AND ad_name IS NOT NULL`,
            [clientId, unmatched.map((r) => r.name)]
          )
          const byAdId = new Map(recovered.map((r) => [r.ad_id, r]))
          for (const row of unmatched) {
            const found = byAdId.get(row.name)
            if (found?.ad_name) {
              row.name = found.ad_name
              row.campaignName = found.campaign_name
            }
          }
        }
      }

      // "matched" means real ad-platform spend backs this row — the anchor dimension
      // here is spend, so a row assembled only from leads/revenue with no cost is the
      // UTM-tagging-mismatch signal worth flagging rather than hiding. CTR/CPC surface
      // here for every breakdown (not creative-only) since ad_costs already carries
      // impressions/clicks for campaign/source too — just never exposed before.
      const rowsOut = Array.from(rows.values())
        .map((r) => ({
          ...r,
          cpl: r.leads > 0 ? r.cost / r.leads : null,
          costPerPurchase: r.sales > 0 ? r.cost / r.sales : null,
          aov: r.sales > 0 ? r.revenue / r.sales : null,
          profit: r.revenue - r.cost,
          roas: r.cost > 0 ? r.revenue / r.cost : null,
          ctr: r.impressions > 0 ? (r.clicks / r.impressions) * 100 : null,
          cpc: r.clicks > 0 ? r.cost / r.clicks : null,
          matched: r.cost > 0,
          trueProfit: computeTrueProfit(marginConfig, r.revenue, r.cost, r.sales).trueProfit,
        }))
        .sort((a, b) => b.revenue - a.revenue)

      return reply.send({ from, to, breakdown, campaigns: rowsOut })
    }
  )

  app.get<{ Querystring: AgencyOverviewQuery }>('/reports/agency-overview', async (req, reply) => {
    const { from, to } = defaultRange(req.query.from, req.query.to)
    const { prevFrom, prevTo } = previousPeriod(from, to)

    const { rows } = await db.query<{
      id: string
      name: string
      cost: string
      revenue: string
      prev_revenue: string
      sales: string
      cogs_percent: string | null
      payment_fee_percent: string | null
      fulfillment_cost_flat: string | null
    }>(
      `SELECT
         c.id,
         c.name,
         c.cogs_percent,
         c.payment_fee_percent,
         c.fulfillment_cost_flat,
         COALESCE(spend.total, 0) AS cost,
         COALESCE(rev.total, 0) AS revenue,
         COALESCE(rev.sales, 0) AS sales,
         COALESCE(prev_rev.total, 0) AS prev_revenue
       FROM clients c
       LEFT JOIN (
         SELECT client_id, SUM(spend) AS total FROM ad_costs
         WHERE date BETWEEN $1 AND $2 GROUP BY client_id
       ) spend ON spend.client_id = c.id
       -- Total revenue from every non-refunded purchase, attributed or not — same
       -- "trust the store's real revenue over Meta/Google's own attribution" basis
       -- getOverviewSummary uses for a single client's headline Revenue tile.
       -- Gating this on attributions.attributed_revenue (as before) silently
       -- dropped organic/direct/unmatched sales, understating revenue below what
       -- the store actually recognizes - worse than an ad platform's own
       -- under-tracking, not a fix for it.
       LEFT JOIN (
         SELECT client_id, SUM(revenue) AS total, COUNT(*) AS sales
         FROM purchases
         WHERE purchased_at::date BETWEEN $1 AND $2 AND NOT refunded
         GROUP BY client_id
       ) rev ON rev.client_id = c.id
       LEFT JOIN (
         SELECT client_id, SUM(revenue) AS total
         FROM purchases
         WHERE purchased_at::date BETWEEN $3 AND $4 AND NOT refunded
         GROUP BY client_id
       ) prev_rev ON prev_rev.client_id = c.id
       WHERE c.owner_user_id = $5
          OR c.id IN (SELECT client_id FROM client_collaborators WHERE user_id = $5)
       ORDER BY c.name`,
      [from, to, prevFrom, prevTo, req.userId]
    )

    const clients = rows.map((r) => {
      const cost = parseFloat(r.cost)
      const revenue = parseFloat(r.revenue)
      const prevRevenue = parseFloat(r.prev_revenue)
      const sales = parseInt(r.sales, 10)
      const profit = revenue - cost
      const { trueProfit, trueRoi } = computeTrueProfit(r, revenue, cost, sales)
      return {
        id: r.id,
        name: r.name,
        cost,
        revenue,
        profit,
        roas: cost > 0 ? revenue / cost : null,
        roi: cost > 0 ? (profit / cost) * 100 : null,
        trueProfit,
        trueRoi,
        revenueChangePct: prevRevenue > 0 ? ((revenue - prevRevenue) / prevRevenue) * 100 : null,
      }
    })

    const totals = clients.reduce(
      (acc, c) => ({
        cost: acc.cost + c.cost,
        revenue: acc.revenue + c.revenue,
        profit: acc.profit + c.profit,
        trueProfit: acc.trueProfit + c.trueProfit,
      }),
      { cost: 0, revenue: 0, profit: 0, trueProfit: 0 }
    )

    return reply.send({ from, to, clients, totals })
  })

  app.get<{ Params: { id: string }; Querystring: CallsQuery }>(
    '/clients/:id/reports/calls',
    async (req, reply) => {
      const clientId = req.params.id
      const { from, to } = defaultRange(req.query.from, req.query.to)

      const [totalsRow, campaignRows, dispositionRows] = await Promise.all([
        db.query<{ total: string; qualified: string; avg_duration: string | null; avg_score: string | null }>(
          `SELECT COUNT(*) AS total,
                  COUNT(*) FILTER (WHERE qualified) AS qualified,
                  AVG(duration_seconds) AS avg_duration,
                  AVG(qualification_score) AS avg_score
           FROM calls WHERE client_id = $1 AND started_at::date BETWEEN $2 AND $3`,
          [clientId, from, to]
        ),
        db.query<{ utm_campaign: string | null; calls: string }>(
          `SELECT s.utm_campaign, COUNT(*) AS calls
           FROM calls c
           JOIN sessions s ON s.id = c.session_id
           WHERE c.client_id = $1 AND c.started_at::date BETWEEN $2 AND $3
           GROUP BY s.utm_campaign
           ORDER BY COUNT(*) DESC`,
          [clientId, from, to]
        ),
        // Step 23 — disposition breakdown. NULL disposition (calls never manually
        // tagged) surfaces as '(untagged)' rather than being silently dropped.
        db.query<{ disposition: string | null; calls: string }>(
          `SELECT disposition, COUNT(*) AS calls
           FROM calls WHERE client_id = $1 AND started_at::date BETWEEN $2 AND $3
           GROUP BY disposition
           ORDER BY COUNT(*) DESC`,
          [clientId, from, to]
        ),
      ])

      const totalCalls = parseInt(totalsRow.rows[0].total, 10)
      const qualifiedCalls = parseInt(totalsRow.rows[0].qualified, 10)

      return reply.send({
        from,
        to,
        totalCalls,
        qualifiedCalls,
        qualifiedRate: totalCalls > 0 ? (qualifiedCalls / totalCalls) * 100 : null,
        avgDurationSeconds:
          totalsRow.rows[0].avg_duration !== null ? parseFloat(totalsRow.rows[0].avg_duration) : null,
        avgQualificationScore:
          totalsRow.rows[0].avg_score !== null ? parseFloat(totalsRow.rows[0].avg_score) : null,
        byCampaign: campaignRows.rows.map((r) => ({
          campaign_name: r.utm_campaign ?? '(untracked)',
          calls: parseInt(r.calls, 10),
        })),
        byDisposition: dispositionRows.rows.map((r) => ({
          disposition: r.disposition ?? '(untagged)',
          calls: parseInt(r.calls, 10),
        })),
      })
    }
  )
}
