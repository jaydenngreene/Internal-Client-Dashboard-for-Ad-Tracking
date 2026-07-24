import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { db } from '../../db'
import { generateOutreachDraft } from '../../lib/remarketingAgent'
import { friendlyAiErrorMessage } from '../../lib/aiErrors'

interface CustomersAiConfig {
  webhook_secret: string
}

async function getIntegration(clientId: string): Promise<CustomersAiConfig | null> {
  const { rows } = await db.query<{ config: CustomersAiConfig }>(
    `SELECT config FROM client_integrations WHERE client_id = $1 AND platform = 'customers_ai'`,
    [clientId]
  )
  return rows[0]?.config ?? null
}

async function getClientContext(clientId: string): Promise<{ name: string; niche: string } | null> {
  const { rows } = await db.query<{ name: string; niche: string }>(
    'SELECT name, niche FROM clients WHERE id = $1',
    [clientId]
  )
  return rows[0] ?? null
}

// Like GoHighLevel (Step 9), Customers.ai's "Custom Webhook" integration has no fixed
// published schema or platform-level signature — the client picks which attributes to
// post from a template in their own UI. This defines the shape we ask them to send
// (documented in scripts/setup-remarketing-client.ts) and verifies a shared secret
// instead of a real signature, same bootstrap-then-fail-closed convention as every
// other webhook here: unverified+accepted when no integration is configured yet,
// 401 once one is.
interface CustomersAiPayload {
  secret?: string
  email?: string
  phone?: string
  first_name?: string
  last_name?: string
  page_url?: string
  page_title?: string
  visited_at?: string
}

export async function customersAiWebhookRoutes(app: FastifyInstance) {
  app.post<{ Params: { client_id: string }; Body: CustomersAiPayload }>(
    '/webhooks/customers-ai/:client_id',
    async (req: FastifyRequest<{ Params: { client_id: string }; Body: CustomersAiPayload }>, reply: FastifyReply) => {
      const { client_id } = req.params
      const body = req.body

      const config = await getIntegration(client_id)
      if (config?.webhook_secret && body.secret !== config.webhook_secret) {
        return reply.code(401).send({ error: 'Invalid or missing secret' })
      }

      if (!body.email) {
        return reply.code(400).send({ error: 'email required' })
      }

      const clientCtx = await getClientContext(client_id)
      if (!clientCtx) {
        return reply.code(404).send({ error: 'Unknown client' })
      }

      const email = body.email.toLowerCase().trim()

      const { rows } = await db.query(
        `INSERT INTO remarketing_candidates
           (client_id, source, email, phone, first_name, last_name, page_url, page_title, identified_at)
         VALUES ($1, 'customers_ai', $2, $3, $4, $5, $6, $7, COALESCE($8::timestamptz, NOW()))
         RETURNING id`,
        [
          client_id,
          email,
          body.phone ?? null,
          body.first_name ?? null,
          body.last_name ?? null,
          body.page_url ?? null,
          body.page_title ?? null,
          body.visited_at ?? null,
        ]
      )
      const candidateId = rows[0].id

      // Draft the outreach copy inline so a reviewer sees ready-to-judge text the
      // moment the candidate shows up — not queued behind a separate job. A failure
      // here (bad API key, model error) is stored on the row and surfaced to the
      // reviewer instead of crashing the webhook or losing the identified visitor.
      try {
        const draft = await generateOutreachDraft({
          clientName: clientCtx.name,
          niche: clientCtx.niche,
          firstName: body.first_name,
          pageUrl: body.page_url,
          pageTitle: body.page_title,
        })
        await db.query(
          `UPDATE remarketing_candidates
           SET draft_subject = $1, draft_body = $2, draft_generated_at = NOW()
           WHERE id = $3`,
          [draft.subject, draft.body, candidateId]
        )
      } catch (err) {
        await db.query(
          `UPDATE remarketing_candidates SET draft_error = $1 WHERE id = $2`,
          [friendlyAiErrorMessage(err), candidateId]
        )
      }

      return reply.code(200).send({ received: true, candidate_id: candidateId })
    }
  )
}
