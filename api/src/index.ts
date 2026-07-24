import Fastify, { FastifyError } from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import multipart from '@fastify/multipart'
import * as Sentry from '@sentry/node'
import * as dotenv from 'dotenv'
import * as path from 'path'

import { pageviewRoutes } from './routes/pageview'
import { pixelAssetRoutes } from './routes/pixelAsset'
import { identifyRoutes } from './routes/identify'
import { conversionRoutes } from './routes/conversion'
import { eventRoutes } from './routes/event'
import { webhookRoutes } from './routes/webhooks'
import { shopifyWebhookRoutes } from './routes/webhooks/shopify'
import { stripeWebhookRoutes } from './routes/webhooks/stripe'
import { paypalWebhookRoutes } from './routes/webhooks/paypal'
import { squareWebhookRoutes } from './routes/webhooks/square'
import { goHighLevelWebhookRoutes } from './routes/webhooks/gohighlevel'
import { twilioWebhookRoutes } from './routes/webhooks/twilio'
import { customersAiWebhookRoutes } from './routes/webhooks/customersAi'
import { tagWebhookRoutes } from './routes/webhooks/tags'
import { clientRoutes } from './routes/clients'
import { reportRoutes } from './routes/reports'
import { campaignDetailRoutes } from './routes/campaignDetail'
import { dniRoutes } from './routes/dni'
import { callRoutes } from './routes/calls'
import { shopifyAppRoutes } from './routes/shopifyApp'
import { remarketingRoutes } from './routes/remarketing'
import { pauseCandidateRoutes } from './routes/pauseCandidates'
import { publicShareRoutes } from './routes/publicShare'
import { incrementalityRoutes } from './routes/incrementality'
import { creativeFatigueRoutes } from './routes/creativeFatigue'
import { trackingHealthRoutes } from './routes/trackingHealth'
import { creativeTagRoutes } from './routes/creativeTags'
import { budgetReallocationRoutes } from './routes/budgetReallocation'
import { chatRoutes } from './routes/chat'
import { geoLiftRoutes } from './routes/geoLift'
import { auditLogRoutes } from './routes/auditLogRoutes'
import { customCostsRoutes } from './routes/customCosts'
import { shopifyImportRoutes } from './routes/shopifyImport'
import { tagRoutes, trackTagRoutes } from './routes/tags'
import { audienceSyncRoutes } from './routes/audienceSync'
import { insightsRoutes } from './routes/insights'
import { journeyRoutes } from './routes/journey'
import { jobRoutes } from './routes/jobs'
import { authRoutes } from './routes/auth'
import { authenticate } from './lib/auth'
import { requireOwnership } from './lib/ownership'
import { startScheduledJobs } from './lib/scheduler'
import { logAction } from './lib/auditLog'

dotenv.config({ path: path.join(__dirname, '../../../.env') })

// Same disclosure pattern as every other integration: without a real SENTRY_DSN,
// Sentry.init's own SDK behavior is to no-op (nothing is captured or sent) —
// there's no custom guard needed here, just an unset env var.
Sentry.init({ dsn: process.env.SENTRY_DSN, tracesSampleRate: 0.1 })

const app = Fastify({ logger: true, trustProxy: true })

const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '').split(',').map((o) => o.trim())

// Origin-restricted CORS — for routes only ever called from this app's own
// dashboard frontend (the Vercel deploy in ALLOWED_ORIGINS). Kept as its own
// object so it can be registered in more than one encapsulated scope below,
// since a Fastify plugin registered on the root `app` applies to every route
// including ones that need the opposite (unrestricted) policy — see
// pixelCorsOptions just below for why that matters.
const dashboardCorsOptions = {
  origin: (origin: string | undefined, cb: (err: Error | null, allow: boolean) => void) => {
    if (!origin || allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
      cb(null, true)
    } else {
      cb(new Error('Not allowed by CORS'), false)
    }
  },
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
}

// Unrestricted CORS — for the pixel's own tracking calls (pageview, identify,
// conversion, cart events, tag, DNI). These are meant to run on ANY client's
// website, which is never known in advance, so an origin allowlist can't work
// here the way it does for the dashboard — that's the whole premise of an
// embeddable pixel. Security for these routes comes from the per-client
// pixel_key each call carries, not from origin trust.
const pixelCorsOptions = {
  origin: true,
  methods: ['GET', 'POST', 'OPTIONS'],
}

app.register(helmet)

// One historical-order CSV per upload is small (a single client's export), never a
// bulk/repeated ingestion path — 25MB comfortably covers even a busy store's full
// export while still bounding worst-case memory use for the in-memory CSV parse.
app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024 } })

// A generous global ceiling against basic abuse; /auth/login and /auth/register
// carry their own much stricter per-route limit (see routes/auth.ts) since
// credential-stuffing/brute-force only matters there.
app.register(rateLimit, { max: 300, timeWindow: '1 minute' })

// Never let an unexpected exception leak internal details (a raw stack trace, a
// DB error message) to the client — log the real error server-side, respond with
// a generic message. Routes that already reply.code(4xx).send(...) themselves
// never reach this; it only catches genuinely uncaught errors.
app.setErrorHandler((error: FastifyError, request, reply) => {
  request.log.error(error)
  const statusCode = error.statusCode ?? 500
  if (statusCode >= 500) {
    Sentry.captureException(error)
    return reply.code(statusCode).send({ error: 'Internal server error' })
  }
  return reply.code(statusCode).send({ error: error.message })
})

// A safety net for anything outside Fastify's own request lifecycle (the cron
// jobs in lib/scheduler.ts already catch their own errors, but this covers
// whatever that pattern misses elsewhere).
process.on('unhandledRejection', (reason) => Sentry.captureException(reason))
process.on('uncaughtException', (err) => Sentry.captureException(err))

app.get('/health', async () => ({ status: 'ok' }))

// Pixel-facing routes — called via fetch/sendBeacon from arbitrary client
// websites, authenticated by pixel_key rather than by origin. Needs the
// unrestricted CORS policy (see pixelCorsOptions above) or every one of these
// silently fails its preflight the moment it's called from a domain that was
// never added to ALLOWED_ORIGINS — which is every new client's site by default.
app.register(async (instance) => {
  instance.register(cors, pixelCorsOptions)
  instance.register(pageviewRoutes)
  instance.register(identifyRoutes)
  instance.register(conversionRoutes)
  instance.register(eventRoutes)
  instance.register(trackTagRoutes)
  instance.register(dniRoutes)
})

// Server-to-server (webhooks) or script-tag/redirect-loaded routes — neither
// is subject to browser CORS enforcement in the first place (no fetch/XHR
// preflight involved), so no cors plugin is needed here at all.
app.register(pixelAssetRoutes)
app.register(webhookRoutes)
app.register(shopifyWebhookRoutes)
app.register(stripeWebhookRoutes)
app.register(paypalWebhookRoutes)
app.register(squareWebhookRoutes)
app.register(goHighLevelWebhookRoutes)
app.register(twilioWebhookRoutes)
app.register(customersAiWebhookRoutes)
app.register(tagWebhookRoutes)
app.register(shopifyAppRoutes)

// Dashboard-called routes (login/register, the public share report) — kept on
// the origin-restricted policy, unchanged from before this split.
app.register(async (instance) => {
  instance.register(cors, dashboardCorsOptions)
  instance.register(authRoutes)
  instance.register(publicShareRoutes)
})

// Dashboard-facing routes — every one of these requires a valid login (authenticate)
// and, except for the two 'skip' cases handled in their own handlers (create/list
// clients, the agency-aggregate report), verifies the authenticated user actually
// owns the client this request touches (requireOwnership) before the real handler
// ever runs. See lib/ownership.ts for the full per-route resolver table.
app.register(
  async (instance) => {
    instance.register(cors, dashboardCorsOptions)
    instance.addHook('preHandler', authenticate)
    instance.addHook('preHandler', requireOwnership)
    // Step 54 — generic audit logging: every mutation (non-GET) that succeeded
    // gets one row, reusing whatever client id requireOwnership already resolved
    // rather than instrumenting each route handler individually. Read-only
    // requests aren't logged — the volume would swamp anything worth reviewing.
    instance.addHook('onResponse', async (req, reply) => {
      if (req.method === 'GET' || reply.statusCode >= 400) return
      await logAction({
        userId: req.userId ?? null,
        clientId: req.auditClientId ?? null,
        method: req.method,
        route: req.routeOptions.url ?? req.url,
        statusCode: reply.statusCode,
        ip: req.ip,
      })
    })
    instance.register(clientRoutes)
    instance.register(reportRoutes)
    instance.register(campaignDetailRoutes)
    instance.register(callRoutes)
    instance.register(remarketingRoutes)
    instance.register(pauseCandidateRoutes)
    instance.register(incrementalityRoutes)
    instance.register(creativeFatigueRoutes)
    instance.register(trackingHealthRoutes)
    instance.register(creativeTagRoutes)
    instance.register(budgetReallocationRoutes)
    instance.register(chatRoutes)
    instance.register(geoLiftRoutes)
    instance.register(customCostsRoutes)
    instance.register(shopifyImportRoutes)
    instance.register(tagRoutes)
    instance.register(audienceSyncRoutes)
    instance.register(insightsRoutes)
    instance.register(journeyRoutes)
    instance.register(jobRoutes)
    instance.register(auditLogRoutes)
  }
)

// Public Attribution API (Step 11) — the same report routes, mounted again under
// /api/v1 with bearer-token auth, so this data can feed other tools without going
// through the (unauthenticated, internal-only) dashboard surface above.
app.register(
  async (instance) => {
    instance.register(cors, dashboardCorsOptions)
    instance.addHook('onRequest', async (req, reply) => {
      const expected = process.env.API_SECRET
      const header = req.headers.authorization
      if (!expected || header !== `Bearer ${expected}`) {
        return reply.code(401).send({ error: 'Unauthorized' })
      }
    })
    instance.register(reportRoutes)
  },
  { prefix: '/api/v1' }
)

const start = async () => {
  try {
    const port = Number(process.env.PORT ?? 3001)
    await app.listen({ port, host: '0.0.0.0' })
    console.log(`API running on port ${port}`)
    // Ad-cost sync, LTV refresh, and audience sync only ever run while this
    // process is alive — there's no OS-level cron here. In production that means
    // this API needs to run on something that stays up continuously (a VPS,
    // Render/Railway/Fly, etc.), not just a laptop dev server that sleeps.
    startScheduledJobs()
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}

start()
