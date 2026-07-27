import Anthropic from '@anthropic-ai/sdk'
import { db } from '../db'
import {
  getCostContext,
  checkGate,
  getDaysLive,
  getDaysLiveMap,
  lookupDaysLive,
  annotateEntityGate,
  GateAnnotation,
  EntityType,
} from './recommendationGate'
import { benchmarkForNiche } from '../config/industryBenchmarks'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const MODEL = 'claude-opus-4-8'

export interface Insight {
  title: string
  detail: string
  priority: 'high' | 'medium' | 'low'
  // Phase 1 guardrails (2026-07-27) — set server-side from the gate, never
  // trusted from the model's own output. insufficientData=true means Claude was
  // never called at all for this scope; the gate failed and this is the only
  // "insight" returned, in place of a generated recommendation.
  confidence?: 'low' | 'medium' | 'high' | null
  daysLive?: number
  insufficientData?: boolean
}

export type InsightScope =
  | { type: 'client' }
  | { type: 'platform'; platform: string }
  | { type: 'campaign'; platform: string; campaignName: string }
  | { type: 'creative'; platform: string; campaignName: string; creativeName: string }

// Pulls the same shape of data the existing report endpoints already compute, but as
// plain self-contained queries here rather than reusing reports.ts's route-local
// functions — keeps this feature isolated from the reporting routes rather than
// risking a refactor of code those routes already depend on.
async function gatherLast30DaysData(clientId: string): Promise<Record<string, unknown>> {
  const { rows: clientRows } = await db.query<{ name: string; niche: string }>(
    'SELECT name, niche FROM clients WHERE id = $1',
    [clientId]
  )
  const clientInfo = clientRows[0]

  const { rows: overviewRows } = await db.query<{
    cost: string
    revenue: string
    leads: string
    sales: string
    impressions: string
    clicks: string
  }>(
    `SELECT
       COALESCE((SELECT SUM(spend) FROM ad_costs WHERE client_id = $1 AND date >= NOW() - INTERVAL '30 days'), 0) AS cost,
       COALESCE((SELECT SUM(a.attributed_revenue) FROM attributions a JOIN purchases p ON p.id = a.purchase_id
                 WHERE a.client_id = $1 AND p.purchased_at >= NOW() - INTERVAL '30 days'), 0) AS revenue,
       COALESCE((SELECT COUNT(*) FROM leads WHERE client_id = $1 AND created_at >= NOW() - INTERVAL '30 days'), 0) AS leads,
       COALESCE((SELECT COUNT(*) FROM purchases WHERE client_id = $1 AND purchased_at >= NOW() - INTERVAL '30 days' AND NOT refunded), 0) AS sales,
       COALESCE((SELECT SUM(impressions) FROM ad_costs WHERE client_id = $1 AND date >= NOW() - INTERVAL '30 days'), 0) AS impressions,
       COALESCE((SELECT SUM(clicks) FROM ad_costs WHERE client_id = $1 AND date >= NOW() - INTERVAL '30 days'), 0) AS clicks`,
    [clientId]
  )
  const overview = overviewRows[0]

  const { rows: campaignRows } = await db.query<{
    campaign_name: string | null
    campaign_id: string | null
    cost: string
    revenue: string
    sales: string
  }>(
    // Rewritten 2026-07-28 (found during review-fix verification, unrelated to
    // the review itself): the original FULL OUTER JOIN's ON clause was
    // `name-match OR id-match` — PostgreSQL's planner categorically cannot
    // execute a FULL JOIN with an OR'd condition ("FULL JOIN is only supported
    // with merge-joinable or hash-joinable join conditions", confirmed via a
    // minimal repro independent of any client's data). This has never been
    // able to run, for any client, since this file was written — a pre-existing
    // outage in Gojo's whole-account insights discovered while verifying the
    // gating fixes, not caused by them. Fix: resolve the name-or-id match in the
    // `rev` CTE first (via correlated subqueries, LIMIT 1 to guard the rare case
    // of two spend rows sharing a name), so the FULL JOIN itself only ever
    // needs a single equality condition, which IS hash-joinable.
    `WITH spend AS (
       SELECT campaign_name, campaign_id, SUM(spend) AS cost FROM ad_costs
       WHERE client_id = $1 AND date >= NOW() - INTERVAL '30 days' GROUP BY campaign_name, campaign_id
     ), rev AS (
       SELECT
         COALESCE(
           (SELECT sp.campaign_name FROM spend sp WHERE LOWER(TRIM(sp.campaign_name)) = LOWER(TRIM(r.utm_campaign)) LIMIT 1),
           (SELECT sp.campaign_name FROM spend sp WHERE sp.campaign_id = r.utm_campaign LIMIT 1),
           r.utm_campaign
         ) AS campaign_name,
         SUM(r.attributed_revenue) AS revenue,
         COUNT(DISTINCT r.purchase_id) AS sales
       FROM (
         SELECT s.utm_campaign, a.attributed_revenue, a.purchase_id
         FROM attributions a JOIN sessions s ON s.id = a.session_id JOIN purchases p ON p.id = a.purchase_id
         WHERE a.client_id = $1 AND p.purchased_at >= NOW() - INTERVAL '30 days'
       ) r
       GROUP BY 1
     )
     SELECT COALESCE(spend.campaign_name, rev.campaign_name) AS campaign_name, spend.campaign_id,
            COALESCE(spend.cost, 0) AS cost, COALESCE(rev.revenue, 0) AS revenue, COALESCE(rev.sales, 0) AS sales
     FROM spend
     FULL OUTER JOIN rev ON lower(trim(rev.campaign_name)) = lower(trim(spend.campaign_name))
     ORDER BY COALESCE(spend.cost, 0) DESC
     LIMIT 10`,
    [clientId]
  )

  const { rows: creativeRows } = await db.query<{
    ad_name: string | null
    ad_id: string | null
    cost: string
    revenue: string
  }>(
    // Same FULL-JOIN-with-OR fix as campaignRows above.
    `WITH spend AS (
       SELECT ad_name, ad_id, SUM(spend) AS cost FROM ad_costs
       WHERE client_id = $1 AND date >= NOW() - INTERVAL '30 days' GROUP BY ad_name, ad_id
     ), rev AS (
       SELECT
         COALESCE(
           (SELECT sp.ad_name FROM spend sp WHERE LOWER(TRIM(sp.ad_name)) = LOWER(TRIM(r.utm_content)) LIMIT 1),
           (SELECT sp.ad_name FROM spend sp WHERE sp.ad_id = r.utm_content LIMIT 1),
           r.utm_content
         ) AS ad_name,
         SUM(r.attributed_revenue) AS revenue
       FROM (
         SELECT s.utm_content, a.attributed_revenue
         FROM attributions a JOIN sessions s ON s.id = a.session_id JOIN purchases p ON p.id = a.purchase_id
         WHERE a.client_id = $1 AND p.purchased_at >= NOW() - INTERVAL '30 days'
       ) r
       GROUP BY 1
     )
     SELECT COALESCE(spend.ad_name, rev.ad_name) AS ad_name, spend.ad_id,
            COALESCE(spend.cost, 0) AS cost, COALESCE(rev.revenue, 0) AS revenue
     FROM spend
     FULL OUTER JOIN rev ON lower(trim(rev.ad_name)) = lower(trim(spend.ad_name))
     ORDER BY COALESCE(spend.cost, 0) DESC
     LIMIT 10`,
    [clientId]
  )

  const { rows: bofRows } = await db.query<{ refund_rate: string | null; avg_days: string | null }>(
    `SELECT
       (COUNT(*) FILTER (WHERE refunded)::float / NULLIF(COUNT(*), 0) * 100) AS refund_rate,
       AVG(EXTRACT(EPOCH FROM (purchased_at - (SELECT MIN(created_at) FROM leads WHERE client_id = $1 AND email = purchases.email))) / 86400)
         FILTER (WHERE purchased_at >= NOW() - INTERVAL '30 days') AS avg_days
     FROM purchases WHERE client_id = $1 AND purchased_at >= NOW() - INTERVAL '30 days'`,
    [clientId]
  )

  const costCtx = await getCostContext(clientId)
  const [campaignDaysLive, creativeDaysLive] = await Promise.all([
    getDaysLiveMap(clientId, 'campaign'),
    getDaysLiveMap(clientId, 'creative'),
  ])

  const result: Record<string, unknown> = {
    clientName: clientInfo?.name,
    niche: clientInfo?.niche,
    // Phase 1.3 (2026-07-28): judged against THIS niche's industry benchmark,
    // not one universal standard — see prompt below for how it's used.
    industryBenchmark: benchmarkForNiche(clientInfo?.niche ?? 'other'),
    last30Days: {
      cost: parseFloat(overview.cost),
      revenue: parseFloat(overview.revenue),
      profit: parseFloat(overview.revenue) - parseFloat(overview.cost),
      roas: parseFloat(overview.cost) > 0 ? parseFloat(overview.revenue) / parseFloat(overview.cost) : null,
      leads: parseInt(overview.leads, 10),
      sales: parseInt(overview.sales, 10),
      impressions: parseInt(overview.impressions, 10),
      clicks: parseInt(overview.clicks, 10),
      ctrPercent: parseInt(overview.impressions, 10) > 0 ? (parseInt(overview.clicks, 10) / parseInt(overview.impressions, 10)) * 100 : null,
    },
    // dataSufficient/confidence/daysLive per row (Phase 1 guardrails) — the
    // prompt below is instructed to only recommend action on rows marked
    // dataSufficient: true, and generateInsights post-validates that instruction
    // was actually followed rather than trusting it. Account-level totals above
    // aren't gated; there's no "days live" for an entire account.
    topCampaignsBySpend: campaignRows.map((r) => ({
      name: r.campaign_name ?? '(untagged)',
      cost: parseFloat(r.cost),
      revenue: parseFloat(r.revenue),
      sales: parseInt(r.sales, 10),
      ...annotateEntityGate(
        costCtx,
        'campaign',
        lookupDaysLive(campaignDaysLive, r.campaign_id, r.campaign_name),
        parseFloat(r.cost),
        parseInt(r.sales, 10)
      ),
    })),
    topCreativesBySpend: creativeRows
      .filter((r) => r.ad_name)
      .map((r) => ({
        name: r.ad_name,
        cost: parseFloat(r.cost),
        revenue: parseFloat(r.revenue),
        ...annotateEntityGate(
          costCtx,
          'creative',
          lookupDaysLive(creativeDaysLive, r.ad_id, r.ad_name),
          parseFloat(r.cost),
          null
        ),
      })),
    refundRatePercent: bofRows[0]?.refund_rate !== null ? parseFloat(bofRows[0].refund_rate!) : null,
    avgDaysToConvert: bofRows[0]?.avg_days !== null ? parseFloat(bofRows[0].avg_days!) : null,
  }

  if (clientInfo?.niche === 'saas') {
    const { rows: subRows } = await db.query<{ current_mrr: string; canceled_count: string; active_count: string }>(
      `SELECT
         (SELECT COALESCE(SUM(mrr_amount), 0) FROM subscriptions WHERE client_id = $1 AND status = 'active') AS current_mrr,
         (SELECT COUNT(*) FROM subscription_events WHERE client_id = $1 AND event_type = 'canceled' AND occurred_at >= NOW() - INTERVAL '30 days') AS canceled_count,
         (SELECT COUNT(*) FROM subscriptions WHERE client_id = $1 AND status = 'active') AS active_count`,
      [clientId]
    )
    result.subscriptions = {
      currentMrr: parseFloat(subRows[0].current_mrr),
      canceledLast30Days: parseInt(subRows[0].canceled_count, 10),
      activeSubscribers: parseInt(subRows[0].active_count, 10),
    }
  }

  return result
}

// Whole-account data scoped to one platform — same shape as gatherLast30DaysData but
// filtered, so a client running Facebook + Google + TikTok gets a separate insight per
// platform instead of one blended number across all of them.
async function gatherPlatformData(clientId: string, platform: string): Promise<Record<string, unknown>> {
  const { rows: clientRows } = await db.query<{ name: string; niche: string }>('SELECT name, niche FROM clients WHERE id = $1', [
    clientId,
  ])

  const { rows: kpiRows } = await db.query<{ cost: string; impressions: string; clicks: string }>(
    `SELECT COALESCE(SUM(spend), 0) AS cost, COALESCE(SUM(impressions), 0) AS impressions, COALESCE(SUM(clicks), 0) AS clicks
     FROM ad_costs
     WHERE client_id = $1 AND date >= NOW() - INTERVAL '30 days'
       AND LOWER(REGEXP_REPLACE(platform, '_ads$', '')) = LOWER(REGEXP_REPLACE($2, '_ads$', ''))`,
    [clientId, platform]
  )
  const { rows: leadRows } = await db.query<{ leads: string }>(
    `SELECT COUNT(DISTINCT l.id) AS leads
     FROM leads l
     JOIN identities i ON i.client_id = l.client_id AND i.email = l.email
     JOIN LATERAL (
       SELECT utm_source FROM sessions
       WHERE visitor_id = i.visitor_id AND started_at <= l.created_at AND started_at >= l.created_at - INTERVAL '90 days'
       ORDER BY started_at ASC LIMIT 1
     ) s ON true
     WHERE l.client_id = $1 AND l.created_at >= NOW() - INTERVAL '30 days'
       AND LOWER(REGEXP_REPLACE(s.utm_source, '_ads$', '')) = LOWER(REGEXP_REPLACE($2, '_ads$', ''))`,
    [clientId, platform]
  )
  const { rows: revRows } = await db.query<{ revenue: string; sales: string }>(
    `SELECT COALESCE(SUM(a.attributed_revenue), 0) AS revenue, COUNT(DISTINCT a.purchase_id) AS sales
     FROM attributions a
     JOIN sessions s ON s.id = a.session_id
     JOIN purchases p ON p.id = a.purchase_id
     WHERE a.client_id = $1 AND p.purchased_at >= NOW() - INTERVAL '30 days'
       AND LOWER(REGEXP_REPLACE(s.utm_source, '_ads$', '')) = LOWER(REGEXP_REPLACE($2, '_ads$', ''))`,
    [clientId, platform]
  )
  const { rows: campaignRows } = await db.query<{
    campaign_name: string | null
    campaign_id: string | null
    cost: string
    revenue: string
    sales: string
  }>(
    // Same FULL-JOIN-with-OR fix as gatherLast30DaysData's campaignRows —
    // resolve the name-or-id match inside the rev CTE first, so the FULL JOIN
    // itself only ever needs a single (hash-joinable) equality condition.
    `WITH spend AS (
       SELECT campaign_name, campaign_id, SUM(spend) AS cost FROM ad_costs
       WHERE client_id = $1 AND date >= NOW() - INTERVAL '30 days'
         AND LOWER(REGEXP_REPLACE(platform, '_ads$', '')) = LOWER(REGEXP_REPLACE($2, '_ads$', ''))
       GROUP BY campaign_name, campaign_id
     ), rev AS (
       SELECT
         COALESCE(
           (SELECT sp.campaign_name FROM spend sp WHERE LOWER(TRIM(sp.campaign_name)) = LOWER(TRIM(r.utm_campaign)) LIMIT 1),
           (SELECT sp.campaign_name FROM spend sp WHERE sp.campaign_id = r.utm_campaign LIMIT 1),
           r.utm_campaign
         ) AS campaign_name,
         SUM(r.attributed_revenue) AS revenue,
         COUNT(DISTINCT r.purchase_id) AS sales
       FROM (
         SELECT s.utm_campaign, a.attributed_revenue, a.purchase_id
         FROM attributions a JOIN sessions s ON s.id = a.session_id JOIN purchases p ON p.id = a.purchase_id
         WHERE a.client_id = $1 AND p.purchased_at >= NOW() - INTERVAL '30 days'
           AND LOWER(REGEXP_REPLACE(s.utm_source, '_ads$', '')) = LOWER(REGEXP_REPLACE($2, '_ads$', ''))
       ) r
       GROUP BY 1
     )
     SELECT COALESCE(spend.campaign_name, rev.campaign_name) AS campaign_name, spend.campaign_id,
            COALESCE(spend.cost, 0) AS cost, COALESCE(rev.revenue, 0) AS revenue, COALESCE(rev.sales, 0) AS sales
     FROM spend
     FULL OUTER JOIN rev ON lower(trim(rev.campaign_name)) = lower(trim(spend.campaign_name))
     ORDER BY COALESCE(spend.cost, 0) DESC
     LIMIT 10`,
    [clientId, platform]
  )

  const cost = parseFloat(kpiRows[0].cost)
  const revenue = parseFloat(revRows[0].revenue)
  const platformCostCtx = await getCostContext(clientId)
  const campaignDaysLive = await getDaysLiveMap(clientId, 'campaign', platform)

  const impressions = parseInt(kpiRows[0].impressions, 10)
  const clicks = parseInt(kpiRows[0].clicks, 10)

  return {
    clientName: clientRows[0]?.name,
    platform,
    industryBenchmark: benchmarkForNiche(clientRows[0]?.niche ?? 'other'),
    last30Days: {
      cost,
      impressions,
      clicks,
      ctrPercent: impressions > 0 ? (clicks / impressions) * 100 : null,
      revenue,
      profit: revenue - cost,
      roas: cost > 0 ? revenue / cost : null,
      leads: parseInt(leadRows[0].leads, 10),
      sales: parseInt(revRows[0].sales, 10),
    },
    topCampaignsBySpend: campaignRows.map((r) => ({
      name: r.campaign_name ?? '(untagged)',
      cost: parseFloat(r.cost),
      revenue: parseFloat(r.revenue),
      sales: parseInt(r.sales, 10),
      ...annotateEntityGate(
        platformCostCtx,
        'campaign',
        lookupDaysLive(campaignDaysLive, r.campaign_id, r.campaign_name),
        parseFloat(r.cost),
        parseInt(r.sales, 10)
      ),
    })),
  }
}

// Same platform/campaign-name matching convention as reports.ts's funnel breakdown and
// campaignDetail.ts (strip a trailing "_ads", lowercase+trim) — kept as self-contained
// queries here rather than importing those routes' internals, same isolation reasoning
// as gatherLast30DaysData above.
async function gatherCampaignData(
  clientId: string,
  platform: string,
  campaignName: string
): Promise<Record<string, unknown>> {
  const { rows: clientRows } = await db.query<{ name: string; niche: string }>('SELECT name, niche FROM clients WHERE id = $1', [
    clientId,
  ])

  const { rows: kpiRows } = await db.query<{ cost: string; impressions: string; clicks: string }>(
    `SELECT COALESCE(SUM(spend), 0) AS cost, COALESCE(SUM(impressions), 0) AS impressions, COALESCE(SUM(clicks), 0) AS clicks
     FROM ad_costs
     WHERE client_id = $1 AND date >= NOW() - INTERVAL '30 days'
       AND LOWER(REGEXP_REPLACE(platform, '_ads$', '')) = LOWER(REGEXP_REPLACE($2, '_ads$', ''))
       AND LOWER(TRIM(campaign_name)) = LOWER(TRIM($3))`,
    [clientId, platform, campaignName]
  )
  // A client's ad URLs can carry Meta's raw {{campaign.id}} in utm_campaign
  // instead of the campaign name (confirmed live) - resolved once here and
  // matched as a fallback everywhere below, same reasoning as
  // campaignDetail.ts's resolveCampaignId (kept as an inline subquery instead
  // of importing that helper, matching this file's own stated isolation).
  const campaignIdSubquery = `(
    SELECT campaign_id FROM ad_costs
    WHERE client_id = $1
      AND LOWER(REGEXP_REPLACE(platform, '_ads$', '')) = LOWER(REGEXP_REPLACE($2, '_ads$', ''))
      AND LOWER(TRIM(campaign_name)) = LOWER(TRIM($3))
      AND campaign_id IS NOT NULL
    LIMIT 1
  )`
  const { rows: leadRows } = await db.query<{ leads: string }>(
    `SELECT COUNT(DISTINCT l.id) AS leads
     FROM leads l
     JOIN identities i ON i.client_id = l.client_id AND i.email = l.email
     JOIN LATERAL (
       SELECT utm_source, utm_campaign FROM sessions
       WHERE visitor_id = i.visitor_id AND started_at <= l.created_at AND started_at >= l.created_at - INTERVAL '90 days'
       ORDER BY started_at ASC LIMIT 1
     ) s ON true
     WHERE l.client_id = $1 AND l.created_at >= NOW() - INTERVAL '30 days'
       AND LOWER(REGEXP_REPLACE(s.utm_source, '_ads$', '')) = LOWER(REGEXP_REPLACE($2, '_ads$', ''))
       AND (LOWER(TRIM(s.utm_campaign)) = LOWER(TRIM($3)) OR s.utm_campaign = ${campaignIdSubquery})`,
    [clientId, platform, campaignName]
  )
  const { rows: revRows } = await db.query<{ revenue: string; sales: string }>(
    `SELECT COALESCE(SUM(a.attributed_revenue), 0) AS revenue, COUNT(DISTINCT a.purchase_id) AS sales
     FROM attributions a
     JOIN sessions s ON s.id = a.session_id
     JOIN purchases p ON p.id = a.purchase_id
     WHERE a.client_id = $1 AND p.purchased_at >= NOW() - INTERVAL '30 days'
       AND LOWER(REGEXP_REPLACE(s.utm_source, '_ads$', '')) = LOWER(REGEXP_REPLACE($2, '_ads$', ''))
       AND (LOWER(TRIM(s.utm_campaign)) = LOWER(TRIM($3)) OR s.utm_campaign = ${campaignIdSubquery})`,
    [clientId, platform, campaignName]
  )
  const { rows: creativeRows } = await db.query<{ ad_name: string | null; cost: string; revenue: string }>(
    // Same FULL-JOIN-with-OR fix as gatherLast30DaysData's queries — resolve
    // the name-or-id match inside the rev CTE first.
    `WITH spend AS (
       SELECT ad_name, ad_id, SUM(spend) AS cost FROM ad_costs
       WHERE client_id = $1 AND date >= NOW() - INTERVAL '30 days'
         AND LOWER(REGEXP_REPLACE(platform, '_ads$', '')) = LOWER(REGEXP_REPLACE($2, '_ads$', ''))
         AND LOWER(TRIM(campaign_name)) = LOWER(TRIM($3))
       GROUP BY ad_name, ad_id
     ), rev AS (
       SELECT
         COALESCE(
           (SELECT sp.ad_name FROM spend sp WHERE LOWER(TRIM(sp.ad_name)) = LOWER(TRIM(r.utm_content)) LIMIT 1),
           (SELECT sp.ad_name FROM spend sp WHERE sp.ad_id = r.utm_content LIMIT 1),
           r.utm_content
         ) AS ad_name,
         SUM(r.attributed_revenue) AS revenue
       FROM (
         SELECT s.utm_content, a.attributed_revenue
         FROM attributions a JOIN sessions s ON s.id = a.session_id JOIN purchases p ON p.id = a.purchase_id
         WHERE a.client_id = $1 AND p.purchased_at >= NOW() - INTERVAL '30 days'
           AND LOWER(REGEXP_REPLACE(s.utm_source, '_ads$', '')) = LOWER(REGEXP_REPLACE($2, '_ads$', ''))
           AND (LOWER(TRIM(s.utm_campaign)) = LOWER(TRIM($3)) OR s.utm_campaign = ${campaignIdSubquery})
       ) r
       GROUP BY 1
     )
     SELECT COALESCE(spend.ad_name, rev.ad_name) AS ad_name,
            COALESCE(spend.cost, 0) AS cost, COALESCE(rev.revenue, 0) AS revenue
     FROM spend
     FULL OUTER JOIN rev ON lower(trim(rev.ad_name)) = lower(trim(spend.ad_name))
     ORDER BY COALESCE(spend.cost, 0) DESC
     LIMIT 15`,
    [clientId, platform, campaignName]
  )

  const cost = parseFloat(kpiRows[0].cost)
  const revenue = parseFloat(revRows[0].revenue)
  const campaignImpressions = parseInt(kpiRows[0].impressions, 10)
  const campaignClicks = parseInt(kpiRows[0].clicks, 10)

  return {
    clientName: clientRows[0]?.name,
    platform,
    campaignName,
    industryBenchmark: benchmarkForNiche(clientRows[0]?.niche ?? 'other'),
    last30Days: {
      cost,
      impressions: campaignImpressions,
      clicks: campaignClicks,
      ctrPercent: campaignImpressions > 0 ? (campaignClicks / campaignImpressions) * 100 : null,
      revenue,
      profit: revenue - cost,
      roas: cost > 0 ? revenue / cost : null,
      leads: parseInt(leadRows[0].leads, 10),
      sales: parseInt(revRows[0].sales, 10),
    },
    creatives: creativeRows
      .filter((r) => r.ad_name)
      .map((r) => ({ name: r.ad_name, cost: parseFloat(r.cost), revenue: parseFloat(r.revenue) })),
  }
}

async function gatherCreativeData(
  clientId: string,
  platform: string,
  campaignName: string,
  creativeName: string
): Promise<Record<string, unknown>> {
  const { rows: clientRows } = await db.query<{ name: string; niche: string }>('SELECT name, niche FROM clients WHERE id = $1', [
    clientId,
  ])

  const { rows: kpiRows } = await db.query<{ cost: string; impressions: string; clicks: string }>(
    `SELECT COALESCE(SUM(spend), 0) AS cost, COALESCE(SUM(impressions), 0) AS impressions, COALESCE(SUM(clicks), 0) AS clicks
     FROM ad_costs
     WHERE client_id = $1 AND date >= NOW() - INTERVAL '30 days'
       AND LOWER(REGEXP_REPLACE(platform, '_ads$', '')) = LOWER(REGEXP_REPLACE($2, '_ads$', ''))
       AND LOWER(TRIM(campaign_name)) = LOWER(TRIM($3))
       AND LOWER(TRIM(ad_name)) = LOWER(TRIM($4))`,
    [clientId, platform, campaignName, creativeName]
  )
  // Same fallback reasoning as gatherCampaignData above, extended to also
  // resolve the ad's own id for utm_content matching.
  const campaignIdSubquery = `(
    SELECT campaign_id FROM ad_costs
    WHERE client_id = $1
      AND LOWER(REGEXP_REPLACE(platform, '_ads$', '')) = LOWER(REGEXP_REPLACE($2, '_ads$', ''))
      AND LOWER(TRIM(campaign_name)) = LOWER(TRIM($3))
      AND campaign_id IS NOT NULL
    LIMIT 1
  )`
  const adIdSubquery = `(
    SELECT ad_id FROM ad_costs
    WHERE client_id = $1
      AND LOWER(REGEXP_REPLACE(platform, '_ads$', '')) = LOWER(REGEXP_REPLACE($2, '_ads$', ''))
      AND LOWER(TRIM(campaign_name)) = LOWER(TRIM($3))
      AND LOWER(TRIM(ad_name)) = LOWER(TRIM($4))
      AND ad_id IS NOT NULL
    LIMIT 1
  )`
  const { rows: leadRows } = await db.query<{ leads: string }>(
    `SELECT COUNT(DISTINCT l.id) AS leads
     FROM leads l
     JOIN identities i ON i.client_id = l.client_id AND i.email = l.email
     JOIN LATERAL (
       SELECT utm_content, utm_source, utm_campaign FROM sessions
       WHERE visitor_id = i.visitor_id AND started_at <= l.created_at AND started_at >= l.created_at - INTERVAL '90 days'
       ORDER BY started_at ASC LIMIT 1
     ) s ON true
     WHERE l.client_id = $1 AND l.created_at >= NOW() - INTERVAL '30 days'
       AND LOWER(REGEXP_REPLACE(s.utm_source, '_ads$', '')) = LOWER(REGEXP_REPLACE($2, '_ads$', ''))
       AND (LOWER(TRIM(s.utm_campaign)) = LOWER(TRIM($3)) OR s.utm_campaign = ${campaignIdSubquery})
       AND (LOWER(TRIM(s.utm_content)) = LOWER(TRIM($4)) OR s.utm_content = ${adIdSubquery})`,
    [clientId, platform, campaignName, creativeName]
  )
  const { rows: revRows } = await db.query<{ revenue: string; sales: string }>(
    `SELECT COALESCE(SUM(a.attributed_revenue), 0) AS revenue, COUNT(DISTINCT a.purchase_id) AS sales
     FROM attributions a
     JOIN sessions s ON s.id = a.session_id
     JOIN purchases p ON p.id = a.purchase_id
     WHERE a.client_id = $1 AND p.purchased_at >= NOW() - INTERVAL '30 days'
       AND LOWER(REGEXP_REPLACE(s.utm_source, '_ads$', '')) = LOWER(REGEXP_REPLACE($2, '_ads$', ''))
       AND (LOWER(TRIM(s.utm_campaign)) = LOWER(TRIM($3)) OR s.utm_campaign = ${campaignIdSubquery})
       AND (LOWER(TRIM(s.utm_content)) = LOWER(TRIM($4)) OR s.utm_content = ${adIdSubquery})`,
    [clientId, platform, campaignName, creativeName]
  )

  const cost = parseFloat(kpiRows[0].cost)
  const revenue = parseFloat(revRows[0].revenue)
  const creativeImpressions = parseInt(kpiRows[0].impressions, 10)
  const creativeClicks = parseInt(kpiRows[0].clicks, 10)

  return {
    clientName: clientRows[0]?.name,
    platform,
    campaignName,
    creativeName,
    industryBenchmark: benchmarkForNiche(clientRows[0]?.niche ?? 'other'),
    last30Days: {
      cost,
      impressions: creativeImpressions,
      clicks: creativeClicks,
      ctrPercent: creativeImpressions > 0 ? (creativeClicks / creativeImpressions) * 100 : null,
      revenue,
      profit: revenue - cost,
      roas: cost > 0 ? revenue / cost : null,
      leads: parseInt(leadRows[0].leads, 10),
      sales: parseInt(revRows[0].sales, 10),
    },
  }
}

function promptForScope(scope: InsightScope): string {
  const subject =
    scope.type === 'campaign'
      ? 'one specific ad campaign'
      : scope.type === 'creative'
        ? 'one specific ad creative'
        : scope.type === 'platform'
          ? 'one specific ad platform (do not compare it to other platforms not shown here)'
          : "a client's whole account"
  // Phase 1 guardrails (2026-07-27): at client/platform scope, topCampaignsBySpend
  // and topCreativesBySpend rows each carry dataSufficient/confidence/daysLive,
  // computed server-side by the Phase 1 gate (recommendationGate.ts) — never
  // trust the model to decide data-sufficiency itself. This instruction is a
  // first line of defense, not the only one: generateInsights below
  // post-validates the response and strips/corrects anything that doesn't
  // comply, rather than trusting the model followed it.
  return `You are an ad-attribution analyst reviewing ${subject}'s last 30 days of data. Based ONLY on the JSON data given below (never invent numbers not present here), produce 3-6 specific, actionable recommendations. Each should name a real number from the data, not generic advice.

Some rows in the data below carry a "dataSufficient" flag. If dataSufficient is false for a campaign or creative, DO NOT produce a recommendation about it individually — it hasn't been live long enough or spent enough to earn a verdict yet. You may still comment on whole-account or whole-platform totals regardless. For every recommendation you DO produce about a specific campaign or creative, copy that row's own "confidence" and "daysLive" values into your output exactly as given — do not invent or recompute them.

The data includes an "industryBenchmark" object for this client's own niche (typicalCostPerConversion, conversionLabel, ctrPercent range, and a roas range when relevant to this niche). Judge whether a number is actually good or bad against THIS benchmark, not a universal standard — e.g. a 1.8x ROAS is a real problem for a niche whose healthy range is 2.5-4x, but may be perfectly normal for one whose healthy range is 1.5-2.5x. A metric merely being "average" for the industry isn't automatically a problem worth flagging; a metric outside the healthy range is worth flagging even if it doesn't look dramatic in isolation. Cite the specific benchmark number you're comparing against when you use it.

DATA:
{{DATA}}

Respond with ONLY a JSON array, no other text, in this exact shape:
[{"title": "short headline", "detail": "1-2 sentence explanation citing the specific number, with the single most important number or phrase wrapped in **double asterisks**", "priority": "high" | "medium" | "low", "confidence": "high" | "medium" | "low" | null, "daysLive": number | null}]

Set "confidence" and "daysLive" to null only for a whole-account/whole-platform recommendation that isn't about one specific campaign or creative.`
}

interface AnnotatedRow {
  name: string
  dataSufficient: boolean
  confidence: GateAnnotation['confidence']
  daysLive: number
}

// Review fix (2026-07-27, item 7): "the prompt is instructed" was a soft
// constraint — with 15-20 annotated rows in a whole-account/platform prompt it
// holds most of the time and silently fails some of the time. This makes the
// constraint real: any insight whose title/detail mentions an insufficient
// row by name is dropped outright (never shown, not just flagged), and any
// insight that DOES cite a sufficient row's confidence/daysLive gets those
// values overwritten from the source row rather than trusted as transcribed —
// models transpose digits. Deliberately strips rather than re-calling Claude
// to regenerate: a dropped recommendation is just one fewer shown, whereas a
// regenerate-on-failure loop adds cost/latency and a real (if small) chance of
// looping on a model that keeps making the same mistake.
function enforceRowCompliance(insights: Insight[], rows: AnnotatedRow[]): Insight[] {
  const insufficientNames = rows.filter((r) => !r.dataSufficient).map((r) => r.name.toLowerCase())
  const sufficientByName = new Map(rows.filter((r) => r.dataSufficient).map((r) => [r.name.toLowerCase(), r]))

  const kept: Insight[] = []
  for (const insight of insights) {
    const haystack = `${insight.title} ${insight.detail}`.toLowerCase()
    if (insufficientNames.some((name) => name.length > 2 && haystack.includes(name))) continue

    const mentionedRow = [...sufficientByName.entries()].find(([name]) => name.length > 2 && haystack.includes(name))?.[1]
    if (mentionedRow) {
      kept.push({ ...insight, confidence: mentionedRow.confidence, daysLive: mentionedRow.daysLive })
    } else {
      kept.push(insight)
    }
  }
  return kept
}

function collectAnnotatedRows(data: Record<string, unknown>): AnnotatedRow[] {
  const rows: AnnotatedRow[] = []
  for (const key of ['topCampaignsBySpend', 'topCreativesBySpend']) {
    const list = data[key]
    if (Array.isArray(list)) {
      for (const r of list) {
        if (r && typeof r.name === 'string' && typeof r.dataSufficient === 'boolean') {
          rows.push({ name: r.name, dataSufficient: r.dataSufficient, confidence: r.confidence ?? null, daysLive: r.daysLive ?? 0 })
        }
      }
    }
  }
  return rows
}

export async function generateInsights(clientId: string, scope: InsightScope = { type: 'client' }): Promise<Insight[]> {
  const data =
    scope.type === 'campaign'
      ? await gatherCampaignData(clientId, scope.platform, scope.campaignName)
      : scope.type === 'creative'
        ? await gatherCreativeData(clientId, scope.platform, scope.campaignName, scope.creativeName)
        : scope.type === 'platform'
          ? await gatherPlatformData(clientId, scope.platform)
          : await gatherLast30DaysData(clientId)

  // Every recommendation-generating call this file makes is gated exactly
  // once, in exactly one place: here. Campaign/creative scope gates the single
  // entity before Claude is ever called (skipping the call entirely on
  // failure — no wasted API spend on an entity that hasn't earned a verdict).
  // Client/platform scope can't gate "the whole account" the same way (there's
  // no days-live for an account), so those two scopes instead annotate each
  // individual campaign/creative row with its own gate verdict and
  // post-validate the model's compliance below (enforceRowCompliance).
  let singleEntityGateDaysLive: number | null = null
  let singleEntityGateConfidence: GateAnnotation['confidence'] = null
  if (scope.type === 'campaign' || scope.type === 'creative') {
    const entityType: EntityType = scope.type === 'creative' ? 'creative' : 'campaign'
    const daysLive =
      scope.type === 'creative'
        ? await getDaysLive(clientId, scope.platform, scope.campaignName, scope.creativeName)
        : await getDaysLive(clientId, scope.platform, scope.campaignName)
    const last30Days = data.last30Days as { cost: number; sales: number }
    const gate = await checkGate(clientId, entityType, daysLive, last30Days.cost, last30Days.sales)
    if (!gate.passed) {
      return [
        {
          title: 'Insufficient data',
          detail: gate.reason,
          priority: 'low',
          confidence: null,
          daysLive: gate.daysLive,
          insufficientData: true,
        },
      ]
    }
    singleEntityGateDaysLive = gate.daysLive
    singleEntityGateConfidence = gate.confidence
  }

  const prompt = promptForScope(scope).replace('{{DATA}}', JSON.stringify(data, null, 2))

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1200,
    messages: [{ role: 'user', content: prompt }],
  })

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim()

  const jsonMatch = text.match(/\[[\s\S]*\]/)
  if (!jsonMatch) throw new Error(`Unexpected model output shape: ${text.slice(0, 200)}`)

  const parsed = JSON.parse(jsonMatch[0]) as Insight[]

  // Single-entity scope: there's exactly one gate verdict for the whole call
  // (computed above, before Claude ever ran), so every insight gets it
  // force-set rather than trusting whatever the model echoed back — closes
  // the same "don't trust the model's transcription" gap enforceRowCompliance
  // closes for the whole-account/platform case below.
  if (scope.type === 'campaign' || scope.type === 'creative') {
    return parsed.map((insight) => ({ ...insight, confidence: singleEntityGateConfidence, daysLive: singleEntityGateDaysLive ?? undefined }))
  }

  const annotatedRows = collectAnnotatedRows(data)
  return enforceRowCompliance(parsed, annotatedRows)
}
