import { FastifyInstance } from 'fastify'
import { db } from '../db'
import { v4 as uuidv4 } from 'uuid'

const NICHES = ['ecommerce', 'call', 'lead_gen', 'saas', 'info_product', 'other']

async function upsertIntegration(clientId: string, platform: string, config: Record<string, unknown>) {
  const { rows } = await db.query(
    `INSERT INTO client_integrations (client_id, platform, config)
     VALUES ($1, $2, $3)
     ON CONFLICT (client_id, platform)
     DO UPDATE SET config = EXCLUDED.config
     RETURNING *`,
    [clientId, platform, JSON.stringify(config)]
  )
  return rows[0]
}

export async function clientRoutes(app: FastifyInstance) {
  // Create a new client
  app.post<{
    Body: { name: string; timezone?: string; niche?: string }
  }>('/clients', async (req, reply) => {
    const { name, timezone = 'America/New_York', niche = 'other' } = req.body
    if (!name) return reply.code(400).send({ error: 'name required' })
    if (!NICHES.includes(niche)) {
      return reply.code(400).send({ error: `niche must be one of: ${NICHES.join(', ')}` })
    }

    const pixelKey = uuidv4()
    const { rows } = await db.query(
      `INSERT INTO clients (name, pixel_key, timezone, niche) VALUES ($1, $2, $3, $4) RETURNING *`,
      [name, pixelKey, timezone, niche]
    )
    return reply.code(201).send(rows[0])
  })

  // List all clients
  app.get('/clients', async (_req, reply) => {
    const { rows } = await db.query(
      'SELECT id, name, pixel_key, timezone, niche, created_at FROM clients ORDER BY created_at DESC'
    )
    return reply.send(rows)
  })

  // Get a single client
  app.get<{ Params: { id: string } }>('/clients/:id', async (req, reply) => {
    const { rows } = await db.query('SELECT * FROM clients WHERE id = $1', [req.params.id])
    if (rows.length === 0) return reply.code(404).send({ error: 'Not found' })
    return reply.send(rows[0])
  })

  // Change a client's attribution model (first_click / last_click / linear)
  app.patch<{
    Params: { id: string }
    Body: { attribution_model: string }
  }>('/clients/:id/attribution-model', async (req, reply) => {
    const { id } = req.params
    const { attribution_model } = req.body

    if (!['first_click', 'last_click', 'linear'].includes(attribution_model)) {
      return reply.code(400).send({ error: 'attribution_model must be first_click, last_click, or linear' })
    }

    const { rows } = await db.query(
      'UPDATE clients SET attribution_model = $1 WHERE id = $2 RETURNING *',
      [attribution_model, id]
    )
    if (rows.length === 0) return reply.code(404).send({ error: 'Not found' })
    return reply.send(rows[0])
  })

  // Change a client's niche/business type — the dashboard uses this to show/hide
  // niche-specific metrics (e.g. cart/ATC cards only make sense for 'ecommerce').
  app.patch<{
    Params: { id: string }
    Body: { niche: string }
  }>('/clients/:id/niche', async (req, reply) => {
    const { id } = req.params
    const { niche } = req.body

    if (!NICHES.includes(niche)) {
      return reply.code(400).send({ error: `niche must be one of: ${NICHES.join(', ')}` })
    }

    const { rows } = await db.query('UPDATE clients SET niche = $1 WHERE id = $2 RETURNING *', [niche, id])
    if (rows.length === 0) return reply.code(404).send({ error: 'Not found' })
    return reply.send(rows[0])
  })

  // Save or update a Shopify integration for a client
  app.post<{
    Params: { id: string }
    Body: {
      webhook_secret: string
      shop_domain: string
    }
  }>('/clients/:id/integrations/shopify', async (req, reply) => {
    const { id } = req.params
    const { webhook_secret, shop_domain } = req.body

    if (!webhook_secret || !shop_domain) {
      return reply.code(400).send({ error: 'webhook_secret and shop_domain required' })
    }

    const { rows } = await db.query(
      `INSERT INTO client_integrations (client_id, platform, config)
       VALUES ($1, 'shopify', $2)
       ON CONFLICT (client_id, platform)
       DO UPDATE SET config = EXCLUDED.config
       RETURNING *`,
      [id, JSON.stringify({ webhook_secret, shop_domain })]
    )
    return reply.code(200).send(rows[0])
  })

  // Save or update a Stripe integration for a client
  app.post<{
    Params: { id: string }
    Body: {
      webhook_secret: string
    }
  }>('/clients/:id/integrations/stripe', async (req, reply) => {
    const { id } = req.params
    const { webhook_secret } = req.body

    if (!webhook_secret) {
      return reply.code(400).send({ error: 'webhook_secret required' })
    }

    const { rows } = await db.query(
      `INSERT INTO client_integrations (client_id, platform, config)
       VALUES ($1, 'stripe', $2)
       ON CONFLICT (client_id, platform)
       DO UPDATE SET config = EXCLUDED.config
       RETURNING *`,
      [id, JSON.stringify({ webhook_secret })]
    )
    return reply.code(200).send(rows[0])
  })

  // Save or update a Facebook Ads integration for a client
  app.post<{
    Params: { id: string }
    Body: {
      access_token: string
      ad_account_id: string
    }
  }>('/clients/:id/integrations/facebook-ads', async (req, reply) => {
    const { id } = req.params
    const { access_token, ad_account_id } = req.body

    if (!access_token || !ad_account_id) {
      return reply.code(400).send({ error: 'access_token and ad_account_id required' })
    }

    const { rows } = await db.query(
      `INSERT INTO client_integrations (client_id, platform, config)
       VALUES ($1, 'facebook_ads', $2)
       ON CONFLICT (client_id, platform)
       DO UPDATE SET config = EXCLUDED.config
       RETURNING *`,
      [id, JSON.stringify({ access_token, ad_account_id })]
    )
    return reply.code(200).send(rows[0])
  })

  // Save or update a Google Ads integration for a client.
  // login_customer_id / refresh_token are optional — they fall back to the shared
  // agency MCC credentials in .env when the client's account sits under that manager account.
  // conversion_action_purchase/lead are Google Ads conversion-action resource names,
  // needed for Enhanced Conversions uploads (Step 8) — optional until that's set up.
  app.post<{
    Params: { id: string }
    Body: {
      customer_id: string
      login_customer_id?: string
      refresh_token?: string
      conversion_action_purchase?: string
      conversion_action_lead?: string
    }
  }>('/clients/:id/integrations/google-ads', async (req, reply) => {
    const { id } = req.params
    const { customer_id, login_customer_id, refresh_token, conversion_action_purchase, conversion_action_lead } =
      req.body

    if (!customer_id) {
      return reply.code(400).send({ error: 'customer_id required' })
    }

    const { rows } = await db.query(
      `INSERT INTO client_integrations (client_id, platform, config)
       VALUES ($1, 'google_ads', $2)
       ON CONFLICT (client_id, platform)
       DO UPDATE SET config = EXCLUDED.config
       RETURNING *`,
      [
        id,
        JSON.stringify({
          customer_id,
          login_customer_id,
          refresh_token,
          conversion_action_purchase,
          conversion_action_lead,
        }),
      ]
    )
    return reply.code(200).send(rows[0])
  })

  // Save or update a Facebook Conversions API (CAPI) integration for a client — Step 8.
  // Distinct from the facebook-ads integration: CAPI needs a pixel_id and a token with
  // business/pixel-management permission, not the ads_read token used for cost sync.
  app.post<{
    Params: { id: string }
    Body: {
      pixel_id: string
      access_token: string
    }
  }>('/clients/:id/integrations/facebook-capi', async (req, reply) => {
    const { id } = req.params
    const { pixel_id, access_token } = req.body

    if (!pixel_id || !access_token) {
      return reply.code(400).send({ error: 'pixel_id and access_token required' })
    }

    const { rows } = await db.query(
      `INSERT INTO client_integrations (client_id, platform, config)
       VALUES ($1, 'facebook_capi', $2)
       ON CONFLICT (client_id, platform)
       DO UPDATE SET config = EXCLUDED.config
       RETURNING *`,
      [id, JSON.stringify({ pixel_id, access_token })]
    )
    return reply.code(200).send(rows[0])
  })

  // Save or update a Bing/Microsoft Advertising integration for a client — Step 11.
  // Same shape as Google Ads: shared app credentials (BING_ADS_CLIENT_ID/SECRET/
  // DEVELOPER_TOKEN) in .env, per-client customer_id/account_id/refresh_token here.
  app.post<{
    Params: { id: string }
    Body: { customer_id: string; account_id: string; refresh_token: string }
  }>('/clients/:id/integrations/bing-ads', async (req, reply) => {
    const { id } = req.params
    const { customer_id, account_id, refresh_token } = req.body
    if (!customer_id || !account_id || !refresh_token) {
      return reply.code(400).send({ error: 'customer_id, account_id, and refresh_token required' })
    }
    return reply.code(200).send(await upsertIntegration(id, 'bing_ads', { customer_id, account_id, refresh_token }))
  })

  // Save or update a Twilio integration for a client — Step 11 call tracking.
  // Just the auth token for webhook signature verification; the account itself
  // (and any purchased numbers) lives entirely in the client's own Twilio account.
  app.post<{
    Params: { id: string }
    Body: { account_sid: string; auth_token: string }
  }>('/clients/:id/integrations/twilio', async (req, reply) => {
    const { id } = req.params
    const { account_sid, auth_token } = req.body
    if (!account_sid || !auth_token) {
      return reply.code(400).send({ error: 'account_sid and auth_token required' })
    }
    return reply.code(200).send(await upsertIntegration(id, 'twilio', { account_sid, auth_token }))
  })

  // Register a tracking number the client already purchased in their own Twilio
  // account — this app never buys numbers or touches billing on anyone's behalf.
  app.post<{
    Params: { id: string }
    Body: { phone_number: string; forward_to: string }
  }>('/clients/:id/tracking-numbers', async (req, reply) => {
    const { id } = req.params
    const { phone_number, forward_to } = req.body
    if (!phone_number || !forward_to) {
      return reply.code(400).send({ error: 'phone_number and forward_to required' })
    }
    const { rows } = await db.query(
      `INSERT INTO tracking_numbers (client_id, phone_number, forward_to)
       VALUES ($1, $2, $3)
       ON CONFLICT (client_id, phone_number) DO UPDATE SET forward_to = EXCLUDED.forward_to
       RETURNING *`,
      [id, phone_number, forward_to]
    )
    return reply.code(201).send(rows[0])
  })

  // List a client's tracking numbers and their current assignment state.
  app.get<{ Params: { id: string } }>('/clients/:id/tracking-numbers', async (req, reply) => {
    const { rows } = await db.query(
      `SELECT id, phone_number, forward_to, status, assigned_at, created_at
       FROM tracking_numbers WHERE client_id = $1 ORDER BY created_at DESC`,
      [req.params.id]
    )
    return reply.send(rows)
  })

  // Save or update a PayPal integration — Step 9. client_id/client_secret authenticate
  // to PayPal's own webhook-signature-verification API; webhook_id identifies which
  // registered webhook this is (PayPal ties signature verification to it).
  app.post<{
    Params: { id: string }
    Body: { client_id: string; client_secret: string; webhook_id: string; sandbox?: boolean }
  }>('/clients/:id/integrations/paypal', async (req, reply) => {
    const { id } = req.params
    const { client_id, client_secret, webhook_id, sandbox } = req.body
    if (!client_id || !client_secret || !webhook_id) {
      return reply.code(400).send({ error: 'client_id, client_secret, and webhook_id required' })
    }
    return reply.code(200).send(await upsertIntegration(id, 'paypal', { client_id, client_secret, webhook_id, sandbox }))
  })

  // Save or update a Square integration — Step 9.
  app.post<{
    Params: { id: string }
    Body: { signature_key: string; notification_url: string }
  }>('/clients/:id/integrations/square', async (req, reply) => {
    const { id } = req.params
    const { signature_key, notification_url } = req.body
    if (!signature_key || !notification_url) {
      return reply.code(400).send({ error: 'signature_key and notification_url required' })
    }
    return reply.code(200).send(await upsertIntegration(id, 'square', { signature_key, notification_url }))
  })

  // Save or update a GoHighLevel integration — Step 9. See routes/webhooks/gohighlevel.ts
  // for why this is a shared secret rather than a real signature.
  app.post<{
    Params: { id: string }
    Body: { webhook_secret: string }
  }>('/clients/:id/integrations/gohighlevel', async (req, reply) => {
    const { id } = req.params
    const { webhook_secret } = req.body
    if (!webhook_secret) {
      return reply.code(400).send({ error: 'webhook_secret required' })
    }
    return reply.code(200).send(await upsertIntegration(id, 'gohighlevel', { webhook_secret }))
  })

  // Save or update a Customers.ai integration — Step 12. See routes/webhooks/customersAi.ts
  // for why this is a shared secret rather than a real signature (same reason as GoHighLevel).
  app.post<{
    Params: { id: string }
    Body: { webhook_secret: string }
  }>('/clients/:id/integrations/customers-ai', async (req, reply) => {
    const { id } = req.params
    const { webhook_secret } = req.body
    if (!webhook_secret) {
      return reply.code(400).send({ error: 'webhook_secret required' })
    }
    return reply.code(200).send(await upsertIntegration(id, 'customers_ai', { webhook_secret }))
  })

  // Save or update the Klaviyo integration used by the Step 12 remarketing agent's
  // (not-yet-auto-wired) dispatch step — see lib/klaviyoDispatch.ts. list_id is the
  // Klaviyo list the client's own flow/campaign is set up to react to.
  app.post<{
    Params: { id: string }
    Body: { api_key: string; list_id: string }
  }>('/clients/:id/integrations/klaviyo', async (req, reply) => {
    const { id } = req.params
    const { api_key, list_id } = req.body
    if (!api_key || !list_id) {
      return reply.code(400).send({ error: 'api_key and list_id required' })
    }
    return reply.code(200).send(await upsertIntegration(id, 'klaviyo', { api_key, list_id }))
  })

  // Get all integrations for a client
  app.get<{ Params: { id: string } }>('/clients/:id/integrations', async (req, reply) => {
    const { rows } = await db.query(
      `SELECT platform, created_at,
              config - 'webhook_secret' - 'access_token' - 'refresh_token' - 'client_secret' - 'signature_key' - 'auth_token' - 'api_key' AS config
       FROM client_integrations WHERE client_id = $1`,
      [req.params.id]
    )
    return reply.send(rows)
  })
}
