import { FastifyInstance } from 'fastify'
import { db } from '../db'
import { recordPurchase } from '../lib/attribution'
import { lookupVisitorId } from '../lib/visitorResolution'

interface ConversionBody {
  pixel_key: string
  email: string
  revenue: number
  product?: string
  order_id?: string
  processor?: string
  currency?: string
  // Sent by the pixel so a visitor can be resolved even if identify() wasn't
  // called first (e.g. email only captured at the moment of purchase).
  anonymous_id?: string
}

export async function conversionRoutes(app: FastifyInstance) {
  app.post<{ Body: ConversionBody }>('/track/conversion', async (req, reply) => {
    const { pixel_key, email, revenue, product, order_id, processor, anonymous_id, currency } = req.body

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

    // If there's no identity yet but the pixel sent an anonymous_id, resolve it to a
    // visitor and backfill the identity so recordPurchase's own lookup can find it.
    if (anonymous_id) {
      const { rows: identityRows } = await db.query(
        'SELECT 1 FROM identities WHERE client_id = $1 AND email = $2',
        [clientId, normalizedEmail]
      )
      if (identityRows.length === 0) {
        // Checks visitor_aliases first (Step 14) so a fingerprint-matched
        // cleared-cookie visitor's purchase still backfills correctly.
        const visitorId = await lookupVisitorId(clientId, anonymous_id)
        if (visitorId) {
          await db.query(
            `INSERT INTO identities (client_id, email, visitor_id)
             VALUES ($1, $2, $3)
             ON CONFLICT (client_id, email) DO NOTHING`,
            [clientId, normalizedEmail, visitorId]
          )
        }
      }
    }

    await recordPurchase(clientId, {
      email: normalizedEmail,
      revenue,
      product,
      order_id,
      processor: processor ?? 'direct',
      currency,
    })

    return reply.code(200).send({ ok: true })
  })
}
