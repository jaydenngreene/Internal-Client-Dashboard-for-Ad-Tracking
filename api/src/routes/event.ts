import { FastifyInstance } from 'fastify'
import { db } from '../db'
import { resolveSession } from '../lib/session'
import { sendConversionSignals, SignalEventType } from '../lib/conversionSignals'

type CartEventType = 'view_item' | 'add_to_cart' | 'begin_checkout'

interface EventBody {
  pixel_key: string
  anonymous_id: string
  event_type: CartEventType
  url: string
  product_id?: string
  product_name?: string
  value?: number
}

const SIGNAL_EVENT_NAME: Record<CartEventType, SignalEventType> = {
  view_item: 'ViewContent',
  add_to_cart: 'AddToCart',
  begin_checkout: 'InitiateCheckout',
}

export async function eventRoutes(app: FastifyInstance) {
  app.post<{ Body: EventBody }>('/track/event', async (req, reply) => {
    const { pixel_key, anonymous_id, event_type, url, product_id, product_name, value } = req.body

    if (!pixel_key || !anonymous_id || !event_type || !url) {
      return reply.code(400).send({ error: 'Missing required fields' })
    }
    if (!(event_type in SIGNAL_EVENT_NAME)) {
      return reply.code(400).send({ error: 'Invalid event_type' })
    }

    const { rows: clientRows } = await db.query('SELECT id FROM clients WHERE pixel_key = $1', [pixel_key])
    if (clientRows.length === 0) {
      return reply.code(401).send({ error: 'Invalid pixel key' })
    }
    const clientId = clientRows[0].id

    const { rows: visitorRows } = await db.query<{ id: string; ip: string | null; user_agent: string | null }>(
      'SELECT id, ip, user_agent FROM visitors WHERE client_id = $1 AND anonymous_id = $2',
      [clientId, anonymous_id]
    )
    if (visitorRows.length === 0) {
      return reply.code(404).send({ error: 'Visitor not found' })
    }
    const visitor = visitorRows[0]

    const sessionId = await resolveSession(clientId, visitor.id, url)

    await db.query(
      `INSERT INTO cart_events (client_id, session_id, event_type, product_id, product_name, value)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [clientId, sessionId, event_type, product_id ?? null, product_name ?? null, value ?? null]
    )

    const { rows: sessionRows } = await db.query<{ fbclid: string | null; gclid: string | null }>(
      'SELECT fbclid, gclid FROM sessions WHERE id = $1',
      [sessionId]
    )

    await sendConversionSignals(clientId, {
      eventType: SIGNAL_EVENT_NAME[event_type],
      value: value ?? null,
      fbclid: sessionRows[0]?.fbclid ?? null,
      gclid: sessionRows[0]?.gclid ?? null,
      ip: visitor.ip,
      userAgent: visitor.user_agent,
      eventTime: new Date(),
    })

    return reply.code(200).send({ ok: true })
  })
}
