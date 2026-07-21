import { FastifyInstance } from 'fastify'
import { db } from '../db'
import {
  resolveSegmentEmails,
  syncToFacebookCustomAudience,
  syncToGoogleCustomerMatch,
  SegmentDefinition,
} from '../lib/audienceSync'

interface FacebookAdsConfig {
  access_token: string
  ad_account_id: string
}

interface GoogleAdsConfig {
  customer_id: string
  login_customer_id?: string
  refresh_token?: string
}

async function runSync(syncId: string): Promise<void> {
  const { rows } = await db.query<{
    id: string
    client_id: string
    platform: 'facebook_custom_audience' | 'google_customer_match'
    name: string
    segment_definition: SegmentDefinition
    external_audience_id: string | null
  }>(`SELECT * FROM audience_syncs WHERE id = $1`, [syncId])
  const sync = rows[0]
  if (!sync) throw new Error('Sync not found')

  const emails = await resolveSegmentEmails(sync.client_id, sync.segment_definition)

  try {
    let result: { externalAudienceId: string; count: number }
    if (sync.platform === 'facebook_custom_audience') {
      const { rows: intRows } = await db.query<{ config: FacebookAdsConfig }>(
        `SELECT config FROM client_integrations WHERE client_id = $1 AND platform = 'facebook_ads'`,
        [sync.client_id]
      )
      const config = intRows[0]?.config
      if (!config?.access_token || !config?.ad_account_id) throw new Error('No Facebook Ads integration configured')
      result = await syncToFacebookCustomAudience(config, sync.name, sync.external_audience_id, emails)
    } else {
      const { rows: intRows } = await db.query<{ config: GoogleAdsConfig }>(
        `SELECT config FROM client_integrations WHERE client_id = $1 AND platform = 'google_ads'`,
        [sync.client_id]
      )
      const config = intRows[0]?.config
      if (!config?.customer_id) throw new Error('No Google Ads integration configured')
      result = await syncToGoogleCustomerMatch(config, sync.name, sync.external_audience_id, emails)
    }

    await db.query(
      `UPDATE audience_syncs
       SET external_audience_id = $1, last_synced_at = NOW(), last_sync_count = $2, last_sync_error = NULL
       WHERE id = $3`,
      [result.externalAudienceId, result.count, syncId]
    )
  } catch (err) {
    await db.query(`UPDATE audience_syncs SET last_synced_at = NOW(), last_sync_error = $1 WHERE id = $2`, [
      (err as Error).message,
      syncId,
    ])
    throw err
  }
}

export async function audienceSyncRoutes(app: FastifyInstance) {
  app.post<{
    Params: { id: string }
    Body: { platform: string; name: string; segment_definition: SegmentDefinition }
  }>('/clients/:id/audience-syncs', async (req, reply) => {
    const { id } = req.params
    const { platform, name, segment_definition } = req.body
    if (!platform || !name || !segment_definition?.type) {
      return reply.code(400).send({ error: 'platform, name, and segment_definition.type required' })
    }
    if (!['facebook_custom_audience', 'google_customer_match'].includes(platform)) {
      return reply.code(400).send({ error: 'platform must be facebook_custom_audience or google_customer_match' })
    }
    const { rows } = await db.query(
      `INSERT INTO audience_syncs (client_id, platform, name, segment_definition) VALUES ($1, $2, $3, $4) RETURNING *`,
      [id, platform, name, JSON.stringify(segment_definition)]
    )
    return reply.code(201).send(rows[0])
  })

  app.get<{ Params: { id: string } }>('/clients/:id/audience-syncs', async (req, reply) => {
    const { rows } = await db.query(`SELECT * FROM audience_syncs WHERE client_id = $1 ORDER BY created_at DESC`, [
      req.params.id,
    ])
    return reply.send(rows)
  })

  app.post<{ Params: { syncId: string } }>('/audience-syncs/:syncId/run', async (req, reply) => {
    try {
      await runSync(req.params.syncId)
    } catch (err) {
      return reply.code(502).send({ error: (err as Error).message })
    }
    const { rows } = await db.query(`SELECT * FROM audience_syncs WHERE id = $1`, [req.params.syncId])
    return reply.send(rows[0])
  })
}

export { runSync }
