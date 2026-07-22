import { FastifyInstance } from 'fastify'
import { db } from '../db'
import { computeTrueProfit, MarginConfig } from '../lib/margin'
import { defaultRange } from './reports'

// Client-facing white-label report (Step 40) — deliberately unauthenticated, the
// public_share_token itself IS the credential (same trust model as any
// "shareable view link" feature: possession of the link is possession of read
// access). Scope is intentionally a single clean overview, not the full internal
// dashboard surface — no integration configs, no raw campaign-level cost data
// broken out by ad platform, nothing a client's own competitors would find useful
// if the link ever leaked. Extending this to more report types is a disclosed,
// deliberate future step, not an oversight.
export async function publicShareRoutes(app: FastifyInstance) {
  app.get<{ Params: { token: string }; Querystring: { from?: string; to?: string } }>(
    '/public/share/:token/overview',
    async (req, reply) => {
      const { rows: clientRows } = await db.query<{
        id: string
        name: string
        cogs_percent: string | null
        payment_fee_percent: string | null
        fulfillment_cost_flat: string | null
      }>(
        `SELECT id, name, cogs_percent, payment_fee_percent, fulfillment_cost_flat
         FROM clients WHERE public_share_token = $1`,
        [req.params.token]
      )
      if (clientRows.length === 0) return reply.code(404).send({ error: 'Invalid or revoked link' })
      const client = clientRows[0]
      const { from, to } = defaultRange(req.query.from, req.query.to)

      const [costTotal, revenueTotal, salesTotal, costByDay, revenueByDay] = await Promise.all([
        db.query<{ total: string }>(
          `SELECT
             (SELECT COALESCE(SUM(spend), 0) FROM ad_costs WHERE client_id = $1 AND date BETWEEN $2 AND $3) +
             (SELECT COALESCE(SUM(spend), 0) FROM custom_costs WHERE client_id = $1 AND date BETWEEN $2 AND $3)
             AS total`,
          [client.id, from, to]
        ),
        db.query<{ total: string }>(
          `SELECT COALESCE(SUM(a.attributed_revenue), 0) AS total
           FROM attributions a JOIN purchases p ON p.id = a.purchase_id
           WHERE a.client_id = $1 AND p.purchased_at::date BETWEEN $2 AND $3`,
          [client.id, from, to]
        ),
        db.query<{ total: string }>(
          `SELECT COUNT(*) AS total FROM purchases
           WHERE client_id = $1 AND purchased_at::date BETWEEN $2 AND $3 AND NOT refunded`,
          [client.id, from, to]
        ),
        db.query<{ date: string; total: string }>(
          `SELECT date::text, SUM(spend) AS total FROM (
             SELECT date, spend FROM ad_costs WHERE client_id = $1 AND date BETWEEN $2 AND $3
             UNION ALL
             SELECT date, spend FROM custom_costs WHERE client_id = $1 AND date BETWEEN $2 AND $3
           ) combined GROUP BY date`,
          [client.id, from, to]
        ),
        db.query<{ date: string; total: string }>(
          `SELECT p.purchased_at::date::text AS date, SUM(a.attributed_revenue) AS total
           FROM attributions a JOIN purchases p ON p.id = a.purchase_id
           WHERE a.client_id = $1 AND p.purchased_at::date BETWEEN $2 AND $3
           GROUP BY p.purchased_at::date`,
          [client.id, from, to]
        ),
      ])

      const cost = parseFloat(costTotal.rows[0].total)
      const revenue = parseFloat(revenueTotal.rows[0].total)
      const sales = parseInt(salesTotal.rows[0].total, 10)
      const roas = cost > 0 ? revenue / cost : null
      const { trueProfit, trueRoi } = computeTrueProfit(client as MarginConfig, revenue, cost, sales)

      const costByDate = new Map(costByDay.rows.map((r) => [r.date, parseFloat(r.total)]))
      const revenueByDate = new Map(revenueByDay.rows.map((r) => [r.date, parseFloat(r.total)]))
      const dates: string[] = []
      for (let d = new Date(from + 'T00:00:00Z'); d <= new Date(to + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)) {
        dates.push(d.toISOString().slice(0, 10))
      }
      const series = dates.map((date) => ({
        date,
        cost: costByDate.get(date) ?? 0,
        revenue: revenueByDate.get(date) ?? 0,
      }))

      return reply.send({
        clientName: client.name,
        from,
        to,
        cost,
        revenue,
        profit: trueProfit,
        roas,
        roi: trueRoi,
        sales,
        series,
      })
    }
  )
}
