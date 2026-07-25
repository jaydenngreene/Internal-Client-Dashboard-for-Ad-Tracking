import { FastifyInstance } from 'fastify'
import sharp from 'sharp'
import { db } from '../db'

const MAX_DIMENSION = 1024

// Authenticated — anyone logged in can upload a logo image (agency branding,
// client branding). Normalizes to PNG and caps dimensions so a huge phone
// photo doesn't bloat the DB; doesn't bake in any particular shape (rounded
// corners, circle, etc.) — that's a display-time CSS concern, since the same
// uploaded image gets reused in differently-shaped places (sidebar badge,
// settings preview, a client's public share page).
export async function uploadRoutes(app: FastifyInstance) {
  app.post('/uploads/logo', async (req, reply) => {
    const file = await req.file()
    if (!file) return reply.code(400).send({ error: 'No file uploaded' })
    if (!file.mimetype.startsWith('image/')) {
      return reply.code(400).send({ error: 'File must be an image' })
    }

    const buffer = await file.toBuffer()
    let processed: Buffer
    try {
      processed = await sharp(buffer)
        .resize(MAX_DIMENSION, MAX_DIMENSION, { fit: 'inside', withoutEnlargement: true })
        .png()
        .toBuffer()
    } catch (err) {
      return reply.code(400).send({ error: `Could not read this image: ${(err as Error).message}` })
    }

    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO uploaded_images (content_type, data) VALUES ('image/png', $1) RETURNING id`,
      [processed]
    )

    const apiUrl = process.env.API_URL ?? `${req.protocol}://${req.headers.host}`
    return reply.code(201).send({ url: `${apiUrl}/uploads/${rows[0].id}` })
  })
}

// Public/unauthenticated — this needs to load as a plain <img src> from the
// dashboard (a different origin than the API), a client's public share page,
// or eventually a browser favicon-adjacent context. No auth header would ever
// be attached to those requests, same reasoning as pixel.js being public.
export async function uploadServeRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string } }>('/uploads/:id', async (req, reply) => {
    const { rows } = await db.query<{ content_type: string; data: Buffer }>(
      `SELECT content_type, data FROM uploaded_images WHERE id = $1`,
      [req.params.id]
    )
    if (rows.length === 0) return reply.code(404).send({ error: 'Not found' })

    reply.header('Content-Type', rows[0].content_type)
    reply.header('Cache-Control', 'public, max-age=31536000, immutable')
    // Same helmet CORP override pixel.js needs (routes/pixelAsset.ts) — this is
    // deliberately loaded cross-origin from the dashboard's own domain.
    reply.header('Cross-Origin-Resource-Policy', 'cross-origin')
    return reply.send(rows[0].data)
  })
}
