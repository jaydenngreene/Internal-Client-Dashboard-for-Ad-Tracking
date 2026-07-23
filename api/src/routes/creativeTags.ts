import { FastifyInstance } from 'fastify'
import { db } from '../db'
import { generateCreativeTags, getCreativeTagPerformance } from '../lib/creativeTagging'

export async function creativeTagRoutes(app: FastifyInstance) {
  // Cached tag for one specific creative — null if never generated yet, matching
  // AI Insights' on-demand+cached convention (GET returns the cached row or null,
  // POST /generate is the explicit action that actually calls Claude). Keyed on
  // platform+adName (normalized the same way campaignDetail.ts's creative-detail
  // route already matches a creative), not ad_id — the dashboard only ever has
  // platform+creativeName on hand at this page.
  app.get<{ Params: { id: string }; Querystring: { platform?: string; adName?: string } }>(
    '/clients/:id/creative-tags',
    async (req, reply) => {
      const { platform, adName } = req.query
      if (!platform || !adName) return reply.code(400).send({ error: 'platform and adName are required' })
      const { rows } = await db.query(
        `SELECT * FROM creative_tags WHERE client_id = $1 AND platform = $2 AND ad_name = LOWER(TRIM($3))`,
        [req.params.id, platform, adName]
      )
      return reply.send(rows[0] ?? null)
    }
  )

  app.post<{ Params: { id: string }; Body: { platform: string; adName: string } }>(
    '/clients/:id/creative-tags/generate',
    async (req, reply) => {
      const { platform, adName } = req.body
      if (!platform || !adName) return reply.code(400).send({ error: 'platform and adName are required' })
      const result = await generateCreativeTags(req.params.id, platform, adName)
      if (!result.tags) return reply.code(502).send({ error: result.error ?? 'Tag generation failed' })
      return reply.send(result.tags)
    }
  )

  // "What kind of creative wins" — every tagged creative's avg ROAS grouped by
  // hook type / angle / tone, sorted best-performing first.
  app.get<{ Params: { id: string } }>('/clients/:id/creative-tags/performance', async (req, reply) => {
    return reply.send(await getCreativeTagPerformance(req.params.id))
  })
}
