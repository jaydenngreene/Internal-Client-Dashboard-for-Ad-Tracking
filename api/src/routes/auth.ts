import { FastifyInstance } from 'fastify'
import { db } from '../db'
import {
  hashPassword,
  verifyPassword,
  signToken,
  authenticate,
  generateRandomToken,
  hashToken,
  signMfaPendingToken,
  verifyMfaPendingToken,
} from '../lib/auth'
import { isValidEmail, isValidUrl } from '../lib/validation'
import { sendPasswordResetEmail, sendVerificationEmail } from '../lib/email'
import { logAction } from '../lib/auditLog'
import { generateBase32Secret, generateTotp, verifyTotp, buildOtpAuthUri } from '../lib/totp'
import QRCode from 'qrcode'

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
      totp_enabled: boolean
    }>('SELECT id, email, password_hash, agency_name, email_verified, totp_enabled FROM users WHERE email = $1', [email])
    const user = rows[0]
    // Deliberately identical error for "no such user" and "wrong password" — a
    // distinct message for one vs the other would let an attacker enumerate which
    // emails have accounts.
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      await logAction({ userId: user?.id ?? null, clientId: null, method: 'POST', route: '/auth/login', statusCode: 401, details: `failed login attempt for ${email}`, ip: req.ip })
      return reply.code(401).send({ error: 'Invalid email or password' })
    }

    // Step 55 — password checked out, but if 2FA is on, the real session token
    // isn't issued yet. mfaToken is only ever valid for /auth/mfa/verify below.
    if (user.totp_enabled) {
      await logAction({ userId: user.id, clientId: null, method: 'POST', route: '/auth/login', statusCode: 200, details: 'password ok, awaiting MFA code', ip: req.ip })
      return reply.send({ mfaRequired: true, mfaToken: signMfaPendingToken(user.id) })
    }

    await logAction({ userId: user.id, clientId: null, method: 'POST', route: '/auth/login', statusCode: 200, details: 'login succeeded', ip: req.ip })
    return reply.send({
      token: signToken(user.id),
      user: { id: user.id, email: user.email, agency_name: user.agency_name, email_verified: user.email_verified },
    })
    }
  )

  // Step 55 — the second step of login when the account has 2FA enabled. Accepts
  // either a 6-digit TOTP code or one of the (single-use) backup codes.
  app.post<{ Body: { mfaToken: string; code: string } }>(
    '/auth/mfa/verify',
    { config: AUTH_RATE_LIMIT },
    async (req, reply) => {
      const { mfaToken, code } = req.body
      if (!mfaToken || !code) return reply.code(400).send({ error: 'mfaToken and code required' })

      const decoded = verifyMfaPendingToken(mfaToken)
      if (!decoded) return reply.code(401).send({ error: 'This login attempt has expired, log in again' })

      const { rows } = await db.query<{
        id: string
        email: string
        agency_name: string
        email_verified: boolean
        totp_secret: string | null
        mfa_backup_codes_hash: string[]
      }>('SELECT id, email, agency_name, email_verified, totp_secret, mfa_backup_codes_hash FROM users WHERE id = $1', [
        decoded.userId,
      ])
      const user = rows[0]
      if (!user?.totp_secret) return reply.code(401).send({ error: 'Invalid login attempt' })

      const isValidTotp = verifyTotp(user.totp_secret, code)
      const backupCodeHash = hashToken(code.trim())
      const backupIndex = user.mfa_backup_codes_hash.indexOf(backupCodeHash)

      if (!isValidTotp && backupIndex === -1) {
        await logAction({ userId: user.id, clientId: null, method: 'POST', route: '/auth/mfa/verify', statusCode: 401, details: 'wrong MFA code', ip: req.ip })
        return reply.code(401).send({ error: 'Invalid code' })
      }

      // A backup code is single-use — remove it the moment it's spent.
      if (backupIndex !== -1) {
        const remaining = user.mfa_backup_codes_hash.filter((_, i) => i !== backupIndex)
        await db.query('UPDATE users SET mfa_backup_codes_hash = $1 WHERE id = $2', [remaining, user.id])
      }

      await logAction({ userId: user.id, clientId: null, method: 'POST', route: '/auth/mfa/verify', statusCode: 200, details: backupIndex !== -1 ? 'login via backup code' : 'login succeeded (MFA)', ip: req.ip })
      return reply.send({
        token: signToken(user.id),
        user: { id: user.id, email: user.email, agency_name: user.agency_name, email_verified: user.email_verified },
      })
    }
  )

  // Begins 2FA setup — generates a secret and returns a QR code, but does NOT
  // enable it yet (see /auth/mfa/confirm). Re-calling this before confirming
  // just overwrites the pending secret, so a user can restart setup cleanly if
  // they scan the wrong QR or their app rejects it.
  app.post('/auth/mfa/setup', { preHandler: authenticate }, async (req, reply) => {
    const { rows } = await db.query<{ email: string }>('SELECT email FROM users WHERE id = $1', [req.userId])
    const secret = generateBase32Secret()
    await db.query('UPDATE users SET totp_secret = $1, totp_enabled = false WHERE id = $2', [secret, req.userId])
    const uri = buildOtpAuthUri(secret, rows[0].email, 'Kado')
    const qrCodeDataUrl = await QRCode.toDataURL(uri)
    return reply.send({ secret, qrCodeDataUrl })
  })

  // Confirms setup with a real code from the app, turns 2FA on, and issues
  // backup codes — shown to the user exactly once, only their hashes are kept.
  app.post<{ Body: { code: string } }>('/auth/mfa/confirm', { preHandler: authenticate }, async (req, reply) => {
    const { rows } = await db.query<{ totp_secret: string | null }>('SELECT totp_secret FROM users WHERE id = $1', [
      req.userId,
    ])
    const secret = rows[0]?.totp_secret
    if (!secret) return reply.code(400).send({ error: 'Call /auth/mfa/setup first' })
    if (!req.body.code || !verifyTotp(secret, req.body.code)) {
      return reply.code(401).send({ error: 'Invalid code' })
    }

    const backupCodes = Array.from({ length: 8 }, () => generateRandomToken().slice(0, 10))
    await db.query('UPDATE users SET totp_enabled = true, mfa_backup_codes_hash = $1 WHERE id = $2', [
      backupCodes.map(hashToken),
      req.userId,
    ])
    await logAction({ userId: req.userId!, clientId: null, method: 'POST', route: '/auth/mfa/confirm', statusCode: 200, details: '2FA enabled', ip: req.ip })
    return reply.send({ enabled: true, backupCodes })
  })

  // Disabling requires the current password — the same "prove you're still you"
  // bar as changing it, since turning 2FA off is a real security downgrade.
  app.post<{ Body: { password: string } }>('/auth/mfa/disable', { preHandler: authenticate }, async (req, reply) => {
    const { rows } = await db.query<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [
      req.userId,
    ])
    if (!req.body.password || !(await verifyPassword(req.body.password, rows[0].password_hash))) {
      return reply.code(401).send({ error: 'Password is incorrect' })
    }
    await db.query(`UPDATE users SET totp_enabled = false, totp_secret = NULL, mfa_backup_codes_hash = '{}' WHERE id = $1`, [
      req.userId,
    ])
    await logAction({ userId: req.userId!, clientId: null, method: 'POST', route: '/auth/mfa/disable', statusCode: 200, details: '2FA disabled', ip: req.ip })
    return reply.send({ enabled: false })
  })

  app.get('/auth/me', { preHandler: authenticate }, async (req, reply) => {
    const { rows } = await db.query<{
      id: string
      email: string
      agency_name: string
      agency_logo_url: string | null
      email_verified: boolean
      totp_enabled: boolean
    }>(
      'SELECT id, email, agency_name, agency_logo_url, email_verified, totp_enabled FROM users WHERE id = $1',
      [req.userId]
    )
    if (rows.length === 0) return reply.code(404).send({ error: 'Not found' })
    return reply.send(rows[0])
  })

  // Sliding-session "remember me" — the dashboard calls this in the background
  // whenever the token it's holding is getting close to its 30-day expiry (see
  // dashboard/src/lib/api.ts's apiRequest), so an account in regular use never
  // hits a forced re-login. Requires an already-valid token to get a new one
  // (authenticate already ran), so this doesn't extend a stolen token's reach
  // beyond what that token could already do.
  app.post('/auth/refresh', { preHandler: authenticate }, async (req, reply) => {
    return reply.send({ token: signToken(req.userId as string) })
  })

  // Update account-level profile fields. Deliberately separate from /auth/password
  // below — changing your agency name shouldn't require re-typing your password,
  // and vice versa.
  app.patch<{ Body: { agency_name?: string; email?: string; agency_logo_url?: string | null } }>(
    '/auth/me',
    { preHandler: authenticate },
    async (req, reply) => {
      const agencyName = req.body.agency_name?.trim()
      const email = req.body.email?.toLowerCase().trim()
      // Distinct from agency_name/email above: the key being present at all
      // (even as "" or null) means "update this," since blank is how the logo
      // gets cleared back to the default Kado mark — omitted entirely is the
      // only case that means "leave it alone."
      const hasLogoUpdate = req.body.agency_logo_url !== undefined
      const agencyLogoUrl = hasLogoUpdate ? req.body.agency_logo_url?.trim() || null : undefined
      if (!agencyName && !email && !hasLogoUpdate) {
        return reply.code(400).send({ error: 'agency_name, email, and/or agency_logo_url required' })
      }
      if (agencyName && agencyName.length > AGENCY_NAME_MAX_LENGTH) {
        return reply.code(400).send({ error: `agency_name must be ${AGENCY_NAME_MAX_LENGTH} characters or fewer` })
      }
      if (agencyLogoUrl && !isValidUrl(agencyLogoUrl)) {
        return reply.code(400).send({ error: 'agency_logo_url must be a valid URL' })
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
      const { rows } = await db.query<{
        id: string
        email: string
        agency_name: string
        agency_logo_url: string | null
        email_verified: boolean
      }>(
        `UPDATE users
         SET agency_name = COALESCE($1, agency_name),
             email = COALESCE($2, email),
             email_verified = CASE WHEN $2::text IS NOT NULL THEN false ELSE email_verified END,
             agency_logo_url = CASE WHEN $4 THEN $5 ELSE agency_logo_url END
         WHERE id = $3
         RETURNING id, email, agency_name, agency_logo_url, email_verified`,
        [agencyName ?? null, email ?? null, req.userId, hasLogoUpdate, agencyLogoUrl ?? null]
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
