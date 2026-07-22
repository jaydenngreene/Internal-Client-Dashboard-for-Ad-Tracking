import { FastifyInstance } from 'fastify'
import { db } from '../db'
import { createIncrementalityTest, computeIncrementalityResult, IncrementalityTest } from '../lib/incrementality'

// Time-based pause/holdout incrementality testing (Step 45) — the user manually
// pauses the campaign in their ad platform for the defined window; this app only
// defines the test and computes the before/after analysis, it never pauses
// anything itself. See lib/incrementality.ts for the actual methodology.
export async function incrementalityRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string } }>('/clients/:id/incrementality-tests', async (req, reply) => {
    const { rows } = await db.query<IncrementalityTest>(
      `SELECT id, client_id, platform, campaign_name, pre_period_days,
              pause_start::text, pause_end::text, created_at
       FROM incrementality_tests WHERE client_id = $1 ORDER BY pause_start DESC`,
      [req.params.id]
    )
    const withResults = await Promise.all(
      rows.map(async (test) => ({ test, result: await computeIncrementalityResult(test) }))
    )
    return reply.send(withResults)
  })

  app.post<{
    Params: { id: string }
    Body: { platform: string; campaignName: string; pauseStart: string; pauseEnd: string; prePeriodDays?: number }
  }>('/clients/:id/incrementality-tests', async (req, reply) => {
    const { platform, campaignName, pauseStart, pauseEnd, prePeriodDays } = req.body
    if (!platform || !campaignName || !pauseStart || !pauseEnd) {
      return reply.code(400).send({ error: 'platform, campaignName, pauseStart, and pauseEnd required' })
    }
    if (pauseEnd < pauseStart) {
      return reply.code(400).send({ error: 'pauseEnd must be on or after pauseStart' })
    }
    const test = await createIncrementalityTest(req.params.id, { platform, campaignName, pauseStart, pauseEnd, prePeriodDays })
    const result = await computeIncrementalityResult(test)
    return reply.code(201).send({ test, result })
  })

  app.delete<{ Params: { testId: string } }>('/incrementality-tests/:testId', async (req, reply) => {
    const { rowCount } = await db.query(`DELETE FROM incrementality_tests WHERE id = $1`, [req.params.testId])
    if (!rowCount) return reply.code(404).send({ error: 'Not found' })
    return reply.code(204).send()
  })
}
