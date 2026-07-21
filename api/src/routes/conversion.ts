import { FastifyInstance } from 'fastify'
import { db } from '../db'

interface ConversionBody {
  pixel_key: string
  email: string
  revenue: number
  product?: string
  order_id?: string
  processor?: string
  // optionally pass anonymous_id if available (e.g. checkout page still has cookie)
  anonymous_id?: string
}

export async function conversionRoutes(app: FastifyInstance) {
  app.post<{ Body: ConversionBody }>('/track/conversion', async (req, reply) => {
    const { pixel_key, email, revenue, product, order_id, processor, anonymous_id } = req.body

    if (!pixel_key || !email || revenue === undefined) {
      return reply.code(400).send({ error: 'Missing required fields' })
    }

    const normalizedEmail = email.toLowerCase().trim()

    const { rows: clientRows } = await db.query(
      'SELECT id FROM clients WHERE pixel_key = $1',
      [pixel_key]
    )
    if (clientRows.length === 0) {
      return reply.code(401).send({ error: 'Invalid pixel key' })
    }
    const clientId = clientRows[0].id

    // Record the purchase
    const { rows: purchaseRows } = await db.query(
      `INSERT INTO purchases (client_id, email, revenue, product, order_id, processor)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [clientId, normalizedEmail, revenue, product, order_id, processor]
    )
    const purchaseId = purchaseRows[0].id

    // Resolve visitor from email identity OR anonymous_id
    let visitorId: string | null = null

    const { rows: identityRows } = await db.query(
      'SELECT visitor_id FROM identities WHERE client_id = $1 AND email = $2',
      [clientId, normalizedEmail]
    )
    if (identityRows.length > 0) {
      visitorId = identityRows[0].visitor_id
    } else if (anonymous_id) {
      const { rows: visitorRows } = await db.query(
        'SELECT id FROM visitors WHERE client_id = $1 AND anonymous_id = $2',
        [clientId, anonymous_id]
      )
      if (visitorRows.length > 0) {
        visitorId = visitorRows[0].id
        // Now we have identity — save it for future purchases
        await db.query(
          `INSERT INTO identities (client_id, email, visitor_id)
           VALUES ($1, $2, $3)
           ON CONFLICT (client_id, email) DO NOTHING`,
          [clientId, normalizedEmail, visitorId]
        )
      }
    }

    if (!visitorId) {
      // Purchase recorded but can't attribute — no ad history found
      return reply.code(200).send({ ok: true, attributed: false, reason: 'no_identity' })
    }

    // Find the attributable session (first click within 90 day window)
    const { rows: sessionRows } = await db.query(
      `SELECT id, fbclid, gclid, utm_source, utm_campaign, utm_content
       FROM sessions
       WHERE visitor_id = $1
         AND started_at >= NOW() - INTERVAL '90 days'
       ORDER BY started_at ASC
       LIMIT 1`,
      [visitorId]
    )

    if (sessionRows.length === 0) {
      return reply.code(200).send({ ok: true, attributed: false, reason: 'outside_window' })
    }

    const session = sessionRows[0]

    // Write attribution record
    await db.query(
      `INSERT INTO attributions (client_id, purchase_id, session_id, model, credit_fraction, attributed_revenue)
       VALUES ($1, $2, $3, 'first_click', 1.0, $4)`,
      [clientId, purchaseId, session.id, revenue]
    )

    // Update or insert customer LTV
    await db.query(
      `INSERT INTO customer_ltv (client_id, email, acquisition_campaign, acquisition_ad, acquisition_source, first_purchase_date, revenue_lifetime, purchase_count)
       VALUES ($1, $2, $3, $4, $5, NOW(), $6, 1)
       ON CONFLICT (client_id, email)
       DO UPDATE SET
         revenue_lifetime = customer_ltv.revenue_lifetime + EXCLUDED.revenue_lifetime,
         purchase_count = customer_ltv.purchase_count + 1,
         last_updated = NOW()`,
      [clientId, normalizedEmail, session.utm_campaign, session.utm_content, session.utm_source, revenue]
    )

    return reply.code(200).send({ ok: true, attributed: true, session_id: session.id })
  })
}
