import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import * as crypto from 'crypto'
import { db } from '../../db'

interface TwilioConfig {
  account_sid: string
  auth_token: string
}

async function getIntegration(clientId: string): Promise<TwilioConfig | null> {
  const { rows } = await db.query<{ config: TwilioConfig }>(
    `SELECT config FROM client_integrations WHERE client_id = $1 AND platform = 'twilio'`,
    [clientId]
  )
  return rows[0]?.config ?? null
}

// Twilio signs (full request URL + sorted-and-concatenated POST param key+value
// pairs) with the account's auth token, HMAC-SHA1, base64. The URL must exactly
// match what's registered in the Twilio console (including https:// and the full
// path) or every signature check fails even with the right token.
function verifyTwilioSignature(
  url: string,
  params: Record<string, string>,
  signatureHeader: string,
  authToken: string
): boolean {
  const sorted = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url)
  const computed = crypto.createHmac('sha1', authToken).update(sorted).digest('base64')
  try {
    return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(signatureHeader))
  } catch {
    return false
  }
}

function parseFormBody(rawBody: Buffer): Record<string, string> {
  const params = new URLSearchParams(rawBody.toString())
  return Object.fromEntries(params.entries())
}

function xml(body: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>${body}`
}

export async function twilioWebhookRoutes(app: FastifyInstance) {
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'buffer' }, (_req, body, done) =>
    done(null, body)
  )

  // Twilio hits this the moment someone calls a tracking number. We look up which
  // visitor/session that number is currently assigned to, log the call, and respond
  // with TwiML that forwards the call to the client's real business line — the
  // caller never knows a tracking number was involved.
  app.post(
    '/webhooks/twilio/:client_id/voice',
    async (req: FastifyRequest<{ Params: { client_id: string } }>, reply: FastifyReply) => {
      const { client_id } = req.params
      const rawBody = req.body as Buffer
      const params = parseFormBody(rawBody)

      const config = await getIntegration(client_id)
      if (config?.auth_token) {
        const signature = req.headers['x-twilio-signature'] as string | undefined
        const fullUrl = `${req.protocol}://${req.headers.host}${req.url}`
        if (!signature || !verifyTwilioSignature(fullUrl, params, signature, config.auth_token)) {
          return reply.code(401).send({ error: 'Invalid signature' })
        }
      }

      const { rows: numberRows } = await db.query<{ id: string; forward_to: string; assigned_visitor_id: string | null }>(
        `SELECT id, forward_to, assigned_visitor_id FROM tracking_numbers WHERE client_id = $1 AND phone_number = $2`,
        [client_id, params.To]
      )

      if (numberRows.length === 0) {
        // Unrecognized number for this client — nothing to forward to, fail safe.
        return reply.type('text/xml').send(xml('<Response><Reject/></Response>'))
      }
      const trackingNumber = numberRows[0]

      let sessionId: string | null = null
      if (trackingNumber.assigned_visitor_id) {
        const { rows: sessionRows } = await db.query(
          `SELECT id FROM sessions WHERE visitor_id = $1 ORDER BY started_at DESC LIMIT 1`,
          [trackingNumber.assigned_visitor_id]
        )
        sessionId = sessionRows[0]?.id ?? null
      }

      await db.query(
        `INSERT INTO calls (client_id, tracking_number_id, session_id, caller_number, call_sid, status, started_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (call_sid) DO NOTHING`,
        [client_id, trackingNumber.id, sessionId, params.From, params.CallSid, params.CallStatus]
      )

      // Records the forwarded call (both legs) so Step 36's transcription job has
      // something to work with. recordingStatusCallback fires once the recording
      // itself is ready — separate from the call status callback above, which
      // fires on call-state changes, not on recording completion.
      const recordingCallbackUrl = `${req.protocol}://${req.headers.host}/webhooks/twilio/${client_id}/recording-status`
      return reply.type('text/xml').send(
        xml(
          `<Response><Dial record="record-from-answer-dual" recordingStatusCallback="${recordingCallbackUrl}" recordingStatusCallbackEvent="completed">${trackingNumber.forward_to}</Dial></Response>`
        )
      )
    }
  )

  // Recording-completed callback (separate from the call-status callback above) —
  // stores the recording so the Step 36 transcription job can pick it up. Doesn't
  // request a transcription itself; that job owns pacing those requests so a
  // recording-heavy day doesn't fire dozens of transcription requests inline.
  app.post(
    '/webhooks/twilio/:client_id/recording-status',
    async (req: FastifyRequest<{ Params: { client_id: string } }>, reply: FastifyReply) => {
      const { client_id } = req.params
      const rawBody = req.body as Buffer
      const params = parseFormBody(rawBody)

      const config = await getIntegration(client_id)
      if (config?.auth_token) {
        const signature = req.headers['x-twilio-signature'] as string | undefined
        const fullUrl = `${req.protocol}://${req.headers.host}${req.url}`
        if (!signature || !verifyTwilioSignature(fullUrl, params, signature, config.auth_token)) {
          return reply.code(401).send({ error: 'Invalid signature' })
        }
      }

      await db.query(
        `UPDATE calls SET recording_url = $2, recording_sid = $3 WHERE call_sid = $1`,
        [params.CallSid, params.RecordingUrl, params.RecordingSid]
      )

      return reply.code(200).send({ received: true })
    }
  )

  // Call status callback — Twilio posts updates as the call progresses and again
  // when it ends, with final duration and (if recording is enabled) the recording URL.
  app.post(
    '/webhooks/twilio/:client_id/status',
    async (req: FastifyRequest<{ Params: { client_id: string } }>, reply: FastifyReply) => {
      const { client_id } = req.params
      const rawBody = req.body as Buffer
      const params = parseFormBody(rawBody)

      const config = await getIntegration(client_id)
      if (config?.auth_token) {
        const signature = req.headers['x-twilio-signature'] as string | undefined
        const fullUrl = `${req.protocol}://${req.headers.host}${req.url}`
        if (!signature || !verifyTwilioSignature(fullUrl, params, signature, config.auth_token)) {
          return reply.code(401).send({ error: 'Invalid signature' })
        }
      }

      const isFinal = ['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(params.CallStatus)

      await db.query(
        `UPDATE calls
         SET status = $2,
             duration_seconds = COALESCE(NULLIF($3, '')::integer, duration_seconds),
             recording_url = COALESCE(NULLIF($4, ''), recording_url),
             ended_at = CASE WHEN $5 THEN NOW() ELSE ended_at END
         WHERE call_sid = $1`,
        [params.CallSid, params.CallStatus, params.CallDuration, params.RecordingUrl, isFinal]
      )

      return reply.code(200).send({ received: true })
    }
  )
}
