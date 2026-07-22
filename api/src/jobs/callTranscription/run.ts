import { db } from '../../db'
import { scoreCallTranscript } from '../../lib/callScoring'

interface TwilioConfig {
  account_sid: string
  auth_token: string
  // Set up once in the Twilio Console (Voice Intelligence > create a Service) —
  // needed to actually transcribe anything. Without it, recordings still get
  // stored (see webhooks/twilio.ts) but this job has nothing to submit them to.
  voice_intelligence_service_sid?: string
}

function authHeader(config: TwilioConfig): string {
  return `Basic ${Buffer.from(`${config.account_sid}:${config.auth_token}`).toString('base64')}`
}

// Twilio's OLDER Recordings/{sid}/Transcriptions.json endpoint no longer accepts
// POST on current accounts (confirmed live: returns a 405 "does not support the
// attempted HTTP method" even with fake credentials, i.e. a real routing error,
// not an auth failure) — Voice Intelligence's /v2/Transcripts is the current
// Twilio-native mechanism (confirmed live: a fake-credentials POST to this one
// returns 401 auth error, meaning the route itself is real and accepts POST).
// Still no completion callback on this resource either, so this job polls: submit
// once per recording, then check status on later runs until it's done.
const INTELLIGENCE_BASE = 'https://intelligence.twilio.com/v2'

export async function transcribeAndScoreCalls(): Promise<number> {
  let processed = 0
  processed += await requestNewTranscriptions()
  processed += await pollPendingTranscriptions()
  return processed
}

async function getTwilioConfig(clientId: string): Promise<TwilioConfig | null> {
  const { rows } = await db.query<{ config: TwilioConfig }>(
    `SELECT config FROM client_integrations WHERE client_id = $1 AND platform = 'twilio'`,
    [clientId]
  )
  return rows[0]?.config ?? null
}

async function requestNewTranscriptions(): Promise<number> {
  const { rows } = await db.query<{ id: string; client_id: string; recording_sid: string }>(
    `SELECT id, client_id, recording_sid FROM calls
     WHERE recording_sid IS NOT NULL AND transcript_requested_at IS NULL
     ORDER BY started_at ASC LIMIT 20`
  )

  let requested = 0
  for (const call of rows) {
    const config = await getTwilioConfig(call.client_id)
    if (!config?.voice_intelligence_service_sid) continue

    try {
      const res = await fetch(`${INTELLIGENCE_BASE}/Transcripts`, {
        method: 'POST',
        headers: { Authorization: authHeader(config), 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          ServiceSid: config.voice_intelligence_service_sid,
          Channel: JSON.stringify({ media_properties: { source_sid: call.recording_sid } }),
        }),
      })
      if (!res.ok) throw new Error(`Voice Intelligence transcript request failed (${res.status}): ${await res.text()}`)
      const body = (await res.json()) as { sid: string }
      await db.query(`UPDATE calls SET transcription_sid = $2, transcript_requested_at = NOW() WHERE id = $1`, [
        call.id,
        body.sid,
      ])
      requested++
    } catch (err) {
      console.error(`[call-transcription] request failed for call ${call.id}:`, (err as Error).message)
      // Still mark as requested so this call isn't retried forever on every run —
      // same "fail once, don't retry-storm" convention as marking a call's
      // transcript '(transcription failed)' below once polling gives up on it.
      await db.query(`UPDATE calls SET transcript_requested_at = NOW() WHERE id = $1`, [call.id])
    }
  }
  return requested
}

async function pollPendingTranscriptions(): Promise<number> {
  const { rows } = await db.query<{ id: string; client_id: string; transcription_sid: string }>(
    `SELECT id, client_id, transcription_sid FROM calls
     WHERE transcription_sid IS NOT NULL AND transcript IS NULL
       AND transcript_requested_at < NOW() - INTERVAL '2 minutes'
     ORDER BY transcript_requested_at ASC LIMIT 20`
  )

  let completed = 0
  for (const call of rows) {
    const config = await getTwilioConfig(call.client_id)
    if (!config) continue
    try {
      const res = await fetch(`${INTELLIGENCE_BASE}/Transcripts/${call.transcription_sid}`, {
        headers: { Authorization: authHeader(config) },
      })
      if (!res.ok) throw new Error(`Voice Intelligence transcript fetch failed (${res.status}): ${await res.text()}`)
      const body = (await res.json()) as { status: string }

      if (body.status === 'completed') {
        const sentencesRes = await fetch(`${INTELLIGENCE_BASE}/Transcripts/${call.transcription_sid}/Sentences`, {
          headers: { Authorization: authHeader(config) },
        })
        if (!sentencesRes.ok) throw new Error(`Voice Intelligence sentences fetch failed (${sentencesRes.status})`)
        const sentencesBody = (await sentencesRes.json()) as { sentences: { transcript: string }[] }
        const transcript = sentencesBody.sentences.map((s) => s.transcript).join(' ')

        await db.query(`UPDATE calls SET transcript = $2 WHERE id = $1`, [call.id, transcript])
        try {
          const score = await scoreCallTranscript(transcript)
          await db.query(
            `UPDATE calls SET ai_qualification_score = $2, ai_disposition = $3, ai_summary = $4 WHERE id = $1`,
            [call.id, score.qualificationScore, score.disposition, score.summary]
          )
        } catch (scoreErr) {
          console.error(`[call-transcription] scoring failed for call ${call.id}:`, (scoreErr as Error).message)
        }
        completed++
      } else if (body.status === 'failed' || body.status === 'canceled') {
        await db.query(`UPDATE calls SET transcript = '(transcription failed)' WHERE id = $1`, [call.id])
      }
      // status still 'queued'/'in-progress' — leave it, next run will check again.
    } catch (err) {
      console.error(`[call-transcription] poll failed for call ${call.id}:`, (err as Error).message)
    }
  }
  return completed
}
