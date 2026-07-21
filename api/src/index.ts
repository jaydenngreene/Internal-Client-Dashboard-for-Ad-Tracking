import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import * as dotenv from 'dotenv'
import * as path from 'path'

import { pageviewRoutes } from './routes/pageview'
import { identifyRoutes } from './routes/identify'
import { conversionRoutes } from './routes/conversion'
import { webhookRoutes } from './routes/webhooks'
import { shopifyWebhookRoutes } from './routes/webhooks/shopify'
import { clientRoutes } from './routes/clients'

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
  methods: ['GET', 'POST', 'OPTIONS'],
})

app.register(helmet)

app.get('/health', async () => ({ status: 'ok' }))

app.register(pageviewRoutes)
app.register(identifyRoutes)
app.register(conversionRoutes)
app.register(webhookRoutes)
app.register(shopifyWebhookRoutes)
app.register(clientRoutes)

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
