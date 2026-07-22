import { db } from '../../db'

interface KlaviyoConfig {
  api_key: string
  list_id: string
}

const KLAVIYO_REVISION = '2025-07-15'

function headers(apiKey: string) {
  return {
    Authorization: `Klaviyo-API-Key ${apiKey}`,
    revision: KLAVIYO_REVISION,
    'content-type': 'application/json',
  }
}

interface KlaviyoCampaign {
  id: string
  attributes: { name?: string; channel?: string; send_time?: string }
}

async function fetchCampaigns(apiKey: string, channel: 'email' | 'sms'): Promise<KlaviyoCampaign[]> {
  const url = `https://a.klaviyo.com/api/campaigns/?filter=${encodeURIComponent(`equals(messages.channel,'${channel}')`)}&page[size]=50`
  const res = await fetch(url, { headers: headers(apiKey) })
  if (!res.ok) throw new Error(`Klaviyo campaigns request failed (${res.status}): ${(await res.text()).slice(0, 300)}`)
  const body = (await res.json()) as { data: KlaviyoCampaign[] }
  return body.data
}

async function fetchPlacedOrderMetricId(apiKey: string): Promise<string | null> {
  const res = await fetch(`https://a.klaviyo.com/api/metrics/?filter=${encodeURIComponent(`equals(name,"Placed Order")`)}`, {
    headers: headers(apiKey),
  })
  if (!res.ok) return null
  const body = (await res.json()) as { data: { id: string }[] }
  return body.data[0]?.id ?? null
}

interface CampaignValuesResult {
  campaign_id: string
  recipients: number
  opens: number
  clicks: number
  revenue: number
  orders: number
}

// Klaviyo's Campaign Values Report API (introduced 2024) — one request per
// channel, grouped by campaign, over the trailing window. Requires the account's
// "Placed Order" metric id (looked up once per sync, not cached across runs —
// this job runs at most a few times a day, the extra lookup call is cheap).
async function fetchCampaignValues(
  apiKey: string,
  conversionMetricId: string,
  since: string,
  until: string
): Promise<CampaignValuesResult[]> {
  const res = await fetch('https://a.klaviyo.com/api/campaign-values-reports/', {
    method: 'POST',
    headers: headers(apiKey),
    body: JSON.stringify({
      data: {
        type: 'campaign-values-report',
        attributes: {
          timeframe: { start: `${since}T00:00:00Z`, end: `${until}T23:59:59Z` },
          conversion_metric_id: conversionMetricId,
          statistics: ['recipients', 'opens', 'clicks', 'conversion_value', 'conversions'],
          groupings: ['campaign_id'],
        },
      },
    }),
  })
  if (!res.ok) throw new Error(`Klaviyo campaign-values-report failed (${res.status}): ${(await res.text()).slice(0, 300)}`)
  const body = (await res.json()) as {
    data: { attributes: { results: { groupings: { campaign_id: string }; statistics: Record<string, number> }[] } }
  }
  return body.data.attributes.results.map((r) => ({
    campaign_id: r.groupings.campaign_id,
    recipients: r.statistics.recipients ?? 0,
    opens: r.statistics.opens ?? 0,
    clicks: r.statistics.clicks ?? 0,
    revenue: r.statistics.conversion_value ?? 0,
    orders: r.statistics.conversions ?? 0,
  }))
}

async function syncChannel(
  clientId: string,
  apiKey: string,
  conversionMetricId: string,
  channel: 'email' | 'sms',
  since: string,
  until: string
): Promise<number> {
  const [campaigns, values] = await Promise.all([
    fetchCampaigns(apiKey, channel),
    fetchCampaignValues(apiKey, conversionMetricId, since, until),
  ])
  const nameById = new Map(campaigns.map((c) => [c.id, c.attributes.name ?? null]))

  let count = 0
  for (const v of values) {
    // Klaviyo's report doesn't split by day within the window itself the way ad
    // platform insights do — it returns one aggregate per campaign per request, so
    // this stores it on the report's end date rather than pretending to have a
    // real day-by-day breakdown for a single-send campaign.
    await db.query(
      `INSERT INTO email_campaign_stats (client_id, campaign_id, campaign_name, channel, date, recipients, opens, clicks, revenue, orders)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (client_id, campaign_id, date)
       DO UPDATE SET campaign_name = EXCLUDED.campaign_name, recipients = EXCLUDED.recipients, opens = EXCLUDED.opens,
                     clicks = EXCLUDED.clicks, revenue = EXCLUDED.revenue, orders = EXCLUDED.orders, synced_at = NOW()`,
      [clientId, v.campaign_id, nameById.get(v.campaign_id) ?? null, channel, until, v.recipients, v.opens, v.clicks, v.revenue, v.orders]
    )
    count++
  }
  return count
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export async function runKlaviyoSync(): Promise<number> {
  const { rows: integrations } = await db.query<{ client_id: string; config: KlaviyoConfig }>(
    `SELECT client_id, config FROM client_integrations WHERE platform = 'klaviyo'`
  )

  const until = new Date()
  const since = new Date(until)
  since.setUTCDate(since.getUTCDate() - 29) // trailing 30 days, re-pulled each run same as ad-cost sync

  let synced = 0
  for (const integration of integrations) {
    try {
      const metricId = await fetchPlacedOrderMetricId(integration.config.api_key)
      if (!metricId) {
        console.warn(`[klaviyo-sync] client=${integration.client_id}: no "Placed Order" metric found, skipping`)
        continue
      }
      const emailCount = await syncChannel(integration.client_id, integration.config.api_key, metricId, 'email', isoDate(since), isoDate(until))
      const smsCount = await syncChannel(integration.client_id, integration.config.api_key, metricId, 'sms', isoDate(since), isoDate(until))
      console.log(`[klaviyo-sync] client=${integration.client_id}: ${emailCount} email + ${smsCount} sms campaign row(s)`)
      synced++
    } catch (err) {
      console.error(`[klaviyo-sync] client=${integration.client_id} failed:`, (err as Error).message)
    }
  }
  return synced
}
