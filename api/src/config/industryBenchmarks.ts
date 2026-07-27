// Phase 1.3 — industry-aware benchmarks (2026-07-28). Distinct from
// client_cost_per_purchase (real, measured, per-client): these are external
// rule-of-thumb figures from paid-social/search industry research, used in
// exactly two places:
//   1. costPerPurchase/run.ts's fallback, when a client has too few
//      conversions of their own to trust a computed figure — the fallback is
//      now "what's typical for this niche," not one flat number across every
//      business type.
//   2. insightsAgent.ts's prompt — judging whether an account's CTR/ROAS/
//      cost-per-conversion is actually good or bad for ITS industry, instead
//      of one universal standard.
//
// Every figure below has a one-line source in the `source` field — these are
// general industry benchmarks, not measured from this app's own clients, and
// will drift over time. Revisit if they start looking stale.
export type Niche = 'ecommerce' | 'call' | 'lead_gen' | 'saas' | 'info_product' | 'other'

export interface IndustryBenchmark {
  typicalCostPerConversion: number
  conversionLabel: string
  ctrPercent: { low: number; high: number }
  // null for niches where ROAS isn't the right lens (lead/call-driven
  // businesses aren't optimizing for a revenue-per-ad-dollar ratio the same
  // way ecommerce/info-product are).
  roas: { low: number; high: number } | null
  source: string
}

export const INDUSTRY_BENCHMARKS: Record<Niche, IndustryBenchmark> = {
  ecommerce: {
    typicalCostPerConversion: 38,
    conversionLabel: 'cost per purchase',
    ctrPercent: { low: 1.5, high: 2.5 },
    roas: { low: 1.5, high: 2.5 },
    source: '2026 Meta/Facebook Ads ecommerce benchmarks — median CPA ~$38, median ROAS ~1.9x (1.5-2.5x normal for DTC), CTR 1.85-2.70% by category (influee.co, 27five.com)',
  },
  info_product: {
    typicalCostPerConversion: 35,
    conversionLabel: 'cost per purchase',
    ctrPercent: { low: 1.5, high: 2.5 },
    roas: { low: 1.5, high: 2.5 },
    source: 'No dedicated info-product benchmark found — extrapolated from ecommerce paid-social figures (similar funnel shape, typically lower AOV than physical goods)',
  },
  saas: {
    typicalCostPerConversion: 250,
    conversionLabel: 'cost per new paying customer',
    ctrPercent: { low: 1.0, high: 2.0 },
    roas: null,
    source: 'Self-serve SaaS CAC benchmark, $100-500 range (userpilot.com, digitalapplied.com 2026) — deliberately NOT the $702-11,400 enterprise/sales-led figures from the same research, which don\'t fit this app\'s self-serve-style clients',
  },
  call: {
    typicalCostPerConversion: 120,
    conversionLabel: 'cost per qualified call',
    ctrPercent: { low: 1.0, high: 2.0 },
    roas: null,
    source: 'Home-services/Local-Service-Ads cost-per-booked-appointment benchmark, ~$125 (queenconsultancy.com, searchlightdigital.io 2026) — dental/legal call-funnel clients run meaningfully higher ($150-400+), revisit per-client if this app ever segments "call" further',
  },
  lead_gen: {
    typicalCostPerConversion: 40,
    conversionLabel: 'cost per lead',
    ctrPercent: { low: 1.0, high: 2.0 },
    roas: null,
    source: 'Blended Meta/Google cost-per-lead estimate across common lead-gen verticals, $27-72 range, excluding legal/healthcare outliers which run far higher (landerlab.io, adamigo.ai 2026)',
  },
  other: {
    typicalCostPerConversion: 50,
    conversionLabel: 'cost per conversion',
    ctrPercent: { low: 1.0, high: 2.0 },
    roas: null,
    source: 'Generic fallback-of-fallbacks — a rough average across the other niches above, used only when the client\'s own niche is unknown/"other"',
  },
}

// Defensive default for a niche value that somehow doesn't match the DB's
// clients_niche_check constraint (shouldn't happen — the constraint only
// allows the six keys above — but a raw TEXT column reaching this code isn't
// statically known to TypeScript to be one of them).
export function benchmarkForNiche(niche: string): IndustryBenchmark {
  return INDUSTRY_BENCHMARKS[niche as Niche] ?? INDUSTRY_BENCHMARKS.other
}
