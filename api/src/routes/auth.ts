import { FastifyInstance } from 'fastify'
import { db } from '../db'
import { hashPassword, verifyPassword, signToken, authenticate } from '../lib/auth'

export async function authRoutes(app: FastifyInstance) {
  app.post<{ Body: { email: string; password: string } }>('/auth/register', async (req, reply) => {
    const email = req.body.email?.toLowerCase().trim()
    const { password } = req.body
    if (!email || !password || password.length < 8) {
      return reply.code(400).send({ error: 'email and a password of at least 8 characters are required' })
    }

    const { rows: existing } = await db.query('SELECT id FROM users WHERE email = $1', [email])
    if (existing.length > 0) {
      return reply.code(409).send({ error: 'An account with this email already exists' })
    }

    const passwordHash = await hashPassword(password)
    const { rows } = await db.query<{ id: string; email: string }>(
      'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email',
      [email, passwordHash]
    )
    const user = rows[0]
    return reply.code(201).send({ token: signToken(user.id), user })
  })

  app.post<{ Body: { email: string; password: string } }>('/auth/login', async (req, reply) => {
    const email = req.body.email?.toLowerCase().trim()
    const { password } = req.body
    if (!email || !password) {
      return reply.code(400).send({ error: 'email and password required' })
    }

    const { rows } = await db.query<{ id: string; email: string; password_hash: string }>(
      'SELECT id, email, password_hash FROM users WHERE email = $1',
      [email]
    )
    const user = rows[0]
    // Deliberately identical error for "no such user" and "wrong password" — a
    // distinct message for one vs the other would let an attacker enumerate which
    // emails have accounts.
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      return reply.code(401).send({ error: 'Invalid email or password' })
    }

    return reply.send({ token: signToken(user.id), user: { id: user.id, email: user.email } })
  })

  app.get('/auth/me', { preHandler: authenticate }, async (req, reply) => {
    const { rows } = await db.query<{ id: string; email: string }>('SELECT id, email FROM users WHERE id = $1', [
      req.userId,
    ])
    if (rows.length === 0) return reply.code(404).send({ error: 'Not found' })
    return reply.send(rows[0])
  })
}
