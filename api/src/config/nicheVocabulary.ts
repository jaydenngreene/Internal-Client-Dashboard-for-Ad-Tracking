// Phase 3 (2026-07-28) — the data-resolution half of the niche vocabulary
// (which table/event counts as "a conversion" for this niche, and whether a
// meaningful dollar/value figure exists for it). The presentation half
// (labels, headers) lives in dashboard/src/lib/niche-vocabulary.ts — kept
// separate rather than one shared file since api/ and dashboard/ are
// separate workspaces with no shared package; this file is the single
// source of truth for the DATA side, that one for the UI side, and both are
// keyed by the same niche strings so they can't drift apart silently.
//
// Deliberately NOT the same lookup jobs/costPerPurchase/run.ts's
// resolveConversionCount() uses — that function tries purchases first for
// EVERY niche regardless of label (the right call for "what's the most
// meaningful economic signal for the gate"), which would violate the
// explicit product decision here: the niche's declared label drives which
// event this feature shows, full stop, so a lead-gen client's tab always
// means leads even if they also happen to take payments. What IS shared
// between the two: the niche->event mapping itself, factored out here so
// costPerPurchase's future changes and this feature's mapping can't disagree
// by accident (resolveConversionCount still owns its own purchases-first
// fallback cascade on top of this, unchanged).
export type Niche = 'ecommerce' | 'call' | 'lead_gen' | 'saas' | 'info_product' | 'other'
export type ConversionEventType = 'purchase' | 'subscription_conversion' | 'qualified_call' | 'lead'

export interface NicheConversionConfig {
  eventType: ConversionEventType
  // Whether a meaningful dollar/value figure exists for this niche's
  // conversion event TODAY, in this app's actual schema — not "could a value
  // exist in principle." call funnels have no deal_value field on `calls`
  // yet, so this is false for 'call' even though the product spec's own
  // vocabulary table says "if tracked" — nothing tracks it yet.
  hasValue: boolean
}

export const NICHE_CONVERSION: Record<Niche, NicheConversionConfig> = {
  ecommerce: { eventType: 'purchase', hasValue: true },
  info_product: { eventType: 'purchase', hasValue: true },
  saas: { eventType: 'subscription_conversion', hasValue: true }, // value = mrr_amount
  call: { eventType: 'qualified_call', hasValue: false }, // no deal_value field exists yet
  lead_gen: { eventType: 'lead', hasValue: false },
  // 'other' (also covers unset/unrecognized, since clients.niche defaults to
  // 'other' and its CHECK constraint only allows these six values) - the
  // lowest-common-denominator event this app can track for literally any
  // client type is a lead/opt-in capture via /track/identify, so 'other'
  // resolves to the same event data as lead_gen while keeping its OWN
  // generic label (see dashboard's niche-vocabulary.ts) rather than being
  // mislabeled "Leads".
  other: { eventType: 'lead', hasValue: false },
}

export function conversionConfigForNiche(niche: string): NicheConversionConfig {
  return NICHE_CONVERSION[niche as Niche] ?? NICHE_CONVERSION.other
}
