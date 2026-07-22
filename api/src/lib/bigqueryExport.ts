import { BigQuery } from '@google-cloud/bigquery'
import { Readable } from 'stream'
import { db } from '../db'

export interface BigQueryConfig {
  project_id: string
  dataset_id: string
  // A GCP service account key JSON (the whole key file's contents, pasted in) with
  // BigQuery Data Editor + Job User on the target dataset — created in the
  // client's own GCP project, this app never provisions GCP resources itself,
  // same boundary as every other credential here.
  service_account_key: string
}

function getClient(config: BigQueryConfig): BigQuery {
  const credentials = JSON.parse(config.service_account_key)
  return new BigQuery({ projectId: config.project_id, credentials })
}

interface TableSpec {
  name: string
  schema: { name: string; type: string; mode?: string }[]
  query: string
}

// 180 days, matching the historical-backfill window chosen in Step 34 — recent
// enough to stay a reasonable load-job size, long enough to be useful for a
// client's own downstream analysis.
const WINDOW_DAYS = 180

const TABLES: TableSpec[] = [
  {
    name: 'ad_costs',
    schema: [
      { name: 'platform', type: 'STRING' },
      { name: 'campaign_name', type: 'STRING' },
      { name: 'ad_name', type: 'STRING' },
      { name: 'date', type: 'DATE' },
      { name: 'spend', type: 'FLOAT' },
      { name: 'impressions', type: 'INTEGER' },
      { name: 'clicks', type: 'INTEGER' },
    ],
    query: `SELECT platform, campaign_name, ad_name, date, spend, impressions, clicks
            FROM ad_costs WHERE client_id = $1 AND date >= CURRENT_DATE - INTERVAL '${WINDOW_DAYS} days'`,
  },
  {
    name: 'purchases',
    schema: [
      { name: 'order_id', type: 'STRING' },
      { name: 'email', type: 'STRING' },
      { name: 'revenue', type: 'FLOAT' },
      { name: 'processor', type: 'STRING' },
      { name: 'refunded', type: 'BOOLEAN' },
      { name: 'purchased_at', type: 'TIMESTAMP' },
    ],
    query: `SELECT order_id, email, revenue, processor, refunded, purchased_at
            FROM purchases WHERE client_id = $1 AND purchased_at >= NOW() - INTERVAL '${WINDOW_DAYS} days'`,
  },
  {
    name: 'attributions',
    schema: [
      { name: 'purchase_id', type: 'STRING' },
      { name: 'session_id', type: 'STRING' },
      { name: 'model', type: 'STRING' },
      { name: 'credit_fraction', type: 'FLOAT' },
      { name: 'attributed_revenue', type: 'FLOAT' },
    ],
    query: `SELECT a.purchase_id::text, a.session_id::text, a.model, a.credit_fraction, a.attributed_revenue
            FROM attributions a JOIN purchases p ON p.id = a.purchase_id
            WHERE a.client_id = $1 AND p.purchased_at >= NOW() - INTERVAL '${WINDOW_DAYS} days'`,
  },
]

// One table at a time, WRITE_TRUNCATE — a full reload of the trailing window
// rather than an incremental append, deliberately: BigQuery's streaming-insert API
// has its own dedup/buffer quirks (can't DELETE recently streamed rows for up to
// ~90 minutes) that a load-job reload sidesteps entirely, and this app's data
// volume is modest enough that reloading 180 days nightly is cheap either way.
export async function exportClientToBigQuery(clientId: string, config: BigQueryConfig): Promise<void> {
  const client = getClient(config)
  const dataset = client.dataset(config.dataset_id)

  for (const table of TABLES) {
    const { rows } = await db.query(table.query, [clientId])
    const ndjson = rows.map((r) => JSON.stringify(r)).join('\n')

    const bqTable = dataset.table(table.name)
    const [exists] = await bqTable.exists()
    if (!exists) {
      await dataset.createTable(table.name, { schema: table.schema })
    }

    if (rows.length === 0) continue // an empty load job would error; nothing to reload

    // No GCS bucket needed: createWriteStream runs a load job fed directly from an
    // in-memory stream, exactly what a client-library caller without their own
    // staging bucket wants.
    await new Promise<void>((resolve, reject) => {
      Readable.from(ndjson)
        .pipe(
          bqTable.createWriteStream({
            sourceFormat: 'NEWLINE_DELIMITED_JSON',
            writeDisposition: 'WRITE_TRUNCATE',
            schema: { fields: table.schema },
          })
        )
        .on('complete', () => resolve())
        .on('error', (err) => reject(err))
    })
  }
}

export async function runWarehouseExports(): Promise<number> {
  const { rows: integrations } = await db.query<{ client_id: string; config: BigQueryConfig }>(
    `SELECT client_id, config FROM client_integrations WHERE platform = 'bigquery'`
  )

  let exported = 0
  for (const integration of integrations) {
    try {
      await exportClientToBigQuery(integration.client_id, integration.config)
      console.log(`[warehouse-export] client=${integration.client_id}: exported to BigQuery`)
      exported++
    } catch (err) {
      console.error(`[warehouse-export] client=${integration.client_id} failed:`, (err as Error).message)
    }
  }
  return exported
}
