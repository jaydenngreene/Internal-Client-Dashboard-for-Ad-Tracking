import * as crypto from 'crypto'
import { db } from '../db'

export type OutboundEventType = 'sale.attributed' | 'lead.opted.in' | 'call.qualified'

function sign(secret: string, body: string): string {
  return crypto.createHmac('sha256', secret).update(body).digest('hex')
}

// Dispatches an internal event to every active subscription that's asked for it.
// Never throws — a client's own endpoint being down must never block the purchase/
// lead/call flow that triggered it, same philosophy as sendConversionSignals. No
// retry/backoff: a failed delivery is logged to outbound_webhook_deliveries and
// dropped, a deliberate scope line for this app's scale, not an oversight.
export async function dispatchEvent(
  clientId: string,
  eventType: OutboundEventType,
  payload: Record<string, unknown>
): Promise<void> {
  const { rows: subscriptions } = await db.query<{ id: string; target_url: string; signing_secret: string }>(
    `SELECT id, target_url, signing_secret FROM outbound_webhook_subscriptions
     WHERE client_id = $1 AND active AND $2 = ANY(event_types)`,
    [clientId, eventType]
  )
  if (subscriptions.length === 0) return

  const body = JSON.stringify({ event: eventType, data: payload, occurred_at: new Date().toISOString() })

  await Promise.all(
    subscriptions.map(async (sub) => {
      let responseStatus: number | null = null
      let error: string | null = null
      try {
        const res = await fetch(sub.target_url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-ADT-Signature': sign(sub.signing_secret, body) },
          body,
        })
        responseStatus = res.status
        if (!res.ok) error = `Non-2xx response: ${res.status}`
      } catch (err) {
        error = (err as Error).message
        console.error(`[outboundWebhooks] delivery failed for subscription=${sub.id}:`, error)
      }

      await db.query(
        `INSERT INTO outbound_webhook_deliveries (subscription_id, event_type, payload, response_status, error)
         VALUES ($1, $2, $3, $4, $5)`,
        [sub.id, eventType, JSON.stringify(payload), responseStatus, error]
      )
    })
  )
}
