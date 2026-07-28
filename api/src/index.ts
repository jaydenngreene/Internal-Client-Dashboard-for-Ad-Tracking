import Fastify, { FastifyError, FastifyRequest, FastifyReply } from 'fastify'
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
import { housecallProWebhookRoutes } from './routes/webhooks/housecallpro'
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
import { notificationsRoutes } from './routes/notifications'
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
import { uploadRoutes, uploadServeRoutes } from './routes/uploads'
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

// Confirmed live (2026-07-28): navigator.sendBeacon()/browser.sendBeacon() sent
// with a raw string (not a Blob) defaults to Content-Type: text/plain, not
// application/json - a well-known Beacon API gotcha. Fastify has no default
// JSON parser for text/plain, so req.body came through as the raw string
// itself, and every /track/* route's required-field destructuring silently
// read undefined for everything - a real Nothing But Buckets checkout pixel
// call was doing exactly this (fixed at the source in the pixel snippet too,
// see docs/ISSUE_LOG.md), but this parser makes the server tolerant of the
// same mistake anywhere else a future sendBeacon call makes it, rather than
// each one silently 400ing with no visible cause.
app.addContentTypeParser('text/plain', { parseAs: 'string' }, (_req, body, done) => {
  try {
    done(null, JSON.parse(body as string))
  } catch {
    done(null, {})
  }
})

const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '').split(',').map((o) => o.trim())

// @fastify/cors is wrapped with fastify-plugin (breaks encapsulation on
// purpose, so its hooks reach every route) — registering it more than once
// across sibling scopes makes Fastify's plugin loader treat the second
// registration as re-entering the same already-booting plugin, and it hangs
// until FST_ERR_PLUGIN_TIMEOUT kills the whole server. So: exactly ONE
// registration, permissive (reflects any origin) — this is what the pixel
// needs, since it's authenticated by pixel_key and runs on client websites
// that can never be enumerated in advance, not by origin trust. Restricting
// specific routes to just this app's own dashboard frontend is instead a
// plain onRequest hook below (requireDashboardOrigin) - a normal function,
// not a plugin, so it can be attached to as many scopes as needed with none
// of the above risk.
// credentials: true is required here — confirmed live: navigator.sendBeacon()
// (what pixel.js uses for every track/* call) sends cross-origin requests with
// credentials included by default in current Chrome, and per the CORS spec a
// credentialed request's preflight fails unless the server explicitly answers
// Access-Control-Allow-Credentials: true (Access-Control-Allow-Origin reflecting
// the real origin, which origin: true already does, isn't sufficient on its
// own). None of these routes actually read cookies for auth — pixel_key in the
// body does that — so this doesn't grant anything new, it just stops the
// browser from blocking the response on a technicality the request already
// opted into.
app.register(cors, { origin: true, credentials: true, methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'] })

function requireDashboardOrigin(req: FastifyRequest, reply: FastifyReply, done: (err?: Error) => void) {
  const origin = req.headers.origin
  if (origin && !allowedOrigins.includes(origin) && !allowedOrigins.includes('*')) {
    reply.code(403).send({ error: 'Not allowed by CORS' })
    return
  }
  done()
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
// websites, authenticated by pixel_key rather than by origin. Covered by the
// permissive global cors registration above; no per-scope hook needed.
app.register(pageviewRoutes)
app.register(identifyRoutes)
app.register(conversionRoutes)
app.register(eventRoutes)
app.register(trackTagRoutes)
app.register(dniRoutes)

// Server-to-server (webhooks) or script-tag/redirect-loaded routes — neither
// is subject to browser CORS enforcement in the first place (no fetch/XHR
// preflight involved).
app.register(pixelAssetRoutes)
app.register(uploadServeRoutes)
app.register(webhookRoutes)
app.register(shopifyWebhookRoutes)
app.register(stripeWebhookRoutes)
app.register(paypalWebhookRoutes)
app.register(squareWebhookRoutes)
app.register(goHighLevelWebhookRoutes)
app.register(housecallProWebhookRoutes)
app.register(twilioWebhookRoutes)
app.register(customersAiWebhookRoutes)
app.register(tagWebhookRoutes)
app.register(shopifyAppRoutes)

// Dashboard-called routes (login/register, the public share report) — kept on
// the origin-restricted policy, unchanged from before this split.
app.register(async (instance) => {
  instance.addHook('onRequest', requireDashboardOrigin)
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
    instance.addHook('onRequest', requireDashboardOrigin)
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
    instance.register(notificationsRoutes)
    instance.register(jobRoutes)
    instance.register(auditLogRoutes)
    instance.register(uploadRoutes)
  }
)

// Public Attribution API (Step 11) — the same report routes, mounted again under
// /api/v1 with bearer-token auth, so this data can feed other tools without going
// through the (unauthenticated, internal-only) dashboard surface above.
app.register(
  async (instance) => {
    instance.addHook('onRequest', requireDashboardOrigin)
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

// Without this, Railway's SIGTERM during a redeploy kills the process
// immediately — any webhook/pixel request already accepted (e.g. mid-DB-write
// on a Shopify order) is severed rather than allowed to finish. app.close()
// stops accepting new connections and waits for in-flight ones to complete;
// railway.json's drainingSeconds (15s) is the window Railway waits before
// escalating to SIGKILL if this hangs. Pairs with railway.json's
// healthcheckPath/overlapSeconds, which keep the *previous* deploy serving
// traffic until the new one is confirmed listening — together these close the
// "container not actually up yet" gap that plausibly dropped requests before.
let shuttingDown = false
async function gracefulShutdown(signal: string) {
  if (shuttingDown) return
  shuttingDown = true
  app.log.info(`${signal} received, draining in-flight requests before exit`)
  try {
    await app.close()
    app.log.info('drained cleanly, exiting')
    process.exit(0)
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
process.on('SIGINT', () => gracefulShutdown('SIGINT'))
