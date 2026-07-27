// Phase 1 guardrails config - every threshold a recommendation-generating
// surface (Gojo's LLM insights, Kado's creative fatigue detector) needs to
// decide "has this entity earned a verdict yet" lives here, not inline in
// either consumer. The one number this deliberately does NOT hold is a spend
// dollar figure: the spend side of the gate is always *computed* per client
// from client_cost_per_purchase (jobs/costPerPurchase/run.ts) x SPEND_MULTIPLIER,
// never a flat threshold - that's the whole point of the gate self-tailoring to
// each client's real economics instead of one universal number.
export const GUARDRAIL_CONFIG = {
  // Gate = (days live >= threshold) OR (spend >= trailing-30d cost-per-purchase x SPEND_MULTIPLIER).
  // Either side alone opens the gate - see recommendationGate.ts.
  daysLive: {
    creative: 7,
    campaign: 14,
  },
  spendMultiplier: 3,
  lookbackDays: 30,

  // Fallback threshold: below this many conversions in the trailing window,
  // a client's own spend/conversions figure is too thin to trust (new
  // account, zero purchases, or a sample size where one unusually large/small
  // sale swings the average heavily) and costPerPurchase/run.ts substitutes
  // this niche's industry-benchmark figure instead (see
  // config/industryBenchmarks.ts) — NOT a flat dollar number across every
  // business type. Raised 5 -> 10 (2026-07-27): 5 conversions is thin for a
  // spend/conversions average; 10 trades a slightly longer fallback period for
  // a materially more stable per-client figure once real data kicks in. Still
  // a judgment call — raise further if a client's early "real" cost-per-
  // purchase still looks noisy at n=10.
  //
  // Confirmed 2026-07-28: this never touched BlackB4U or Nothing But Buckets —
  // both clear this threshold comfortably (145 and 586 purchases), so their
  // gates were always their own true 3x ($90.33 and $15.18 respectively). The
  // fallback only ever applies to clients below the threshold.
  fallback: {
    minConversionsToTrust: 10,
  },

  // Optional secondary check (1.1's "statistical confidence" note) - off by
  // default. When enabled, a creative/campaign that cleared the gate on spend
  // alone but has fewer than minConversions real conversions gets confidence
  // forced to 'low' instead of whatever the gate math would otherwise say.
  minConversionCheck: {
    enabled: false,
    minConversions: 10,
  },
} as const

export type EntityType = 'creative' | 'campaign'

// Which event counts as "purchase" for the cost-per-purchase calc, resolved
// PER CLIENT rather than a fixed niche switch - see costPerPurchase/run.ts's
// resolveConversionEvent() for why (a lead_gen or info_product client that
// actually takes Stripe/Shopify purchases should be measured on those, not
// forced onto a lead-count proxy just because of their niche label).
export type ConversionEvent = 'purchase' | 'subscription_conversion' | 'qualified_call' | 'lead' | 'fallback'
