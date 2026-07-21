import { db } from '../../db'
import { fetchFacebookAdCosts } from './facebook'
import { fetchGoogleAdCosts } from './google'
import { fetchBingAdCosts } from './bing'
import { upsertAdCosts } from './upsert'

interface ClientIntegration {
  client_id: string
  platform: 'facebook_ads' | 'google_ads' | 'bing_ads'
  config: Record<string, string>
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
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
     WHERE platform IN ('facebook_ads', 'google_ads', 'bing_ads')`
  )

  console.log(`Syncing ad costs for ${integrations.length} integration(s), ${sinceStr} → ${untilStr}`)

  for (const integration of integrations) {
    try {
      let rows
      if (integration.platform === 'facebook_ads') {
        rows = await fetchFacebookAdCosts(
          integration.config.access_token,
          integration.config.ad_account_id,
          sinceStr,
          untilStr
        )
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
      } else {
        rows = await fetchBingAdCosts(
          {
            customer_id: integration.config.customer_id,
            account_id: integration.config.account_id,
            refresh_token: integration.config.refresh_token,
          },
          sinceStr,
          untilStr
        )
      }

      await upsertAdCosts(integration.client_id, integration.platform, rows)
      console.log(`  ✓ ${integration.platform} client=${integration.client_id}: ${rows.length} row(s)`)
    } catch (err) {
      console.error(`  ✗ ${integration.platform} client=${integration.client_id} failed:`, (err as Error).message)
    }
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
