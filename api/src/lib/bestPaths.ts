import { db } from '../db'

// Rockerbox's Marketing Paths view surfaces "fastest path" / "highest earning
// path" as named, curated insights instead of making the reader derive them
// from a raw journey table - pre-digested framing, not a bigger feature. Built
// from data this app already computes at attribution time (no new tracking):
// each purchase's attribution rows already carry every credited touch in
// chronological order (one row per touch for linear/time-decay/u-shaped models,
// a single row for first/last-click), so grouping purchases by their ordered
// sequence of touch sources is honest for whichever model actually drove that
// purchase's credit - a first/last-click client will simply see single-source
// paths, which correctly reflects that model rather than inventing multi-touch
// detail the credit calculation never used.
const MIN_CONVERSIONS = 3

interface PathStats {
  path: string
  revenue: number
  conversions: number
  totalDaysToConvert: number
}

export interface BestPaths {
  bestRevenuePath: { path: string; revenue: number; conversions: number } | null
  fastestPath: { path: string; avgDaysToConvert: number; conversions: number } | null
  reason: string | null
}

export async function computeBestPaths(clientId: string, from: string, to: string): Promise<BestPaths> {
  const { rows } = await db.query<{
    purchase_id: string
    purchased_at: string
    session_started_at: string
    utm_source: string | null
    attributed_revenue: string
  }>(
    `SELECT a.purchase_id, p.purchased_at, s.started_at AS session_started_at, s.utm_source, a.attributed_revenue
     FROM attributions a
     JOIN purchases p ON p.id = a.purchase_id
     JOIN sessions s ON s.id = a.session_id
     WHERE a.client_id = $1 AND p.purchased_at::date BETWEEN $2 AND $3 AND NOT p.refunded
     ORDER BY a.purchase_id, s.started_at ASC`,
    [clientId, from, to]
  )

  if (rows.length === 0) {
    return { bestRevenuePath: null, fastestPath: null, reason: 'No attributed purchases in this range yet.' }
  }

  // Group by purchase first (rows arrive pre-sorted by session time within each
  // purchase), then collapse consecutive same-source touches into one hop -
  // same convention markovAttribution.ts already uses for its channel paths.
  const byPurchase = new Map<
    string,
    { purchasedAt: string; firstTouchAt: string; sources: string[]; revenue: number }
  >()
  for (const r of rows) {
    const source = r.utm_source ?? 'direct'
    let entry = byPurchase.get(r.purchase_id)
    if (!entry) {
      entry = { purchasedAt: r.purchased_at, firstTouchAt: r.session_started_at, sources: [], revenue: 0 }
      byPurchase.set(r.purchase_id, entry)
    }
    if (entry.sources[entry.sources.length - 1] !== source) entry.sources.push(source)
    entry.revenue += parseFloat(r.attributed_revenue)
  }

  const byPath = new Map<string, PathStats>()
  for (const entry of byPurchase.values()) {
    const path = entry.sources.join(' → ')
    const days = Math.max(
      (new Date(entry.purchasedAt).getTime() - new Date(entry.firstTouchAt).getTime()) / (1000 * 60 * 60 * 24),
      0
    )
    const stats = byPath.get(path) ?? { path, revenue: 0, conversions: 0, totalDaysToConvert: 0 }
    stats.revenue += entry.revenue
    stats.conversions += 1
    stats.totalDaysToConvert += days
    byPath.set(path, stats)
  }

  const eligible = [...byPath.values()].filter((p) => p.conversions >= MIN_CONVERSIONS)
  if (eligible.length === 0) {
    return {
      bestRevenuePath: null,
      fastestPath: null,
      reason: `Not enough repeat paths yet (need at least ${MIN_CONVERSIONS} purchases sharing the same path) to call one out confidently.`,
    }
  }

  const bestRevenue = [...eligible].sort((a, b) => b.revenue - a.revenue)[0]
  const fastest = [...eligible].sort((a, b) => a.totalDaysToConvert / a.conversions - b.totalDaysToConvert / b.conversions)[0]

  return {
    bestRevenuePath: { path: bestRevenue.path, revenue: bestRevenue.revenue, conversions: bestRevenue.conversions },
    fastestPath: {
      path: fastest.path,
      avgDaysToConvert: fastest.totalDaysToConvert / fastest.conversions,
      conversions: fastest.conversions,
    },
    reason: null,
  }
}
