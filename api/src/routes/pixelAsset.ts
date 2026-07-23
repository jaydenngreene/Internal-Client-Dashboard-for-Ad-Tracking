import { FastifyInstance } from 'fastify'
import * as fs from 'fs/promises'
import * as path from 'path'

// The Shopify theme snippet (pixel/src/shopify/theme-snippet.liquid) already
// points at "{apiUrl}/pixel.js" — this is that route. One universal built file,
// config-driven per page via window.ADT_CONFIG (see pixel/src/pixel.js) rather
// than a file rebuilt/hosted separately per client.
const PIXEL_DIST_PATH = path.join(__dirname, '..', '..', '..', 'pixel', 'dist', 'pixel.js')

export async function pixelAssetRoutes(app: FastifyInstance) {
  app.get('/pixel.js', async (_req, reply) => {
    try {
      const contents = await fs.readFile(PIXEL_DIST_PATH, 'utf-8')
      reply.header('Content-Type', 'application/javascript; charset=utf-8')
      reply.header('Cache-Control', 'public, max-age=300')
      // The whole point of this route is being <script src>'d from arbitrary
      // third-party client websites — @fastify/helmet's default
      // Cross-Origin-Resource-Policy: same-origin (registered globally in
      // index.ts) would silently block exactly that in any browser that
      // enforces CORP, so it's overridden here to the one route that needs it.
      reply.header('Cross-Origin-Resource-Policy', 'cross-origin')
      return reply.send(contents)
    } catch {
      return reply.code(503).send({ error: 'Pixel asset not built yet — run `npm run build` in pixel/' })
    }
  })
}
