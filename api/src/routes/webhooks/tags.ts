import { FastifyInstance } from 'fastify'
import { db } from '../../db'
import { applyTagAndAutomate } from '../../lib/tagAutomation'

interface TagWebhookConfig {
  webhook_secret: string
}

async function getIntegration(clientId: string): Promise<TagWebhookConfig | null> {
  const { rows } = await db.query<{ config: TagWebhookConfig }>(
    `SELECT config FROM client_integrations WHERE client_id = $1 AND platform = 'tag_webhook'`,
    [clientId]
  )
  return rows[0]?.config ?? null
}

// A dedicated, secret-protected entry point for external callers (a client's CRM,
// a Zapier "Webhooks" action) to apply a tag by email alone — distinct from
// /clients/:id/leads/:email/tags, which stays unauthenticated same as every other
// dashboard-facing route (it's only ever called by our own trusted dashboard UI).
// Same shared-secret convention as webhooks/gohighlevel.ts, for the same reason:
// no platform-level signature exists to verify instead.
export async function tagWebhookRoutes(app: FastifyInstance) {
  app.post<{
    Params: { client_id: string }
    Body: { secret?: string; email?: string; tag_name?: string }
  }>('/webhooks/tags/:client_id', async (req, reply) => {
    const { client_id } = req.params
    const { secret, email, tag_name } = req.body

    const config = await getIntegration(client_id)
    if (!config?.webhook_secret) {
      return reply.code(400).send({ error: 'No tag webhook secret configured for this client yet — set one up in Settings first' })
    }
    if (secret !== config.webhook_secret) {
      return reply.code(401).send({ error: 'Invalid or missing secret' })
    }
    if (!email || !tag_name) {
      return reply.code(400).send({ error: 'email and tag_name required' })
    }

    const { rows: tagRows } = await db.query('SELECT id FROM tags WHERE client_id = $1 AND name = $2', [
      client_id,
      tag_name,
    ])
    if (tagRows.length === 0) {
      return reply.code(404).send({ error: `No tag named "${tag_name}" defined for this client` })
    }

    try {
      await applyTagAndAutomate(client_id, email.toLowerCase().trim(), tagRows[0].id)
    } catch (err) {
      return reply.code(500).send({ error: (err as Error).message })
    }
    return reply.code(200).send({ ok: true })
  })
}
