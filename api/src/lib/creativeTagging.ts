import Anthropic from '@anthropic-ai/sdk'
import { db } from '../db'

const MODEL = 'claude-opus-4-8'
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// Text-based creative tagging (ad copy + asset type), not computer-vision analysis
// of the actual image/video — a disclosed scope cut, same ethos as every other
// simple/honest model in this app. The upside of a text-based approach: it works
// for all 8 ad platforms (every platform's ad_costs rows carry copy since the "ad
// copy for all 7 non-Facebook platforms" pass), not just Facebook's asset/video
// depth. Answers "what KIND of creative wins" (a recurring hook/angle/tone),
// distinct from the existing per-creative KPI view which only answers "which
// specific ad wins."
const ALLOWED_HOOK_TYPES = ['question', 'bold_claim', 'social_proof', 'problem_agitate', 'curiosity', 'direct_offer', 'other']
const ALLOWED_ANGLES = ['discount_promo', 'urgency_scarcity', 'benefit_led', 'feature_led', 'testimonial', 'comparison', 'other']
const ALLOWED_TONES = ['casual', 'professional', 'urgent', 'playful', 'aspirational', 'other']

export interface CreativeTagResult {
  hookType: string
  angle: string
  tone: string
  format: string
}

interface CreativeCopyInput {
  headline: string | null
  primaryText: string | null
  description: string | null
  creativeType: string | null
}

function buildPrompt(input: CreativeCopyInput): string {
  return `Classify this ad creative's copy into exactly these categories, choosing ONLY from the allowed values listed (pick "other" if none fit — never invent a new value):

hook_type: ${ALLOWED_HOOK_TYPES.join(', ')}
angle: ${ALLOWED_ANGLES.join(', ')}
tone: ${ALLOWED_TONES.join(', ')}

Ad copy:
Headline: ${input.headline ?? '(none)'}
Primary text: ${input.primaryText ?? '(none)'}
Description: ${input.description ?? '(none)'}
Asset type: ${input.creativeType ?? 'unknown'}

Respond with ONLY a JSON object, no other text: {"hookType": "...", "angle": "...", "tone": "..."}`
}

// Same normalization convention campaignDetail.ts's creative-detail route already
// uses for matching a creative by name.
function normalize(value: string): string {
  return value.trim().toLowerCase()
}

// Never throws — same never-let-a-downstream-failure-break-the-write-path
// convention as sendConversionSignals/dispatchEvent. A failure (including "no
// ANTHROPIC_API_KEY configured," the expected state in this dev sandbox) is
// stored on the row's `error` column so the UI shows a real reason instead of a
// silent gap, matching client_insights/remarketing_candidates' own error columns.
export async function generateCreativeTags(
  clientId: string,
  platform: string,
  adName: string
): Promise<{ tags: CreativeTagResult | null; error: string | null }> {
  const { rows } = await db.query<{
    creative_headline: string | null
    creative_primary_text: string | null
    creative_description: string | null
    creative_type: string | null
  }>(
    `SELECT creative_headline, creative_primary_text, creative_description, creative_type
     FROM ad_costs
     WHERE client_id = $1
       AND LOWER(REGEXP_REPLACE(platform, '_ads$', '')) = LOWER(REGEXP_REPLACE($2, '_ads$', ''))
       AND LOWER(TRIM(ad_name)) = LOWER(TRIM($3))
     ORDER BY date DESC LIMIT 1`,
    [clientId, platform, adName]
  )
  const row = rows[0]
  const normalizedName = normalize(adName)

  if (!row) {
    const error = 'No ad_costs row found for this creative.'
    await db.query(
      `INSERT INTO creative_tags (client_id, platform, ad_name, error)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (client_id, platform, ad_name) DO UPDATE SET error = $4, generated_at = NOW()`,
      [clientId, platform, normalizedName, error]
    )
    return { tags: null, error }
  }

  const input: CreativeCopyInput = {
    headline: row.creative_headline,
    primaryText: row.creative_primary_text,
    description: row.creative_description,
    creativeType: row.creative_type,
  }
  if (!input.headline && !input.primaryText && !input.description) {
    const error = 'No ad copy synced for this creative yet — nothing to classify.'
    await db.query(
      `INSERT INTO creative_tags (client_id, platform, ad_name, error)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (client_id, platform, ad_name) DO UPDATE SET error = $4, generated_at = NOW()`,
      [clientId, platform, normalizedName, error]
    )
    return { tags: null, error }
  }

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 200,
      messages: [{ role: 'user', content: buildPrompt(input) }],
    })
    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim()
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error(`Unexpected model output shape: ${text.slice(0, 200)}`)
    const parsed = JSON.parse(jsonMatch[0]) as { hookType: string; angle: string; tone: string }

    const hookType = ALLOWED_HOOK_TYPES.includes(parsed.hookType) ? parsed.hookType : 'other'
    const angle = ALLOWED_ANGLES.includes(parsed.angle) ? parsed.angle : 'other'
    const tone = ALLOWED_TONES.includes(parsed.tone) ? parsed.tone : 'other'
    const format = input.creativeType ?? 'unknown'

    await db.query(
      `INSERT INTO creative_tags (client_id, platform, ad_name, hook_type, angle, tone, format, model, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL)
       ON CONFLICT (client_id, platform, ad_name)
       DO UPDATE SET hook_type = $4, angle = $5, tone = $6, format = $7, model = $8, error = NULL, generated_at = NOW()`,
      [clientId, platform, normalizedName, hookType, angle, tone, format, MODEL]
    )
    return { tags: { hookType, angle, tone, format }, error: null }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    await db.query(
      `INSERT INTO creative_tags (client_id, platform, ad_name, error)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (client_id, platform, ad_name) DO UPDATE SET error = $4, generated_at = NOW()`,
      [clientId, platform, normalizedName, error]
    )
    return { tags: null, error }
  }
}

export interface TagPerformanceRow {
  dimension: 'hook_type' | 'angle' | 'tone'
  value: string
  creativeCount: number
  totalSpend: number
  totalRevenue: number
  avgRoas: number | null
}

// The "pattern mining" half — correlates each tag value against the same
// creatives' actual spend/revenue (joined by normalized platform+ad_name, the
// same key creative_tags is keyed on) so "which angle actually performs" is
// answerable without opening every creative individually.
export async function getCreativeTagPerformance(clientId: string): Promise<TagPerformanceRow[]> {
  const { rows: tagRows } = await db.query<{ platform: string; ad_name: string; hook_type: string; angle: string; tone: string }>(
    `SELECT platform, ad_name, hook_type, angle, tone FROM creative_tags
     WHERE client_id = $1 AND hook_type IS NOT NULL`,
    [clientId]
  )
  if (tagRows.length === 0) return []

  const { rows: perfRows } = await db.query<{ platform: string; ad_name: string; spend: string; revenue: string }>(
    `SELECT LOWER(REGEXP_REPLACE(ac.platform, '_ads$', '')) AS platform, LOWER(TRIM(ac.ad_name)) AS ad_name,
            SUM(ac.spend) AS spend, COALESCE(rev.total, 0) AS revenue
     FROM ad_costs ac
     LEFT JOIN (
       SELECT s.utm_content, SUM(a.attributed_revenue) AS total
       FROM attributions a JOIN sessions s ON s.id = a.session_id
       WHERE a.client_id = $1
       GROUP BY s.utm_content
     ) rev ON LOWER(TRIM(rev.utm_content)) = LOWER(TRIM(ac.ad_name))
     WHERE ac.client_id = $1
     GROUP BY LOWER(REGEXP_REPLACE(ac.platform, '_ads$', '')), LOWER(TRIM(ac.ad_name)), rev.total`,
    [clientId]
  )
  const perfByKey = new Map(
    perfRows.map((r) => [`${r.platform}::${r.ad_name}`, { spend: parseFloat(r.spend), revenue: parseFloat(r.revenue) }])
  )

  const buckets = new Map<string, { creativeCount: number; totalSpend: number; totalRevenue: number }>()
  function addTo(dimension: string, value: string, spend: number, revenue: number) {
    const key = `${dimension}::${value}`
    const existing = buckets.get(key) ?? { creativeCount: 0, totalSpend: 0, totalRevenue: 0 }
    existing.creativeCount += 1
    existing.totalSpend += spend
    existing.totalRevenue += revenue
    buckets.set(key, existing)
  }

  for (const tag of tagRows) {
    const platformKey = tag.platform.replace(/_ads$/, '').toLowerCase()
    const perf = perfByKey.get(`${platformKey}::${tag.ad_name}`) ?? { spend: 0, revenue: 0 }
    addTo('hook_type', tag.hook_type, perf.spend, perf.revenue)
    addTo('angle', tag.angle, perf.spend, perf.revenue)
    addTo('tone', tag.tone, perf.spend, perf.revenue)
  }

  const result: TagPerformanceRow[] = []
  for (const [key, agg] of buckets) {
    const [dimension, value] = key.split('::') as [TagPerformanceRow['dimension'], string]
    result.push({
      dimension,
      value,
      creativeCount: agg.creativeCount,
      totalSpend: agg.totalSpend,
      totalRevenue: agg.totalRevenue,
      avgRoas: agg.totalSpend > 0 ? agg.totalRevenue / agg.totalSpend : null,
    })
  }
  return result.sort((a, b) => (b.avgRoas ?? 0) - (a.avgRoas ?? 0))
}
