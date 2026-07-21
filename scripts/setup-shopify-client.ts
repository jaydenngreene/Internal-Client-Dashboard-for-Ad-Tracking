import * as readline from 'readline'
import * as path from 'path'
import * as fs from 'fs'
import * as dotenv from 'dotenv'
import { Pool } from 'pg'
import { v4 as uuidv4 } from 'uuid'

dotenv.config({ path: path.join(__dirname, '../.env') })

const db = new Pool({ connectionString: process.env.DATABASE_URL })

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

function fillSnippet(template: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce(
    (str, [k, v]) => str.replaceAll(k, v),
    template
  )
}

async function main() {
  console.log('\n🔧  Shopify Client Setup\n')

  const clientName = await ask('Client name: ')
  const shopDomain = await ask('Shopify store domain (e.g. mystore.myshopify.com): ')
  const apiUrl = await ask('Your API URL (e.g. https://api.yourdomain.com): ')
  const timezone = await ask('Timezone (default: America/New_York): ') || 'America/New_York'

  // Create client in DB
  const pixelKey = uuidv4()
  const { rows: clientRows } = await db.query(
    `INSERT INTO clients (name, pixel_key, timezone) VALUES ($1, $2, $3) RETURNING id, pixel_key`,
    [clientName, pixelKey, timezone]
  )
  const { id: clientId, pixel_key } = clientRows[0]

  // Show webhook URLs to register in Shopify
  const ordersWebhookUrl = `${apiUrl}/webhooks/shopify/${clientId}/orders`
  const refundsWebhookUrl = `${apiUrl}/webhooks/shopify/${clientId}/refunds`

  box('Step 1 — Register these webhooks in Shopify', [
    'Shopify Admin → Settings → Notifications → Webhooks',
    '',
    `orders/create   →  ${ordersWebhookUrl}`,
    `refunds/create  →  ${refundsWebhookUrl}`,
    '',
    'Format: JSON'
  ])

  const webhookSecret = await ask('\nPaste the webhook signing secret from Shopify: ')

  // Save integration config
  await db.query(
    `INSERT INTO client_integrations (client_id, platform, config)
     VALUES ($1, 'shopify', $2)
     ON CONFLICT (client_id, platform) DO UPDATE SET config = EXCLUDED.config`,
    [clientId, JSON.stringify({ webhook_secret: webhookSecret, shop_domain: shopDomain })]
  )

  // Generate filled-in snippets
  const snippetDir = path.join(__dirname, '../pixel/src/shopify')
  const themeTemplate = fs.readFileSync(path.join(snippetDir, 'theme-snippet.liquid'), 'utf8')
  const checkoutTemplate = fs.readFileSync(path.join(snippetDir, 'checkout-tracking.liquid'), 'utf8')

  const vars = {
    'YOUR_API_URL': apiUrl,
    'YOUR_PIXEL_KEY': pixel_key,
  }

  const outputDir = path.join(__dirname, `../output/${clientName.replace(/\s+/g, '-').toLowerCase()}`)
  fs.mkdirSync(outputDir, { recursive: true })

  fs.writeFileSync(path.join(outputDir, 'theme-snippet.liquid'), fillSnippet(themeTemplate, vars))
  fs.writeFileSync(path.join(outputDir, 'checkout-tracking.liquid'), fillSnippet(checkoutTemplate, vars))

  box('Step 2 — Add pixel to Shopify theme', [
    `File saved: output/${clientName.replace(/\s+/g, '-').toLowerCase()}/theme-snippet.liquid`,
    '',
    'In Shopify Admin → Online Store → Themes → Edit code',
    'Open: layout/theme.liquid',
    'Paste the snippet contents just before </body>',
  ])

  box('Step 3 — Add checkout tracking', [
    `File saved: output/${clientName.replace(/\s+/g, '-').toLowerCase()}/checkout-tracking.liquid`,
    '',
    'In Shopify Admin → Settings → Checkout',
    'Scroll to: Order status page → Additional scripts',
    'Paste the snippet contents there',
  ])

  box('Client Summary', [
    `Name:       ${clientName}`,
    `Client ID:  ${clientId}`,
    `Pixel Key:  ${pixel_key}`,
    `Shop:       ${shopDomain}`,
    `API URL:    ${apiUrl}`,
  ])

  console.log('\n✅  Client setup complete!\n')

  await db.end()
  rl.close()
}

main().catch((err) => {
  console.error('Setup failed:', err.message)
  process.exit(1)
})
