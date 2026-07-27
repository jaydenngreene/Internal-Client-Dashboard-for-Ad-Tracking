import { db } from '../../db'
import { GUARDRAIL_CONFIG, ConversionEvent } from '../../config/recommendationGuardrails'
import { benchmarkForNiche } from '../../config/industryBenchmarks'

interface ClientRow {
  id: string
  niche: string
}

interface ConversionResult {
  event: ConversionEvent
  count: number
}

// Resolves what "a purchase" means for this specific client, per client rather
// than a fixed niche switch: purchases (Shopify/Stripe/PayPal/etc, processor-
// agnostic) is tried FIRST for every niche, since a lead_gen or info_product
// client that's actually taking real payments should be measured on those, not
// forced onto a proxy metric just because of their niche label. Only when a
// client has zero purchases in the window do we fall back to a niche-specific
// proxy: SaaS -> new paying subscribers (trial_converted/activated, not
// trial_started - a trial isn't revenue yet), call funnels -> qualified calls
// (the thing a call-tracking client is actually optimizing for). Everything
// else (lead_gen/info_product/other with no purchases and no subscription/call
// data) falls through to raw lead count, and finally to this niche's industry-
// benchmark figure (config/industryBenchmarks.ts) if even that's too thin.
async function resolveConversionCount(clientId: string, niche: string, lookbackDays: number): Promise<ConversionResult> {
  const { rows: purchaseRows } = await db.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM purchases
     WHERE client_id = $1 AND NOT refunded AND purchased_at >= NOW() - ($2 || ' days')::interval`,
    [clientId, lookbackDays]
  )
  const purchaseCount = parseInt(purchaseRows[0].count, 10)
  if (purchaseCount > 0) return { event: 'purchase', count: purchaseCount }

  if (niche === 'saas') {
    const { rows } = await db.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM subscription_events
       WHERE client_id = $1 AND event_type IN ('trial_converted', 'activated')
         AND occurred_at >= NOW() - ($2 || ' days')::interval`,
      [clientId, lookbackDays]
    )
    const count = parseInt(rows[0].count, 10)
    if (count > 0) return { event: 'subscription_conversion', count }
  }

  if (niche === 'call') {
    const { rows } = await db.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM calls
       WHERE client_id = $1 AND qualified = TRUE
         AND started_at >= NOW() - ($2 || ' days')::interval`,
      [clientId, lookbackDays]
    )
    const count = parseInt(rows[0].count, 10)
    if (count > 0) return { event: 'qualified_call', count }
  }

  const { rows: leadRows } = await db.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM leads
     WHERE client_id = $1 AND created_at >= NOW() - ($2 || ' days')::interval`,
    [clientId, lookbackDays]
  )
  return { event: 'lead', count: parseInt(leadRows[0].count, 10) }
}

// Recomputes every client's trailing-window cost-per-purchase from scratch each
// run - deliberately not incremental, so a stale/incorrect row never persists
// past the next scheduled run (see scheduler.ts, daily). Never manually
// editable: this is the entire point of the gate self-tailoring to each
// client's real economics instead of one shared number.
export async function refreshCostPerPurchase(): Promise<number> {
  const { lookbackDays, fallback } = GUARDRAIL_CONFIG
  const { rows: clients } = await db.query<ClientRow>(`SELECT id, niche FROM clients`)

  let updated = 0
  for (const client of clients) {
    const { rows: spendRows } = await db.query<{ spend: string }>(
      `SELECT COALESCE(SUM(spend), 0) AS spend FROM ad_costs
       WHERE client_id = $1 AND date >= NOW() - ($2 || ' days')::interval`,
      [client.id, lookbackDays]
    )
    const spend = parseFloat(spendRows[0].spend)

    const conversion = await resolveConversionCount(client.id, client.niche, lookbackDays)

    const isFallback = conversion.count < fallback.minConversionsToTrust
    // Review fix (2026-07-28): a flat dollar figure across every business type
    // was wrong — a new SaaS client and a new lead-gen client have nothing in
    // common economically. Falls back to this niche's industry-benchmark
    // typical cost-per-conversion (config/industryBenchmarks.ts) instead.
    const costPerPurchase = isFallback ? benchmarkForNiche(client.niche).typicalCostPerConversion : spend / conversion.count

    await db.query(
      `INSERT INTO client_cost_per_purchase (client_id, cost_per_purchase, conversion_event, conversion_count, spend, is_fallback, computed_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (client_id) DO UPDATE SET
         cost_per_purchase = EXCLUDED.cost_per_purchase,
         conversion_event = EXCLUDED.conversion_event,
         conversion_count = EXCLUDED.conversion_count,
         spend = EXCLUDED.spend,
         is_fallback = EXCLUDED.is_fallback,
         computed_at = NOW()`,
      [client.id, costPerPurchase, isFallback ? 'fallback' : conversion.event, conversion.count, spend, isFallback]
    )
    updated++
  }
  return updated
}
