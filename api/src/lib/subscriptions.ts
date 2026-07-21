import { db } from '../db'

export type SubscriptionStatus =
  | 'incomplete'
  | 'incomplete_expired'
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'unpaid'
  | 'paused'

export interface SubscriptionInput {
  email?: string | null
  processor: string
  externalSubscriptionId: string
  planName?: string | null
  status: SubscriptionStatus
  mrrAmount: number
  currency?: string
  trialEndsAt?: Date | null
  currentPeriodEnd?: Date | null
  startedAt?: Date | null
  canceledAt?: Date | null
}

// MRR only counts real, currently-active revenue — trialing subscriptions haven't
// paid anything yet, so entering/leaving 'active' is what actually moves MRR.
// Only real transitions get a subscription_events row; a webhook redelivery with no
// status or mrr change (very common — Stripe retries and sends near-duplicate
// updates) just refreshes the row's other fields without logging a fake event.
export async function upsertSubscription(clientId: string, input: SubscriptionInput): Promise<void> {
  const { rows: existingRows } = await db.query<{
    id: string
    status: SubscriptionStatus
    mrr_amount: string
    email: string | null
  }>(
    `SELECT id, status, mrr_amount, email FROM subscriptions
     WHERE client_id = $1 AND processor = $2 AND external_subscription_id = $3`,
    [clientId, input.processor, input.externalSubscriptionId]
  )
  const existing = existingRows[0]

  const { rows: upsertedRows } = await db.query<{ id: string }>(
    `INSERT INTO subscriptions
       (client_id, email, processor, external_subscription_id, plan_name, status, mrr_amount, currency,
        trial_ends_at, current_period_end, started_at, canceled_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     ON CONFLICT (client_id, processor, external_subscription_id)
     DO UPDATE SET
       email = COALESCE(EXCLUDED.email, subscriptions.email),
       plan_name = COALESCE(EXCLUDED.plan_name, subscriptions.plan_name),
       status = EXCLUDED.status,
       mrr_amount = EXCLUDED.mrr_amount,
       currency = EXCLUDED.currency,
       trial_ends_at = COALESCE(EXCLUDED.trial_ends_at, subscriptions.trial_ends_at),
       current_period_end = COALESCE(EXCLUDED.current_period_end, subscriptions.current_period_end),
       started_at = COALESCE(EXCLUDED.started_at, subscriptions.started_at),
       canceled_at = COALESCE(EXCLUDED.canceled_at, subscriptions.canceled_at)
     RETURNING id`,
    [
      clientId,
      input.email ?? null,
      input.processor,
      input.externalSubscriptionId,
      input.planName ?? null,
      input.status,
      input.mrrAmount,
      input.currency ?? 'USD',
      input.trialEndsAt ?? null,
      input.currentPeriodEnd ?? null,
      input.startedAt ?? null,
      input.canceledAt ?? null,
    ]
  )
  const subscriptionId = upsertedRows[0].id

  const { eventType, mrrDelta } = classifyTransition(existing, input)
  if (eventType) {
    await db.query(
      `INSERT INTO subscription_events (client_id, subscription_id, event_type, from_status, to_status, mrr_delta)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [clientId, subscriptionId, eventType, existing?.status ?? null, input.status, mrrDelta]
    )
  }
}

function classifyTransition(
  existing: { status: SubscriptionStatus; mrr_amount: string } | undefined,
  input: SubscriptionInput
): { eventType: string | null; mrrDelta: number } {
  if (!existing) {
    if (input.status === 'trialing') return { eventType: 'trial_started', mrrDelta: 0 }
    if (input.status === 'active') return { eventType: 'created', mrrDelta: input.mrrAmount }
    return { eventType: 'created', mrrDelta: 0 }
  }

  const fromStatus = existing.status
  const oldMrr = parseFloat(existing.mrr_amount)

  if (fromStatus === input.status) {
    if (input.status === 'active' && oldMrr !== input.mrrAmount) {
      return { eventType: 'plan_changed', mrrDelta: input.mrrAmount - oldMrr }
    }
    return { eventType: null, mrrDelta: 0 }
  }

  if (input.status === 'active' && fromStatus === 'trialing') {
    return { eventType: 'trial_converted', mrrDelta: input.mrrAmount }
  }
  if (input.status === 'active') {
    return { eventType: 'reactivated', mrrDelta: input.mrrAmount }
  }
  if (fromStatus === 'active' && (input.status === 'canceled' || input.status === 'unpaid')) {
    return { eventType: 'canceled', mrrDelta: -oldMrr }
  }
  if (fromStatus === 'active' && input.status === 'past_due') {
    return { eventType: 'past_due', mrrDelta: -oldMrr }
  }

  return { eventType: null, mrrDelta: 0 }
}
