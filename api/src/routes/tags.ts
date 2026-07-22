import { FastifyInstance } from 'fastify'
import { db } from '../db'
import { applyTagAndAutomate } from '../lib/tagAutomation'
import { lookupVisitorId } from '../lib/visitorResolution'

const TAG_TYPES = ['freeform', 'funnel_stage', 'product']
const TAG_NAME_MAX_LENGTH = 100

function toNumberOrNull(value: string | null): number | null {
  return value === null ? null : parseFloat(value)
}

export async function tagRoutes(app: FastifyInstance) {
  // Tag definitions
  app.post<{
    Params: { id: string }
    Body: { name: string; tag_type?: string; stage_order?: number; product_value?: number }
  }>('/clients/:id/tags', async (req, reply) => {
    const { id } = req.params
    const { name, tag_type = 'freeform', stage_order, product_value } = req.body
    if (!name) return reply.code(400).send({ error: 'name required' })
    if (name.length > TAG_NAME_MAX_LENGTH) {
      return reply.code(400).send({ error: `name must be ${TAG_NAME_MAX_LENGTH} characters or fewer` })
    }
    if (!TAG_TYPES.includes(tag_type)) {
      return reply.code(400).send({ error: `tag_type must be one of: ${TAG_TYPES.join(', ')}` })
    }
    const { rows } = await db.query(
      `INSERT INTO tags (client_id, name, tag_type, stage_order, product_value)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (client_id, name) DO UPDATE SET tag_type = EXCLUDED.tag_type, stage_order = EXCLUDED.stage_order, product_value = EXCLUDED.product_value
       RETURNING *`,
      [id, name, tag_type, stage_order ?? null, product_value ?? null]
    )
    return reply.code(200).send({ ...rows[0], product_value: toNumberOrNull(rows[0].product_value) })
  })

  app.get<{ Params: { id: string } }>('/clients/:id/tags', async (req, reply) => {
    const { rows } = await db.query(
      `SELECT * FROM tags WHERE client_id = $1 ORDER BY tag_type, stage_order NULLS LAST, name`,
      [req.params.id]
    )
    // product_value is NUMERIC in Postgres, which node-postgres returns as a
    // string — every other report route in this app parses it before responding,
    // this one didn't.
    return reply.send(rows.map((r) => ({ ...r, product_value: toNumberOrNull(r.product_value) })))
  })

  app.delete<{ Params: { tagId: string } }>('/tags/:tagId', async (req, reply) => {
    const { rows } = await db.query('DELETE FROM tags WHERE id = $1 RETURNING id', [req.params.tagId])
    if (rows.length === 0) return reply.code(404).send({ error: 'Not found' })
    return reply.code(204).send()
  })

  // Applying/removing/listing tags on a lead
  app.post<{
    Params: { id: string; email: string }
    Body: { tag_name?: string; tag_id?: string }
  }>('/clients/:id/leads/:email/tags', async (req, reply) => {
    const { id, email } = req.params
    const { tag_name, tag_id } = req.body

    let resolvedTagId = tag_id
    if (!resolvedTagId && tag_name) {
      const { rows } = await db.query('SELECT id FROM tags WHERE client_id = $1 AND name = $2', [id, tag_name])
      resolvedTagId = rows[0]?.id
    }
    if (!resolvedTagId) {
      return reply.code(400).send({ error: 'tag_id or a valid tag_name required' })
    }

    try {
      await applyTagAndAutomate(id, email.toLowerCase().trim(), resolvedTagId)
    } catch (err) {
      return reply.code(404).send({ error: (err as Error).message })
    }
    return reply.code(200).send({ ok: true })
  })

  app.delete<{ Params: { id: string; email: string; tagId: string } }>(
    '/clients/:id/leads/:email/tags/:tagId',
    async (req, reply) => {
      const { rows } = await db.query(
        `DELETE FROM lead_tags WHERE client_id = $1 AND email = $2 AND tag_id = $3 RETURNING id`,
        [req.params.id, req.params.email.toLowerCase().trim(), req.params.tagId]
      )
      if (rows.length === 0) return reply.code(404).send({ error: 'Not found' })
      return reply.code(204).send()
    }
  )

  app.get<{ Params: { id: string; email: string } }>('/clients/:id/leads/:email/tags', async (req, reply) => {
    const { rows } = await db.query(
      `SELECT t.*, lt.applied_at, lt.applied_by
       FROM lead_tags lt JOIN tags t ON t.id = lt.tag_id
       WHERE lt.client_id = $1 AND lt.email = $2
       ORDER BY lt.applied_at DESC`,
      [req.params.id, req.params.email.toLowerCase().trim()]
    )
    return reply.send(rows)
  })

}

// Pixel-facing — split from tagRoutes above so it can be registered outside the
// dashboard's JWT-auth block (it authenticates via pixel_key, same as every other
// /track/* route, not a logged-in user). Mirrors /track/identify's shape
// (pixel_key + anonymous_id), resolving the lead's email via identities rather
// than requiring it directly, since the client's own site/CRM automation is
// calling this, not the dashboard.
export async function trackTagRoutes(app: FastifyInstance) {
  app.post<{
    Body: { pixel_key: string; anonymous_id: string; tag_name: string }
  }>('/track/tag', async (req, reply) => {
    const { pixel_key, anonymous_id, tag_name } = req.body
    if (!pixel_key || !anonymous_id || !tag_name) {
      return reply.code(400).send({ error: 'Missing required fields' })
    }

    const { rows: clientRows } = await db.query('SELECT id FROM clients WHERE pixel_key = $1', [pixel_key])
    if (clientRows.length === 0) {
      return reply.code(401).send({ error: 'Invalid pixel key' })
    }
    const clientId = clientRows[0].id

    const visitorId = await lookupVisitorId(clientId, anonymous_id)
    if (!visitorId) {
      return reply.code(404).send({ error: 'Visitor not found' })
    }

    const { rows: identityRows } = await db.query('SELECT email FROM identities WHERE client_id = $1 AND visitor_id = $2', [
      clientId,
      visitorId,
    ])
    if (identityRows.length === 0) {
      return reply.code(404).send({ error: 'This visitor has not been identified yet — call ADT.identify() first' })
    }

    const { rows: tagRows } = await db.query('SELECT id FROM tags WHERE client_id = $1 AND name = $2', [
      clientId,
      tag_name,
    ])
    if (tagRows.length === 0) {
      return reply.code(404).send({ error: `No tag named "${tag_name}" defined for this client` })
    }

    try {
      await applyTagAndAutomate(clientId, identityRows[0].email, tagRows[0].id)
    } catch (err) {
      return reply.code(500).send({ error: (err as Error).message })
    }
    return reply.code(200).send({ ok: true })
  })
}
