import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import { FastifyRequest, FastifyReply } from 'fastify'

const JWT_SECRET = process.env.JWT_SECRET

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10)
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

export function signToken(userId: string): string {
  if (!JWT_SECRET) throw new Error('JWT_SECRET is not configured')
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '30d' })
}

// Step 55 — a separate, narrowly-scoped, short-lived token issued when a login's
// password check passes but the account has 2FA enabled. It carries
// `mfaPending: true` specifically so `authenticate()` below can tell it apart
// from a real session token and refuse it on every normal route — it's only
// ever accepted by /auth/mfa/verify.
export function signMfaPendingToken(userId: string): string {
  if (!JWT_SECRET) throw new Error('JWT_SECRET is not configured')
  return jwt.sign({ userId, mfaPending: true }, JWT_SECRET, { expiresIn: '5m' })
}

export function verifyMfaPendingToken(token: string): { userId: string } | null {
  if (!JWT_SECRET) return null
  try {
    const decoded = jwt.verify(token, JWT_SECRET)
    if (typeof decoded === 'object' && decoded && decoded.mfaPending === true && 'userId' in decoded) {
      return { userId: (decoded as { userId: string }).userId }
    }
    return null
  } catch {
    return null
  }
}

// Used for password-reset and email-verification tokens — high-entropy random
// values, not user-chosen secrets, so a fast hash (not bcrypt's deliberately slow
// one) is the right tool: it's stored so a DB read alone can't be replayed as a
// valid token, same principle as password_hash, without bcrypt's cost being
// necessary here.
export function generateRandomToken(): string {
  return crypto.randomBytes(32).toString('hex')
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

export function verifyToken(token: string): { userId: string } | null {
  if (!JWT_SECRET) return null
  try {
    const decoded = jwt.verify(token, JWT_SECRET)
    // An mfaPending token must never work as a real session token — it's only
    // ever valid for /auth/mfa/verify (see verifyMfaPendingToken below).
    if (typeof decoded === 'object' && decoded && 'userId' in decoded && decoded.mfaPending !== true) {
      return { userId: (decoded as { userId: string }).userId }
    }
    return null
  } catch {
    return null
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    userId?: string
  }
}

// Applied as a preHandler on every dashboard-facing route (everything registered
// inside the block in index.ts) — NOT on /track/*, /webhooks/*, /shopify/install,
// /shopify/callback, or /api/v1/*, which authenticate themselves a different way
// (pixel_key, webhook signature/shared secret, or the existing API_SECRET bearer
// token) and are meant to be called by something other than a logged-in user.
export async function authenticate(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const header = req.headers.authorization
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null
  const decoded = token ? verifyToken(token) : null
  if (!decoded) {
    return reply.code(401).send({ error: 'Unauthorized' })
  }
  req.userId = decoded.userId
}
