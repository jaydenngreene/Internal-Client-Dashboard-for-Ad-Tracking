import { FastifyInstance } from 'fastify'
import { db } from '../db'

export interface NotificationsSummary {
  pauseCandidates: number
  creativeFatigue: number
  trackingHealth: number
  budgetReallocation: number
  total: number
}

// The header bar's notification bell previously did nothing when clicked - a
// visible, interactive-looking control with zero behavior reads as broken, and
// this app already has four real advisory signals worth surfacing (Pause
// Candidates, Creative Fatigue, Tracking Health, Budget Reallocation) that a
// user would otherwise only ever see by remembering to check each page. One
// cheap COUNT per table, not a generic notifications table - matches this
// app's existing "no premature abstraction" convention (these four each
// already have their own dedicated review page; this is just a badge pointing
// at them, not a new inbox to maintain).
export async function notificationsRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string } }>('/clients/:id/notifications-summary', async (req, reply) => {
    const { id } = req.params
    const [pause, fatigue, health, realloc] = await Promise.all([
      db.query<{ count: string }>(`SELECT COUNT(*) FROM pause_candidates WHERE client_id = $1 AND status = 'pending'`, [id]),
      db.query<{ count: string }>(
        `SELECT COUNT(*) FROM creative_fatigue_signals WHERE client_id = $1 AND status = 'active'`,
        [id]
      ),
      db.query<{ count: string }>(
        `SELECT COUNT(*) FROM tracking_health_signals WHERE client_id = $1 AND status = 'active'`,
        [id]
      ),
      db.query<{ count: string }>(
        `SELECT COUNT(*) FROM budget_reallocation_suggestions WHERE client_id = $1 AND status = 'pending'`,
        [id]
      ),
    ])
    const pauseCandidates = parseInt(pause.rows[0].count, 10)
    const creativeFatigue = parseInt(fatigue.rows[0].count, 10)
    const trackingHealth = parseInt(health.rows[0].count, 10)
    const budgetReallocation = parseInt(realloc.rows[0].count, 10)
    const summary: NotificationsSummary = {
      pauseCandidates,
      creativeFatigue,
      trackingHealth,
      budgetReallocation,
      total: pauseCandidates + creativeFatigue + trackingHealth + budgetReallocation,
    }
    return reply.send(summary)
  })
}
