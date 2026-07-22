import { db } from '../db'

// Free, no-API-key exchange rate source — daily rates, no vendor account needed
// (same "prefer no new vendor" preference the user set for call transcription
// earlier this session). Cached in exchange_rates (one row per date/currency
// pair) so this app never re-fetches the same day's rate twice.
const RATES_BASE_URL = 'https://open.er-api.com/v6/latest'

async function fetchRate(from: string, to: string): Promise<number> {
  const res = await fetch(`${RATES_BASE_URL}/${from}`)
  if (!res.ok) throw new Error(`Exchange rate request failed (${res.status})`)
  const body = (await res.json()) as { result: string; rates: Record<string, number> }
  if (body.result !== 'success' || !body.rates[to]) {
    throw new Error(`No exchange rate available for ${from} -> ${to}`)
  }
  return body.rates[to]
}

// Cached per calendar day — conversion doesn't need to be more precise than
// "today's rate," and this keeps the free API to at most one real call per
// currency pair per day across every client.
export async function getExchangeRate(from: string, to: string): Promise<number> {
  if (from === to) return 1

  const today = new Date().toISOString().slice(0, 10)
  const { rows: cached } = await db.query<{ rate: string }>(
    `SELECT rate FROM exchange_rates WHERE date = $1 AND base_currency = $2 AND target_currency = $3`,
    [today, from, to]
  )
  if (cached.length > 0) return parseFloat(cached[0].rate)

  const rate = await fetchRate(from, to)
  await db.query(
    `INSERT INTO exchange_rates (date, base_currency, target_currency, rate) VALUES ($1, $2, $3, $4)
     ON CONFLICT (date, base_currency, target_currency) DO UPDATE SET rate = EXCLUDED.rate`,
    [today, from, to, rate]
  )
  return rate
}

// Converts once at ingestion (recordPurchase for purchases, upsertAdCosts for ad
// spend) — every existing report query keeps summing one already-converted
// number, unchanged. Returns the original amount unchanged if no currency is
// given (treated as "already in the client's base currency") or if it matches
// the target already.
export async function convertToBaseCurrency(
  amount: number,
  fromCurrency: string | null | undefined,
  baseCurrency: string
): Promise<number> {
  if (!fromCurrency || fromCurrency.toUpperCase() === baseCurrency.toUpperCase()) return amount
  const rate = await getExchangeRate(fromCurrency.toUpperCase(), baseCurrency.toUpperCase())
  return amount * rate
}

export async function getClientCurrency(clientId: string): Promise<string> {
  const { rows } = await db.query<{ currency: string }>(`SELECT currency FROM clients WHERE id = $1`, [clientId])
  return rows[0]?.currency ?? 'USD'
}
