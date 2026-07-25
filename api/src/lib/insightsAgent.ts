import Anthropic from '@anthropic-ai/sdk'
import { db } from '../db'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const MODEL = 'claude-opus-4-8'

export interface Insight {
  title: string
  detail: string
  priority: 'high' | 'medium' | 'low'
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
  }>(
    `SELECT
       COALESCE((SELECT SUM(spend) FROM ad_costs WHERE client_id = $1 AND date >= NOW() - INTERVAL '30 days'), 0) AS cost,
       COALESCE((SELECT SUM(a.attributed_revenue) FROM attributions a JOIN purchases p ON p.id = a.purchase_id
                 WHERE a.client_id = $1 AND p.purchased_at >= NOW() - INTERVAL '30 days'), 0) AS revenue,
       COALESCE((SELECT COUNT(*) FROM leads WHERE client_id = $1 AND created_at >= NOW() - INTERVAL '30 days'), 0) AS leads,
       COALESCE((SELECT COUNT(*) FROM purchases WHERE client_id = $1 AND purchased_at >= NOW() - INTERVAL '30 days' AND NOT refunded), 0) AS sales`,
    [clientId]
  )
  const overview = overviewRows[0]

  const { rows: campaignRows } = await db.query<{
    campaign_name: string | null
    cost: string
    revenue: string
    sales: string
  }>(
    `SELECT COALESCE(spend.campaign_name, rev.utm_campaign) AS campaign_name,
            COALESCE(spend.cost, 0) AS cost, COALESCE(rev.revenue, 0) AS revenue, COALESCE(rev.sales, 0) AS sales
     FROM (
       SELECT campaign_name, SUM(spend) AS cost FROM ad_costs
       WHERE client_id = $1 AND date >= NOW() - INTERVAL '30 days' GROUP BY campaign_name
     ) spend
     FULL OUTER JOIN (
       SELECT s.utm_campaign, SUM(a.attributed_revenue) AS revenue, COUNT(DISTINCT a.purchase_id) AS sales
       FROM attributions a JOIN sessions s ON s.id = a.session_id JOIN purchases p ON p.id = a.purchase_id
       WHERE a.client_id = $1 AND p.purchased_at >= NOW() - INTERVAL '30 days'
       GROUP BY s.utm_campaign
     ) rev ON lower(trim(rev.utm_campaign)) = lower(trim(spend.campaign_name))
     ORDER BY COALESCE(spend.cost, 0) DESC
     LIMIT 10`,
    [clientId]
  )

  const { rows: creativeRows } = await db.query<{
    ad_name: string | null
    cost: string
    revenue: string
  }>(
    `SELECT COALESCE(spend.ad_name, rev.utm_content) AS ad_name,
            COALESCE(spend.cost, 0) AS cost, COALESCE(rev.revenue, 0) AS revenue
     FROM (
       SELECT ad_name, SUM(spend) AS cost FROM ad_costs
       WHERE client_id = $1 AND date >= NOW() - INTERVAL '30 days' GROUP BY ad_name
     ) spend
     FULL OUTER JOIN (
       SELECT s.utm_content, SUM(a.attributed_revenue) AS revenue
       FROM attributions a JOIN sessions s ON s.id = a.session_id JOIN purchases p ON p.id = a.purchase_id
       WHERE a.client_id = $1 AND p.purchased_at >= NOW() - INTERVAL '30 days'
       GROUP BY s.utm_content
     ) rev ON lower(trim(rev.utm_content)) = lower(trim(spend.ad_name))
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

  const result: Record<string, unknown> = {
    clientName: clientInfo?.name,
    niche: clientInfo?.niche,
    last30Days: {
      cost: parseFloat(overview.cost),
      revenue: parseFloat(overview.revenue),
      profit: parseFloat(overview.revenue) - parseFloat(overview.cost),
      roas: parseFloat(overview.cost) > 0 ? parseFloat(overview.revenue) / parseFloat(overview.cost) : null,
      leads: parseInt(overview.leads, 10),
      sales: parseInt(overview.sales, 10),
    },
    topCampaignsBySpend: campaignRows.map((r) => ({
      name: r.campaign_name ?? '(untagged)',
      cost: parseFloat(r.cost),
      revenue: parseFloat(r.revenue),
      sales: parseInt(r.sales, 10),
    })),
    topCreativesBySpend: creativeRows
      .filter((r) => r.ad_name)
      .map((r) => ({ name: r.ad_name, cost: parseFloat(r.cost), revenue: parseFloat(r.revenue) })),
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
  const { rows: clientRows } = await db.query<{ name: string }>('SELECT name FROM clients WHERE id = $1', [clientId])

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
  const { rows: campaignRows } = await db.query<{ campaign_name: string | null; cost: string; revenue: string; sales: string }>(
    `SELECT COALESCE(spend.campaign_name, rev.utm_campaign) AS campaign_name,
            COALESCE(spend.cost, 0) AS cost, COALESCE(rev.revenue, 0) AS revenue, COALESCE(rev.sales, 0) AS sales
     FROM (
       SELECT campaign_name, SUM(spend) AS cost FROM ad_costs
       WHERE client_id = $1 AND date >= NOW() - INTERVAL '30 days'
         AND LOWER(REGEXP_REPLACE(platform, '_ads$', '')) = LOWER(REGEXP_REPLACE($2, '_ads$', ''))
       GROUP BY campaign_name
     ) spend
     FULL OUTER JOIN (
       SELECT s.utm_campaign, SUM(a.attributed_revenue) AS revenue, COUNT(DISTINCT a.purchase_id) AS sales
       FROM attributions a JOIN sessions s ON s.id = a.session_id JOIN purchases p ON p.id = a.purchase_id
       WHERE a.client_id = $1 AND p.purchased_at >= NOW() - INTERVAL '30 days'
         AND LOWER(REGEXP_REPLACE(s.utm_source, '_ads$', '')) = LOWER(REGEXP_REPLACE($2, '_ads$', ''))
       GROUP BY s.utm_campaign
     ) rev ON lower(trim(rev.utm_campaign)) = lower(trim(spend.campaign_name))
     ORDER BY COALESCE(spend.cost, 0) DESC
     LIMIT 10`,
    [clientId, platform]
  )

  const cost = parseFloat(kpiRows[0].cost)
  const revenue = parseFloat(revRows[0].revenue)

  return {
    clientName: clientRows[0]?.name,
    platform,
    last30Days: {
      cost,
      impressions: parseInt(kpiRows[0].impressions, 10),
      clicks: parseInt(kpiRows[0].clicks, 10),
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
  const { rows: clientRows } = await db.query<{ name: string }>('SELECT name FROM clients WHERE id = $1', [clientId])

  const { rows: kpiRows } = await db.query<{ cost: string; impressions: string; clicks: string }>(
    `SELECT COALESCE(SUM(spend), 0) AS cost, COALESCE(SUM(impressions), 0) AS impressions, COALESCE(SUM(clicks), 0) AS clicks
     FROM ad_costs
     WHERE client_id = $1 AND date >= NOW() - INTERVAL '30 days'
       AND LOWER(REGEXP_REPLACE(platform, '_ads$', '')) = LOWER(REGEXP_REPLACE($2, '_ads$', ''))
       AND LOWER(TRIM(campaign_name)) = LOWER(TRIM($3))`,
    [clientId, platform, campaignName]
  )
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
       AND LOWER(TRIM(s.utm_campaign)) = LOWER(TRIM($3))`,
    [clientId, platform, campaignName]
  )
  const { rows: revRows } = await db.query<{ revenue: string; sales: string }>(
    `SELECT COALESCE(SUM(a.attributed_revenue), 0) AS revenue, COUNT(DISTINCT a.purchase_id) AS sales
     FROM attributions a
     JOIN sessions s ON s.id = a.session_id
     JOIN purchases p ON p.id = a.purchase_id
     WHERE a.client_id = $1 AND p.purchased_at >= NOW() - INTERVAL '30 days'
       AND LOWER(REGEXP_REPLACE(s.utm_source, '_ads$', '')) = LOWER(REGEXP_REPLACE($2, '_ads$', ''))
       AND LOWER(TRIM(s.utm_campaign)) = LOWER(TRIM($3))`,
    [clientId, platform, campaignName]
  )
  const { rows: creativeRows } = await db.query<{ ad_name: string | null; cost: string; revenue: string }>(
    `SELECT COALESCE(spend.ad_name, rev.utm_content) AS ad_name,
            COALESCE(spend.cost, 0) AS cost, COALESCE(rev.revenue, 0) AS revenue
     FROM (
       SELECT ad_name, SUM(spend) AS cost FROM ad_costs
       WHERE client_id = $1 AND date >= NOW() - INTERVAL '30 days'
         AND LOWER(REGEXP_REPLACE(platform, '_ads$', '')) = LOWER(REGEXP_REPLACE($2, '_ads$', ''))
         AND LOWER(TRIM(campaign_name)) = LOWER(TRIM($3))
       GROUP BY ad_name
     ) spend
     FULL OUTER JOIN (
       SELECT s.utm_content, SUM(a.attributed_revenue) AS revenue
       FROM attributions a JOIN sessions s ON s.id = a.session_id JOIN purchases p ON p.id = a.purchase_id
       WHERE a.client_id = $1 AND p.purchased_at >= NOW() - INTERVAL '30 days'
         AND LOWER(REGEXP_REPLACE(s.utm_source, '_ads$', '')) = LOWER(REGEXP_REPLACE($2, '_ads$', ''))
         AND LOWER(TRIM(s.utm_campaign)) = LOWER(TRIM($3))
       GROUP BY s.utm_content
     ) rev ON lower(trim(rev.utm_content)) = lower(trim(spend.ad_name))
     ORDER BY COALESCE(spend.cost, 0) DESC
     LIMIT 15`,
    [clientId, platform, campaignName]
  )

  const cost = parseFloat(kpiRows[0].cost)
  const revenue = parseFloat(revRows[0].revenue)

  return {
    clientName: clientRows[0]?.name,
    platform,
    campaignName,
    last30Days: {
      cost,
      impressions: parseInt(kpiRows[0].impressions, 10),
      clicks: parseInt(kpiRows[0].clicks, 10),
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
  const { rows: clientRows } = await db.query<{ name: string }>('SELECT name FROM clients WHERE id = $1', [clientId])

  const { rows: kpiRows } = await db.query<{ cost: string; impressions: string; clicks: string }>(
    `SELECT COALESCE(SUM(spend), 0) AS cost, COALESCE(SUM(impressions), 0) AS impressions, COALESCE(SUM(clicks), 0) AS clicks
     FROM ad_costs
     WHERE client_id = $1 AND date >= NOW() - INTERVAL '30 days'
       AND LOWER(REGEXP_REPLACE(platform, '_ads$', '')) = LOWER(REGEXP_REPLACE($2, '_ads$', ''))
       AND LOWER(TRIM(campaign_name)) = LOWER(TRIM($3))
       AND LOWER(TRIM(ad_name)) = LOWER(TRIM($4))`,
    [clientId, platform, campaignName, creativeName]
  )
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
       AND LOWER(TRIM(s.utm_campaign)) = LOWER(TRIM($3))
       AND LOWER(TRIM(s.utm_content)) = LOWER(TRIM($4))`,
    [clientId, platform, campaignName, creativeName]
  )
  const { rows: revRows } = await db.query<{ revenue: string; sales: string }>(
    `SELECT COALESCE(SUM(a.attributed_revenue), 0) AS revenue, COUNT(DISTINCT a.purchase_id) AS sales
     FROM attributions a
     JOIN sessions s ON s.id = a.session_id
     JOIN purchases p ON p.id = a.purchase_id
     WHERE a.client_id = $1 AND p.purchased_at >= NOW() - INTERVAL '30 days'
       AND LOWER(REGEXP_REPLACE(s.utm_source, '_ads$', '')) = LOWER(REGEXP_REPLACE($2, '_ads$', ''))
       AND LOWER(TRIM(s.utm_campaign)) = LOWER(TRIM($3))
       AND LOWER(TRIM(s.utm_content)) = LOWER(TRIM($4))`,
    [clientId, platform, campaignName, creativeName]
  )

  const cost = parseFloat(kpiRows[0].cost)
  const revenue = parseFloat(revRows[0].revenue)

  return {
    clientName: clientRows[0]?.name,
    platform,
    campaignName,
    creativeName,
    last30Days: {
      cost,
      impressions: parseInt(kpiRows[0].impressions, 10),
      clicks: parseInt(kpiRows[0].clicks, 10),
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
  return `You are an ad-attribution analyst reviewing ${subject}'s last 30 days of data. Based ONLY on the JSON data given below (never invent numbers not present here), produce 3-6 specific, actionable recommendations. Each should name a real number from the data, not generic advice.

DATA:
{{DATA}}

Respond with ONLY a JSON array, no other text, in this exact shape:
[{"title": "short headline", "detail": "1-2 sentence explanation citing the specific number, with the single most important number or phrase wrapped in **double asterisks**", "priority": "high" | "medium" | "low"}]`
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
  return parsed
}
