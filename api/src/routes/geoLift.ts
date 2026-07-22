import { FastifyInstance } from 'fastify'
import { db } from '../db'
import { createGeoLiftTest, computeGeoLiftResult, GeoLiftTest } from '../lib/geoLift'

// True geo-lift/holdout testing (Step 53) — the user excludes holdout_regions
// from the campaign's own targeting in their ad platform; this app only defines
// the test and runs the difference-in-differences analysis, it never touches
// targeting itself.
export async function geoLiftRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string } }>('/clients/:id/geo-lift-tests', async (req, reply) => {
    const { rows } = await db.query<GeoLiftTest>(
      `SELECT id, client_id, platform, campaign_name, holdout_regions, pre_period_days,
              test_start::text, test_end::text, created_at
       FROM geo_lift_tests WHERE client_id = $1 ORDER BY test_start DESC`,
      [req.params.id]
    )
    const withResults = await Promise.all(rows.map(async (test) => ({ test, result: await computeGeoLiftResult(test) })))
    return reply.send(withResults)
  })

  app.post<{
    Params: { id: string }
    Body: { platform: string; campaignName: string; holdoutRegions: string[]; testStart: string; testEnd: string; prePeriodDays?: number }
  }>('/clients/:id/geo-lift-tests', async (req, reply) => {
    const { platform, campaignName, holdoutRegions, testStart, testEnd, prePeriodDays } = req.body
    if (!platform || !campaignName || !holdoutRegions?.length || !testStart || !testEnd) {
      return reply.code(400).send({ error: 'platform, campaignName, holdoutRegions, testStart, and testEnd required' })
    }
    if (testEnd < testStart) {
      return reply.code(400).send({ error: 'testEnd must be on or after testStart' })
    }
    const test = await createGeoLiftTest(req.params.id, { platform, campaignName, holdoutRegions, testStart, testEnd, prePeriodDays })
    const result = await computeGeoLiftResult(test)
    return reply.code(201).send({ test, result })
  })

  app.delete<{ Params: { testId: string } }>('/geo-lift-tests/:testId', async (req, reply) => {
    const { rowCount } = await db.query(`DELETE FROM geo_lift_tests WHERE id = $1`, [req.params.testId])
    if (!rowCount) return reply.code(404).send({ error: 'Not found' })
    return reply.code(204).send()
  })
}
