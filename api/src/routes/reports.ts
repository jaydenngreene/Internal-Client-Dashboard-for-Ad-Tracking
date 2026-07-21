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

const normalizeCampaignName = (name: string | null) => (name ?? '').trim().toLowerCase()

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
        db.query<{ utm_campaign: string | null; revenue: string; sales: string }>(
          `SELECT s.utm_campaign, SUM(a.attributed_revenue) AS revenue, COUNT(DISTINCT a.purchase_id) AS sales
           FROM attributions a
           JOIN sessions s ON s.id = a.session_id
           JOIN purchases p ON p.id = a.purchase_id
           WHERE a.client_id = $1 AND p.purchased_at::date BETWEEN $2 AND $3
           GROUP BY s.utm_campaign`,
          [clientId, from, to]
        ),
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
        // Attribute each lead to the visitor's most recent session at-or-before the
        // lead was created (first-touch-per-lead), the same acquisition convention
        // customer_ltv uses — independent of the client's purchase attribution_model,
        // since a lead isn't revenue to split, just a single acquisition event.
        db.query<{ utm_campaign: string | null; leads: string }>(
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
        ),
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
}
