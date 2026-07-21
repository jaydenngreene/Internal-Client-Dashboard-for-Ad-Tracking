import * as readline from 'readline'
import * as path from 'path'
import * as dotenv from 'dotenv'
import { Pool } from 'pg'

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

function randomSecret(): string {
  return [...Array(32)].map(() => Math.floor(Math.random() * 36).toString(36)).join('')
}

// Wires up Step 12's identity-resolution source (Customers.ai) and, optionally, the
// Klaviyo integration its (not-yet-auto-wired) dispatch step will use later. This
// script never causes a message to be sent — it only saves credentials and prints the
// webhook URL to paste into Customers.ai's own dashboard.
async function main() {
  console.log('\n🕵️  Remarketing Agent Setup (Customers.ai identity resolution + Klaviyo)\n')

  const clientId = await ask('Client ID (from `npm run setup:*` output, or GET /clients): ')
  const apiUrl = await ask('Your API URL (e.g. https://api.yourdomain.com): ')

  const { rows } = await db.query('SELECT id, name FROM clients WHERE id = $1', [clientId])
  if (rows.length === 0) {
    console.error(`\n❌  No client found with id ${clientId}. Run one of the other setup:* scripts first.\n`)
    await db.end()
    rl.close()
    return
  }
  const clientName = rows[0].name

  const webhookSecret = randomSecret()
  const webhookUrl = `${apiUrl}/webhooks/customers-ai/${clientId}`

  box('Step 1 — Configure a Custom Webhook in Customers.ai', [
    'Customers.ai dashboard → Integrations → Custom Webhooks → Add',
    '',
    `Webhook URL:  ${webhookUrl}`,
    '',
    'Map these attributes into the JSON body:',
    `  secret: ${webhookSecret}`,
    '  email, phone, first_name, last_name',
    '  page_url, page_title, visited_at',
    '',
    "Also install Customers.ai's own X-Ray pixel on the site — it is separate",
    "from this project's own pixel.js and is what actually deanonymizes visitors.",
  ])

  await db.query(
    `INSERT INTO client_integrations (client_id, platform, config)
     VALUES ($1, 'customers_ai', $2)
     ON CONFLICT (client_id, platform) DO UPDATE SET config = EXCLUDED.config`,
    [clientId, JSON.stringify({ webhook_secret: webhookSecret })]
  )

  const wantsKlaviyo = (await ask('\nSet up Klaviyo dispatch now too? (y/N): ')).toLowerCase() === 'y'
  if (wantsKlaviyo) {
    box('Step 2 — Klaviyo', [
      'Klaviyo → Settings → API Keys → Create Private Key (needs profiles + lists write access)',
      'Klaviyo → Lists → the list your remarketing flow is triggered from → copy its List ID',
      '',
      'Reminder: this only ever ADDS someone to that list. It never sends a',
      'message directly — your existing Klaviyo flow decides what happens next.',
    ])
    const apiKey = await ask('Klaviyo Private API Key: ')
    const listId = await ask('Klaviyo List ID: ')

    await db.query(
      `INSERT INTO client_integrations (client_id, platform, config)
       VALUES ($1, 'klaviyo', $2)
       ON CONFLICT (client_id, platform) DO UPDATE SET config = EXCLUDED.config`,
      [clientId, JSON.stringify({ api_key: apiKey, list_id: listId })]
    )
  } else {
    console.log('\nSkipping Klaviyo — candidates will still be captured and drafted, just not dispatchable yet.')
  }

  box('Client Summary', [
    `Name:       ${clientName}`,
    `Client ID:  ${clientId}`,
    `Webhook:    ${webhookUrl}`,
    `Klaviyo:    ${wantsKlaviyo ? 'configured' : 'not configured'}`,
  ])

  console.log('\n✅  Remarketing setup complete! Review incoming candidates at')
  console.log(`   GET ${apiUrl}/clients/${clientId}/remarketing/candidates\n`)

  await db.end()
  rl.close()
}

main().catch((err) => {
  console.error('Setup failed:', err.message)
  process.exit(1)
})
