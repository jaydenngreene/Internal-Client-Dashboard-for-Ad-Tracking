// Phase 3 (2026-07-28) — the presentation half of the niche vocabulary (see
// api/src/config/nicheVocabulary.ts for the data-resolution half: which table
// counts as "a conversion" and whether a value figure exists — kept separate
// since api/ and dashboard/ are different workspaces with no shared package).
// Every user-facing string on the Customer Buying Journey page comes from
// here — no niche conditionals scattered through the component itself.
export interface NicheVocabulary {
  // Page header (h1) and sidebar nav label — same string, both places, so
  // they can never disagree (that mismatch was a real Phase 2 bug).
  pageLabel: string;
  personNoun: string; // "Customer", "Subscriber", "Prospect", "Lead", "Contact"
  conversionsSectionHeader: string; // single-customer detail view's conversions card title
  convertedPeopleTabLabel: string; // the second tab ("Customers Who Purchased" and its equivalents)
  valueColumnLabel: string | null; // null = hide the column entirely, not render it empty
  emailFieldLabel: string; // "Customer email", "Subscriber email", etc.
  emailPlaceholder: string;
}

const VOCABULARY: Record<string, NicheVocabulary> = {
  ecommerce: {
    pageLabel: "Customer Buying Journey",
    personNoun: "Customer",
    conversionsSectionHeader: "Purchases",
    convertedPeopleTabLabel: "Customers Who Purchased",
    valueColumnLabel: "Total spent",
    emailFieldLabel: "Customer email",
    emailPlaceholder: "customer@example.com",
  },
  info_product: {
    pageLabel: "Customers",
    personNoun: "Customer",
    conversionsSectionHeader: "Purchases",
    convertedPeopleTabLabel: "Customers Who Purchased",
    valueColumnLabel: "Total spent",
    emailFieldLabel: "Customer email",
    emailPlaceholder: "customer@example.com",
  },
  saas: {
    pageLabel: "Subscribers",
    personNoun: "Subscriber",
    conversionsSectionHeader: "Subscriptions",
    convertedPeopleTabLabel: "Subscribers Who Converted",
    valueColumnLabel: "MRR",
    emailFieldLabel: "Subscriber email",
    emailPlaceholder: "subscriber@example.com",
  },
  call: {
    pageLabel: "Booked Calls",
    personNoun: "Prospect",
    conversionsSectionHeader: "Booked calls",
    convertedPeopleTabLabel: "Prospects Who Booked",
    valueColumnLabel: null, // no deal_value field exists on `calls` yet
    emailFieldLabel: "Prospect email",
    emailPlaceholder: "prospect@example.com",
  },
  lead_gen: {
    pageLabel: "Leads",
    personNoun: "Lead",
    conversionsSectionHeader: "Form submissions",
    convertedPeopleTabLabel: "Form Submissions",
    valueColumnLabel: null,
    emailFieldLabel: "Lead email",
    emailPlaceholder: "lead@example.com",
  },
};

// Generic fallback for 'other' and any unrecognized/future niche value —
// never errors, never silently defaults to ecom's vocabulary.
const GENERIC_VOCABULARY: NicheVocabulary = {
  pageLabel: "Conversions",
  personNoun: "Contact",
  conversionsSectionHeader: "Conversions",
  convertedPeopleTabLabel: "Conversions",
  valueColumnLabel: null,
  emailFieldLabel: "Contact email",
  emailPlaceholder: "contact@example.com",
};

export function vocabularyForNiche(niche: string | undefined): NicheVocabulary {
  return (niche ? VOCABULARY[niche] : undefined) ?? GENERIC_VOCABULARY;
}

// bestPaths.ts's "Best-earning path"/"Fastest-converting path" callouts are
// revenue-path-driven (walk each purchase's attribution rows by dollar
// value) — only meaningful for niches with real per-transaction revenue
// attribution, i.e. the two 'purchase'-event niches. Not generalized to
// leads/calls/subscriptions in this pass (bestPaths.ts's own SQL is
// purchases-hardcoded; regeneralizing IT is out of scope here).
export function showsBestPaths(niche: string | undefined): boolean {
  return niche === "ecommerce" || niche === "info_product";
}
