import { FastifyInstance } from 'fastify'
import { db } from '../db'

// System-wide (not per-client) — every logged-in user can see whether the
// scheduled jobs are actually running, same reasoning as there being no
// per-client breakdown of ad-cost-sync failures: these jobs run once across
// every client regardless of who owns them.
export async function jobRoutes(app: FastifyInstance) {
  app.get('/jobs/status', async (_req, reply) => {
    const { rows } = await db.query<{
      job_name: string
      status: string
      error: string | null
      started_at: string
      finished_at: string
    }>(
      `SELECT DISTINCT ON (job_name) job_name, status, error, started_at, finished_at
       FROM job_runs ORDER BY job_name, finished_at DESC`
    )
    return reply.send(rows)
  })
}
