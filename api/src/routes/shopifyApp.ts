import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import * as crypto from 'crypto'
import { db } from '../db'
import { v4 as uuidv4 } from 'uuid'

// Real embedded Shopify App OAuth install flow — replaces scripts/setup-shopify-client.ts's
// CLI walkthrough (create client -> paste webhook URLs into Shopify admin by hand -> paste
// the webhook secret back) with Shopify's actual "click Install" flow. Needs a Shopify
// Partner account + a registered app (SHOPIFY_APP_CLIENT_ID/SECRET) to function at all —
// that account/app registration is a business step outside what code alone can do, same as
// every other "you get the credential, I wire the plumbing" integration in this project.
//
// One real simplification this unlocks: an installed app's webhooks are signed with the
// APP's client_secret (not a per-store secret you copy/paste), so the OAuth callback can
// just write that into client_integrations.webhook_secret and the existing signature-verified
// handler in routes/webhooks/shopify.ts needs zero changes to accept it.

const SHOPIFY_API_VERSION = '2024-01'
const REQUIRED_SCOPES = 'read_orders,read_customers'

function getAppCredentials() {
  const clientId = process.env.SHOPIFY_APP_CLIENT_ID
  const clientSecret = process.env.SHOPIFY_APP_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new Error('SHOPIFY_APP_CLIENT_ID and SHOPIFY_APP_CLIENT_SECRET must be set')
  }
  return { clientId, clientSecret }
}

function isValidShopDomain(shop: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/.test(shop)
}

// Stateless CSRF token: HMAC(shop + timestamp) signed with the app secret, verified on
// callback rather than needing server-side session storage for a one-shot install flow.
function signState(shop: string, clientSecret: string): string {
  const ts = Date.now().toString()
  const payload = `${shop}:${ts}`
  const sig = crypto.createHmac('sha256', clientSecret).update(payload).digest('hex')
  return Buffer.from(`${payload}:${sig}`).toString('base64url')
}

function verifyState(state: string, shop: string, clientSecret: string): boolean {
  try {
    const decoded = Buffer.from(state, 'base64url').toString('utf8')
    const [decodedShop, ts, sig] = decoded.split(':')
    if (decodedShop !== shop) return false
    if (Date.now() - Number(ts) > 10 * 60 * 1000) return false // 10 minute window
    const expected = crypto.createHmac('sha256', clientSecret).update(`${decodedShop}:${ts}`).digest('hex')
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))
  } catch {
    return false
  }
}

// Shopify's OAuth callback HMAC: sort all query params except hmac/signature, join as
// key=value pairs with &, HMAC-SHA256 with the app's client_secret, compare hex digests.
function verifyCallbackHmac(query: Record<string, string>, clientSecret: string): boolean {
  const { hmac, ...rest } = query
  if (!hmac) return false
  const message = Object.keys(rest)
    .sort()
    .map((key) => `${key}=${rest[key]}`)
    .join('&')
  const computed = crypto.createHmac('sha256', clientSecret).update(message).digest('hex')
  try {
    return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(hmac))
  } catch {
    return false
  }
}

async function registerWebhook(shop: string, accessToken: string, topic: string, address: string) {
  await fetch(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}/webhooks.json`, {
    method: 'POST',
    headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ webhook: { topic, address, format: 'json' } }),
  })
  // Best-effort — if a webhook of this topic already exists Shopify 422s, which is fine
  // (re-running install shouldn't create duplicates); not treated as a fatal error.
}

export async function shopifyAppRoutes(app: FastifyInstance) {
  // Step 1: merchant clicks "Install" (or is redirected here from the Shopify App Store
  // listing) with ?shop=their-store.myshopify.com
  app.get<{ Querystring: { shop?: string } }>('/shopify/install', async (req, reply) => {
    const { shop } = req.query
    if (!shop || !isValidShopDomain(shop)) {
      return reply.code(400).send({ error: 'Missing or invalid shop parameter' })
    }

    const { clientId, clientSecret } = getAppCredentials()
    const state = signState(shop, clientSecret)
    const redirectUri = `${req.protocol}://${req.headers.host}/shopify/callback`

    const authorizeUrl =
      `https://${shop}/admin/oauth/authorize?client_id=${clientId}` +
      `&scope=${REQUIRED_SCOPES}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&state=${state}`

    return reply.redirect(authorizeUrl)
  })

  // Step 2: Shopify redirects back here with an authorization code after the merchant approves.
  app.get<{ Querystring: Record<string, string> }>(
    '/shopify/callback',
    async (req: FastifyRequest<{ Querystring: Record<string, string> }>, reply: FastifyReply) => {
      const { shop, code, state } = req.query
      if (!shop || !code || !state || !isValidShopDomain(shop)) {
        return reply.code(400).send({ error: 'Missing or invalid callback parameters' })
      }

      const { clientId, clientSecret } = getAppCredentials()

      if (!verifyCallbackHmac(req.query, clientSecret)) {
        return reply.code(401).send({ error: 'Invalid HMAC' })
      }
      if (!verifyState(state, shop, clientSecret)) {
        return reply.code(401).send({ error: 'Invalid or expired state' })
      }

      const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
      })
      if (!tokenRes.ok) {
        return reply.code(502).send({ error: 'Failed to exchange code for access token' })
      }
      const { access_token: accessToken } = (await tokenRes.json()) as { access_token: string }

      // Find or create the client for this shop.
      const { rows: existingRows } = await db.query(
        `SELECT client_id FROM client_integrations WHERE platform = 'shopify' AND config->>'shop_domain' = $1`,
        [shop]
      )

      let clientRecordId: string
      if (existingRows.length > 0) {
        clientRecordId = existingRows[0].client_id
      } else {
        const { rows } = await db.query(
          `INSERT INTO clients (name, pixel_key, niche) VALUES ($1, $2, 'ecommerce') RETURNING id`,
          [shop.replace('.myshopify.com', ''), uuidv4()]
        )
        clientRecordId = rows[0].id
      }

      const apiUrl = `${req.protocol}://${req.headers.host}`
      await Promise.all([
        registerWebhook(shop, accessToken, 'orders/create', `${apiUrl}/webhooks/shopify/${clientRecordId}/orders`),
        registerWebhook(shop, accessToken, 'refunds/create', `${apiUrl}/webhooks/shopify/${clientRecordId}/refunds`),
      ])

      // App-installed webhooks are signed with the app's own client_secret, not a
      // per-store secret — routes/webhooks/shopify.ts already reads this exact field.
      await db.query(
        `INSERT INTO client_integrations (client_id, platform, config)
         VALUES ($1, 'shopify', $2)
         ON CONFLICT (client_id, platform) DO UPDATE SET config = EXCLUDED.config`,
        [clientRecordId, JSON.stringify({ webhook_secret: clientSecret, shop_domain: shop, access_token: accessToken })]
      )

      const { rows: clientRows } = await db.query('SELECT pixel_key FROM clients WHERE id = $1', [clientRecordId])

      return reply.type('text/html').send(`
        <html><body style="font-family: system-ui; padding: 40px; max-width: 600px; margin: 0 auto;">
          <h1>✅ Installed</h1>
          <p>Client ID: <code>${clientRecordId}</code></p>
          <p>Pixel key: <code>${clientRows[0]?.pixel_key}</code></p>
          <p>Add the tracking pixel snippet to your theme (see pixel/src/shopify/theme-snippet.liquid),
             filling in this client's pixel key. Webhooks were registered automatically.</p>
        </body></html>
      `)
    }
  )
}
