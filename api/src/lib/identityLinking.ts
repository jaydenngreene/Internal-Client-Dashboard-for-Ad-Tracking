import { db } from '../db'

export type LinkMechanism = 'session_id' | 'phone_number' | 'ip' | 'manual'

// Canonicalize direction (alphabetically by id) so the same pair is never linked
// twice in opposite directions — keeps "all links touching identity X" queries
// simple (check both columns) without ever producing a duplicate reverse row.
export async function linkIdentities(
  clientId: string,
  identityIdA: string,
  identityIdB: string,
  mechanism: LinkMechanism,
  confidence = 1.0
): Promise<void> {
  if (identityIdA === identityIdB) return
  const [primaryId, linkedId] = [identityIdA, identityIdB].sort()

  await db.query(
    `INSERT INTO identity_links (client_id, primary_identity_id, linked_identity_id, mechanism, confidence)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (client_id, primary_identity_id, linked_identity_id, mechanism) DO NOTHING`,
    [clientId, primaryId, linkedId, mechanism, confidence]
  )
}

// Called whenever a phone number is captured against an email (identify, or a
// webhook payload that includes both). Finds every OTHER identity in this client
// sharing that phone and links them all — real evidence of the same person, so
// full confidence.
export async function autoLinkByPhone(clientId: string, email: string, phone: string): Promise<void> {
  if (!phone) return

  const { rows: selfRows } = await db.query<{ id: string }>(
    `SELECT id FROM identities WHERE client_id = $1 AND email = $2`,
    [clientId, email]
  )
  if (selfRows.length === 0) return
  const selfId = selfRows[0].id

  const { rows: matches } = await db.query<{ id: string }>(
    `SELECT id FROM identities WHERE client_id = $1 AND phone = $2 AND email != $3`,
    [clientId, phone, email]
  )

  for (const match of matches) {
    await linkIdentities(clientId, selfId, match.id, 'phone_number', 1.0)
  }
}

// Called when a new identity is created. Looks for other visitors on the same
// client sharing this visitor's IP within a trailing window who already have their
// own identity — a much weaker signal than a shared phone (shared wifi/office
// network produces false positives), so linked at lower confidence rather than 1.0.
export async function autoLinkByIp(clientId: string, email: string, visitorId: string): Promise<void> {
  const { rows: selfRows } = await db.query<{ id: string }>(
    `SELECT id FROM identities WHERE client_id = $1 AND email = $2`,
    [clientId, email]
  )
  if (selfRows.length === 0) return
  const selfId = selfRows[0].id

  const { rows: matches } = await db.query<{ id: string }>(
    `SELECT DISTINCT i.id
     FROM visitors v
     JOIN visitors v2 ON v2.client_id = v.client_id AND v2.ip = v.ip AND v2.id != v.id
     JOIN identities i ON i.client_id = v2.client_id AND i.visitor_id = v2.id
     WHERE v.id = $1 AND v.client_id = $2 AND v.ip IS NOT NULL
       AND v2.last_seen >= NOW() - INTERVAL '24 hours'
       AND i.email != $3`,
    [visitorId, clientId, email]
  )

  for (const match of matches) {
    await linkIdentities(clientId, selfId, match.id, 'ip', 0.5)
  }
}
