import { FastifyInstance } from 'fastify'
import { db } from '../db'

function defaultRange(from?: string, to?: string): { from: string; to: string } {
  if (from && to) return { from, to }
  const toDate = new Date()
  const fromDate = new Date(toDate)
  fromDate.setUTCDate(fromDate.getUTCDate() - 29)
  return { from: fromDate.toISOString().slice(0, 10), to: toDate.toISOString().slice(0, 10) }
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

interface CampaignsQuery {
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

interface FunnelQuery {
  from?: string
  to?: string
  breakdown?: 'campaign' | 'source'
}

interface AgencyOverviewQuery {
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

function getSpendByCampaign(clientId: string, from: string, to: string) {
  return db.query<SpendRow>(
    `SELECT campaign_id, campaign_name, platform,
            SUM(spend) AS cost, SUM(impressions) AS impressions, SUM(clicks) AS clicks
     FROM ad_costs
     WHERE client_id = $1 AND date BETWEEN $2 AND $3
     GROUP BY campaign_id, campaign_name, platform`,
    [clientId, from, to]
  )
}

// Attributes each lead to the visitor's most recent session at-or-before the lead
// was created (first-touch-per-lead, same acquisition convention as customer_ltv) —
// independent of the client's purchase attribution_model, since a lead isn't
// revenue to split, just a single acquisition event.
function getLeadsByCampaign(clientId: string, from: string, to: string) {
  return db.query<{ utm_campaign: string | null; leads: string }>(
    `SELECT s.utm_campaign, COUNT(DISTINCT l.id) AS leads
     FROM leads l
     JOIN identities i ON i.client_id = l.client_id AND i.email = l.email
     JOIN LATERAL (
       SELECT utm_campaign FROM sessions
       WHERE visitor_id = i.visitor_id
         AND started_at <= l.created_at
         AND started_at >= l.created_at - INTERVAL '90 days'
       ORDER BY started_at ASC
       LIMIT 1
     ) s ON true
     WHERE l.client_id = $1 AND l.created_at::date BETWEEN $2 AND $3
     GROUP BY s.utm_campaign`,
    [clientId, from, to]
  )
}

function getRevenueByCampaign(clientId: string, from: string, to: string) {
  return db.query<{ utm_campaign: string | null; revenue: string; sales: string }>(
    `SELECT s.utm_campaign, SUM(a.attributed_revenue) AS revenue, COUNT(DISTINCT a.purchase_id) AS sales
     FROM attributions a
     JOIN sessions s ON s.id = a.session_id
     JOIN purchases p ON p.id = a.purchase_id
     WHERE a.client_id = $1 AND p.purchased_at::date BETWEEN $2 AND $3
     GROUP BY s.utm_campaign`,
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
     GROUP BY platform`,
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

const normalizeCampaignName = (name: string | null) => (name ?? '').trim().toLowerCase()
const normalizeSource = (name: string | null) => (name ?? '').trim().toLowerCase().replace(/_ads$/, '')

export async function reportRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string }; Querystring: OverviewQuery }>(
    '/clients/:id/reports/overview',
    async (req, reply) => {
      const clientId = req.params.id
      const { from, to } = defaultRange(req.query.from, req.query.to)

      const [costTotal, revenueTotal, leadsTotal, salesTotal, costByDay, revenueByDay] = await Promise.all([
        db.query<{ total: string }>(
          `SELECT COALESCE(SUM(spend), 0) AS total FROM ad_costs WHERE client_id = $1 AND date BETWEEN $2 AND $3`,
          [clientId, from, to]
        ),
        db.query<{ total: string }>(
          `SELECT COALESCE(SUM(a.attributed_revenue), 0) AS total
           FROM attributions a JOIN purchases p ON p.id = a.purchase_id
           WHERE a.client_id = $1 AND p.purchased_at::date BETWEEN $2 AND $3`,
          [clientId, from, to]
        ),
        db.query<{ total: string }>(
          `SELECT COUNT(*) AS total FROM leads WHERE client_id = $1 AND created_at::date BETWEEN $2 AND $3`,
          [clientId, from, to]
        ),
        db.query<{ total: string }>(
          `SELECT COUNT(*) AS total FROM purchases
           WHERE client_id = $1 AND purchased_at::date BETWEEN $2 AND $3 AND NOT refunded`,
          [clientId, from, to]
        ),
        db.query<{ date: string; total: string }>(
          `SELECT date::text, SUM(spend) AS total FROM ad_costs
           WHERE client_id = $1 AND date BETWEEN $2 AND $3 GROUP BY date`,
          [clientId, from, to]
        ),
        db.query<{ date: string; total: string }>(
          `SELECT p.purchased_at::date::text AS date, SUM(a.attributed_revenue) AS total
           FROM attributions a JOIN purchases p ON p.id = a.purchase_id
           WHERE a.client_id = $1 AND p.purchased_at::date BETWEEN $2 AND $3
           GROUP BY p.purchased_at::date`,
          [clientId, from, to]
        ),
      ])

      const cost = parseFloat(costTotal.rows[0].total)
      const revenue = parseFloat(revenueTotal.rows[0].total)
      const profit = revenue - cost
      const roas = cost > 0 ? revenue / cost : null
      const roi = cost > 0 ? (profit / cost) * 100 : null

      const costByDate = new Map(costByDay.rows.map((r) => [r.date, parseFloat(r.total)]))
      const revenueByDate = new Map(revenueByDay.rows.map((r) => [r.date, parseFloat(r.total)]))

      const series = dateList(from, to).map((date) => {
        const dailyCost = costByDate.get(date) ?? 0
        const dailyRevenue = revenueByDate.get(date) ?? 0
        return { date, cost: dailyCost, revenue: dailyRevenue, profit: dailyRevenue - dailyCost }
      })

      return reply.send({
        from,
        to,
        cost,
        revenue,
        profit,
        roas,
        roi,
        leads: parseInt(leadsTotal.rows[0].total, 10),
        sales: parseInt(salesTotal.rows[0].total, 10),
        series,
      })
    }
  )

  app.get<{ Params: { id: string }; Querystring: CampaignsQuery }>(
    '/clients/:id/reports/campaigns',
    async (req, reply) => {
      const clientId = req.params.id
      const { from, to } = defaultRange(req.query.from, req.query.to)

      const [spendRows, revenueRows] = await Promise.all([
        getSpendByCampaign(clientId, from, to),
        getRevenueByCampaign(clientId, from, to),
      ])

      const normalize = normalizeCampaignName

      interface Row {
        campaign_name: string
        platform: string | null
        cost: number
        impressions: number
        clicks: number
        revenue: number
        sales: number
        matched: boolean
      }

      const rows = new Map<string, Row>()

      for (const r of spendRows.rows) {
        const key = normalize(r.campaign_name)
        rows.set(key, {
          campaign_name: r.campaign_name ?? '(unnamed campaign)',
          platform: r.platform,
          cost: parseFloat(r.cost),
          impressions: parseInt(r.impressions, 10),
          clicks: parseInt(r.clicks, 10),
          revenue: 0,
          sales: 0,
          matched: false,
        })
      }

      for (const r of revenueRows.rows) {
        const key = normalize(r.utm_campaign)
        const existing = rows.get(key)
        if (existing) {
          existing.revenue = parseFloat(r.revenue)
          existing.sales = parseInt(r.sales, 10)
          existing.matched = true
        } else {
          rows.set(key, {
            campaign_name: r.utm_campaign ?? '(no utm_campaign)',
            platform: null,
            cost: 0,
            impressions: 0,
            clicks: 0,
            revenue: parseFloat(r.revenue),
            sales: parseInt(r.sales, 10),
            matched: false,
          })
        }
      }

      const campaigns = Array.from(rows.values())
        .map((r) => ({
          ...r,
          profit: r.revenue - r.cost,
          roas: r.cost > 0 ? r.revenue / r.cost : null,
        }))
        .sort((a, b) => b.revenue - a.revenue)

      return reply.send({ from, to, campaigns })
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

      return reply.send({
        from,
        to,
        campaigns: rows.map((r) => ({
          campaign_name: r.acquisition_campaign ?? '(unknown)',
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

  app.get<{ Params: { id: string }; Querystring: FunnelQuery }>(
    '/clients/:id/reports/funnel',
    async (req, reply) => {
      const clientId = req.params.id
      const { from, to } = defaultRange(req.query.from, req.query.to)
      const breakdown = req.query.breakdown === 'source' ? 'source' : 'campaign'

      const [spendRows, leadRows, revenueRows] =
        breakdown === 'source'
          ? await Promise.all([
              getSpendBySource(clientId, from, to),
              getLeadsBySource(clientId, from, to),
              getRevenueBySource(clientId, from, to),
            ])
          : await Promise.all([
              getSpendByCampaign(clientId, from, to),
              getLeadsByCampaign(clientId, from, to),
              getRevenueByCampaign(clientId, from, to),
            ])

      const normalize = breakdown === 'source' ? normalizeSource : normalizeCampaignName

      interface Row {
        name: string
        platform: string | null
        cost: number
        leads: number
        sales: number
        revenue: number
      }

      const rows = new Map<string, Row>()

      const getOrCreate = (key: string, fallbackName: string): Row => {
        let row = rows.get(key)
        if (!row) {
          row = { name: fallbackName, platform: null, cost: 0, leads: 0, sales: 0, revenue: 0 }
          rows.set(key, row)
        }
        return row
      }

      for (const r of spendRows.rows) {
        const name = breakdown === 'source' ? (r as { platform: string }).platform : (r as SpendRow).campaign_name
        const platform = breakdown === 'source' ? (r as { platform: string }).platform : (r as SpendRow).platform
        const key = normalize(name)
        const row = getOrCreate(key, name ?? '(unnamed campaign)')
        row.platform = platform
        row.cost = parseFloat(r.cost)
      }

      for (const r of leadRows.rows) {
        const name = breakdown === 'source' ? (r as { utm_source: string | null }).utm_source : (r as { utm_campaign: string | null }).utm_campaign
        const key = normalize(name)
        const row = getOrCreate(key, name ?? (breakdown === 'source' ? '(no utm_source)' : '(no utm_campaign)'))
        row.leads = parseInt(r.leads, 10)
      }

      for (const r of revenueRows.rows) {
        const name = breakdown === 'source' ? (r as { utm_source: string | null }).utm_source : (r as { utm_campaign: string | null }).utm_campaign
        const key = normalize(name)
        const row = getOrCreate(key, name ?? (breakdown === 'source' ? '(no utm_source)' : '(no utm_campaign)'))
        row.revenue = parseFloat(r.revenue)
        row.sales = parseInt(r.sales, 10)
      }

      // "matched" means real ad-platform spend backs this row — the anchor dimension
      // here is spend, so a row assembled only from leads/revenue with no cost is the
      // UTM-tagging-mismatch signal worth flagging rather than hiding.
      const rowsOut = Array.from(rows.values())
        .map((r) => ({
          ...r,
          cpl: r.leads > 0 ? r.cost / r.leads : null,
          profit: r.revenue - r.cost,
          roas: r.cost > 0 ? r.revenue / r.cost : null,
          matched: r.cost > 0,
        }))
        .sort((a, b) => b.revenue - a.revenue)

      return reply.send({ from, to, breakdown, campaigns: rowsOut })
    }
  )

  app.get<{ Querystring: AgencyOverviewQuery }>('/reports/agency-overview', async (req, reply) => {
    const { from, to } = defaultRange(req.query.from, req.query.to)

    const { rows } = await db.query<{
      id: string
      name: string
      cost: string
      revenue: string
    }>(
      `SELECT
         c.id,
         c.name,
         COALESCE(spend.total, 0) AS cost,
         COALESCE(rev.total, 0) AS revenue
       FROM clients c
       LEFT JOIN (
         SELECT client_id, SUM(spend) AS total FROM ad_costs
         WHERE date BETWEEN $1 AND $2 GROUP BY client_id
       ) spend ON spend.client_id = c.id
       LEFT JOIN (
         SELECT a.client_id, SUM(a.attributed_revenue) AS total
         FROM attributions a JOIN purchases p ON p.id = a.purchase_id
         WHERE p.purchased_at::date BETWEEN $1 AND $2
         GROUP BY a.client_id
       ) rev ON rev.client_id = c.id
       ORDER BY c.name`,
      [from, to]
    )

    const clients = rows.map((r) => {
      const cost = parseFloat(r.cost)
      const revenue = parseFloat(r.revenue)
      const profit = revenue - cost
      return {
        id: r.id,
        name: r.name,
        cost,
        revenue,
        profit,
        roas: cost > 0 ? revenue / cost : null,
        roi: cost > 0 ? (profit / cost) * 100 : null,
      }
    })

    const totals = clients.reduce(
      (acc, c) => ({ cost: acc.cost + c.cost, revenue: acc.revenue + c.revenue, profit: acc.profit + c.profit }),
      { cost: 0, revenue: 0, profit: 0 }
    )

    return reply.send({ from, to, clients, totals })
  })
}
