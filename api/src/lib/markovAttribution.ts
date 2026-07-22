import { db } from '../db'
import { solveLinearSystem } from './linearAlgebra'

// Step 59 — data-driven ("algorithmic") attribution via a Markov chain removal-
// effect model, the same general approach GA4's Data-Driven Attribution and
// tools like the ChannelAttribution R package use, instead of a fixed rule
// (first/last/linear/time-decay/u-shaped — Steps 6/30). Deliberately a
// **separate comparison report**, not a 6th value plugged into
// `clients.attribution_model`: the other models credit ONE visitor's own touch
// sequence at purchase time; a Markov model's whole premise is comparing a
// channel's role across every visitor's path (converting AND non-converting) in
// a window, which has to be computed over the account's aggregate history, not
// per-transaction. Reuses the exact same hand-rolled `solveLinearSystem` Step 52's
// MMM already proved correct against noiseless synthetic data, rather than a new
// numeric dependency for what's ultimately still a small linear system (state
// count = 1 + distinct channels, almost always under 20).
export const START = '__START__'
const CONVERSION = '__CONVERSION__'
const NULL_STATE = '__NULL__'
const CONVERSION_GRACE_DAYS = 7
const MIN_VISITORS = 20
const MIN_CHANNELS = 2

interface ChannelResult {
  channel: string
  touchpoints: number
  removalEffect: number
  creditShare: number
  attributedRevenue: number
}

export type MarkovAttributionResult =
  | { available: false; reason: string }
  | {
      available: true
      from: string
      to: string
      totalConversionProbability: number
      visitorsAnalyzed: number
      totalRevenue: number
      channels: ChannelResult[]
    }

// Builds the transient transition-count table shared by the full graph and every
// "remove channel c" variant below — counts[state][nextState] = number of times
// that edge was walked across every visitor path.
export function buildTransitionCounts(
  paths: { channels: string[]; converted: boolean }[]
): Map<string, Map<string, number>> {
  const counts = new Map<string, Map<string, number>>()
  const bump = (from: string, to: string) => {
    if (!counts.has(from)) counts.set(from, new Map())
    const row = counts.get(from)!
    row.set(to, (row.get(to) ?? 0) + 1)
  }
  for (const { channels, converted } of paths) {
    let prev = START
    for (const c of channels) {
      bump(prev, c)
      prev = c
    }
    bump(prev, converted ? CONVERSION : NULL_STATE)
  }
  return counts
}

// Solves (I - Q)h = R for the absorption-into-CONVERSION probability of every
// transient state, restricted to `states` (always includes START; excludes
// whichever channel is being "removed" when computing that channel's removal
// effect). Any transition to/from an excluded state is simply left out of the
// normalization below — that probability mass silently becomes "never
// converts," which is the standard definition of a channel's removal effect.
export function solveAbsorptionProbabilities(
  counts: Map<string, Map<string, number>>,
  states: string[]
): number {
  const index = new Map(states.map((s, i) => [s, i]))
  const n = states.length
  const Q: number[][] = Array.from({ length: n }, () => new Array(n).fill(0))
  const R: number[] = new Array(n).fill(0)

  for (let i = 0; i < n; i++) {
    const row = counts.get(states[i])
    if (!row) continue
    let total = 0
    for (const [, count] of row) total += count
    if (total === 0) continue
    for (const [next, count] of row) {
      if (next === CONVERSION) R[i] += count / total
      else if (next === NULL_STATE) continue
      else if (index.has(next)) Q[i][index.get(next)!] += count / total
      // else: transition into an excluded (removed) channel — dropped, not
      // redistributed, exactly matching the removal-effect definition above.
    }
  }

  const I_minus_Q = Q.map((row, i) => row.map((v, j) => (i === j ? 1 - v : -v)))
  try {
    const h = solveLinearSystem(I_minus_Q, R)
    return h[index.get(START)!]
  } catch {
    // Singular system (shouldn't happen for a graph built purely from finite,
    // terminating real paths, but never let one edge case crash the report).
    return 0
  }
}

export async function computeMarkovAttribution(clientId: string, from: string, to: string): Promise<MarkovAttributionResult> {
  const [sessionRows, conversionRows] = await Promise.all([
    db.query<{ visitor_id: string; utm_source: string | null; started_at: string }>(
      `SELECT visitor_id, utm_source, started_at FROM sessions
       WHERE client_id = $1 AND started_at::date BETWEEN $2 AND $3
       ORDER BY visitor_id, started_at ASC`,
      [clientId, from, to]
    ),
    db.query<{ visitor_id: string; revenue: string }>(
      `SELECT i.visitor_id, SUM(p.revenue) AS revenue
       FROM identities i
       JOIN purchases p ON p.client_id = i.client_id AND p.email = i.email
       WHERE i.client_id = $1 AND NOT p.refunded
         AND p.purchased_at::date BETWEEN $2 AND ($3::date + INTERVAL '${CONVERSION_GRACE_DAYS} days')
       GROUP BY i.visitor_id`,
      [clientId, from, to]
    ),
  ])

  const revenueByVisitor = new Map(conversionRows.rows.map((r) => [r.visitor_id, parseFloat(r.revenue)]))

  const channelsByVisitor = new Map<string, string[]>()
  for (const row of sessionRows.rows) {
    const label = row.utm_source?.trim() || 'direct'
    const list = channelsByVisitor.get(row.visitor_id) ?? []
    if (list[list.length - 1] !== label) list.push(label) // collapse consecutive repeats only
    channelsByVisitor.set(row.visitor_id, list)
  }

  const paths = Array.from(channelsByVisitor.entries()).map(([visitorId, channels]) => ({
    channels,
    converted: (revenueByVisitor.get(visitorId) ?? 0) > 0,
    revenue: revenueByVisitor.get(visitorId) ?? 0,
  }))

  const visitorsAnalyzed = paths.length
  const uniqueChannels = Array.from(new Set(paths.flatMap((p) => p.channels))).sort()

  if (visitorsAnalyzed < MIN_VISITORS) {
    return { available: false, reason: `Needs at least ${MIN_VISITORS} visitors with tracked sessions in this window (found ${visitorsAnalyzed}).` }
  }
  if (uniqueChannels.length < MIN_CHANNELS) {
    return { available: false, reason: `Needs at least ${MIN_CHANNELS} distinct traffic sources in this window (found ${uniqueChannels.length}) — with only one, every model already agrees.` }
  }
  if (!paths.some((p) => p.converted)) {
    return { available: false, reason: 'No conversions in this window to attribute.' }
  }

  const counts = buildTransitionCounts(paths)
  const fullStates = [START, ...uniqueChannels]
  const totalConversionProbability = solveAbsorptionProbabilities(counts, fullStates)

  const totalRevenue = paths.reduce((sum, p) => sum + p.revenue, 0)

  const removalEffects = uniqueChannels.map((channel) => {
    const reducedStates = fullStates.filter((s) => s !== channel)
    const withoutChannel = solveAbsorptionProbabilities(counts, reducedStates)
    const effect = totalConversionProbability > 0 ? Math.max(0, (totalConversionProbability - withoutChannel) / totalConversionProbability) : 0
    return { channel, effect }
  })

  const totalEffect = removalEffects.reduce((sum, r) => sum + r.effect, 0)
  const touchpointCounts = new Map<string, number>()
  for (const p of paths) for (const c of p.channels) touchpointCounts.set(c, (touchpointCounts.get(c) ?? 0) + 1)

  const channels: ChannelResult[] = removalEffects.map(({ channel, effect }) => {
    const creditShare = totalEffect > 0 ? effect / totalEffect : 0
    return {
      channel,
      touchpoints: touchpointCounts.get(channel) ?? 0,
      removalEffect: effect,
      creditShare,
      attributedRevenue: creditShare * totalRevenue,
    }
  })
  channels.sort((a, b) => b.creditShare - a.creditShare)

  return {
    available: true,
    from,
    to,
    totalConversionProbability,
    visitorsAnalyzed,
    totalRevenue,
    channels,
  }
}
