import { FastifyInstance } from 'fastify'
import { db } from '../db'
import { v4 as uuidv4 } from 'uuid'
import { isValidUrl, isValidEmail } from '../lib/validation'
import { isClientOwner } from '../lib/ownership'
import { backfillIntegration } from '../jobs/adCosts/run'
import { generateRandomToken } from '../lib/auth'
import { findUtmMismatches } from '../lib/utmMismatch'

const NICHES = ['ecommerce', 'call', 'lead_gen', 'saas', 'info_product', 'other']
const CLIENT_NAME_MAX_LENGTH = 200

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

// Keys GET /clients/:id/integrations strips before ever sending config back to the
// browser (see that route below) — the edit form can't pre-fill what it never
// received, so it submits these blank on an edit that only touches an unrelated
// field (e.g. changing an ad account's currency). Without this, that blank would
// overwrite — and silently destroy — the real saved secret. Falls back to whatever
// is already stored whenever the incoming value is blank; a real, non-blank value
// always wins, so actually replacing a secret still works exactly as before.
const SECRET_KEYS = new Set([
  'webhook_secret',
  'access_token',
  'refresh_token',
  'client_secret',
  'signature_key',
  'auth_token',
  'api_key',
  'service_account_key',
])

async function resolveIntegrationFields(
  clientId: string,
  platform: string,
  incoming: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const hasBlankSecret = Object.entries(incoming).some(
    ([key, value]) => SECRET_KEYS.has(key) && (value === undefined || value === '')
  )
  if (!hasBlankSecret) return incoming

  const { rows } = await db.query(`SELECT config FROM client_integrations WHERE client_id = $1 AND platform = $2`, [
    clientId,
    platform,
  ])
  const existing: Record<string, unknown> = rows[0]?.config ?? {}

  const resolved: Record<string, unknown> = { ...incoming }
  for (const [key, value] of Object.entries(incoming)) {
    if (SECRET_KEYS.has(key) && (value === undefined || value === '') && existing[key]) {
      resolved[key] = existing[key]
    }
  }
  return resolved
}

export async function clientRoutes(app: FastifyInstance) {
  // Create a new client
  app.post<{
    Body: { name: string; timezone?: string; niche?: string }
  }>('/clients', async (req, reply) => {
    const { name, timezone = 'America/New_York', niche = 'other' } = req.body
    if (!name) return reply.code(400).send({ error: 'name required' })
    if (name.length > CLIENT_NAME_MAX_LENGTH) {
      return reply.code(400).send({ error: `name must be ${CLIENT_NAME_MAX_LENGTH} characters or fewer` })
    }
    if (!NICHES.includes(niche)) {
      return reply.code(400).send({ error: `niche must be one of: ${NICHES.join(', ')}` })
    }

    const pixelKey = uuidv4()
    const { rows } = await db.query(
      `INSERT INTO clients (name, pixel_key, timezone, niche, owner_user_id) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [name, pixelKey, timezone, niche, req.userId]
    )
    return reply.code(201).send(rows[0])
  })

  // List every client this user can access — either owned outright, or shared with
  // them via client_collaborators (migration 028). Every other user's clients (and
  // clients not shared with this one) stay invisible here, not just inaccessible by
  // direct id. is_owner tells the dashboard whether to show owner-only controls
  // (collaborator management, delete) for that client.
  app.get('/clients', async (req, reply) => {
    const { rows } = await db.query(
      `SELECT id, name, pixel_key, timezone, niche, created_at, (owner_user_id = $1) AS is_owner
       FROM clients
       WHERE owner_user_id = $1 OR id IN (SELECT client_id FROM client_collaborators WHERE user_id = $1)
       ORDER BY created_at DESC`,
      [req.userId]
    )
    return reply.send(rows)
  })

  // Get a single client
  app.get<{ Params: { id: string } }>('/clients/:id', async (req, reply) => {
    const { rows } = await db.query('SELECT *, (owner_user_id = $2) AS is_owner FROM clients WHERE id = $1', [
      req.params.id,
      req.userId,
    ])
    if (rows.length === 0) return reply.code(404).send({ error: 'Not found' })
    return reply.send(rows[0])
  })

  // Rename a client. Deliberately separate from the niche/attribution-model PATCHes
  // above rather than one combined PATCH — each already has its own validation and
  // this keeps a bad niche value from ever blocking a plain rename.
  app.patch<{
    Params: { id: string }
    Body: { name: string }
  }>('/clients/:id', async (req, reply) => {
    const { id } = req.params
    const { name } = req.body
    if (!name || !name.trim()) return reply.code(400).send({ error: 'name required' })
    if (name.trim().length > CLIENT_NAME_MAX_LENGTH) {
      return reply.code(400).send({ error: `name must be ${CLIENT_NAME_MAX_LENGTH} characters or fewer` })
    }

    const { rows } = await db.query('UPDATE clients SET name = $1 WHERE id = $2 RETURNING *', [name.trim(), id])
    if (rows.length === 0) return reply.code(404).send({ error: 'Not found' })
    return reply.send(rows[0])
  })

  // Delete a client. Owner-only — a collaborator has full access to a client's data
  // (see hasClientAccess in lib/ownership.ts) but can't destroy the client itself,
  // same restriction as managing who else has access (see the collaborators routes
  // below). Every table referencing clients(id) does so with ON DELETE CASCADE
  // (verified across every migration), so the DELETE statement itself is sufficient —
  // no manual cleanup of sessions/leads/purchases/etc. needed.
  app.delete<{ Params: { id: string } }>('/clients/:id', async (req, reply) => {
    const { id } = req.params
    if (!(await isClientOwner(id, req.userId!))) {
      return reply.code(403).send({ error: 'Only the owner can delete this client' })
    }
    const { rows } = await db.query('DELETE FROM clients WHERE id = $1 RETURNING id', [id])
    if (rows.length === 0) return reply.code(404).send({ error: 'Not found' })
    return reply.code(204).send()
  })

  // Change a client's attribution model (first_click / last_click / linear)
  app.patch<{
    Params: { id: string }
    Body: { attribution_model: string }
  }>('/clients/:id/attribution-model', async (req, reply) => {
    const { id } = req.params
    const { attribution_model } = req.body

    const VALID_ATTRIBUTION_MODELS = ['first_click', 'last_click', 'linear', 'time_decay', 'u_shaped']
    if (!VALID_ATTRIBUTION_MODELS.includes(attribution_model)) {
      return reply.code(400).send({ error: `attribution_model must be one of: ${VALID_ATTRIBUTION_MODELS.join(', ')}` })
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

  // Set the true-profit margin assumptions (Step 31) — cogs_percent/payment_fee_percent
  // are % of revenue, fulfillment_cost_flat is a flat $ per order. Any field omitted
  // from the body clears back to NULL (0 impact), not left unchanged, so unchecking a
  // field in the Settings form actually removes it rather than silently sticking.
  app.patch<{
    Params: { id: string }
    Body: { cogs_percent?: number | null; payment_fee_percent?: number | null; fulfillment_cost_flat?: number | null }
  }>('/clients/:id/margin', async (req, reply) => {
    const { id } = req.params
    const { cogs_percent = null, payment_fee_percent = null, fulfillment_cost_flat = null } = req.body

    for (const [key, value] of Object.entries({ cogs_percent, payment_fee_percent, fulfillment_cost_flat })) {
      if (value !== null && (typeof value !== 'number' || isNaN(value) || value < 0)) {
        return reply.code(400).send({ error: `${key} must be a non-negative number or null` })
      }
    }

    const { rows } = await db.query(
      `UPDATE clients SET cogs_percent = $1, payment_fee_percent = $2, fulfillment_cost_flat = $3 WHERE id = $4 RETURNING *`,
      [cogs_percent, payment_fee_percent, fulfillment_cost_flat, id]
    )
    if (rows.length === 0) return reply.code(404).send({ error: 'Not found' })
    return reply.send(rows[0])
  })

  // Generate (or regenerate, revoking the old one) a public share link — Step 40.
  // Regenerating is the deliberate revoke mechanism (matches the user's own
  // explicit choice of a link over a client-role login): the old token stops
  // resolving the instant a new one overwrites it.
  app.post<{ Params: { id: string } }>('/clients/:id/share-link', async (req, reply) => {
    const token = generateRandomToken()
    const { rows } = await db.query('UPDATE clients SET public_share_token = $1 WHERE id = $2 RETURNING *', [
      token,
      req.params.id,
    ])
    if (rows.length === 0) return reply.code(404).send({ error: 'Not found' })
    return reply.send(rows[0])
  })

  // Revoke without generating a replacement.
  app.delete<{ Params: { id: string } }>('/clients/:id/share-link', async (req, reply) => {
    const { rows } = await db.query('UPDATE clients SET public_share_token = NULL WHERE id = $1 RETURNING *', [
      req.params.id,
    ])
    if (rows.length === 0) return reply.code(404).send({ error: 'Not found' })
    return reply.send(rows[0])
  })

  // Step 41 — likely-typo UTM naming mismatches (session utm_campaign vs. ad
  // platform campaign_name), distinct from the funnel breakdown's existing
  // exact-match "matched" flag — this tries to explain WHY a row is unmatched
  // when it's plausibly a typo, not just that it is.
  app.get<{ Params: { id: string } }>('/clients/:id/utm-mismatches', async (req, reply) => {
    return reply.send(await findUtmMismatches(req.params.id))
  })

  // Step 48 — the client's reporting/base currency. A short ISO 4217 code check
  // (3 uppercase letters), not a real currency-list validation — good enough to
  // catch a typo without maintaining a hardcoded list.
  app.patch<{ Params: { id: string }; Body: { currency: string } }>('/clients/:id/currency', async (req, reply) => {
    const { id } = req.params
    const currency = req.body.currency?.toUpperCase()
    if (!currency || !/^[A-Z]{3}$/.test(currency)) {
      return reply.code(400).send({ error: 'currency must be a 3-letter ISO code (e.g. USD, EUR, GBP)' })
    }
    const { rows } = await db.query('UPDATE clients SET currency = $1 WHERE id = $2 RETURNING *', [currency, id])
    if (rows.length === 0) return reply.code(404).send({ error: 'Not found' })
    return reply.send(rows[0])
  })

  // Step 57 — opt-in periodic (weekly/monthly) report email, sent to the owning
  // user's email by the scheduler. 'none' turns it back off.
  app.patch<{ Params: { id: string }; Body: { report_schedule_frequency: string } }>(
    '/clients/:id/report-schedule',
    async (req, reply) => {
      const { id } = req.params
      const frequency = req.body.report_schedule_frequency
      if (!['none', 'weekly', 'monthly'].includes(frequency)) {
        return reply.code(400).send({ error: 'report_schedule_frequency must be one of: none, weekly, monthly' })
      }
      const { rows } = await db.query('UPDATE clients SET report_schedule_frequency = $1 WHERE id = $2 RETURNING *', [
        frequency,
        id,
      ])
      if (rows.length === 0) return reply.code(404).send({ error: 'Not found' })
      return reply.send(rows[0])
    }
  )

  // Step 58 — white-label branding for the public share link. Both fields are
  // nullable/clearable (send null to remove) so an agency can revert to this
  // app's own default branding at any time.
  app.patch<{
    Params: { id: string }
    Body: { brand_logo_url?: string | null; brand_accent_color?: string | null }
  }>('/clients/:id/branding', async (req, reply) => {
    const { id } = req.params
    const { brand_logo_url = null, brand_accent_color = null } = req.body

    if (brand_logo_url !== null && !isValidUrl(brand_logo_url)) {
      return reply.code(400).send({ error: 'brand_logo_url must be a valid http(s) URL' })
    }
    if (brand_accent_color !== null && !/^#[0-9a-fA-F]{6}$/.test(brand_accent_color)) {
      return reply.code(400).send({ error: 'brand_accent_color must be a 6-digit hex color (e.g. #3987e5)' })
    }

    const { rows } = await db.query(
      'UPDATE clients SET brand_logo_url = $1, brand_accent_color = $2 WHERE id = $3 RETURNING *',
      [brand_logo_url, brand_accent_color, id]
    )
    if (rows.length === 0) return reply.code(404).send({ error: 'Not found' })
    return reply.send(rows[0])
  })

  // Step 43 — account-wide monthly ad-spend budget target, used by the budget
  // pacing report. null clears it back to "no target set."
  app.patch<{
    Params: { id: string }
    Body: { monthly_budget_target: number | null }
  }>('/clients/:id/budget-target', async (req, reply) => {
    const { id } = req.params
    const { monthly_budget_target = null } = req.body
    if (monthly_budget_target !== null && (typeof monthly_budget_target !== 'number' || isNaN(monthly_budget_target) || monthly_budget_target < 0)) {
      return reply.code(400).send({ error: 'monthly_budget_target must be a non-negative number or null' })
    }
    const { rows } = await db.query('UPDATE clients SET monthly_budget_target = $1 WHERE id = $2 RETURNING *', [
      monthly_budget_target,
      id,
    ])
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
    const fields = await resolveIntegrationFields(id, 'shopify', {
      webhook_secret: req.body.webhook_secret,
      shop_domain: req.body.shop_domain,
    })

    if (!fields.webhook_secret || !fields.shop_domain) {
      return reply.code(400).send({ error: 'webhook_secret and shop_domain required' })
    }

    return reply.code(200).send(await upsertIntegration(id, 'shopify', fields))
  })

  // Save or update a Stripe integration for a client
  app.post<{
    Params: { id: string }
    Body: {
      webhook_secret: string
    }
  }>('/clients/:id/integrations/stripe', async (req, reply) => {
    const { id } = req.params
    const fields = await resolveIntegrationFields(id, 'stripe', { webhook_secret: req.body.webhook_secret })

    if (!fields.webhook_secret) {
      return reply.code(400).send({ error: 'webhook_secret required' })
    }

    return reply.code(200).send(await upsertIntegration(id, 'stripe', fields))
  })

  // Save or update a Facebook Ads integration for a client
  app.post<{
    Params: { id: string }
    Body: {
      access_token: string
      ad_account_id: string
      currency?: string
    }
  }>('/clients/:id/integrations/facebook-ads', async (req, reply) => {
    const { id } = req.params
    const { access_token, ad_account_id, currency } = req.body
    const fields = await resolveIntegrationFields(id, 'facebook_ads', {
      access_token,
      ad_account_id,
      currency: currency?.toUpperCase(),
    })

    if (!fields.access_token || !fields.ad_account_id) {
      return reply.code(400).send({ error: 'access_token and ad_account_id required' })
    }

    const saved = await upsertIntegration(id, 'facebook_ads', fields)
    backfillIntegration(id, 'facebook_ads', saved.config)
    return reply.code(200).send(saved)
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
      currency?: string
    }
  }>('/clients/:id/integrations/google-ads', async (req, reply) => {
    const { id } = req.params
    const { customer_id, login_customer_id, refresh_token, conversion_action_purchase, conversion_action_lead, currency } =
      req.body
    const fields = await resolveIntegrationFields(id, 'google_ads', {
      customer_id,
      login_customer_id,
      refresh_token,
      conversion_action_purchase,
      conversion_action_lead,
      currency: currency?.toUpperCase(),
    })

    if (!fields.customer_id) {
      return reply.code(400).send({ error: 'customer_id required' })
    }

    const saved = await upsertIntegration(id, 'google_ads', fields)
    backfillIntegration(id, 'google_ads', saved.config)
    return reply.code(200).send(saved)
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
    const fields = await resolveIntegrationFields(id, 'facebook_capi', {
      pixel_id: req.body.pixel_id,
      access_token: req.body.access_token,
    })

    if (!fields.pixel_id || !fields.access_token) {
      return reply.code(400).send({ error: 'pixel_id and access_token required' })
    }

    return reply.code(200).send(await upsertIntegration(id, 'facebook_capi', fields))
  })

  // Save or update a Bing/Microsoft Advertising integration for a client — Step 11.
  // Same shape as Google Ads: shared app credentials (BING_ADS_CLIENT_ID/SECRET/
  // DEVELOPER_TOKEN) in .env, per-client customer_id/account_id/refresh_token here.
  app.post<{
    Params: { id: string }
    Body: { customer_id: string; account_id: string; refresh_token: string; currency?: string }
  }>('/clients/:id/integrations/bing-ads', async (req, reply) => {
    const { id } = req.params
    const { customer_id, account_id, refresh_token, currency } = req.body
    const fields = await resolveIntegrationFields(id, 'bing_ads', {
      customer_id,
      account_id,
      refresh_token,
      currency: currency?.toUpperCase(),
    })
    if (!fields.customer_id || !fields.account_id || !fields.refresh_token) {
      return reply.code(400).send({ error: 'customer_id, account_id, and refresh_token required' })
    }
    const saved = await upsertIntegration(id, 'bing_ads', fields)
    backfillIntegration(id, 'bing_ads', saved.config)
    return reply.code(200).send(saved)
  })

  // Save or update a Twilio integration for a client — Step 11 call tracking.
  // Just the auth token for webhook signature verification; the account itself
  // (and any purchased numbers) lives entirely in the client's own Twilio account.
  app.post<{
    Params: { id: string }
    Body: { account_sid: string; auth_token: string; voice_intelligence_service_sid?: string }
  }>('/clients/:id/integrations/twilio', async (req, reply) => {
    const { id } = req.params
    const { account_sid, auth_token, voice_intelligence_service_sid } = req.body
    const fields = await resolveIntegrationFields(id, 'twilio', { account_sid, auth_token, voice_intelligence_service_sid })
    if (!fields.account_sid || !fields.auth_token) {
      return reply.code(400).send({ error: 'account_sid and auth_token required' })
    }
    return reply.code(200).send(await upsertIntegration(id, 'twilio', fields))
  })

  // Alert delivery config (Step 32) — any subset of Slack/email/SMS. SMS reuses
  // this client's own Twilio integration + one of its registered tracking numbers
  // (see lib/alerts.ts), so no separate SMS credential lives here.
  app.post<{
    Params: { id: string }
    Body: { slack_webhook_url?: string; alert_email?: string; alert_phone?: string }
  }>('/clients/:id/integrations/alerts', async (req, reply) => {
    const { id } = req.params
    const { slack_webhook_url, alert_email, alert_phone } = req.body
    if (!slack_webhook_url && !alert_email && !alert_phone) {
      return reply.code(400).send({ error: 'at least one of slack_webhook_url, alert_email, alert_phone required' })
    }
    if (alert_email && !isValidEmail(alert_email)) {
      return reply.code(400).send({ error: 'alert_email must be a valid email' })
    }
    if (slack_webhook_url && !isValidUrl(slack_webhook_url)) {
      return reply.code(400).send({ error: 'slack_webhook_url must be a valid URL' })
    }
    return reply
      .code(200)
      .send(await upsertIntegration(id, 'alerts', { slack_webhook_url, alert_email, alert_phone }))
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
    const fields = await resolveIntegrationFields(id, 'paypal', { client_id, client_secret, webhook_id, sandbox })
    if (!fields.client_id || !fields.client_secret || !fields.webhook_id) {
      return reply.code(400).send({ error: 'client_id, client_secret, and webhook_id required' })
    }
    return reply.code(200).send(await upsertIntegration(id, 'paypal', fields))
  })

  // Save or update a Square integration — Step 9.
  app.post<{
    Params: { id: string }
    Body: { signature_key: string; notification_url: string }
  }>('/clients/:id/integrations/square', async (req, reply) => {
    const { id } = req.params
    const { signature_key, notification_url } = req.body
    const fields = await resolveIntegrationFields(id, 'square', { signature_key, notification_url })
    if (!fields.signature_key || !fields.notification_url) {
      return reply.code(400).send({ error: 'signature_key and notification_url required' })
    }
    if (typeof fields.notification_url !== 'string' || !isValidUrl(fields.notification_url)) {
      return reply.code(400).send({ error: 'notification_url must be a valid http(s) URL' })
    }
    return reply.code(200).send(await upsertIntegration(id, 'square', fields))
  })

  // Save or update a GoHighLevel integration — Step 9. See routes/webhooks/gohighlevel.ts
  // for why this is a shared secret rather than a real signature.
  app.post<{
    Params: { id: string }
    Body: { webhook_secret: string }
  }>('/clients/:id/integrations/gohighlevel', async (req, reply) => {
    const { id } = req.params
    const fields = await resolveIntegrationFields(id, 'gohighlevel', { webhook_secret: req.body.webhook_secret })
    if (!fields.webhook_secret) {
      return reply.code(400).send({ error: 'webhook_secret required' })
    }
    return reply.code(200).send(await upsertIntegration(id, 'gohighlevel', fields))
  })

  // Save or update a TikTok Ads integration — Step 16 (signals) / Step 19 (cost sync)
  // share this same client_integrations row, unlike Facebook's split facebook_ads/
  // facebook_capi — TikTok's Events API and Marketing API use the same access token.
  app.post<{
    Params: { id: string }
    Body: { access_token: string; advertiser_id: string; pixel_code: string; currency?: string }
  }>('/clients/:id/integrations/tiktok-ads', async (req, reply) => {
    const { id } = req.params
    const { access_token, advertiser_id, pixel_code, currency } = req.body
    const fields = await resolveIntegrationFields(id, 'tiktok_ads', {
      access_token,
      advertiser_id,
      pixel_code,
      currency: currency?.toUpperCase(),
    })
    if (!fields.access_token || !fields.advertiser_id || !fields.pixel_code) {
      return reply.code(400).send({ error: 'access_token, advertiser_id, and pixel_code required' })
    }
    const saved = await upsertIntegration(id, 'tiktok_ads', fields)
    backfillIntegration(id, 'tiktok_ads', saved.config)
    return reply.code(200).send(saved)
  })

  // Save or update a Snapchat Ads integration — Step 16 (signals) / Step 19 (cost sync).
  app.post<{
    Params: { id: string }
    Body: { access_token: string; pixel_id: string; ad_account_id: string; currency?: string }
  }>('/clients/:id/integrations/snapchat-ads', async (req, reply) => {
    const { id } = req.params
    const { access_token, pixel_id, ad_account_id, currency } = req.body
    const fields = await resolveIntegrationFields(id, 'snapchat_ads', {
      access_token,
      pixel_id,
      ad_account_id,
      currency: currency?.toUpperCase(),
    })
    if (!fields.access_token || !fields.pixel_id || !fields.ad_account_id) {
      return reply.code(400).send({ error: 'access_token, pixel_id, and ad_account_id required' })
    }
    const saved = await upsertIntegration(id, 'snapchat_ads', fields)
    backfillIntegration(id, 'snapchat_ads', saved.config)
    return reply.code(200).send(saved)
  })

  // Save or update a Pinterest Ads integration — Step 17 (signals) / Step 19 (cost sync).
  app.post<{
    Params: { id: string }
    Body: { access_token: string; ad_account_id: string; currency?: string }
  }>('/clients/:id/integrations/pinterest-ads', async (req, reply) => {
    const { id } = req.params
    const { access_token, ad_account_id, currency } = req.body
    const fields = await resolveIntegrationFields(id, 'pinterest_ads', {
      access_token,
      ad_account_id,
      currency: currency?.toUpperCase(),
    })
    if (!fields.access_token || !fields.ad_account_id) {
      return reply.code(400).send({ error: 'access_token and ad_account_id required' })
    }
    const saved = await upsertIntegration(id, 'pinterest_ads', fields)
    backfillIntegration(id, 'pinterest_ads', saved.config)
    return reply.code(200).send(saved)
  })

  // Save or update a LinkedIn Ads integration — Step 17 (signals, conversion_id_*)
  // and Step 20 (cost sync, account_id). conversion_id_purchase/lead are LinkedIn
  // Campaign Manager "conversion" object ids, optional until created (mirrors
  // Google Ads' conversion_action_purchase/lead — same reason: conversion-matching,
  // not a general funnel-stage vocabulary). account_id is the sponsored ad account
  // id cost-sync reports against — optional until Step 20 needs it.
  app.post<{
    Params: { id: string }
    Body: {
      access_token: string
      account_id?: string
      conversion_id_purchase?: string
      conversion_id_lead?: string
      currency?: string
    }
  }>('/clients/:id/integrations/linkedin-ads', async (req, reply) => {
    const { id } = req.params
    const { access_token, account_id, conversion_id_purchase, conversion_id_lead, currency } = req.body
    const fields = await resolveIntegrationFields(id, 'linkedin_ads', {
      access_token,
      account_id,
      currency: currency?.toUpperCase(),
      conversion_id_purchase,
      conversion_id_lead,
    })
    if (!fields.access_token) {
      return reply.code(400).send({ error: 'access_token required' })
    }
    const saved = await upsertIntegration(id, 'linkedin_ads', fields)
    backfillIntegration(id, 'linkedin_ads', saved.config)
    return reply.code(200).send(saved)
  })

  // Save or update a Reddit Ads integration — Step 17 (signals) / Step 20 (cost sync).
  app.post<{
    Params: { id: string }
    Body: { access_token: string; account_id: string; currency?: string }
  }>('/clients/:id/integrations/reddit-ads', async (req, reply) => {
    const { id } = req.params
    const { access_token, account_id, currency } = req.body
    const fields = await resolveIntegrationFields(id, 'reddit_ads', { access_token, account_id, currency: currency?.toUpperCase() })
    if (!fields.access_token || !fields.account_id) {
      return reply.code(400).send({ error: 'access_token and account_id required' })
    }
    const saved = await upsertIntegration(id, 'reddit_ads', fields)
    backfillIntegration(id, 'reddit_ads', saved.config)
    return reply.code(200).send(saved)
  })

  // Save or update a Customers.ai integration — Step 12. See routes/webhooks/customersAi.ts
  // for why this is a shared secret rather than a real signature (same reason as GoHighLevel).
  app.post<{
    Params: { id: string }
    Body: { webhook_secret: string }
  }>('/clients/:id/integrations/customers-ai', async (req, reply) => {
    const { id } = req.params
    const fields = await resolveIntegrationFields(id, 'customers_ai', { webhook_secret: req.body.webhook_secret })
    if (!fields.webhook_secret) {
      return reply.code(400).send({ error: 'webhook_secret required' })
    }
    return reply.code(200).send(await upsertIntegration(id, 'customers_ai', fields))
  })

  // Save or update a BigQuery warehouse-export integration — Step 44. The dataset
  // itself must already exist in the client's own GCP project (this app never
  // provisions GCP resources), created by whoever set up the service account.
  app.post<{
    Params: { id: string }
    Body: { project_id: string; dataset_id: string; service_account_key: string }
  }>('/clients/:id/integrations/bigquery', async (req, reply) => {
    const { id } = req.params
    const { project_id, dataset_id, service_account_key } = req.body
    const fields = await resolveIntegrationFields(id, 'bigquery', { project_id, dataset_id, service_account_key })
    if (!fields.project_id || !fields.dataset_id || typeof fields.service_account_key !== 'string') {
      return reply.code(400).send({ error: 'project_id, dataset_id, and service_account_key required' })
    }
    try {
      JSON.parse(fields.service_account_key)
    } catch {
      return reply.code(400).send({ error: 'service_account_key must be valid JSON (the full key file contents)' })
    }
    return reply.code(200).send(await upsertIntegration(id, 'bigquery', fields))
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
    const fields = await resolveIntegrationFields(id, 'klaviyo', { api_key, list_id })
    if (!fields.api_key || !fields.list_id) {
      return reply.code(400).send({ error: 'api_key and list_id required' })
    }
    return reply.code(200).send(await upsertIntegration(id, 'klaviyo', fields))
  })

  // Step 15 — manual identity-link override. Not upsertIntegration() — identity
  // links aren't a client_integrations row, they're a dedicated many-to-many table.
  app.post<{
    Params: { id: string }
    Body: { primary_email: string; linked_email: string }
  }>('/clients/:id/identity-links', async (req, reply) => {
    const { id } = req.params
    const primaryEmail = req.body.primary_email?.toLowerCase().trim()
    const linkedEmail = req.body.linked_email?.toLowerCase().trim()
    if (!primaryEmail || !linkedEmail) {
      return reply.code(400).send({ error: 'primary_email and linked_email required' })
    }
    if (primaryEmail === linkedEmail) {
      return reply.code(400).send({ error: 'Cannot link an identity to itself' })
    }

    // Manual linking is by email — the same identifier every other feature in this
    // app uses (tags, journey, custom costs) — rather than exposing raw identity
    // UUIDs, which no dashboard user would ever have on hand.
    const { rows: identityRows } = await db.query<{ id: string; email: string }>(
      `SELECT id, email FROM identities WHERE client_id = $1 AND email IN ($2, $3)`,
      [id, primaryEmail, linkedEmail]
    )
    const primaryIdentity = identityRows.find((r) => r.email === primaryEmail)
    const linkedIdentity = identityRows.find((r) => r.email === linkedEmail)
    if (!primaryIdentity || !linkedIdentity) {
      const missing = [!primaryIdentity && primaryEmail, !linkedIdentity && linkedEmail].filter(Boolean)
      return reply.code(404).send({ error: `No identity found for: ${missing.join(', ')}` })
    }

    const [a, b] = [primaryIdentity.id, linkedIdentity.id].sort()
    const { rows } = await db.query(
      `INSERT INTO identity_links (client_id, primary_identity_id, linked_identity_id, mechanism, confidence)
       VALUES ($1, $2, $3, 'manual', 1.0)
       ON CONFLICT (client_id, primary_identity_id, linked_identity_id, mechanism) DO NOTHING
       RETURNING *`,
      [id, a, b]
    )
    const link = rows[0]
    return reply.code(200).send(link ? { ...link, confidence: parseFloat(link.confidence) } : { message: 'Link already exists' })
  })

  app.get<{ Params: { id: string } }>('/clients/:id/identity-links', async (req, reply) => {
    const { rows } = await db.query<{ confidence: string }>(
      `SELECT l.*, pi.email AS primary_email, li.email AS linked_email
       FROM identity_links l
       JOIN identities pi ON pi.id = l.primary_identity_id
       JOIN identities li ON li.id = l.linked_identity_id
       WHERE l.client_id = $1
       ORDER BY l.created_at DESC`,
      [req.params.id]
    )
    // confidence is NUMERIC in Postgres, which node-postgres returns as a string —
    // every other report route in this app parses it before responding.
    return reply.send(rows.map((r) => ({ ...r, confidence: parseFloat(r.confidence) })))
  })

  // Step 29 — outbound webhook subscriptions. Dedicated CRUD, not upsertIntegration()
  // — a client can want multiple target URLs with different event filters, a real
  // one-to-many shape client_integrations' one-row-per-platform design doesn't fit.
  app.post<{
    Params: { id: string }
    Body: { target_url: string; event_types: string[] }
  }>('/clients/:id/webhook-subscriptions', async (req, reply) => {
    const { id } = req.params
    const { target_url, event_types } = req.body
    if (!target_url || !Array.isArray(event_types) || event_types.length === 0) {
      return reply.code(400).send({ error: 'target_url and a non-empty event_types array required' })
    }
    if (!isValidUrl(target_url)) {
      return reply.code(400).send({ error: 'target_url must be a valid http(s) URL' })
    }
    const validEvents = ['sale.attributed', 'lead.opted.in', 'call.qualified']
    const invalid = event_types.filter((e) => !validEvents.includes(e))
    if (invalid.length > 0) {
      return reply.code(400).send({ error: `Invalid event_types: ${invalid.join(', ')}. Valid: ${validEvents.join(', ')}` })
    }
    const signingSecret = uuidv4()
    const { rows } = await db.query(
      `INSERT INTO outbound_webhook_subscriptions (client_id, target_url, event_types, signing_secret)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [id, target_url, event_types, signingSecret]
    )
    return reply.code(201).send(rows[0])
  })

  app.get<{ Params: { id: string } }>('/clients/:id/webhook-subscriptions', async (req, reply) => {
    const { rows } = await db.query(
      `SELECT id, client_id, target_url, event_types, active, created_at
       FROM outbound_webhook_subscriptions WHERE client_id = $1 ORDER BY created_at DESC`,
      [req.params.id]
    )
    return reply.send(rows)
  })

  app.delete<{ Params: { subId: string } }>('/webhook-subscriptions/:subId', async (req, reply) => {
    const { rows } = await db.query('DELETE FROM outbound_webhook_subscriptions WHERE id = $1 RETURNING id', [
      req.params.subId,
    ])
    if (rows.length === 0) return reply.code(404).send({ error: 'Not found' })
    return reply.code(204).send()
  })

  // Generate (or rotate) the shared secret an external CRM/Zapier zap needs to call
  // POST /webhooks/tags/:client_id. Server-generated rather than user-typed, like
  // pixel_key — returned once in full here; every other read of this integration
  // (GET /clients/:id/integrations) redacts it same as every other webhook_secret.
  app.post<{ Params: { id: string } }>('/clients/:id/integrations/tag-webhook/generate', async (req, reply) => {
    const webhookSecret = uuidv4()
    const integration = await upsertIntegration(req.params.id, 'tag_webhook', { webhook_secret: webhookSecret })
    return reply.code(200).send(integration)
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

  // Client sharing (migration 028) — a collaborator gets the exact same data access
  // as the owner (see hasClientAccess in lib/ownership.ts, which the generic 'client'
  // resolver already applies to every route below this file's own DELETE and these
  // three). Anyone with access can see who else has it; only the owner can change it.
  // Sharing is by email, same identifier every other feature in this app uses — and
  // since self-registration is gone, that email must already belong to a login
  // someone created via `npm run create:user`.
  app.get<{ Params: { id: string } }>('/clients/:id/collaborators', async (req, reply) => {
    const { rows } = await db.query(
      `SELECT u.id AS user_id, u.email, u.agency_name, cc.added_at
       FROM client_collaborators cc
       JOIN users u ON u.id = cc.user_id
       WHERE cc.client_id = $1
       ORDER BY cc.added_at ASC`,
      [req.params.id]
    )
    return reply.send(rows)
  })

  app.post<{ Params: { id: string }; Body: { email: string } }>('/clients/:id/collaborators', async (req, reply) => {
    const { id } = req.params
    if (!(await isClientOwner(id, req.userId!))) {
      return reply.code(403).send({ error: 'Only the owner can add collaborators' })
    }
    const email = req.body.email?.toLowerCase().trim()
    if (!email || !isValidEmail(email)) {
      return reply.code(400).send({ error: 'A valid email is required' })
    }

    const { rows: userRows } = await db.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [email])
    if (userRows.length === 0) {
      return reply.code(404).send({
        error: `No account exists for ${email}. Create one first with npm run create:user, then share this client with it`,
      })
    }
    const collaboratorId = userRows[0].id
    if (collaboratorId === req.userId) {
      return reply.code(400).send({ error: 'You already own this client' })
    }

    await db.query(
      `INSERT INTO client_collaborators (client_id, user_id) VALUES ($1, $2)
       ON CONFLICT (client_id, user_id) DO NOTHING`,
      [id, collaboratorId]
    )
    return reply.code(201).send({ user_id: collaboratorId, email })
  })

  app.delete<{ Params: { id: string; userId: string } }>('/clients/:id/collaborators/:userId', async (req, reply) => {
    const { id, userId } = req.params
    if (!(await isClientOwner(id, req.userId!))) {
      return reply.code(403).send({ error: 'Only the owner can remove collaborators' })
    }
    await db.query('DELETE FROM client_collaborators WHERE client_id = $1 AND user_id = $2', [id, userId])
    return reply.code(204).send()
  })
}
