import { FastifyInstance } from 'fastify'
import { db } from '../db'
import { pauseAd } from '../lib/adPause'

interface PlatformConfigRow {
  config: Record<string, string>
}

// Confirm-first review surface for Step 35's ad-level anomaly detection — nothing
// here pauses an ad on its own until a human clicks Confirm, matching the explicit
// user decision made before this was built (auto-pause was rejected as too risky
// for a single anomalous day to act on unattended).
export async function pauseCandidateRoutes(app: FastifyInstance) {
  app.get<{
    Params: { id: string }
    Querystring: { status?: string }
  }>('/clients/:id/pause-candidates', async (req, reply) => {
    const { id } = req.params
    const status = req.query.status ?? 'pending'
    const { rows } = await db.query(
      `SELECT * FROM pause_candidates WHERE client_id = $1 AND status = $2 ORDER BY created_at DESC`,
      [id, status]
    )
    return reply.send(rows)
  })

  app.patch<{ Params: { id: string } }>('/pause-candidates/:id/dismiss', async (req, reply) => {
    const { rows } = await db.query(
      `UPDATE pause_candidates SET status = 'dismissed', resolved_at = NOW() WHERE id = $1 AND status = 'pending' RETURNING *`,
      [req.params.id]
    )
    if (rows.length === 0) return reply.code(404).send({ error: 'Not found or not pending' })
    return reply.send(rows[0])
  })

  // The one endpoint that actually writes back to an ad platform. Looks up the
  // client's integration config for whatever platform the candidate is on, calls
  // pauseAd() (Facebook-only for now, see lib/adPause.ts), and records the outcome
  // either way — a failure marks the candidate 'failed' with the real error message
  // rather than leaving it stuck pending forever.
  app.post<{ Params: { id: string } }>('/pause-candidates/:id/confirm', async (req, reply) => {
    const { rows } = await db.query(`SELECT * FROM pause_candidates WHERE id = $1 AND status = 'pending'`, [
      req.params.id,
    ])
    const candidate = rows[0]
    if (!candidate) return reply.code(404).send({ error: 'Not found or not pending' })

    const { rows: integrationRows } = await db.query<PlatformConfigRow>(
      `SELECT config FROM client_integrations WHERE client_id = $1 AND platform = $2`,
      [candidate.client_id, candidate.platform]
    )
    const config = integrationRows[0]?.config
    if (!config) {
      const { rows: failed } = await db.query(
        `UPDATE pause_candidates SET status = 'failed', error = $2, resolved_at = NOW() WHERE id = $1 RETURNING *`,
        [candidate.id, `No ${candidate.platform} integration configured for this client`]
      )
      return reply.code(400).send(failed[0])
    }

    try {
      await pauseAd(candidate.platform, config, candidate.ad_id)
      const { rows: confirmed } = await db.query(
        `UPDATE pause_candidates SET status = 'confirmed', resolved_at = NOW() WHERE id = $1 RETURNING *`,
        [candidate.id]
      )
      return reply.send(confirmed[0])
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const { rows: failed } = await db.query(
        `UPDATE pause_candidates SET status = 'failed', error = $2, resolved_at = NOW() WHERE id = $1 RETURNING *`,
        [candidate.id, message]
      )
      return reply.code(502).send(failed[0])
    }
  })
}
