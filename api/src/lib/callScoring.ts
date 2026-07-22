import Anthropic from '@anthropic-ai/sdk'

// Scores a call transcript into the same disposition taxonomy as the existing
// human-set `disposition` column (migration 009) so the two are directly
// comparable in the UI, without ever overwriting what a human already set —
// see routes/calls.ts, these land in the separate ai_* columns (migration 032).
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const MODEL = 'claude-opus-4-8'

const DISPOSITIONS = ['new_lead', 'qualified', 'unqualified', 'existing_customer', 'wrong_number', 'voicemail', 'spam']

export interface CallScore {
  qualificationScore: number
  disposition: string
  summary: string
}

function buildPrompt(transcript: string): string {
  return `You are scoring a phone call transcript for a sales/marketing team. Read the transcript and respond with ONLY a JSON object, no other text, in exactly this shape:

{"qualification_score": <number 0 to 1>, "disposition": "<one of: ${DISPOSITIONS.join(', ')}>", "summary": "<one sentence summary>"}

qualification_score reflects how likely this caller is a genuine, sales-ready lead (1.0 = clearly ready to buy, 0.0 = spam/wrong number/not a real prospect).
disposition must be exactly one of the listed values.
summary must be a single factual sentence based only on what's actually in the transcript — never invent details not present.

Transcript:
"""
${transcript}
"""`
}

export async function scoreCallTranscript(transcript: string): Promise<CallScore> {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 300,
    messages: [{ role: 'user', content: buildPrompt(transcript) }],
  })

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim()

  const parsed = JSON.parse(text)
  if (typeof parsed.qualification_score !== 'number' || !DISPOSITIONS.includes(parsed.disposition)) {
    throw new Error(`Unexpected model output shape: ${text.slice(0, 200)}`)
  }

  return {
    qualificationScore: Math.max(0, Math.min(1, parsed.qualification_score)),
    disposition: parsed.disposition,
    summary: typeof parsed.summary === 'string' ? parsed.summary : '',
  }
}
