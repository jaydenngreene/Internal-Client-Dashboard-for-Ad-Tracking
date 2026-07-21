import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
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
import { clientRoutes } from './routes/clients'
import { reportRoutes } from './routes/reports'
import { dniRoutes } from './routes/dni'
import { callRoutes } from './routes/calls'
import { shopifyAppRoutes } from './routes/shopifyApp'
import { remarketingRoutes } from './routes/remarketing'
import { customCostsRoutes } from './routes/customCosts'
import { tagRoutes } from './routes/tags'
import { audienceSyncRoutes } from './routes/audienceSync'

dotenv.config({ path: path.join(__dirname, '../../../.env') })

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
  methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
})

app.register(helmet)

app.get('/health', async () => ({ status: 'ok' }))

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
app.register(clientRoutes)
app.register(reportRoutes)
app.register(dniRoutes)
app.register(callRoutes)
app.register(shopifyAppRoutes)
app.register(remarketingRoutes)
app.register(customCostsRoutes)
app.register(tagRoutes)
app.register(audienceSyncRoutes)

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
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}

start()
