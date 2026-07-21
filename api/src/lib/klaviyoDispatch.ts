import { db } from '../db'

// Deliberately NOT wired into the approve flow yet (see routes/remarketing.ts) — v1 of
// the remarketing agent is build-and-review-only, no live sends to real leads. This
// exists so the integration is ready to flip on later, one explicit call at a time.
//
// Also deliberately does NOT compose or send a message itself. It adds the person to a
// Klaviyo list the client already has a flow/campaign wired to — the same "identify,
// then hand off to the ESP's own send logic" pattern real identity-resolution vendors
// (Retention.com, Opensend) use. This code never calls Klaviyo's own send-campaign
// endpoint, so there is no path here that emails anyone directly.
interface KlaviyoConfig {
  api_key: string
  list_id: string
}

const KLAVIYO_REVISION = '2025-07-15'

async function getIntegration(clientId: string): Promise<KlaviyoConfig | null> {
  const { rows } = await db.query<{ config: KlaviyoConfig }>(
    `SELECT config FROM client_integrations WHERE client_id = $1 AND platform = 'klaviyo'`,
    [clientId]
  )
  return rows[0]?.config ?? null
}

export interface KlaviyoDispatchInput {
  email: string
  phone?: string | null
  firstName?: string | null
  lastName?: string | null
}

export interface KlaviyoDispatchResult {
  profileId: string
}

export async function addToKlaviyoList(clientId: string, input: KlaviyoDispatchInput): Promise<KlaviyoDispatchResult> {
  const config = await getIntegration(clientId)
  if (!config?.api_key || !config?.list_id) {
    throw new Error('No Klaviyo integration configured for this client')
  }

  const headers = {
    Authorization: `Klaviyo-API-Key ${config.api_key}`,
    revision: KLAVIYO_REVISION,
    'content-type': 'application/json',
  }

  // Create-or-update the profile first (Klaviyo dedupes on email).
  const profileRes = await fetch('https://a.klaviyo.com/api/profiles/', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      data: {
        type: 'profile',
        attributes: {
          email: input.email,
          phone_number: input.phone ?? undefined,
          first_name: input.firstName ?? undefined,
          last_name: input.lastName ?? undefined,
        },
      },
    }),
  })

  let profileId: string | undefined
  if (profileRes.status === 201) {
    const body = (await profileRes.json()) as { data: { id: string } }
    profileId = body.data.id
  } else if (profileRes.status === 409) {
    // Profile already exists — Klaviyo's conflict body includes the existing id.
    const body = (await profileRes.json()) as { errors?: { meta?: { duplicate_profile_id?: string } }[] }
    profileId = body.errors?.[0]?.meta?.duplicate_profile_id
  }

  if (!profileId) {
    const text = await profileRes.text()
    throw new Error(`Klaviyo profile upsert failed (${profileRes.status}): ${text.slice(0, 300)}`)
  }

  const listRes = await fetch(`https://a.klaviyo.com/api/lists/${config.list_id}/relationships/profiles/`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ data: [{ type: 'profile', id: profileId }] }),
  })

  if (!listRes.ok && listRes.status !== 409) {
    const text = await listRes.text()
    throw new Error(`Klaviyo list-add failed (${listRes.status}): ${text.slice(0, 300)}`)
  }

  return { profileId }
}
