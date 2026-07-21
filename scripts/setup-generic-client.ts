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

const NICHES = ['ecommerce', 'call', 'lead_gen', 'saas', 'info_product', 'other']
const PROCESSORS = ['paypal', 'square', 'gohighlevel', 'generic'] as const
type Processor = (typeof PROCESSORS)[number]

async function askFrom(label: string, options: readonly string[], fallback: string): Promise<string> {
  const answer = (await ask(`${label} (${options.join(' / ')}) [${fallback}]: `)).toLowerCase()
  if (!answer) return fallback
  if (!options.includes(answer)) {
    console.log(`  "${answer}" isn't one of the options, defaulting to "${fallback}".`)
    return fallback
  }
  return answer
}

async function main() {
  console.log('\n🔧  Generic Client Setup (PayPal / Square / GoHighLevel / fully generic)\n')

  const clientName = await ask('Client name: ')
  const apiUrl = await ask('Your API URL (e.g. https://api.yourdomain.com): ')
  const timezone = (await ask('Timezone (default: America/New_York): ')) || 'America/New_York'
  const niche = await askFrom('Niche', NICHES, 'other')
  const processor = (await askFrom('Payment processor', PROCESSORS, 'generic')) as Processor

  const pixelKey = uuidv4()
  const { rows: clientRows } = await db.query(
    `INSERT INTO clients (name, pixel_key, timezone, niche) VALUES ($1, $2, $3, $4) RETURNING id, pixel_key`,
    [clientName, pixelKey, timezone, niche]
  )
  const { id: clientId, pixel_key } = clientRows[0]

  const webhookUrl = `${apiUrl}/webhooks/${processor}/${clientId}`

  if (processor === 'paypal') {
    box('Step 1 — Register this webhook in PayPal', [
      'PayPal Developer Dashboard → your app → Webhooks → Add Webhook',
      '',
      `Webhook URL:  ${webhookUrl}`,
      '',
      'Events to send: Payment sale completed',
    ])
    const paypalClientId = await ask('\nPayPal app Client ID: ')
    const paypalClientSecret = await ask('PayPal app Client Secret: ')
    const webhookId = await ask('Webhook ID (shown after creating the webhook above): ')
    const sandboxAnswer = (await ask('Sandbox mode? (y/N): ')).toLowerCase()

    await db.query(
      `INSERT INTO client_integrations (client_id, platform, config)
       VALUES ($1, 'paypal', $2)
       ON CONFLICT (client_id, platform) DO UPDATE SET config = EXCLUDED.config`,
      [
        clientId,
        JSON.stringify({
          client_id: paypalClientId,
          client_secret: paypalClientSecret,
          webhook_id: webhookId,
          sandbox: sandboxAnswer === 'y',
        }),
      ]
    )
  } else if (processor === 'square') {
    box('Step 1 — Register this webhook in Square', [
      'Square Developer Dashboard → your app → Webhooks → Add Endpoint',
      '',
      `Notification URL:  ${webhookUrl}`,
      '',
      'Events to send: payment.created, payment.updated',
    ])
    const signatureKey = await ask('\nSignature key (shown after creating the endpoint above): ')

    await db.query(
      `INSERT INTO client_integrations (client_id, platform, config)
       VALUES ($1, 'square', $2)
       ON CONFLICT (client_id, platform) DO UPDATE SET config = EXCLUDED.config`,
      [clientId, JSON.stringify({ signature_key: signatureKey, notification_url: webhookUrl })]
    )
  } else if (processor === 'gohighlevel') {
    const webhookSecret = uuidv4()
    box('Step 1 — Add a Custom Webhook action in your GHL workflow', [
      'GHL doesn\'t sign webhooks, so this uses a shared secret instead.',
      '',
      `Webhook URL:  ${webhookUrl}`,
      '',
      'Body must include these fields (map with GHL merge tags):',
      `  secret: ${webhookSecret}`,
      '  event: "charge" or "refund"',
      '  contact.email (or email)',
      '  amount',
      '  transaction_id',
    ])

    await db.query(
      `INSERT INTO client_integrations (client_id, platform, config)
       VALUES ($1, 'gohighlevel', $2)
       ON CONFLICT (client_id, platform) DO UPDATE SET config = EXCLUDED.config`,
      [clientId, JSON.stringify({ webhook_secret: webhookSecret })]
    )
  } else {
    box('Step 1 — Point your processor/system at this URL', [
      `Webhook URL:  ${webhookUrl}`,
      '',
      'No signature verification available for a fully generic processor —',
      'body must be JSON: { email, revenue, order_id?, product?, processor? }',
    ])
  }

  box('Step 2 — Install the pixel', [
    `Pixel key: ${pixel_key}`,
    'Add pixel.js (with this pixel key baked in) to the client\'s site,',
    'and call ADT.identify(email) before checkout so purchases can attribute.',
  ])

  box('Client Summary', [
    `Name:       ${clientName}`,
    `Client ID:  ${clientId}`,
    `Niche:      ${niche}`,
    `Processor:  ${processor}`,
    `Pixel Key:  ${pixel_key}`,
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
