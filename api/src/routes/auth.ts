import { FastifyInstance } from 'fastify'
import { db } from '../db'
import {
  hashPassword,
  verifyPassword,
  signToken,
  authenticate,
  generateRandomToken,
  hashToken,
} from '../lib/auth'
import { isValidEmail } from '../lib/validation'
import { sendPasswordResetEmail, sendVerificationEmail } from '../lib/email'
import { logAction } from '../lib/auditLog'

const AGENCY_NAME_MAX_LENGTH = 200
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000 // 1 hour

function dashboardUrl(path: string): string {
  const base = process.env.DASHBOARD_URL ?? 'http://localhost:3000'
  return `${base}${path}`
}

// Credential-stuffing/brute-force only matters on login and registration — every
// other route here already requires a valid token (authenticate), which the
// global rate limit in index.ts already covers.
const AUTH_RATE_LIMIT = { rateLimit: { max: 10, timeWindow: '15 minutes' } }

// Self-service registration was removed on purpose — this app is no longer "anyone
// who registers gets their own workspace." Logins are now created only by whoever
// runs `npm run create:user` (scripts/create-user.ts, writes directly to the users
// table). There is deliberately no HTTP path to create a user anymore, not even an
// admin-secret-gated one — the smaller the attack surface, the better for something
// meant to be reachable from the internet with only a login form in front of it.
export async function authRoutes(app: FastifyInstance) {
  app.post<{ Body: { email: string; password: string } }>(
    '/auth/login',
    { config: AUTH_RATE_LIMIT },
    async (req, reply) => {
    const email = req.body.email?.toLowerCase().trim()
    const { password } = req.body
    if (!email || !password) {
      return reply.code(400).send({ error: 'email and password required' })
    }

    const { rows } = await db.query<{
      id: string
      email: string
      password_hash: string
      agency_name: string
      email_verified: boolean
    }>('SELECT id, email, password_hash, agency_name, email_verified FROM users WHERE email = $1', [email])
    const user = rows[0]
    // Deliberately identical error for "no such user" and "wrong password" — a
    // distinct message for one vs the other would let an attacker enumerate which
    // emails have accounts.
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      await logAction({ userId: user?.id ?? null, clientId: null, method: 'POST', route: '/auth/login', statusCode: 401, details: `failed login attempt for ${email}`, ip: req.ip })
      return reply.code(401).send({ error: 'Invalid email or password' })
    }

    await logAction({ userId: user.id, clientId: null, method: 'POST', route: '/auth/login', statusCode: 200, details: 'login succeeded', ip: req.ip })
    return reply.send({
      token: signToken(user.id),
      user: { id: user.id, email: user.email, agency_name: user.agency_name, email_verified: user.email_verified },
    })
    }
  )

  app.get('/auth/me', { preHandler: authenticate }, async (req, reply) => {
    const { rows } = await db.query<{ id: string; email: string; agency_name: string; email_verified: boolean }>(
      'SELECT id, email, agency_name, email_verified FROM users WHERE id = $1',
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
      // Changing the email address invalidates whatever verification applied to
      // the old one — a new address needs its own verify step.
      const { rows } = await db.query<{ id: string; email: string; agency_name: string; email_verified: boolean }>(
        `UPDATE users
         SET agency_name = COALESCE($1, agency_name),
             email = COALESCE($2, email),
             email_verified = CASE WHEN $2::text IS NOT NULL THEN false ELSE email_verified END
         WHERE id = $3
         RETURNING id, email, agency_name, email_verified`,
        [agencyName ?? null, email ?? null, req.userId]
      )
      const updated = rows[0]
      if (email) {
        const token = generateRandomToken()
        await db.query('UPDATE users SET email_verification_token_hash = $1 WHERE id = $2', [
          hashToken(token),
          req.userId,
        ])
        sendVerificationEmail(updated.email, dashboardUrl(`/verify-email?token=${token}`)).catch(() => {})
      }
      return reply.send(updated)
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

  // Always the same response whether or not the email has an account — a
  // different message for "no such user" would let an attacker enumerate emails,
  // same reasoning as /auth/login's identical invalid-credentials error.
  app.post<{ Body: { email: string } }>(
    '/auth/forgot-password',
    { config: AUTH_RATE_LIMIT },
    async (req, reply) => {
      const email = req.body.email?.toLowerCase().trim()
      const generic = { message: 'If an account exists for that email, a reset link has been sent.' }
      if (!email) return reply.send(generic)

      const { rows } = await db.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [email])
      if (rows.length > 0) {
        const token = generateRandomToken()
        await db.query(
          `UPDATE users SET password_reset_token_hash = $1, password_reset_expires_at = $2 WHERE id = $3`,
          [hashToken(token), new Date(Date.now() + PASSWORD_RESET_TTL_MS), rows[0].id]
        )
        sendPasswordResetEmail(email, dashboardUrl(`/reset-password?token=${token}`)).catch(() => {})
      }
      return reply.send(generic)
    }
  )

  app.post<{ Body: { token: string; new_password: string } }>(
    '/auth/reset-password',
    { config: AUTH_RATE_LIMIT },
    async (req, reply) => {
      const { token, new_password } = req.body
      if (!token || !new_password || new_password.length < 8) {
        return reply.code(400).send({ error: 'token and a new_password of at least 8 characters are required' })
      }

      const { rows } = await db.query<{ id: string }>(
        `SELECT id FROM users
         WHERE password_reset_token_hash = $1 AND password_reset_expires_at > NOW()`,
        [hashToken(token)]
      )
      if (rows.length === 0) {
        return reply.code(400).send({ error: 'This reset link is invalid or has expired' })
      }

      const newHash = await hashPassword(new_password)
      await db.query(
        `UPDATE users SET password_hash = $1, password_reset_token_hash = NULL, password_reset_expires_at = NULL
         WHERE id = $2`,
        [newHash, rows[0].id]
      )
      return reply.send({ ok: true })
    }
  )

  app.post<{ Body: { token: string } }>('/auth/verify-email', async (req, reply) => {
    const { token } = req.body
    if (!token) return reply.code(400).send({ error: 'token required' })

    const { rows } = await db.query<{ id: string }>(
      'SELECT id FROM users WHERE email_verification_token_hash = $1',
      [hashToken(token)]
    )
    if (rows.length === 0) {
      return reply.code(400).send({ error: 'This verification link is invalid' })
    }

    await db.query('UPDATE users SET email_verified = true, email_verification_token_hash = NULL WHERE id = $1', [
      rows[0].id,
    ])
    return reply.send({ ok: true })
  })

  app.post('/auth/resend-verification', { preHandler: authenticate }, async (req, reply) => {
    const { rows } = await db.query<{ email: string; email_verified: boolean }>(
      'SELECT email, email_verified FROM users WHERE id = $1',
      [req.userId]
    )
    const user = rows[0]
    if (!user || user.email_verified) {
      return reply.send({ ok: true })
    }
    const token = generateRandomToken()
    await db.query('UPDATE users SET email_verification_token_hash = $1 WHERE id = $2', [
      hashToken(token),
      req.userId,
    ])
    sendVerificationEmail(user.email, dashboardUrl(`/verify-email?token=${token}`)).catch(() => {})
    return reply.send({ ok: true })
  })
}
