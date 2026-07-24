import { db } from '../db'
import { sendConversionSignals } from './conversionSignals'
import { dispatchEvent } from './outboundWebhooks'
import { convertToBaseCurrency, getClientCurrency } from './currency'
import { parseAdParamsFromLandingSite } from './session'
import { resolveVisitor } from './visitorResolution'

export interface NormalizedConversion {
  email: string
  revenue: number
  product?: string | null
  order_id?: string | null
  processor: string
  // Step 48 — the currency `revenue` was reported in (e.g. Shopify's order
  // currency, Stripe's session currency). Omitted entirely means "already in the
  // client's base currency" (e.g. GoHighLevel's custom webhook schema has no
  // reliable currency field) — no conversion happens, same as today's behavior.
  currency?: string | null
  // The order's real placed-at date. Omitted means "right now" (every live
  // webhook/CAPI call wants that, via the purchased_at DEFAULT NOW()) — only the
  // historical CSV importer sets this, so backfilled orders land on their real
  // date instead of the moment they were uploaded.
  purchased_at?: Date | string | null
  // Shopify order's `landing_site` — attribution fallback when our own session
  // tracking finds nothing for this email (see recordPurchase below).
  landing_site?: string | null
}

type AttributionModel = 'first_click' | 'last_click' | 'linear' | 'time_decay' | 'u_shaped'

interface TouchSession {
  id: string
  utm_campaign: string | null
  utm_content: string | null
  utm_source: string | null
  fbclid: string | null
  gclid: string | null
  msclkid: string | null
  started_at: string
}

// 7-day half-life: a touch a week before conversion gets half the credit of one
// on the day of conversion. Weights are normalized to sum to 1 afterward, so the
// half-life value only controls how sharply credit skews toward recency, not the
// absolute scale.
const TIME_DECAY_HALF_LIFE_DAYS = 7

export function timeDecayWeights(sessions: TouchSession[], purchaseTime: Date): number[] {
  const rawWeights = sessions.map((s) => {
    const daysBefore = (purchaseTime.getTime() - new Date(s.started_at).getTime()) / (1000 * 60 * 60 * 24)
    return Math.pow(2, -Math.max(daysBefore, 0) / TIME_DECAY_HALF_LIFE_DAYS)
  })
  const total = rawWeights.reduce((a, b) => a + b, 0)
  return rawWeights.map((w) => w / total)
}

// Standard position-based/U-shaped split: 40% first touch, 40% last touch, the
// remaining 20% divided evenly across whatever touches fall in between. Collapses
// sensibly for 1 touch (100%) and 2 touches (50/50, no middle to split).
export function uShapedWeights(count: number): number[] {
  if (count === 1) return [1]
  if (count === 2) return [0.5, 0.5]
  const middleWeight = 0.2 / (count - 2)
  return Array.from({ length: count }, (_, i) => (i === 0 || i === count - 1 ? 0.4 : middleWeight))
}

// Insert a purchase, walk back through the customer's ad sessions, split revenue
// credit across them per the client's attribution model, and roll revenue into customer_ltv.
// Returns whether a purchase row was actually inserted (false for a missing
// email/revenue or a duplicate order_id) — callers that only care about side
// effects (the live webhook) can ignore it; the bulk CSV importer uses it to
// report accurate imported/skipped counts instead of guessing.
export async function recordPurchase(clientId: string, conv: NormalizedConversion): Promise<boolean> {
  if (!conv.email || !conv.revenue) return false

  const email = conv.email.toLowerCase().trim()

  const baseCurrency = await getClientCurrency(clientId)
  const revenue = await convertToBaseCurrency(conv.revenue, conv.currency, baseCurrency)

  const { rows: purchaseRows } = await db.query(
    `INSERT INTO purchases (client_id, email, revenue, product, order_id, processor, purchased_at)
     VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, NOW()))
     ON CONFLICT (client_id, order_id) WHERE order_id IS NOT NULL DO NOTHING
     RETURNING id`,
    [clientId, email, revenue, conv.product ?? null, conv.order_id ?? null, conv.processor, conv.purchased_at ?? null]
  )
  if (purchaseRows.length === 0) return false // duplicate (webhook retry)

  const purchaseId = purchaseRows[0].id
  const purchaseTime = conv.purchased_at ? new Date(conv.purchased_at) : new Date()

  const { rows: identityRows } = await db.query(
    'SELECT visitor_id FROM identities WHERE client_id = $1 AND email = $2',
    [clientId, email]
  )

  let sessionRows: TouchSession[] = []
  if (identityRows.length > 0) {
    const visitorId = identityRows[0].visitor_id
    const { rows } = await db.query<TouchSession>(
      `SELECT id, utm_campaign, utm_content, utm_source, fbclid, gclid, msclkid, started_at
       FROM sessions
       WHERE visitor_id = $1
         AND started_at >= $2::timestamptz - INTERVAL '90 days'
         AND started_at <= $2::timestamptz
       ORDER BY started_at ASC`,
      [visitorId, purchaseTime]
    )
    sessionRows = rows
  }

  // Fallback (2026-07-25): confirmed live that Shopify's checkout Web Pixel
  // sandbox doesn't reliably return the same cookie the storefront pixel set
  // (two separate test orders, different browsers/incognito state, identical
  // stale visitor id both times) — so /track/identify from checkout often
  // links the wrong visitor, leaving real ad-driven orders unattributed even
  // with everything installed correctly. Shopify tracks the customer's actual
  // first landing page itself, independent of any pixel — parsing UTM/click-ids
  // out of that gives a real single-touch attribution when our own tracking
  // came up empty, without depending on the broken cookie hop at all.
  if (sessionRows.length === 0 && conv.landing_site) {
    const adParams = parseAdParamsFromLandingSite(conv.landing_site)
    if (adParams) {
      const fallbackVisitorId = await resolveVisitor({
        clientId,
        anonymousId: `shopify-landing-site:${conv.order_id ?? purchaseId}`,
        ip: null,
        userAgent: null,
      })
      const { rows } = await db.query<TouchSession>(
        `INSERT INTO sessions
           (client_id, visitor_id, fbclid, gclid, ttclid, msclkid, utm_source, utm_medium, utm_campaign, utm_content, utm_term, landing_page, started_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         RETURNING id, utm_campaign, utm_content, utm_source, fbclid, gclid, msclkid, started_at`,
        [
          clientId,
          fallbackVisitorId,
          adParams.fbclid ?? null,
          adParams.gclid ?? null,
          adParams.ttclid ?? null,
          adParams.msclkid ?? null,
          adParams.utm_source ?? null,
          adParams.utm_medium ?? null,
          adParams.utm_campaign ?? null,
          adParams.utm_content ?? null,
          adParams.utm_term ?? null,
          adParams.landing_page ?? null,
          purchaseTime,
        ]
      )
      sessionRows = rows
    }
  }

  if (sessionRows.length === 0) return true // no ad history to attribute

  const { rows: clientRows } = await db.query<{ attribution_model: AttributionModel }>(
    'SELECT attribution_model FROM clients WHERE id = $1',
    [clientId]
  )
  const model: AttributionModel = clientRows[0]?.attribution_model ?? 'first_click'

  // Acquisition channel for LTV is always the true first touch, independent of
  // attribution model — the model only changes how revenue credit is split for ROAS.
  const firstSession = sessionRows[0]

  const timeDecayWeightsForSessions = model === 'time_decay' ? timeDecayWeights(sessionRows, purchaseTime) : null
  const uShapedWeightsForSessions = model === 'u_shaped' ? uShapedWeights(sessionRows.length) : null

  const creditedTouches: Array<{ session: TouchSession; fraction: number }> =
    model === 'last_click'
      ? [{ session: sessionRows[sessionRows.length - 1], fraction: 1 }]
      : model === 'linear'
        ? sessionRows.map((session) => ({ session, fraction: 1 / sessionRows.length }))
        : timeDecayWeightsForSessions
          ? sessionRows.map((session, i) => ({ session, fraction: timeDecayWeightsForSessions[i] }))
          : uShapedWeightsForSessions
            ? sessionRows.map((session, i) => ({ session, fraction: uShapedWeightsForSessions[i] }))
            : [{ session: firstSession, fraction: 1 }]

  for (const { session, fraction } of creditedTouches) {
    await db.query(
      `INSERT INTO attributions (client_id, purchase_id, session_id, model, credit_fraction, attributed_revenue)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [clientId, purchaseId, session.id, model, fraction, revenue * fraction]
    )
  }

  await db.query(
    `INSERT INTO customer_ltv
       (client_id, email, acquisition_campaign, acquisition_ad, acquisition_source, first_purchase_date, revenue_lifetime, purchase_count)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 1)
     ON CONFLICT (client_id, email)
     DO UPDATE SET
       revenue_lifetime = customer_ltv.revenue_lifetime + EXCLUDED.revenue_lifetime,
       purchase_count   = customer_ltv.purchase_count + 1,
       last_updated     = NOW()`,
    [clientId, email, firstSession.utm_campaign, firstSession.utm_content, firstSession.utm_source, purchaseTime, revenue]
  )

  // Signal the ad platforms using whichever click is most recently "live" for this
  // visitor (the last touch), matching how the platforms' own pixels behave — their
  // click-id cookies get overwritten by the most recent click, not the first one.
  const lastSession = sessionRows[sessionRows.length - 1]
  // Sent in the ORIGINAL transaction currency, not the base-currency-converted
  // `revenue` above — the ad platform's own optimization/reporting needs the real
  // amount that changed hands, not this app's internal reporting conversion. This
  // also fixes a latent gap: currency was never passed here before Step 48, so
  // every conversion signal silently claimed USD regardless of the real currency.
  await sendConversionSignals(clientId, {
    eventType: 'Purchase',
    email,
    value: conv.revenue,
    currency: conv.currency ?? baseCurrency,
    fbclid: lastSession.fbclid,
    gclid: lastSession.gclid,
    msclkid: lastSession.msclkid,
    eventTime: new Date(),
    // Order id as the shared dedup key — a client's own native Meta pixel
    // needs to pass the same value as its Purchase event's eventID for Meta to
    // actually de-dupe against this CAPI call (see SignalPayload.eventId).
    eventId: conv.order_id ?? undefined,
  })

  // Step 29 — notify any of the client's own systems subscribed to this event.
  // Reports the base-currency-converted amount, matching what every internal
  // report now shows, alongside the original for anyone downstream who wants it.
  await dispatchEvent(clientId, 'sale.attributed', {
    email,
    revenue,
    original_revenue: conv.revenue,
    original_currency: conv.currency ?? baseCurrency,
    product: conv.product ?? null,
    order_id: conv.order_id ?? null,
    processor: conv.processor,
    attribution_model: model,
  })

  return true
}

// Deduct a refund from the matching purchase, its attribution record(s), and customer_ltv.
// Refund is prorated across attribution rows by credit_fraction, so linear-model
// purchases (multiple touches) get the refund split the same way the revenue was.
// `currency` (Step 48) — a refund is always issued in the same currency as the
// original charge, but this app doesn't store what that was per-purchase (kept
// out of scope to limit how invasive this change is), so it converts using
// TODAY's rate rather than the rate actually in effect at purchase time — a
// disclosed approximation, not exact, same spirit as every other "simple,
// honest method" choice in this app (predictive LTV, creative fatigue).
export async function recordRefund(
  clientId: string,
  orderId: string,
  refundAmount: number,
  currency?: string | null
): Promise<void> {
  if (refundAmount <= 0) return

  const baseCurrency = await getClientCurrency(clientId)
  refundAmount = await convertToBaseCurrency(refundAmount, currency, baseCurrency)

  const { rows: purchaseRows } = await db.query(
    `UPDATE purchases
     SET refunded = TRUE, refunded_at = NOW()
     WHERE client_id = $1 AND order_id = $2
     RETURNING id, email`,
    [clientId, orderId]
  )
  if (purchaseRows.length === 0) return

  const { id: purchaseId, email } = purchaseRows[0]

  await db.query(
    `UPDATE customer_ltv
     SET revenue_lifetime = GREATEST(0, revenue_lifetime - $3),
         purchase_count   = GREATEST(0, purchase_count - 1),
         last_updated     = NOW()
     WHERE client_id = $1 AND email = $2`,
    [clientId, String(email).toLowerCase(), refundAmount]
  )

  await db.query(
    `UPDATE attributions
     SET attributed_revenue = GREATEST(0, attributed_revenue - ($2 * credit_fraction))
     WHERE purchase_id = $1`,
    [purchaseId, refundAmount]
  )
}
