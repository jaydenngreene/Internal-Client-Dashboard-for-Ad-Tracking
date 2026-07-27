import { FastifyInstance } from 'fastify'
import { db } from '../db'
import { conversionConfigForNiche, ConversionEventType } from '../config/nicheVocabulary'

interface SessionRow {
  id: string
  started_at: string
  utm_source: string | null
  utm_campaign: string | null
  utm_content: string | null
  utm_term: string | null
  landing_page: string | null
  referrer: string | null
  fbclid: string | null
  gclid: string | null
  ttclid: string | null
  // Resolved from utm_content via the same ad_costs id-or-name matching
  // convention every other report/job in this app uses (Phase 2, 2026-07-28)
  // — null means no ad_costs row exists for it yet (never synced, or a
  // genuinely deleted ad); the frontend falls back to the raw utm_content in
  // that case, same "graceful" behavior as everywhere else in this app.
  resolved_creative_name: string | null
}

// Phase 3 (2026-07-28) — generic conversion record replacing the previous
// purchase-only shape. `label`/`value` are always present (null when not
// applicable); the rest are populated only for the event type that actually
// produced this row (purchase-only fields stay undefined for a subscription
// or lead row, etc.) — same "flexible, not a forced lowest-common-shape"
// approach buyingJourney.ts's ConvertedPerson already takes.
interface ConversionRow {
  id: string
  occurred_at: string
  value: string | null
  label: string | null
  refunded?: boolean
  refunded_at?: string | null
  processor?: string | null
  order_id?: string | null
  status?: string | null
  page?: string | null
}

interface AttributionRow {
  purchase_id: string
  session_id: string
  model: string
  credit_fraction: string
  attributed_revenue: string
}

interface TagRow {
  name: string
  tag_type: string
  applied_at: string
  applied_by: string
}

interface CallRow {
  id: string
  session_id: string | null
  status: string | null
  duration_seconds: number | null
  qualified: boolean | null
  disposition: string | null
  started_at: string
  transcript: string | null
  ai_qualification_score: string | null
  ai_disposition: string | null
  ai_summary: string | null
}

// Fetches this email's conversion history from whichever table the client's
// niche maps to (nicheVocabulary.ts) — purchases keep their existing rich
// shape (refunded/processor/order_id); qualified_call returns nothing here
// because the existing Calls card below already covers that niche
// end-to-end (disposition workflow, AI summary) and duplicating it into a
// second generic card would just be two views of the same data.
async function getConversions(
  clientId: string,
  email: string,
  eventType: ConversionEventType
): Promise<{ rows: ConversionRow[]; supportsAttribution: boolean }> {
  if (eventType === 'purchase') {
    const { rows } = await db.query<ConversionRow>(
      `SELECT id, purchased_at AS occurred_at, revenue AS value, product AS label,
              refunded, refunded_at, processor, order_id
       FROM purchases WHERE client_id = $1 AND email = $2 ORDER BY purchased_at ASC`,
      [clientId, email]
    )
    return { rows, supportsAttribution: true }
  }
  if (eventType === 'subscription_conversion') {
    const { rows } = await db.query<ConversionRow>(
      `SELECT se.id, se.occurred_at, se.mrr_delta AS value, sub.plan_name AS label, sub.status
       FROM subscription_events se
       JOIN subscriptions sub ON sub.id = se.subscription_id
       WHERE se.client_id = $1 AND sub.email = $2 AND se.event_type IN ('trial_converted', 'activated')
       ORDER BY se.occurred_at ASC`,
      [clientId, email]
    )
    return { rows, supportsAttribution: false }
  }
  if (eventType === 'lead') {
    const { rows } = await db.query<ConversionRow>(
      `SELECT id, created_at AS occurred_at, NULL AS value, lead_type AS label, page
       FROM leads WHERE client_id = $1 AND email = $2 ORDER BY created_at ASC`,
      [clientId, email]
    )
    return { rows, supportsAttribution: false }
  }
  return { rows: [], supportsAttribution: false } // qualified_call — see the Calls card instead
}

// One place to see everything this app knows about a single lead — every session/
// touchpoint that led here, which one(s) got attribution credit for which purchase,
// every tag applied, and every call. Previously this data only existed scattered
// across aggregate report tables; the click-chain itself was computed for
// attribution math in lib/attribution.ts and then discarded, never surfaced to a
// human. A purchase with no matching identity (e.g. a CRM-only lead, never
// pixel-tracked) still shows up here as an unattributed purchase — flagged
// explicitly — rather than silently vanishing the way it does in aggregate reports.
//
// Phase 3 (2026-07-28): generalized beyond purchases — which table backs the
// "conversions" section is resolved from the client's niche, same mapping
// buyingJourney.ts uses for the aggregate tab.
export async function journeyRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string; email: string } }>(
    '/clients/:id/leads/:email/journey',
    async (req, reply) => {
      const clientId = req.params.id
      const email = req.params.email.toLowerCase().trim()

      const { rows: clientRows } = await db.query<{ niche: string }>('SELECT niche FROM clients WHERE id = $1', [clientId])
      const eventType = conversionConfigForNiche(clientRows[0]?.niche ?? 'other').eventType

      const { rows: identityRows } = await db.query<{ visitor_id: string; identified_at: string; identified_on_page: string | null }>(
        `SELECT visitor_id, identified_at, identified_on_page FROM identities WHERE client_id = $1 AND email = $2`,
        [clientId, email]
      )
      const identity = identityRows[0] ?? null

      // Phase 2 (2026-07-28): utm_medium dropped — grepped the whole codebase
      // and confirmed it's captured everywhere sessions are written but never
      // read by any matching/attribution/report query, pure passthrough
      // noise. Creative name resolved here via a LATERAL join against
      // ad_costs (id-or-name match on utm_content, platform-scoped via
      // utm_source with the same "_ads" suffix stripped everywhere else in
      // this app) instead of showing the raw numeric id.
      const sessions = identity
        ? (
            await db.query<SessionRow>(
              `SELECT s.id, s.started_at, s.utm_source, s.utm_campaign, s.utm_content, s.utm_term,
                      s.landing_page, s.referrer, s.fbclid, s.gclid, s.ttclid,
                      ac.ad_name AS resolved_creative_name
               FROM sessions s
               LEFT JOIN LATERAL (
                 SELECT ad_name FROM ad_costs
                 WHERE client_id = s.client_id
                   AND LOWER(REGEXP_REPLACE(platform, '_ads$', '')) = LOWER(REGEXP_REPLACE(COALESCE(s.utm_source, ''), '_ads$', ''))
                   AND (ad_id = s.utm_content OR LOWER(TRIM(ad_name)) = LOWER(TRIM(s.utm_content)))
                 LIMIT 1
               ) ac ON s.utm_content IS NOT NULL
               WHERE s.client_id = $1 AND s.visitor_id = $2
               ORDER BY s.started_at ASC`,
              [clientId, identity.visitor_id]
            )
          ).rows
        : []

      const { rows: conversionRows, supportsAttribution } = await getConversions(clientId, email, eventType)

      const attributionRows = supportsAttribution
        ? (
            await db.query<AttributionRow>(
              `SELECT a.purchase_id, a.session_id, a.model, a.credit_fraction, a.attributed_revenue
               FROM attributions a
               JOIN purchases p ON p.id = a.purchase_id
               WHERE a.client_id = $1 AND p.email = $2`,
              [clientId, email]
            )
          ).rows
        : []

      const { rows: tagRows } = await db.query<TagRow>(
        `SELECT t.name, t.tag_type, lt.applied_at, lt.applied_by
         FROM lead_tags lt JOIN tags t ON t.id = lt.tag_id
         WHERE lt.client_id = $1 AND lt.email = $2 ORDER BY lt.applied_at ASC`,
        [clientId, email]
      )

      const sessionIds = sessions.map((s) => s.id)
      const calls =
        sessionIds.length > 0
          ? (
              await db.query<CallRow>(
                `SELECT id, session_id, status, duration_seconds, qualified, disposition, started_at,
                        transcript, ai_qualification_score, ai_disposition, ai_summary
                 FROM calls WHERE client_id = $1 AND session_id = ANY($2::uuid[]) ORDER BY started_at ASC`,
                [clientId, sessionIds]
              )
            ).rows
          : []

      const attributedPurchaseIds = new Set(attributionRows.map((a) => a.purchase_id))
      const conversions = conversionRows.map((c) => ({
        ...c,
        value: c.value !== null ? parseFloat(c.value) : null,
        attributed: supportsAttribution ? attributedPurchaseIds.has(c.id) : undefined,
        attributions: supportsAttribution
          ? attributionRows
              .filter((a) => a.purchase_id === c.id)
              .map((a) => ({
                session_id: a.session_id,
                model: a.model,
                credit_fraction: parseFloat(a.credit_fraction),
                attributed_revenue: parseFloat(a.attributed_revenue),
              }))
          : undefined,
      }))

      const callsOut = calls.map((c) => ({
        ...c,
        ai_qualification_score: c.ai_qualification_score === null ? null : parseFloat(c.ai_qualification_score),
      }))

      return reply.send({
        email,
        eventType,
        identified: identity !== null,
        identified_at: identity?.identified_at ?? null,
        identified_on_page: identity?.identified_on_page ?? null,
        sessions,
        conversions,
        tags: tagRows,
        calls: callsOut,
      })
    }
  )
}
