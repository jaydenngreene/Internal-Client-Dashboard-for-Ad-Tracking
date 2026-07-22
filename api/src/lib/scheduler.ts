import cron from 'node-cron'
import { runAdCostSync } from '../jobs/adCosts/run'
import { refreshCustomerLtv } from '../jobs/ltv/run'
import { runAudienceSyncs } from '../jobs/audienceSync/run'

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
    runAdCostSync().catch((err) => console.error('[scheduler] ad cost sync failed:', err.message))
  })

  // LTV windows and audience segments don't need to be as fresh — once a day is
  // what their own code comments already assumed ("nightly refresh").
  cron.schedule('0 2 * * *', () => {
    console.log('[scheduler] refreshing customer LTV')
    refreshCustomerLtv().catch((err) => console.error('[scheduler] LTV refresh failed:', err.message))
  })

  cron.schedule('0 3 * * *', () => {
    console.log('[scheduler] running audience syncs')
    runAudienceSyncs().catch((err) => console.error('[scheduler] audience sync failed:', err.message))
  })

  // Run once immediately on startup too, so data isn't stale from a cold start
  // (e.g. right after a deploy) until the next scheduled tick.
  console.log('[scheduler] running initial ad cost sync on startup')
  runAdCostSync().catch((err) => console.error('[scheduler] initial ad cost sync failed:', err.message))
}
