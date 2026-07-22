import { db } from '../db'
import { sendEmail } from './email'

export interface AlertConfig {
  slack_webhook_url?: string
  alert_email?: string
  alert_phone?: string
}

interface TwilioConfig {
  account_sid: string
  auth_token: string
}

async function getAlertConfig(clientId: string): Promise<AlertConfig | null> {
  const { rows } = await db.query<{ config: AlertConfig }>(
    `SELECT config FROM client_integrations WHERE client_id = $1 AND platform = 'alerts'`,
    [clientId]
  )
  return rows[0]?.config ?? null
}

async function sendSlackAlert(webhookUrl: string, title: string, message: string): Promise<void> {
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: `*${title}*\n${message}` }),
  })
  if (!res.ok) throw new Error(`Slack webhook failed (${res.status})`)
}

// Reuses whatever Twilio account_sid/auth_token the client already has configured
// for call tracking (Step 11) and one of their own registered tracking numbers as
// the "from" — this app never provisions its own Twilio account, same boundary as
// everywhere else Twilio is touched. Silently skipped if either is missing.
async function sendSmsAlert(clientId: string, toPhone: string, message: string): Promise<void> {
  const [twilioRow, numberRow] = await Promise.all([
    db.query<{ config: TwilioConfig }>(
      `SELECT config FROM client_integrations WHERE client_id = $1 AND platform = 'twilio'`,
      [clientId]
    ),
    db.query<{ phone_number: string }>(`SELECT phone_number FROM tracking_numbers WHERE client_id = $1 LIMIT 1`, [
      clientId,
    ]),
  ])
  const twilioConfig = twilioRow.rows[0]?.config
  const fromNumber = numberRow.rows[0]?.phone_number
  if (!twilioConfig || !fromNumber) {
    console.warn(`[alerts] SMS skipped for client ${clientId} — no Twilio config or tracking number registered.`)
    return
  }

  const auth = Buffer.from(`${twilioConfig.account_sid}:${twilioConfig.auth_token}`).toString('base64')
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilioConfig.account_sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ To: toPhone, From: fromNumber, Body: message }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Twilio SMS send failed (${res.status}): ${text}`)
  }
}

// Dispatches an alert to whichever channels a client has configured (Slack/email/
// SMS, any subset). Same never-throw, log-and-continue-per-channel convention as
// sendConversionSignals/dispatchEvent — an alert-delivery failure must never break
// whatever anomaly-detection or auto-pause flow triggered it.
export async function sendAlert(clientId: string, title: string, message: string): Promise<void> {
  const config = await getAlertConfig(clientId)
  if (!config) return

  const tasks: Promise<void>[] = []
  if (config.slack_webhook_url) {
    tasks.push(
      sendSlackAlert(config.slack_webhook_url, title, message).catch((err) =>
        console.error(`[alerts] Slack send failed for client ${clientId}:`, (err as Error).message)
      )
    )
  }
  if (config.alert_email) {
    tasks.push(
      sendEmail(config.alert_email, title, `<p>${message.replace(/\n/g, '<br/>')}</p>`).catch((err) =>
        console.error(`[alerts] email send failed for client ${clientId}:`, (err as Error).message)
      )
    )
  }
  if (config.alert_phone) {
    tasks.push(
      sendSmsAlert(clientId, config.alert_phone, `${title}: ${message}`).catch((err) =>
        console.error(`[alerts] SMS send failed for client ${clientId}:`, (err as Error).message)
      )
    )
  }
  await Promise.all(tasks)
}
