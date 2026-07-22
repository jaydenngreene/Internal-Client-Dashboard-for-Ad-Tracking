import * as crypto from 'crypto'
import { db } from '../db'

export type OutboundEventType = 'sale.attributed' | 'lead.opted.in' | 'call.qualified'

// Backoff schedule indexed by retry_count going INTO the attempt (0 = first retry
// after the original failed send). Five retries after the original send (six
// attempts total) spread over about 6 hours before giving up for good — long
// enough to ride out a client's short outage/deploy, not so long a real
// integration problem sits silently for days.
const RETRY_DELAYS_MINUTES = [1, 5, 30, 120, 360]
export const MAX_RETRIES = RETRY_DELAYS_MINUTES.length

function sign(secret: string, body: string): string {
  return crypto.createHmac('sha256', secret).update(body).digest('hex')
}

interface DeliveryAttemptResult {
  responseStatus: number | null
  error: string | null
}

async function attemptDelivery(targetUrl: string, signingSecret: string, body: string): Promise<DeliveryAttemptResult> {
  try {
    const res = await fetch(targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-ADT-Signature': sign(signingSecret, body) },
      body,
    })
    return { responseStatus: res.status, error: res.ok ? null : `Non-2xx response: ${res.status}` }
  } catch (err) {
    return { responseStatus: null, error: (err as Error).message }
  }
}

// Dispatches an internal event to every active subscription that's asked for it.
// Never throws — a client's own endpoint being down must never block the purchase/
// lead/call flow that triggered it, same philosophy as sendConversionSignals. A
// failed delivery is now retried (Step 38) by a separate scheduled job
// (jobs/webhookRetry/run.ts) rather than logged-and-dropped — this function only
// makes the first attempt and schedules the first retry if it fails.
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
      const { responseStatus, error } = await attemptDelivery(sub.target_url, sub.signing_secret, body)
      if (error) console.error(`[outboundWebhooks] delivery failed for subscription=${sub.id}:`, error)

      const nextRetryAt = error ? new Date(Date.now() + RETRY_DELAYS_MINUTES[0] * 60 * 1000) : null

      await db.query(
        `INSERT INTO outbound_webhook_deliveries (subscription_id, event_type, payload, response_status, error, next_retry_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [sub.id, eventType, JSON.stringify(payload), responseStatus, error, nextRetryAt]
      )
    })
  )
}

// Retries deliveries whose next_retry_at has come due, up to MAX_RETRIES total
// attempts. A subscription deactivated since the original failure is skipped
// (its deliveries just age out unretried) rather than firing at a URL the client
// deliberately turned off.
export async function retryFailedWebhookDeliveries(): Promise<number> {
  const { rows } = await db.query<{
    id: string
    subscription_id: string
    event_type: OutboundEventType
    payload: Record<string, unknown>
    retry_count: number
    target_url: string
    signing_secret: string
    active: boolean
  }>(
    `SELECT d.id, d.subscription_id, d.event_type, d.payload, d.retry_count,
            s.target_url, s.signing_secret, s.active
     FROM outbound_webhook_deliveries d
     JOIN outbound_webhook_subscriptions s ON s.id = d.subscription_id
     WHERE d.next_retry_at IS NOT NULL AND d.next_retry_at <= NOW() AND d.retry_count < $1
     ORDER BY d.next_retry_at ASC LIMIT 50`,
    [MAX_RETRIES]
  )

  let retried = 0
  for (const delivery of rows) {
    if (!delivery.active) {
      await db.query(`UPDATE outbound_webhook_deliveries SET next_retry_at = NULL WHERE id = $1`, [delivery.id])
      continue
    }

    const body = JSON.stringify({ event: delivery.event_type, data: delivery.payload, occurred_at: new Date().toISOString() })
    const { responseStatus, error } = await attemptDelivery(delivery.target_url, delivery.signing_secret, body)
    const newRetryCount = delivery.retry_count + 1
    const nextRetryAt =
      error && newRetryCount < MAX_RETRIES ? new Date(Date.now() + RETRY_DELAYS_MINUTES[newRetryCount] * 60 * 1000) : null

    await db.query(
      `UPDATE outbound_webhook_deliveries
       SET response_status = $2, error = $3, retry_count = $4, next_retry_at = $5
       WHERE id = $1`,
      [delivery.id, responseStatus, error, newRetryCount, nextRetryAt]
    )
    retried++
    if (error) {
      console.error(`[webhook-retry] delivery=${delivery.id} attempt ${newRetryCount}/${MAX_RETRIES} failed:`, error)
    } else {
      console.log(`[webhook-retry] delivery=${delivery.id} succeeded on attempt ${newRetryCount}`)
    }
  }
  return retried
}
