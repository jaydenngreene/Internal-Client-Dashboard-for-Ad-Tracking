import { db } from '../db'

// Never blocks or fails the request that triggered it — same "a logging/
// notification failure must never break the real write path" convention as
// dispatchEvent/sendConversionSignals elsewhere in this app.
export async function logAction(params: {
  userId: string | null
  clientId: string | null
  method: string
  route: string
  statusCode: number
  details?: string | null
  ip?: string | null
}): Promise<void> {
  try {
    await db.query(
      `INSERT INTO audit_log (user_id, client_id, method, route, status_code, details, ip)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [params.userId, params.clientId, params.method, params.route, params.statusCode, params.details ?? null, params.ip ?? null]
    )
  } catch (err) {
    console.error('[audit-log] failed to record entry:', (err as Error).message)
  }
}
