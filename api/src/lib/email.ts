import { Resend } from 'resend'

// Same disclosure pattern as every other unconfigured integration in this app
// (Facebook, Google Ads, etc): the code path is real and complete, but does
// nothing until a real RESEND_API_KEY exists. Read lazily (not at module load)
// so tests and a cold-start server never crash just because it's unset.
function getClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY
  return apiKey ? new Resend(apiKey) : null
}

export async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const client = getClient()
  const from = process.env.EMAIL_FROM
  if (!client || !from) {
    console.warn(
      `[email] RESEND_API_KEY/EMAIL_FROM not configured — would have sent "${subject}" to ${to}, skipping.`
    )
    return
  }
  try {
    await client.emails.send({ from, to, subject, html })
  } catch (err) {
    // Never let a failed email send break the request that triggered it (e.g.
    // /auth/forgot-password always responds the same way whether or not the
    // email actually goes out, to avoid leaking which emails have accounts).
    console.error(`[email] failed to send "${subject}" to ${to}:`, (err as Error).message)
  }
}

export function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  return sendEmail(
    to,
    'Reset your password',
    `<p>Someone requested a password reset for this account.</p>
     <p><a href="${resetUrl}">Click here to set a new password</a>. This link expires in 1 hour.</p>
     <p>If you didn't request this, you can safely ignore this email.</p>`
  )
}

export function sendVerificationEmail(to: string, verifyUrl: string): Promise<void> {
  return sendEmail(
    to,
    'Verify your email',
    `<p>Confirm this is your email address to finish setting up your account.</p>
     <p><a href="${verifyUrl}">Click here to verify</a>.</p>`
  )
}

interface ScheduledReportSummary {
  clientName: string
  from: string
  to: string
  cost: number
  revenue: number
  profit: number
  roas: number | null
  leads: number
  sales: number
  currency: string
}

const money = (n: number, currency: string) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n)

// Step 57 — the periodic (weekly/monthly) account summary a client owner opts
// into via clients.report_schedule_frequency. Reuses the exact numbers
// `/reports/overview` computes (via lib/overviewSummary.ts) rather than a
// second hand-written aggregation.
export function sendScheduledReportEmail(to: string, s: ScheduledReportSummary): Promise<void> {
  return sendEmail(
    to,
    `${s.clientName} performance summary: ${s.from} to ${s.to}`,
    `<p>Here's how <strong>${s.clientName}</strong> performed from ${s.from} to ${s.to}:</p>
     <ul>
       <li>Ad spend: ${money(s.cost, s.currency)}</li>
       <li>Attributed revenue: ${money(s.revenue, s.currency)}</li>
       <li>Profit: ${money(s.profit, s.currency)}</li>
       <li>ROAS: ${s.roas === null ? 'n/a (no spend in this window)' : `${s.roas.toFixed(2)}x`}</li>
       <li>Leads: ${s.leads}</li>
       <li>Sales: ${s.sales}</li>
     </ul>
     <p>Log in to the dashboard for the full breakdown by campaign and source.</p>
     <p style="color:#888;font-size:12px">You're receiving this because scheduled reports are enabled for this client in Settings. You can turn this off there at any time.</p>`
  )
}
