import { FastifyInstance } from 'fastify'
import { db } from '../db'

interface SessionRow {
  id: string
  started_at: string
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  utm_content: string | null
  utm_term: string | null
  landing_page: string | null
  referrer: string | null
  fbclid: string | null
  gclid: string | null
  ttclid: string | null
}

interface PurchaseRow {
  id: string
  revenue: string
  product: string | null
  order_id: string | null
  processor: string | null
  refunded: boolean
  refunded_at: string | null
  purchased_at: string
}

interface AttributionRow {
  purchase_id: string
  session_id: string
  model: string
  credit_fraction: string
  attributed_revenue: string
}

interface TagRow {
  name: string
  tag_type: string
  applied_at: string
  applied_by: string
}

interface CallRow {
  id: string
  session_id: string | null
  status: string | null
  duration_seconds: number | null
  qualified: boolean | null
  disposition: string | null
  started_at: string
}

// One place to see everything this app knows about a single lead — every session/
// touchpoint that led here, which one(s) got attribution credit for which purchase,
// every tag applied, and every call. Previously this data only existed scattered
// across aggregate report tables; the click-chain itself was computed for
// attribution math in lib/attribution.ts and then discarded, never surfaced to a
// human. A purchase with no matching identity (e.g. a CRM-only lead, never
// pixel-tracked) still shows up here as an unattributed purchase — flagged
// explicitly — rather than silently vanishing the way it does in aggregate reports.
export async function journeyRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string; email: string } }>(
    '/clients/:id/leads/:email/journey',
    async (req, reply) => {
      const clientId = req.params.id
      const email = req.params.email.toLowerCase().trim()

      const { rows: identityRows } = await db.query<{ visitor_id: string; identified_at: string; identified_on_page: string | null }>(
        `SELECT visitor_id, identified_at, identified_on_page FROM identities WHERE client_id = $1 AND email = $2`,
        [clientId, email]
      )
      const identity = identityRows[0] ?? null

      const sessions = identity
        ? (
            await db.query<SessionRow>(
              `SELECT id, started_at, utm_source, utm_medium, utm_campaign, utm_content, utm_term,
                      landing_page, referrer, fbclid, gclid, ttclid
               FROM sessions WHERE client_id = $1 AND visitor_id = $2 ORDER BY started_at ASC`,
              [clientId, identity.visitor_id]
            )
          ).rows
        : []

      const { rows: purchaseRows } = await db.query<PurchaseRow>(
        `SELECT id, revenue, product, order_id, processor, refunded, refunded_at, purchased_at
         FROM purchases WHERE client_id = $1 AND email = $2 ORDER BY purchased_at ASC`,
        [clientId, email]
      )

      const { rows: attributionRows } = await db.query<AttributionRow>(
        `SELECT a.purchase_id, a.session_id, a.model, a.credit_fraction, a.attributed_revenue
         FROM attributions a
         JOIN purchases p ON p.id = a.purchase_id
         WHERE a.client_id = $1 AND p.email = $2`,
        [clientId, email]
      )

      const { rows: tagRows } = await db.query<TagRow>(
        `SELECT t.name, t.tag_type, lt.applied_at, lt.applied_by
         FROM lead_tags lt JOIN tags t ON t.id = lt.tag_id
         WHERE lt.client_id = $1 AND lt.email = $2 ORDER BY lt.applied_at ASC`,
        [clientId, email]
      )

      const sessionIds = sessions.map((s) => s.id)
      const calls =
        sessionIds.length > 0
          ? (
              await db.query<CallRow>(
                `SELECT id, session_id, status, duration_seconds, qualified, disposition, started_at
                 FROM calls WHERE client_id = $1 AND session_id = ANY($2::uuid[]) ORDER BY started_at ASC`,
                [clientId, sessionIds]
              )
            ).rows
          : []

      const attributedPurchaseIds = new Set(attributionRows.map((a) => a.purchase_id))
      const purchases = purchaseRows.map((p) => ({
        ...p,
        revenue: parseFloat(p.revenue),
        attributed: attributedPurchaseIds.has(p.id),
        attributions: attributionRows
          .filter((a) => a.purchase_id === p.id)
          .map((a) => ({
            session_id: a.session_id,
            model: a.model,
            credit_fraction: parseFloat(a.credit_fraction),
            attributed_revenue: parseFloat(a.attributed_revenue),
          })),
      }))

      return reply.send({
        email,
        identified: identity !== null,
        identified_at: identity?.identified_at ?? null,
        identified_on_page: identity?.identified_on_page ?? null,
        sessions,
        purchases,
        tags: tagRows,
        calls,
      })
    }
  )
}
