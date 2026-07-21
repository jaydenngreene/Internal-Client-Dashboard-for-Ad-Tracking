import { FastifyInstance } from 'fastify'
import { db } from '../db'
import { v4 as uuidv4 } from 'uuid'

export async function clientRoutes(app: FastifyInstance) {
  // Create a new client
  app.post<{
    Body: { name: string; timezone?: string }
  }>('/clients', async (req, reply) => {
    const { name, timezone = 'America/New_York' } = req.body
    if (!name) return reply.code(400).send({ error: 'name required' })

    const pixelKey = uuidv4()
    const { rows } = await db.query(
      `INSERT INTO clients (name, pixel_key, timezone) VALUES ($1, $2, $3) RETURNING *`,
      [name, pixelKey, timezone]
    )
    return reply.code(201).send(rows[0])
  })

  // List all clients
  app.get('/clients', async (_req, reply) => {
    const { rows } = await db.query(
      'SELECT id, name, pixel_key, timezone, created_at FROM clients ORDER BY created_at DESC'
    )
    return reply.send(rows)
  })

  // Get a single client
  app.get<{ Params: { id: string } }>('/clients/:id', async (req, reply) => {
    const { rows } = await db.query('SELECT * FROM clients WHERE id = $1', [req.params.id])
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
  app.post<{
    Params: { id: string }
    Body: {
      customer_id: string
      login_customer_id?: string
      refresh_token?: string
    }
  }>('/clients/:id/integrations/google-ads', async (req, reply) => {
    const { id } = req.params
    const { customer_id, login_customer_id, refresh_token } = req.body

    if (!customer_id) {
      return reply.code(400).send({ error: 'customer_id required' })
    }

    const { rows } = await db.query(
      `INSERT INTO client_integrations (client_id, platform, config)
       VALUES ($1, 'google_ads', $2)
       ON CONFLICT (client_id, platform)
       DO UPDATE SET config = EXCLUDED.config
       RETURNING *`,
      [id, JSON.stringify({ customer_id, login_customer_id, refresh_token })]
    )
    return reply.code(200).send(rows[0])
  })

  // Get all integrations for a client
  app.get<{ Params: { id: string } }>('/clients/:id/integrations', async (req, reply) => {
    const { rows } = await db.query(
      `SELECT platform, created_at,
              config - 'webhook_secret' - 'access_token' - 'refresh_token' AS config  -- strip secrets from response
       FROM client_integrations WHERE client_id = $1`,
      [req.params.id]
    )
    return reply.send(rows)
  })
}
