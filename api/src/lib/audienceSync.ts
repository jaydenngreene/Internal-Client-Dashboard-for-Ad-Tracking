import * as crypto from 'crypto'
import { db } from '../db'

export type SegmentType = 'all_customers' | 'ltv_above' | 'tag'

export interface SegmentDefinition {
  type: SegmentType
  threshold?: number
  tag_name?: string
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value.toLowerCase().trim()).digest('hex')
}

// Resolves a segment definition to the actual list of emails right now — segments
// are defined declaratively (not a frozen snapshot), so every sync re-evaluates
// against current data.
export async function resolveSegmentEmails(clientId: string, segment: SegmentDefinition): Promise<string[]> {
  if (segment.type === 'all_customers') {
    const { rows } = await db.query<{ email: string }>(`SELECT DISTINCT email FROM customer_ltv WHERE client_id = $1`, [
      clientId,
    ])
    return rows.map((r) => r.email)
  }

  if (segment.type === 'ltv_above') {
    const { rows } = await db.query<{ email: string }>(
      `SELECT email FROM customer_ltv WHERE client_id = $1 AND revenue_lifetime >= $2`,
      [clientId, segment.threshold ?? 0]
    )
    return rows.map((r) => r.email)
  }

  // 'tag'
  const { rows } = await db.query<{ email: string }>(
    `SELECT DISTINCT lt.email
     FROM lead_tags lt JOIN tags t ON t.id = lt.tag_id
     WHERE lt.client_id = $1 AND t.name = $2`,
    [clientId, segment.tag_name ?? '']
  )
  return rows.map((r) => r.email)
}

interface FacebookAudienceConfig {
  access_token: string
  ad_account_id: string
}

const FB_GRAPH_VERSION = process.env.FB_GRAPH_API_VERSION ?? 'v21.0'

// Creates the Custom Audience on first sync (stores the id for reuse), then always
// replaces its membership with the current segment resolution — simpler and more
// correct than trying to diff adds/removes each time, at the cost of a full
// re-upload every sync (fine for a nightly job at this scale).
export async function syncToFacebookCustomAudience(
  config: FacebookAudienceConfig,
  audienceName: string,
  existingAudienceId: string | null,
  emails: string[]
): Promise<{ externalAudienceId: string; count: number }> {
  const account = config.ad_account_id.startsWith('act_') ? config.ad_account_id : `act_${config.ad_account_id}`

  let audienceId = existingAudienceId
  if (!audienceId) {
    const res = await fetch(`https://graph.facebook.com/${FB_GRAPH_VERSION}/${account}/customaudiences`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: audienceName,
        subtype: 'CUSTOM',
        customer_file_source: 'USER_PROVIDED_ONLY',
        access_token: config.access_token,
      }),
    })
    if (!res.ok) throw new Error(`Facebook Custom Audience create failed (${res.status}): ${await res.text()}`)
    const body = (await res.json()) as { id: string }
    audienceId = body.id
  }

  const res = await fetch(`https://graph.facebook.com/${FB_GRAPH_VERSION}/${audienceId}/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      payload: { schema: ['EMAIL_SHA256'], data: emails.map((e) => [sha256(e)]) },
      access_token: config.access_token,
    }),
  })
  if (!res.ok) throw new Error(`Facebook Custom Audience upload failed (${res.status}): ${await res.text()}`)

  return { externalAudienceId: audienceId, count: emails.length }
}

interface GoogleCustomerMatchConfig {
  customer_id: string
  login_customer_id?: string
  refresh_token?: string
}

const GOOGLE_ADS_API_VERSION = 'v17'

// REST calls rather than the google-ads-api npm package here — Customer Match /
// OfflineUserDataJobs isn't one of the package's high-level wrapped resources the
// way conversionUploads is, so hand-rolled REST (same approach as Bing/TikTok/
// Snapchat/Pinterest/LinkedIn/Reddit elsewhere in this file's siblings) is safer
// than guessing at an unverified npm method surface. Unverified against a live
// account, same disclosure as those.
async function getGoogleAccessToken(refreshToken: string): Promise<string> {
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET
  if (!clientId || !clientSecret) throw new Error('GOOGLE_ADS_CLIENT_ID/SECRET must be set')

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  })
  if (!res.ok) throw new Error(`Google OAuth token request failed (${res.status})`)
  const data = (await res.json()) as { access_token: string }
  return data.access_token
}

function googleHeaders(token: string, config: GoogleCustomerMatchConfig): Record<string, string> {
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN
  if (!developerToken) throw new Error('GOOGLE_ADS_DEVELOPER_TOKEN must be set')
  const loginCustomerId = config.login_customer_id ?? process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'developer-token': developerToken,
    'Content-Type': 'application/json',
  }
  if (loginCustomerId) headers['login-customer-id'] = loginCustomerId
  return headers
}

export async function syncToGoogleCustomerMatch(
  config: GoogleCustomerMatchConfig,
  audienceName: string,
  existingAudienceId: string | null,
  emails: string[]
): Promise<{ externalAudienceId: string; count: number }> {
  const refreshToken = config.refresh_token ?? process.env.GOOGLE_ADS_REFRESH_TOKEN
  if (!refreshToken) throw new Error('No Google Ads refresh token configured')

  const token = await getGoogleAccessToken(refreshToken)
  const headers = googleHeaders(token, config)
  const base = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${config.customer_id}`

  let userListResourceName = existingAudienceId
  if (!userListResourceName) {
    const res = await fetch(`${base}/userLists:mutate`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        operations: [
          {
            create: {
              name: audienceName,
              membershipLifeSpan: 10000,
              crmBasedUserList: { uploadKeyType: 'CONTACT_INFO' },
            },
          },
        ],
      }),
    })
    if (!res.ok) throw new Error(`Google user list create failed (${res.status}): ${await res.text()}`)
    const body = (await res.json()) as { results: { resourceName: string }[] }
    userListResourceName = body.results[0].resourceName
  }

  const createJobRes = await fetch(`${base}/offlineUserDataJobs:create`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      job: { type: 'CUSTOMER_MATCH_USER_LIST', customerMatchUserListMetadata: { userList: userListResourceName } },
    }),
  })
  if (!createJobRes.ok) throw new Error(`Google offline user data job create failed (${createJobRes.status}): ${await createJobRes.text()}`)
  const jobBody = (await createJobRes.json()) as { resourceName: string }
  const jobResourceName = jobBody.resourceName

  const addOpsRes = await fetch(`https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/${jobResourceName}:addOperations`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      operations: emails.map((e) => ({ create: { userIdentifiers: [{ hashedEmail: sha256(e) }] } })),
      enablePartialFailure: true,
    }),
  })
  if (!addOpsRes.ok) throw new Error(`Google add operations failed (${addOpsRes.status}): ${await addOpsRes.text()}`)

  const runRes = await fetch(`https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/${jobResourceName}:run`, {
    method: 'POST',
    headers,
    body: JSON.stringify({}),
  })
  if (!runRes.ok) throw new Error(`Google offline user data job run failed (${runRes.status}): ${await runRes.text()}`)

  return { externalAudienceId: userListResourceName, count: emails.length }
}
