import { db } from '../../db'
import { fetchFacebookAdCosts } from './facebook'
import { fetchGoogleAdCosts } from './google'
import { fetchBingAdCosts } from './bing'
import { fetchTikTokAdCosts } from './tiktok'
import { fetchSnapchatAdCosts } from './snapchat'
import { fetchPinterestAdCosts } from './pinterest'
import { fetchLinkedInAdCosts } from './linkedin'
import { fetchRedditAdCosts } from './reddit'
import { upsertAdCosts } from './upsert'

export type AdPlatform =
  | 'facebook_ads'
  | 'google_ads'
  | 'bing_ads'
  | 'tiktok_ads'
  | 'snapchat_ads'
  | 'pinterest_ads'
  | 'linkedin_ads'
  | 'reddit_ads'

interface ClientIntegration {
  client_id: string
  platform: AdPlatform
  config: Record<string, string>
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

// One integration's fetch-and-upsert, factored out so both the routine trailing-
// window sync (the loop below) and a one-off wider backfill (Step 34, triggered
// right when a client's integration is first saved) share identical dispatch
// logic instead of drifting apart.
export async function syncOneIntegration(integration: ClientIntegration, sinceStr: string, untilStr: string): Promise<number> {
  let rows
  if (integration.platform === 'facebook_ads') {
    rows = await fetchFacebookAdCosts(integration.config.access_token, integration.config.ad_account_id, sinceStr, untilStr)
  } else if (integration.platform === 'google_ads') {
    rows = await fetchGoogleAdCosts(
      {
        customer_id: integration.config.customer_id,
        login_customer_id: integration.config.login_customer_id,
        refresh_token: integration.config.refresh_token,
      },
      sinceStr,
      untilStr
    )
  } else if (integration.platform === 'bing_ads') {
    rows = await fetchBingAdCosts(
      {
        customer_id: integration.config.customer_id,
        account_id: integration.config.account_id,
        refresh_token: integration.config.refresh_token,
      },
      sinceStr,
      untilStr
    )
  } else if (integration.platform === 'tiktok_ads') {
    rows = await fetchTikTokAdCosts(integration.config.access_token, integration.config.advertiser_id, sinceStr, untilStr)
  } else if (integration.platform === 'snapchat_ads') {
    rows = await fetchSnapchatAdCosts(integration.config.access_token, integration.config.ad_account_id, sinceStr, untilStr)
  } else if (integration.platform === 'pinterest_ads') {
    rows = await fetchPinterestAdCosts(integration.config.access_token, integration.config.ad_account_id, sinceStr, untilStr)
  } else if (integration.platform === 'linkedin_ads') {
    rows = await fetchLinkedInAdCosts(integration.config.access_token, integration.config.account_id, sinceStr, untilStr)
  } else {
    rows = await fetchRedditAdCosts(integration.config.access_token, integration.config.account_id, sinceStr, untilStr)
  }

  await upsertAdCosts(integration.client_id, integration.platform, rows)
  return rows.length
}

// Ad platforms finalize spend numbers a couple days late, so every run re-pulls
// a small trailing window instead of just "yesterday" to pick up corrections.
export async function runAdCostSync(daysBack = 3): Promise<void> {
  const until = new Date()
  until.setUTCDate(until.getUTCDate() - 1) // yesterday — today's numbers are still live
  const since = new Date(until)
  since.setUTCDate(since.getUTCDate() - (daysBack - 1))

  const sinceStr = isoDate(since)
  const untilStr = isoDate(until)

  const { rows: integrations } = await db.query<ClientIntegration>(
    `SELECT client_id, platform, config
     FROM client_integrations
     WHERE platform IN (
       'facebook_ads', 'google_ads', 'bing_ads', 'tiktok_ads', 'snapchat_ads', 'pinterest_ads',
       'linkedin_ads', 'reddit_ads'
     )`
  )

  console.log(`Syncing ad costs for ${integrations.length} integration(s), ${sinceStr} → ${untilStr}`)

  for (const integration of integrations) {
    try {
      const count = await syncOneIntegration(integration, sinceStr, untilStr)
      console.log(`  ✓ ${integration.platform} client=${integration.client_id}: ${count} row(s)`)
    } catch (err) {
      console.error(`  ✗ ${integration.platform} client=${integration.client_id} failed:`, (err as Error).message)
    }
  }
}

// One-time historical pull for a single client+platform, run right when that
// integration is first connected (see clients.ts) instead of only ever building
// up history one 3-day sync at a time — otherwise a new client's dashboard looks
// empty for weeks. 180 days, not a full year+, to keep the very first request to a
// freshly-connected ad account modest; the routine 6-hourly sync keeps it current
// from here. Fire-and-forget from the caller's perspective — logged, never thrown,
// so a slow/failing backfill can't block the integration-save request itself.
export async function backfillIntegration(clientId: string, platform: AdPlatform, config: Record<string, string>): Promise<void> {
  const until = new Date()
  until.setUTCDate(until.getUTCDate() - 1)
  const since = new Date(until)
  since.setUTCDate(since.getUTCDate() - 179)

  try {
    const count = await syncOneIntegration({ client_id: clientId, platform, config }, isoDate(since), isoDate(until))
    console.log(`[backfill] ${platform} client=${clientId}: ${count} row(s) over 180 days`)
  } catch (err) {
    console.error(`[backfill] ${platform} client=${clientId} failed:`, (err as Error).message)
  }
}

if (require.main === module) {
  runAdCostSync()
    .then(() => db.end())
    .catch((err) => {
      console.error('Ad cost sync failed:', err)
      process.exit(1)
    })
}
