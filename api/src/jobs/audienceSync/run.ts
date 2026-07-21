import { db } from '../../db'
import { runSync } from '../../routes/audienceSync'

// Nightly refresh so segments stay current without a manual re-trigger each time —
// same per-sync try/catch isolation as jobs/adCosts/run.ts, one bad sync never
// blocks the rest.
export async function runAudienceSyncs(): Promise<void> {
  const { rows } = await db.query<{ id: string }>(`SELECT id FROM audience_syncs`)

  console.log(`Running ${rows.length} audience sync(s)`)

  for (const row of rows) {
    try {
      await runSync(row.id)
      console.log(`  ✓ audience_sync=${row.id}`)
    } catch (err) {
      console.error(`  ✗ audience_sync=${row.id} failed:`, (err as Error).message)
    }
  }
}

if (require.main === module) {
  runAudienceSyncs()
    .then(() => db.end())
    .catch((err) => {
      console.error('Audience sync run failed:', err)
      process.exit(1)
    })
}
