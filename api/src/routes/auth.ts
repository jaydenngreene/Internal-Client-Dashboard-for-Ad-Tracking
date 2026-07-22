import { FastifyInstance } from 'fastify'
import { db } from '../db'
import { hashPassword, verifyPassword, signToken, authenticate } from '../lib/auth'
import { isValidEmail } from '../lib/validation'

const AGENCY_NAME_MAX_LENGTH = 200

// Credential-stuffing/brute-force only matters on login and registration — every
// other route here already requires a valid token (authenticate), which the
// global rate limit in index.ts already covers.
const AUTH_RATE_LIMIT = { rateLimit: { max: 10, timeWindow: '15 minutes' } }

export async function authRoutes(app: FastifyInstance) {
  app.post<{ Body: { email: string; password: string; agency_name: string } }>(
    '/auth/register',
    { config: AUTH_RATE_LIMIT },
    async (req, reply) => {
      const email = req.body.email?.toLowerCase().trim()
      const agencyName = req.body.agency_name?.trim()
      const { password } = req.body
      if (!email || !password || password.length < 8 || !agencyName) {
        return reply
          .code(400)
          .send({ error: 'email, agency_name, and a password of at least 8 characters are required' })
      }
      if (!isValidEmail(email)) {
        return reply.code(400).send({ error: 'Enter a valid email address' })
      }
      if (agencyName.length > AGENCY_NAME_MAX_LENGTH) {
        return reply.code(400).send({ error: `agency_name must be ${AGENCY_NAME_MAX_LENGTH} characters or fewer` })
      }

      const { rows: existing } = await db.query('SELECT id FROM users WHERE email = $1', [email])
      if (existing.length > 0) {
        return reply.code(409).send({ error: 'An account with this email already exists' })
      }

      const passwordHash = await hashPassword(password)
      const { rows } = await db.query<{ id: string; email: string; agency_name: string }>(
        'INSERT INTO users (email, password_hash, agency_name) VALUES ($1, $2, $3) RETURNING id, email, agency_name',
        [email, passwordHash, agencyName]
      )
      const user = rows[0]
      return reply.code(201).send({ token: signToken(user.id), user })
    }
  )

  app.post<{ Body: { email: string; password: string } }>(
    '/auth/login',
    { config: AUTH_RATE_LIMIT },
    async (req, reply) => {
    const email = req.body.email?.toLowerCase().trim()
    const { password } = req.body
    if (!email || !password) {
      return reply.code(400).send({ error: 'email and password required' })
    }

    const { rows } = await db.query<{ id: string; email: string; password_hash: string; agency_name: string }>(
      'SELECT id, email, password_hash, agency_name FROM users WHERE email = $1',
      [email]
    )
    const user = rows[0]
    // Deliberately identical error for "no such user" and "wrong password" — a
    // distinct message for one vs the other would let an attacker enumerate which
    // emails have accounts.
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      return reply.code(401).send({ error: 'Invalid email or password' })
    }

    return reply.send({
      token: signToken(user.id),
      user: { id: user.id, email: user.email, agency_name: user.agency_name },
    })
    }
  )

  app.get('/auth/me', { preHandler: authenticate }, async (req, reply) => {
    const { rows } = await db.query<{ id: string; email: string; agency_name: string }>(
      'SELECT id, email, agency_name FROM users WHERE id = $1',
      [req.userId]
    )
    if (rows.length === 0) return reply.code(404).send({ error: 'Not found' })
    return reply.send(rows[0])
  })

  // Update account-level profile fields. Deliberately separate from /auth/password
  // below — changing your agency name shouldn't require re-typing your password,
  // and vice versa.
  app.patch<{ Body: { agency_name?: string; email?: string } }>(
    '/auth/me',
    { preHandler: authenticate },
    async (req, reply) => {
      const agencyName = req.body.agency_name?.trim()
      const email = req.body.email?.toLowerCase().trim()
      if (!agencyName && !email) {
        return reply.code(400).send({ error: 'agency_name and/or email required' })
      }
      if (agencyName && agencyName.length > AGENCY_NAME_MAX_LENGTH) {
        return reply.code(400).send({ error: `agency_name must be ${AGENCY_NAME_MAX_LENGTH} characters or fewer` })
      }
      if (email) {
        if (!isValidEmail(email)) {
          return reply.code(400).send({ error: 'Enter a valid email address' })
        }
        const { rows: existing } = await db.query('SELECT id FROM users WHERE email = $1 AND id != $2', [
          email,
          req.userId,
        ])
        if (existing.length > 0) {
          return reply.code(409).send({ error: 'An account with this email already exists' })
        }
      }
      const { rows } = await db.query<{ id: string; email: string; agency_name: string }>(
        `UPDATE users SET agency_name = COALESCE($1, agency_name), email = COALESCE($2, email) WHERE id = $3
         RETURNING id, email, agency_name`,
        [agencyName ?? null, email ?? null, req.userId]
      )
      return reply.send(rows[0])
    }
  )

  app.patch<{ Body: { current_password: string; new_password: string } }>(
    '/auth/password',
    { preHandler: authenticate },
    async (req, reply) => {
      const { current_password, new_password } = req.body
      if (!current_password || !new_password || new_password.length < 8) {
        return reply
          .code(400)
          .send({ error: 'current_password and a new_password of at least 8 characters are required' })
      }

      const { rows } = await db.query<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [
        req.userId,
      ])
      if (!(await verifyPassword(current_password, rows[0].password_hash))) {
        return reply.code(401).send({ error: 'Current password is incorrect' })
      }

      const newHash = await hashPassword(new_password)
      await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, req.userId])
      return reply.send({ ok: true })
    }
  )

  // Delete your own account. Every client's owner_user_id references users(id)
  // ON DELETE CASCADE, so this one statement also removes every client (and
  // everything under them) this user owns — same cascade the per-client Danger
  // Zone already relies on, just one level up.
  app.delete('/auth/me', { preHandler: authenticate }, async (req, reply) => {
    await db.query('DELETE FROM users WHERE id = $1', [req.userId])
    return reply.code(204).send()
  })
}
