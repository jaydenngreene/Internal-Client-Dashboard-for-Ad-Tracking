import { FastifyInstance } from 'fastify'
import { db } from '../db'
import { computeTrueProfit, MarginConfig } from '../lib/margin'
import { computeMaturityCurve, predictLifetimeValue } from '../lib/predictiveLtv'
import { projectSum } from '../lib/forecasting'
import { computeMMM } from '../lib/mmm'
import { computeMmmScenario, ScenarioAdjustment } from '../lib/mmmScenario'
import { getOverviewSummary } from '../lib/overviewSummary'
import { computeMarkovAttribution } from '../lib/markovAttribution'

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
  return db.query<{ ad_id: string; ad_name: string | null; platform: string; cost: string; impressions: string; clicks: string }>(
    `SELECT ad_id, ad_name, platform,
            SUM(spend) AS cost, SUM(impressions) AS impressions, SUM(clicks) AS clicks
     FROM ad_costs
     WHERE client_id = $1 AND date BETWEEN $2 AND $3
     GROUP BY ad_id, ad_name, platform`,
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

      const [summary, marginConfig, costByDay, revenueByDay, salesByDay] = await Promise.all([
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
      ])

      const { cost, revenue, profit, roas, roi, trueProfit, trueRoi, leads, sales } = summary
      const margin = marginConfig.rows[0] ?? null

      const costByDate = new Map(costByDay.rows.map((r) => [r.date, parseFloat(r.total)]))
      const revenueByDate = new Map(revenueByDay.rows.map((r) => [r.date, parseFloat(r.total)]))
      const salesByDate = new Map(salesByDay.rows.map((r) => [r.date, parseInt(r.total, 10)]))

      const series = dateList(from, to).map((date) => {
        const dailyCost = costByDate.get(date) ?? 0
        const dailyRevenue = revenueByDate.get(date) ?? 0
        const dailySales = salesByDate.get(date) ?? 0
        return {
          date,
          cost: dailyCost,
          revenue: dailyRevenue,
          profit: dailyRevenue - dailyCost,
          trueProfit: computeTrueProfit(margin, dailyRevenue, dailyCost, dailySales).trueProfit,
        }
      })

      return reply.send({
        from,
        to,
        cost,
        revenue,
        profit,
        roas,
        roi,
        trueProfit,
        trueRoi,
        hasMarginConfig: Boolean(margin && (margin.cogs_percent || margin.payment_fee_percent || margin.fulfillment_cost_flat)),
        leads,
        sales,
        series,
      })
    }
  )

  app.get<{ Params: { id: string }; Querystring: LeadsQuery }>(
    '/clients/:id/reports/leads',
    async (req, reply) => {
      const clientId = req.params.id
      const { from, to } = defaultRange(req.query.from, req.query.to)

      const [totalRow, spendRows, leadsByCampaign] = await Promise.all([
        db.query<{ total: string }>(
          `SELECT COUNT(*) AS total FROM leads WHERE client_id = $1 AND created_at::date BETWEEN $2 AND $3`,
          [clientId, from, to]
        ),
        getSpendByCampaign(clientId, from, to),
        getLeadsByCampaign(clientId, from, to),
      ])

      const totalLeads = parseInt(totalRow.rows[0].total, 10)
      const totalCost = spendRows.rows.reduce((sum, r) => sum + parseFloat(r.cost), 0)
      const cpl = totalLeads > 0 ? totalCost / totalLeads : null

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

      return reply.send({ from, to, totalLeads, cpl, campaigns })
    }
  )

  app.get<{ Params: { id: string }; Querystring: BofQuery }>(
    '/clients/:id/reports/bof',
    async (req, reply) => {
      const clientId = req.params.id
      const { from, to } = defaultRange(req.query.from, req.query.to)

      const [conversionRow, orderRow, aovBySource] = await Promise.all([
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
      ])

      const totalLeads = parseInt(conversionRow.rows[0].total_leads, 10)
      const convertedLeads = parseInt(conversionRow.rows[0].converted_leads, 10)
      const leadToBuyerRate = totalLeads > 0 ? (convertedLeads / totalLeads) * 100 : null
      const avgDaysToConvert = conversionRow.rows[0].avg_days !== null ? parseFloat(conversionRow.rows[0].avg_days) : null

      const totalOrders = parseInt(orderRow.rows[0].total, 10)
      const refundedOrders = parseInt(orderRow.rows[0].refunded, 10)
      const refundRate = totalOrders > 0 ? (refundedOrders / totalOrders) * 100 : null

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
        aovBySource: aovBySource.rows.map((r) => ({
          source: r.utm_source ?? '(unknown)',
          aov: parseFloat(r.aov),
          sales: parseInt(r.sales, 10),
        })),
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

      const [sessionsRow, pageviewsRow, engagedRow, cartCountsRow, abandonedRow] = await Promise.all([
        db.query<{ total: string }>(
          `SELECT COUNT(*) AS total FROM sessions WHERE client_id = $1 AND started_at::date BETWEEN $2 AND $3`,
          [clientId, from, to]
        ),
        db.query<{ total: string }>(
          `SELECT COUNT(*) AS total FROM pageviews WHERE client_id = $1 AND timestamp::date BETWEEN $2 AND $3`,
          [clientId, from, to]
        ),
        db.query<{ total: string }>(
          `SELECT COUNT(DISTINCT pv.session_id) AS total
           FROM pageviews pv JOIN sessions s ON s.id = pv.session_id
           WHERE pv.client_id = $1 AND s.started_at::date BETWEEN $2 AND $3`,
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
      ])

      const totalSessions = parseInt(sessionsRow.rows[0].total, 10)
      const totalPageviews = parseInt(pageviewsRow.rows[0].total, 10)
      const engagedSessions = parseInt(engagedRow.rows[0].total, 10)

      const cartCounts = Object.fromEntries(cartCountsRow.rows.map((r) => [r.event_type, parseInt(r.total, 10)]))
      const viewContentCount = cartCounts.view_item ?? 0
      const addToCartCount = cartCounts.add_to_cart ?? 0
      const initiateCheckoutCount = cartCounts.begin_checkout ?? 0
      const abandonedCartCount = parseInt(abandonedRow.rows[0].total, 10)

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
      })
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
        }>(
          `SELECT
             COUNT(*) FILTER (WHERE event_type = 'trial_started') AS trials_started,
             COUNT(*) FILTER (WHERE event_type = 'trial_converted') AS trials_converted,
             COUNT(*) FILTER (WHERE event_type = 'canceled') AS canceled_count,
             COALESCE(SUM(mrr_delta) FILTER (WHERE event_type IN ('created', 'trial_converted', 'reactivated')), 0) AS new_mrr,
             COALESCE(SUM(mrr_delta) FILTER (WHERE event_type = 'canceled'), 0) AS churned_mrr
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

      const trialsStarted = parseInt(rangeStatsRow.rows[0].trials_started, 10)
      const trialsConverted = parseInt(rangeStatsRow.rows[0].trials_converted, 10)
      const canceledCount = parseInt(rangeStatsRow.rows[0].canceled_count, 10)
      const currentMrr = parseFloat(currentMrrRow.rows[0].current_mrr)
      const activeCount = parseInt(currentMrrRow.rows[0].active_count, 10)
      // Logo churn rate: canceled-in-range / (currently active + canceled-in-range) —
      // an approximation of "active at the start of the period" without needing a
      // point-in-time historical snapshot, same simplicity as the BOF report's
      // refund-rate math elsewhere in this file.
      const churnBase = activeCount + canceledCount

      return reply.send({
        from,
        to,
        currentMrr,
        activeCount,
        newMrr: parseFloat(rangeStatsRow.rows[0].new_mrr),
        churnedMrr: parseFloat(rangeStatsRow.rows[0].churned_mrr),
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
        cost: number
        impressions: number
        clicks: number
        leads: number
        sales: number
        revenue: number
      }

      const rows = new Map<string, Row>()

      const getOrCreate = (key: string, fallbackName: string): Row => {
        let row = rows.get(key)
        if (!row) {
          row = { name: fallbackName, platform: null, cost: 0, impressions: 0, clicks: 0, leads: 0, sales: 0, revenue: 0 }
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
        const platform = breakdown === 'source' ? (r as { platform: string }).platform : (r as SpendRow).platform
        const key = buildKey(name, platform)
        const row = getOrCreate(key, name ?? (breakdown === 'creative' ? '(unnamed creative)' : '(unnamed campaign)'))
        row.platform = platform
        row.cost = parseFloat(r.cost)
        row.impressions = parseInt((r as { impressions: string }).impressions ?? '0', 10)
        row.clicks = parseInt((r as { clicks: string }).clicks ?? '0', 10)
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
        const row = getOrCreate(key, name ?? fallbackFor())
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
        const row = getOrCreate(key, name ?? fallbackFor())
        if (row.platform === null && source) row.platform = source
        row.revenue = parseFloat(r.revenue)
        row.sales = parseInt(r.sales, 10)
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
       LEFT JOIN (
         SELECT a.client_id, SUM(a.attributed_revenue) AS total, COUNT(DISTINCT a.purchase_id) AS sales
         FROM attributions a JOIN purchases p ON p.id = a.purchase_id
         WHERE p.purchased_at::date BETWEEN $1 AND $2
         GROUP BY a.client_id
       ) rev ON rev.client_id = c.id
       LEFT JOIN (
         SELECT a.client_id, SUM(a.attributed_revenue) AS total
         FROM attributions a JOIN purchases p ON p.id = a.purchase_id
         WHERE p.purchased_at::date BETWEEN $3 AND $4
         GROUP BY a.client_id
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
