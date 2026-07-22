import { db } from '../../db'
import { getOverviewSummary } from '../../lib/overviewSummary'
import { sendScheduledReportEmail } from '../../lib/email'

interface ScheduledClient {
  id: string
  name: string
  currency: string
  email: string
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

// Step 57 — sends to the owning user's email (clients has no dedicated contact-
// email column; users.email is the only structurally-typed address on the
// account, same choice password-reset/verification emails already made).
async function getScheduledClients(frequency: 'weekly' | 'monthly'): Promise<ScheduledClient[]> {
  const { rows } = await db.query<ScheduledClient>(
    `SELECT clients.id, clients.name, clients.currency, users.email
     FROM clients JOIN users ON users.id = clients.owner_user_id
     WHERE clients.report_schedule_frequency = $1`,
    [frequency]
  )
  return rows
}

// Per-client try/catch so one bad email address or a transient DB hiccup on one
// client's summary doesn't block every other client's report that run — same
// isolation convention as jobs/adCosts/run.ts.
async function sendReportsFor(frequency: 'weekly' | 'monthly', from: string, to: string): Promise<number> {
  const clients = await getScheduledClients(frequency)
  let sent = 0
  for (const client of clients) {
    try {
      const summary = await getOverviewSummary(client.id, from, to)
      await sendScheduledReportEmail(client.email, {
        clientName: client.name,
        from,
        to,
        cost: summary.cost,
        revenue: summary.revenue,
        profit: summary.profit,
        roas: summary.roas,
        leads: summary.leads,
        sales: summary.sales,
        currency: client.currency,
      })
      sent++
    } catch (err) {
      console.error(`[scheduledReports] failed to send ${frequency} report for client ${client.id}:`, (err as Error).message)
    }
  }
  return sent
}

export async function sendWeeklyReports(): Promise<number> {
  const to = new Date()
  to.setUTCDate(to.getUTCDate() - 1) // yesterday, same "today's still incomplete" reasoning as other jobs
  const from = new Date(to)
  from.setUTCDate(from.getUTCDate() - 6) // trailing 7 days including `to`
  return sendReportsFor('weekly', isoDate(from), isoDate(to))
}

export async function sendMonthlyReports(): Promise<number> {
  const to = new Date()
  to.setUTCDate(to.getUTCDate() - 1)
  const from = new Date(to)
  from.setUTCDate(from.getUTCDate() - 29) // trailing 30 days, matches every other report's default window
  return sendReportsFor('monthly', isoDate(from), isoDate(to))
}
