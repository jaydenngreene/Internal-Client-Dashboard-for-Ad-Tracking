import { db } from '../db'

// Every route that looks up an existing visitor by anonymous_id (identify, event,
// conversion, dni) needs to check visitor_aliases first — otherwise a visitor whose
// cookie was cleared and got fingerprint-matched back to their history (Step 14)
// 404s the moment they do anything other than a pageview, since their anonymous_id
// was never given its own `visitors` row. resolveVisitor() (below) is pageview-only
// (it creates rows); this is the read-only counterpart every other route should use.
export async function lookupVisitorId(clientId: string, anonymousId: string): Promise<string | null> {
  const { rows: aliasRows } = await db.query<{ canonical_visitor_id: string }>(
    `SELECT canonical_visitor_id FROM visitor_aliases WHERE client_id = $1 AND anonymous_id = $2`,
    [clientId, anonymousId]
  )
  if (aliasRows.length > 0) return aliasRows[0].canonical_visitor_id

  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM visitors WHERE client_id = $1 AND anonymous_id = $2`,
    [clientId, anonymousId]
  )
  return rows[0]?.id ?? null
}

export interface ResolveVisitorInput {
  clientId: string
  anonymousId: string
  ip: string | null
  userAgent: string | null
  fingerprintHash?: string | null
  fingerprintComponents?: Record<string, unknown> | null
}

// Step 14 — recognizes a returning device via its Step 13 fingerprint even when its
// cookie (anonymous_id) is gone or was never set (cleared cookies, incognito, a
// different browser profile). Lookup order:
//   1. visitor_aliases — this exact anonymous_id was already resolved to some other
//      visitor's canonical id on an earlier fingerprint match; keep routing there.
//   2. visitors by (client_id, anonymous_id) — the normal case, cookie intact.
//   3. visitors by (client_id, fingerprint_hash) — new anonymous_id, but the device
//      fingerprint matches a visitor we've already seen; record the alias instead of
//      creating a duplicate visitor row, and route to the existing (canonical) one.
//   4. Create a new visitor.
// Exact-hash match only — no fuzzy/near-match logic (a real precision/recall
// trade-off: browser auto-updates will occasionally break a match), which is
// deliberately out of scope here (that's real ML/similarity-matching work).
export async function resolveVisitor(input: ResolveVisitorInput): Promise<string> {
  const { clientId, anonymousId, ip, userAgent, fingerprintHash, fingerprintComponents } = input
  const componentsJson = fingerprintComponents ? JSON.stringify(fingerprintComponents) : null

  const { rows: aliasRows } = await db.query<{ canonical_visitor_id: string }>(
    `SELECT canonical_visitor_id FROM visitor_aliases WHERE client_id = $1 AND anonymous_id = $2`,
    [clientId, anonymousId]
  )
  if (aliasRows.length > 0) {
    const canonicalId = aliasRows[0].canonical_visitor_id
    await db.query(
      `UPDATE visitors
       SET last_seen = NOW(), ip = COALESCE($2, ip),
           fingerprint_hash = COALESCE($3, fingerprint_hash),
           fingerprint_components = COALESCE($4::jsonb, fingerprint_components)
       WHERE id = $1`,
      [canonicalId, ip, fingerprintHash ?? null, componentsJson]
    )
    return canonicalId
  }

  const { rows: directRows } = await db.query<{ id: string }>(
    `UPDATE visitors
     SET last_seen = NOW(), ip = COALESCE($3, ip),
         fingerprint_hash = COALESCE($4, fingerprint_hash),
         fingerprint_components = COALESCE($5::jsonb, fingerprint_components)
     WHERE client_id = $1 AND anonymous_id = $2
     RETURNING id`,
    [clientId, anonymousId, ip, fingerprintHash ?? null, componentsJson]
  )
  if (directRows.length > 0) return directRows[0].id

  if (fingerprintHash) {
    const { rows: fpRows } = await db.query<{ id: string }>(
      `SELECT id FROM visitors WHERE client_id = $1 AND fingerprint_hash = $2 LIMIT 1`,
      [clientId, fingerprintHash]
    )
    if (fpRows.length > 0) {
      const canonicalId = fpRows[0].id
      await db.query(
        `INSERT INTO visitor_aliases (client_id, anonymous_id, canonical_visitor_id, matched_via)
         VALUES ($1, $2, $3, 'fingerprint')
         ON CONFLICT (client_id, anonymous_id) DO NOTHING`,
        [clientId, anonymousId, canonicalId]
      )
      await db.query(`UPDATE visitors SET last_seen = NOW(), ip = COALESCE($2, ip) WHERE id = $1`, [
        canonicalId,
        ip,
      ])
      return canonicalId
    }
  }

  const { rows: createdRows } = await db.query<{ id: string }>(
    `INSERT INTO visitors (client_id, anonymous_id, ip, user_agent, fingerprint_hash, fingerprint_components)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)
     RETURNING id`,
    [clientId, anonymousId, ip, userAgent, fingerprintHash ?? null, componentsJson]
  )
  return createdRows[0].id
}
