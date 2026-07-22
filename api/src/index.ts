import Fastify, { FastifyError } from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import * as Sentry from '@sentry/node'
import * as dotenv from 'dotenv'
import * as path from 'path'

import { pageviewRoutes } from './routes/pageview'
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
import { customCostsRoutes } from './routes/customCosts'
import { tagRoutes, trackTagRoutes } from './routes/tags'
import { audienceSyncRoutes } from './routes/audienceSync'
import { insightsRoutes } from './routes/insights'
import { journeyRoutes } from './routes/journey'
import { jobRoutes } from './routes/jobs'
import { authRoutes } from './routes/auth'
import { authenticate } from './lib/auth'
import { requireOwnership } from './lib/ownership'
import { startScheduledJobs } from './lib/scheduler'

dotenv.config({ path: path.join(__dirname, '../../../.env') })

// Same disclosure pattern as every other integration: without a real SENTRY_DSN,
// Sentry.init's own SDK behavior is to no-op (nothing is captured or sent) —
// there's no custom guard needed here, just an unset env var.
Sentry.init({ dsn: process.env.SENTRY_DSN, tracesSampleRate: 0.1 })

const app = Fastify({ logger: true, trustProxy: true })

const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '').split(',').map((o) => o.trim())

app.register(cors, {
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
      cb(null, true)
    } else {
      cb(new Error('Not allowed by CORS'), false)
    }
  },
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
})

app.register(helmet)

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

// Third-party/pixel-facing routes — authenticate themselves a different way
// (pixel_key, a webhook signature, or a per-client shared secret), never a
// logged-in dashboard user, so none of these sit behind the auth block below.
app.register(pageviewRoutes)
app.register(identifyRoutes)
app.register(conversionRoutes)
app.register(eventRoutes)
app.register(webhookRoutes)
app.register(shopifyWebhookRoutes)
app.register(stripeWebhookRoutes)
app.register(paypalWebhookRoutes)
app.register(squareWebhookRoutes)
app.register(goHighLevelWebhookRoutes)
app.register(twilioWebhookRoutes)
app.register(customersAiWebhookRoutes)
app.register(tagWebhookRoutes)
app.register(dniRoutes)
app.register(shopifyAppRoutes)
app.register(trackTagRoutes)
app.register(authRoutes)
app.register(publicShareRoutes)

// Dashboard-facing routes — every one of these requires a valid login (authenticate)
// and, except for the two 'skip' cases handled in their own handlers (create/list
// clients, the agency-aggregate report), verifies the authenticated user actually
// owns the client this request touches (requireOwnership) before the real handler
// ever runs. See lib/ownership.ts for the full per-route resolver table.
app.register(
  async (instance) => {
    instance.addHook('preHandler', authenticate)
    instance.addHook('preHandler', requireOwnership)
    instance.register(clientRoutes)
    instance.register(reportRoutes)
    instance.register(campaignDetailRoutes)
    instance.register(callRoutes)
    instance.register(remarketingRoutes)
    instance.register(pauseCandidateRoutes)
    instance.register(customCostsRoutes)
    instance.register(tagRoutes)
    instance.register(audienceSyncRoutes)
    instance.register(insightsRoutes)
    instance.register(journeyRoutes)
    instance.register(jobRoutes)
  }
)

// Public Attribution API (Step 11) — the same report routes, mounted again under
// /api/v1 with bearer-token auth, so this data can feed other tools without going
// through the (unauthenticated, internal-only) dashboard surface above.
app.register(
  async (instance) => {
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
