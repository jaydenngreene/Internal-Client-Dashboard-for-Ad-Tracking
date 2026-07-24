import * as readline from 'readline'
import * as path from 'path'
import * as dotenv from 'dotenv'
import { Pool } from 'pg'
import { recordPurchase, recordRefund } from '../api/src/lib/attribution'

dotenv.config({ path: path.join(__dirname, '../.env') })

const db = new Pool({ connectionString: process.env.DATABASE_URL })

const SHOPIFY_API_VERSION = '2024-01'

const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
const ask = (q: string): Promise<string> =>
  new Promise((resolve) => rl.question(q, (a) => resolve(a.trim())))

function box(title: string, lines: string[]) {
  const width = Math.max(title.length, ...lines.map((l) => l.length)) + 4
  const hr = '─'.repeat(width)
  console.log(`\n┌${hr}┐`)
  console.log(`│  ${title.padEnd(width - 2)}│`)
  console.log(`├${hr}┤`)
  lines.forEach((l) => console.log(`│  ${l.padEnd(width - 2)}│`))
  console.log(`└${hr}┘`)
}

interface ShopifyOrder {
  id: number
  email: string | null
  total_price: string
  currency: string
  cancelled_at: string | null
  cancel_reason: string | null
  customer: { email: string } | null
  line_items: Array<{ title: string }>
  refunds: Array<{
    id: number
    transactions: Array<{ amount: string; kind: string; status: string; currency?: string }>
  }>
}

interface ShopifyOrdersResponse {
  orders: ShopifyOrder[]
  errors?: string
}

function parseNextPageInfo(linkHeader: string | null): string | null {
  if (!linkHeader) return null
  const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/)
  if (!match) return null
  const nextUrl = new URL(match[1])
  return nextUrl.searchParams.get('page_info')
}

async function fetchOrdersPage(
  shopDomain: string,
  accessToken: string,
  params: URLSearchParams
): Promise<{ orders: ShopifyOrder[]; nextPageInfo: string | null }> {
  const url = `https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/orders.json?${params.toString()}`
  const res = await fetch(url, { headers: { 'X-Shopify-Access-Token': accessToken } })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Shopify orders request failed (${res.status}): ${body}`)
  }

  const body = (await res.json()) as ShopifyOrdersResponse
  const nextPageInfo = parseNextPageInfo(res.headers.get('link'))
  return { orders: body.orders, nextPageInfo }
}

// Mirrors api/src/routes/webhooks/shopify.ts's orders/create + refunds/create handlers
// exactly, so a historical order is treated identically to one that arrives live —
// same skip-cancelled rule, same recordPurchase/recordRefund calls. recordPurchase
// only attributes to a campaign (and only fires a Conversions API signal) when it
// finds a matching identity+session — for a freshly-installed pixel there's no prior
// session history for any of these emails, so historical orders land as unattributed
// revenue and never trigger an outbound Facebook/Google signal. That's intentional:
// this script backfills dashboard revenue history, not ad-platform conversion events.
async function importOrder(clientId: string, order: ShopifyOrder): Promise<'imported' | 'skipped'> {
  if (order.cancelled_at || order.cancel_reason) return 'skipped'

  const email = order.email ?? order.customer?.email
  if (!email) return 'skipped'

  await recordPurchase(clientId, {
    email,
    revenue: parseFloat(order.total_price),
    product: order.line_items?.[0]?.title ?? null,
    order_id: String(order.id),
    processor: 'shopify',
    currency: order.currency,
  })

  for (const refund of order.refunds ?? []) {
    const refundTxns = refund.transactions.filter((t) => t.status === 'success' && t.kind === 'refund')
    const refundAmount = refundTxns.reduce((sum, t) => sum + parseFloat(t.amount), 0)
    if (refundAmount > 0) {
      await recordRefund(clientId, String(order.id), refundAmount, refundTxns[0]?.currency)
    }
  }

  return 'imported'
}

async function main() {
  console.log('\n🔧  Shopify Historical Order Import\n')

  const clientId = await ask('Client ID: ')

  const { rows: clientRows } = await db.query('SELECT id, name FROM clients WHERE id = $1', [clientId])
  if (clientRows.length === 0) {
    console.error(`No client found with ID ${clientId}`)
    process.exit(1)
  }
  console.log(`Client: ${clientRows[0].name}`)

  const { rows: integrationRows } = await db.query(
    `SELECT config->>'shop_domain' AS shop_domain, config->>'access_token' AS access_token
     FROM client_integrations WHERE client_id = $1 AND platform = 'shopify'`,
    [clientId]
  )
  const savedDomain = integrationRows[0]?.shop_domain ?? ''
  const savedAccessToken = integrationRows[0]?.access_token ?? ''
  const shopDomain =
    (await ask(`Shopify store domain${savedDomain ? ` (default: ${savedDomain})` : ''}: `)) || savedDomain
  if (!shopDomain) {
    console.error('A shop domain is required.')
    process.exit(1)
  }

  // The OAuth install flow (routes/shopifyApp.ts) already saved a working token here —
  // only clients still on the older manual custom-app setup need to paste one by hand.
  let accessToken = savedAccessToken
  if (accessToken) {
    console.log('\nUsing the access token already saved from the Shopify OAuth install.\n')
  } else {
    box('Need an Admin API access token', [
      'No token found on this client from the OAuth install flow.',
      'This is different from the webhook signing secret already saved.',
      '',
      'Shopify Admin → Settings → Apps and sales channels',
      '→ Develop apps → Create an app',
      '→ Configure Admin API scopes → enable read_orders + read_all_orders',
      '→ Install app → reveal the Admin API access token',
    ])
    accessToken = await ask('Admin API access token (starts with shpat_): ')
    if (!accessToken) {
      console.error('An access token is required.')
      process.exit(1)
    }
  }

  const daysBackInput = await ask('How many days back? (default 180, same window as ad platform backfill): ')
  const daysBack = daysBackInput ? parseInt(daysBackInput, 10) : 180

  const since = new Date()
  since.setUTCDate(since.getUTCDate() - daysBack)

  console.log(`\nPulling orders since ${since.toISOString().slice(0, 10)}...\n`)

  let imported = 0
  let skipped = 0
  let pageInfo: string | null = null
  let pageNum = 1

  do {
    const params = new URLSearchParams({ status: 'any', limit: '250' })
    if (pageInfo) {
      params.set('page_info', pageInfo)
    } else {
      params.set('created_at_min', since.toISOString())
    }

    const { orders, nextPageInfo } = await fetchOrdersPage(shopDomain, accessToken, params)
    console.log(`Page ${pageNum}: ${orders.length} order(s)`)

    for (const order of orders) {
      const result = await importOrder(clientId, order)
      if (result === 'imported') imported++
      else skipped++
    }

    pageInfo = nextPageInfo
    pageNum++

    // Shopify's REST API allows ~2 req/sec on standard plans — a small pause between
    // pages keeps this comfortably under that regardless of store size.
    if (pageInfo) await new Promise((resolve) => setTimeout(resolve, 600))
  } while (pageInfo)

  box('Import complete', [
    `Imported:  ${imported}`,
    `Skipped:   ${skipped} (cancelled or no email)`,
    '',
    'Revenue/LTV totals will reflect these now.',
    'Campaign-level attribution will not, since these orders',
    'predate the pixel — that only applies to orders going forward.',
  ])

  await db.end()
  rl.close()
}

main().catch((err) => {
  console.error('Import failed:', err.message)
  process.exit(1)
})
