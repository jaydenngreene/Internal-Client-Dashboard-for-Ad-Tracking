import Anthropic from '@anthropic-ai/sdk'

// Drafts outreach copy for a deanonymized visitor. This never sends anything —
// it only produces text for a human to review (see routes/remarketing.ts). The only
// context available is what the identity-resolution vendor hands back (name, the page
// they were on) plus the client's niche; there is no browsing history or cart contents
// to draw on, so the prompt is deliberately honest about working from a single page view
// rather than pretending to a level of personalization we don't have data for.
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export interface DraftInput {
  clientName: string
  niche: string
  firstName?: string | null
  pageUrl?: string | null
  pageTitle?: string | null
}

export interface DraftOutput {
  subject: string
  body: string
}

const MODEL = 'claude-opus-4-8'

function buildPrompt(input: DraftInput): string {
  const greeting = input.firstName ? `The visitor's first name is "${input.firstName}".` : 'The visitor\'s name is unknown — do not invent one.'
  const page = input.pageTitle || input.pageUrl
    ? `They were last seen on: ${input.pageTitle ?? ''} ${input.pageUrl ? `(${input.pageUrl})` : ''}`.trim()
    : 'No specific page is known — keep this general.'

  return `You are writing a single short remarketing email on behalf of "${input.clientName}", a ${input.niche} business, to a website visitor who was identified by a third-party tool but never gave their contact info directly (no purchase, no form fill, no login).

${greeting}
${page}

Write copy that:
- Sounds like a real person from the brand, not an ad
- References the page/interest only if it's actually known above — never fabricate browsing detail, product names, or urgency ("only 2 left!") that wasn't given to you
- Is short (under 90 words for the body)
- Has a single, low-pressure call to action
- Does not claim any prior relationship with the recipient beyond "we noticed you stopped by"

Respond with exactly two lines, nothing else:
SUBJECT: <subject line>
BODY: <email body>`
}

// Throws on failure — the caller (webhook handler) catches this and stores the
// error on the candidate row rather than blocking ingestion, same "never let a
// downstream failure break the write path" pattern as sendConversionSignals/adCosts.
export async function generateOutreachDraft(input: DraftInput): Promise<DraftOutput> {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 400,
    messages: [{ role: 'user', content: buildPrompt(input) }],
  })

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim()

  const subjectMatch = text.match(/SUBJECT:\s*(.+)/i)
  const bodyMatch = text.match(/BODY:\s*([\s\S]+)/i)

  if (!subjectMatch || !bodyMatch) {
    throw new Error(`Unexpected model output shape: ${text.slice(0, 200)}`)
  }

  return {
    subject: subjectMatch[1].trim(),
    body: bodyMatch[1].trim(),
  }
}
