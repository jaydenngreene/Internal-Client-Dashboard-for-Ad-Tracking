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
        db.query<{
          campaign_id: string | null
          campaign_name: string | null
          platform: string
          cost: string
          impressions: string
          clicks: string
        }>(
          `SELECT campaign_id, campaign_name, platform,
                  SUM(spend) AS cost, SUM(impressions) AS impressions, SUM(clicks) AS clicks
           FROM ad_costs
           WHERE client_id = $1 AND date BETWEEN $2 AND $3
           GROUP BY campaign_id, campaign_name, platform`,
          [clientId, from, to]
        ),
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

      const normalize = (name: string | null) => (name ?? '').trim().toLowerCase()

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
}
