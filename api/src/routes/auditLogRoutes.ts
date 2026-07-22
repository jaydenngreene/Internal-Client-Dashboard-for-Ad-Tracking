import { FastifyInstance } from 'fastify'
import { db } from '../db'

// Step 54 — read side of the generic audit log populated by index.ts's
// onResponse hook (mutations) and auth.ts (login attempts).
export async function auditLogRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string } }>('/clients/:id/audit-log', async (req, reply) => {
    const { rows } = await db.query(
      `SELECT al.id, al.method, al.route, al.status_code, al.details, al.ip, al.created_at, u.email AS user_email
       FROM audit_log al LEFT JOIN users u ON u.id = al.user_id
       WHERE al.client_id = $1 ORDER BY al.created_at DESC LIMIT 200`,
      [req.params.id]
    )
    return reply.send(rows)
  })

  // Account-wide: every mutation across every client this user owns or
  // collaborates on, plus their own login attempts (client_id IS NULL rows for
  // this user specifically — never another user's login history).
  app.get('/account/audit-log', async (req, reply) => {
    const { rows } = await db.query(
      `SELECT al.id, al.method, al.route, al.status_code, al.details, al.ip, al.created_at,
              u.email AS user_email, c.name AS client_name
       FROM audit_log al
       LEFT JOIN users u ON u.id = al.user_id
       LEFT JOIN clients c ON c.id = al.client_id
       WHERE (al.client_id IN (
                SELECT id FROM clients WHERE owner_user_id = $1
                UNION SELECT client_id FROM client_collaborators WHERE user_id = $1
              ))
          OR (al.client_id IS NULL AND al.user_id = $1)
       ORDER BY al.created_at DESC LIMIT 200`,
      [req.userId]
    )
    return reply.send(rows)
  })
}
