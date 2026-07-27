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

  // Cost-per-purchase fallback: used when a client has too few conversions in
  // the trailing window for spend/conversions to mean anything (new account,
  // zero purchases, or a sample too thin to trust). Both numbers are
  // placeholders pending the user's real figures - see docs/ISSUE_LOG.md or ask
  // before relying on them for a live client.
  fallback: {
    costPerPurchase: 50, // TODO(user): set the real fallback $ figure
    minConversionsToTrust: 5, // below this many conversions in the window, use the fallback instead
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
