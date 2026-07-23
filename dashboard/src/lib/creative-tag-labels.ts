// Shared between the per-creative AI Tags panel and the account-wide Creative
// Patterns page — must match the ALLOWED_* value lists in
// api/src/lib/creativeTagging.ts exactly.
export const TAG_LABEL: Record<string, string> = {
  question: "Question",
  bold_claim: "Bold claim",
  social_proof: "Social proof",
  problem_agitate: "Problem/agitate",
  curiosity: "Curiosity",
  direct_offer: "Direct offer",
  discount_promo: "Discount/promo",
  urgency_scarcity: "Urgency/scarcity",
  benefit_led: "Benefit-led",
  feature_led: "Feature-led",
  testimonial: "Testimonial",
  comparison: "Comparison",
  casual: "Casual",
  professional: "Professional",
  urgent: "Urgent",
  playful: "Playful",
  aspirational: "Aspirational",
  other: "Other",
};

export const DIMENSION_LABEL: Record<string, string> = {
  hook_type: "Hook Type",
  angle: "Angle",
  tone: "Tone",
};
