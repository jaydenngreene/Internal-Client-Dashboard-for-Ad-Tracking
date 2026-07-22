import cron from 'node-cron'
import { db } from '../db'
import { runAdCostSync } from '../jobs/adCosts/run'
import { refreshCustomerLtv } from '../jobs/ltv/run'
import { runAudienceSyncs } from '../jobs/audienceSync/run'
import { detectAnomalies } from '../jobs/anomalyDetection/run'
import { transcribeAndScoreCalls } from '../jobs/callTranscription/run'
import { retryFailedWebhookDeliveries } from '../lib/outboundWebhooks'
import { runWarehouseExports } from '../lib/bigqueryExport'
import { runKlaviyoSync } from '../jobs/klaviyoSync/run'
import { detectCreativeFatigue } from '../jobs/creativeFatigue/run'

// Records one row per job run so a failure is queryable (GET /jobs/status)
// instead of vanishing into a console.error nobody's watching. Recording the run
// itself never blocks or fails the job — if this insert throws, it's logged and
// swallowed, same never-block philosophy as everything else in this app.
async function runAndRecord(jobName: string, fn: () => Promise<unknown>): Promise<void> {
  const startedAt = new Date()
  try {
    await fn()
    await db
      .query(`INSERT INTO job_runs (job_name, status, started_at) VALUES ($1, 'success', $2)`, [jobName, startedAt])
      .catch((err) => console.error(`[scheduler] failed to record success for ${jobName}:`, err.message))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[scheduler] ${jobName} failed:`, message)
    await db
      .query(`INSERT INTO job_runs (job_name, status, error, started_at) VALUES ($1, 'failure', $2, $3)`, [
        jobName,
        message,
        startedAt,
      ])
      .catch((recordErr) => console.error(`[scheduler] failed to record failure for ${jobName}:`, recordErr.message))
  }
}

// These three jobs (ad-cost sync, LTV refresh, audience sync) previously only ran
// when someone manually invoked their npm script — nothing in this repo triggered
// them on a schedule. Scheduling them here means they run for as long as this API
// process stays up; there's still no scheduling if the process itself isn't kept
// running continuously (see the module-level comment in index.ts where this is
// wired in).
export function startScheduledJobs(): void {
  // Ad platforms report spend with a short lag, so every-6-hours (not daily) keeps
  // ROAS/CPC close to live without hammering any platform's rate limits.
  cron.schedule('0 */6 * * *', () => {
    console.log('[scheduler] running ad cost sync')
    runAndRecord('ad_cost_sync', runAdCostSync)
  })

  // LTV windows and audience segments don't need to be as fresh — once a day is
  // what their own code comments already assumed ("nightly refresh").
  cron.schedule('0 2 * * *', () => {
    console.log('[scheduler] refreshing customer LTV')
    runAndRecord('ltv_refresh', refreshCustomerLtv)
  })

  cron.schedule('0 3 * * *', () => {
    console.log('[scheduler] running audience syncs')
    runAndRecord('audience_sync', runAudienceSyncs)
  })

  // Nightly, same slot family as LTV/audience sync — a full reload of each
  // configured client's trailing window is cheap enough at this app's scale to
  // not need more frequent runs.
  cron.schedule('0 4 * * *', () => {
    console.log('[scheduler] running BigQuery warehouse exports')
    runAndRecord('warehouse_export', runWarehouseExports)
  })

  // Same 6-hourly cadence as ad-cost sync — email/SMS campaign performance is the
  // email/SMS-channel equivalent of ad spend/revenue, worth keeping similarly fresh.
  cron.schedule('30 */6 * * *', () => {
    console.log('[scheduler] running Klaviyo campaign sync')
    runAndRecord('klaviyo_sync', runKlaviyoSync)
  })

  // Runs after the 6-hourly ad-cost sync has a chance to land yesterday's finalized
  // spend — checking anomalies against yesterday's own not-yet-synced numbers would
  // just compare zeros. 7am covers "something broke overnight" before the workday.
  cron.schedule('0 7 * * *', () => {
    console.log('[scheduler] running anomaly detection')
    runAndRecord('anomaly_detection', detectAnomalies)
  })

  // Same 7am slot as anomaly detection — both are "daily creative/campaign health
  // check" jobs reading yesterday's finalized ad_costs.
  cron.schedule('5 7 * * *', () => {
    console.log('[scheduler] running creative fatigue detection')
    runAndRecord('creative_fatigue', detectCreativeFatigue)
  })

  // Every 15 minutes: recordings finish within seconds of a call ending, but
  // Twilio's transcription itself is async on their end, so this runs often
  // enough to both request new ones promptly and pick up completions quickly.
  cron.schedule('*/15 * * * *', () => {
    console.log('[scheduler] running call transcription')
    runAndRecord('call_transcription', transcribeAndScoreCalls)
  })

  // Matches the shortest backoff delay (1 minute) closely enough that a fast-
  // recovering endpoint gets retried promptly, without polling so often it's
  // pointless overhead for deliveries whose next_retry_at is hours out.
  cron.schedule('*/2 * * * *', () => {
    runAndRecord('webhook_retry', retryFailedWebhookDeliveries)
  })

  // Run once immediately on startup too, so data isn't stale from a cold start
  // (e.g. right after a deploy) until the next scheduled tick.
  console.log('[scheduler] running initial ad cost sync on startup')
  runAndRecord('ad_cost_sync', runAdCostSync)
}
