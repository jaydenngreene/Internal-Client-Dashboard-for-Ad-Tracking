import { Niche } from '../config/nicheVocabulary'

export type AttributionModel = 'first_click' | 'last_click' | 'linear' | 'time_decay' | 'u_shaped'

// Product decision (2026-08-01): ecommerce/info_product purchases are
// high-volume and often impulse-driven, so Last Click (matching Meta's own
// default and Shopify's own "last non-direct click" dashboard convention)
// answers "which ad triggered the immediate sale" for daily budget/creative
// scaling decisions. Lead-driven niches (lead_gen, call, saas) and the
// generic 'other' bucket have longer, multi-touch consideration cycles, so
// U-Shaped (40/40/20) credits both the ad that first created awareness and
// the one that closed it, rather than crediting a single touch.
//
// This is only ever a STARTING default, applied once at client creation
// (see clients.ts's POST /clients) — every client can switch to any of the
// 5 models at any time from Settings, and changing this mapping later never
// retroactively touches an existing client's current setting.
const NICHE_DEFAULT_ATTRIBUTION_MODEL: Record<Niche, AttributionModel> = {
  ecommerce: 'last_click',
  info_product: 'last_click',
  saas: 'u_shaped',
  call: 'u_shaped',
  lead_gen: 'u_shaped',
  other: 'u_shaped',
}

export function defaultAttributionModelForNiche(niche: string): AttributionModel {
  return NICHE_DEFAULT_ATTRIBUTION_MODEL[niche as Niche] ?? 'first_click'
}
