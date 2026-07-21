import * as readline from 'readline'
import * as path from 'path'
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

async function main() {
  console.log('\n🔧  Stripe Client Setup\n')

  const clientName = await ask('Client name: ')
  const apiUrl = await ask('Your API URL (e.g. https://api.yourdomain.com): ')
  const timezone = await ask('Timezone (default: America/New_York): ') || 'America/New_York'

  // Create client in DB
  const pixelKey = uuidv4()
  const { rows: clientRows } = await db.query(
    `INSERT INTO clients (name, pixel_key, timezone) VALUES ($1, $2, $3) RETURNING id, pixel_key`,
    [clientName, pixelKey, timezone]
  )
  const { id: clientId, pixel_key } = clientRows[0]

  const webhookUrl = `${apiUrl}/webhooks/stripe/${clientId}`

  box('Step 1 — Register this webhook endpoint in Stripe', [
    'Stripe Dashboard → Developers → Webhooks → Add endpoint',
    '',
    `Endpoint URL:  ${webhookUrl}`,
    '',
    'Events to send:',
    '  - checkout.session.completed',
    '  - invoice.payment_succeeded',
    '  - charge.refunded',
  ])

  const webhookSecret = await ask('\nPaste the signing secret (whsec_...) from Stripe: ')

  // Save integration config
  await db.query(
    `INSERT INTO client_integrations (client_id, platform, config)
     VALUES ($1, 'stripe', $2)
     ON CONFLICT (client_id, platform) DO UPDATE SET config = EXCLUDED.config`,
    [clientId, JSON.stringify({ webhook_secret: webhookSecret })]
  )

  box('Step 2 — Identify leads before checkout', [
    'Stripe Checkout runs on stripe.com, so the pixel cannot see it directly.',
    'Attribution relies on capturing the email BEFORE redirecting to Stripe.',
    '',
    'On your lead form / booking page, call:',
    '  ADT.identify(email)',
    '',
    `Pixel key: ${pixel_key}`,
    'Make sure pixel.js (with this pixel key baked in) loads on that page.',
  ])

  box('Client Summary', [
    `Name:       ${clientName}`,
    `Client ID:  ${clientId}`,
    `Pixel Key:  ${pixel_key}`,
    `API URL:    ${apiUrl}`,
    `Webhook:    ${webhookUrl}`,
  ])

  console.log('\n✅  Client setup complete!\n')

  await db.end()
  rl.close()
}

main().catch((err) => {
  console.error('Setup failed:', err.message)
  process.exit(1)
})
