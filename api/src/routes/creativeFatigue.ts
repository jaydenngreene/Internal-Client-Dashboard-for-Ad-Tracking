import { FastifyInstance } from 'fastify'
import { db } from '../db'

// Advisory-only creative fatigue signals (Step 47) — no confirm-and-pause action
// like pause_candidates has, this is purely "consider refreshing this creative,"
// left to the user to act on however they see fit.
//
// Phase 1 (2026-07-27): every row now also carries the gate/confidence context
// (days_live, confidence, gate_opened_by, cost_per_purchase_basis, spend_threshold,
// spend) and a metrics_triggered breakdown (per-metric recent/prior numbers for
// roas/ctr/cpa/cpm/frequency, each flagged whether it actually triggered) — the
// numeric fields node-pg returns as strings need the same parseFloat treatment
// the pre-existing recent_ctr/prior_ctr/decline_pct fields already got.
function normalizeFatigueSignal<T extends Record<string, unknown>>(r: T): T {
  return {
    ...r,
    recent_ctr: parseFloat(r.recent_ctr as string),
    prior_ctr: parseFloat(r.prior_ctr as string),
    decline_pct: parseFloat(r.decline_pct as string),
    cost_per_purchase_basis: r.cost_per_purchase_basis === null ? null : parseFloat(r.cost_per_purchase_basis as string),
    spend_threshold: r.spend_threshold === null ? null : parseFloat(r.spend_threshold as string),
    spend: r.spend === null ? null : parseFloat(r.spend as string),
  }
}

export async function creativeFatigueRoutes(app: FastifyInstance) {
  app.get<{
    Params: { id: string }
    Querystring: { status?: string }
  }>('/clients/:id/creative-fatigue', async (req, reply) => {
    const status = req.query.status ?? 'active'
    const { rows } = await db.query<{ recent_ctr: string; prior_ctr: string; decline_pct: string; [key: string]: unknown }>(
      `SELECT * FROM creative_fatigue_signals WHERE client_id = $1 AND status = $2 ORDER BY created_at DESC`,
      [req.params.id, status]
    )
    return reply.send(rows.map(normalizeFatigueSignal))
  })

  app.patch<{ Params: { id: string } }>('/creative-fatigue/:id/dismiss', async (req, reply) => {
    const { rows } = await db.query<{ recent_ctr: string; prior_ctr: string; decline_pct: string; [key: string]: unknown }>(
      `UPDATE creative_fatigue_signals SET status = 'dismissed', resolved_at = NOW() WHERE id = $1 AND status = 'active' RETURNING *`,
      [req.params.id]
    )
    if (rows.length === 0) return reply.code(404).send({ error: 'Not found or not active' })
    return reply.send(normalizeFatigueSignal(rows[0]))
  })
}
