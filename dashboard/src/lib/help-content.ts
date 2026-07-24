export interface HelpMetric {
  term: string;
  definition: string;
}

export interface HelpEntry {
  slug: string;
  title: string;
  purpose: string;
  metrics?: HelpMetric[];
  howToUse?: string;
}

export interface HelpSection {
  label: string;
  entries: HelpEntry[];
}

// One entry per sidebar item (same slugs as lib/nav-items.ts, so a future entry
// is easy to keep in sync) plus a "Concepts" section for cross-cutting ideas
// that don't belong to a single tab. Descriptions are adapted from each page's
// own subtitle where one exists, kept accurate to what the page actually does
// rather than written fresh, so this can't drift into marketing-speak that
// doesn't match the real behavior.
export const HELP_SECTIONS: HelpSection[] = [
  {
    label: "Concepts",
    entries: [
      {
        slug: "basic-pro-view",
        title: "Basic View vs. Pro View",
        purpose:
          "Overview has two densities. Basic View is a fast glance: headline numbers only, grouped under section labels, no charts or tables. Pro View adds the full widget set: trend charts, conversion breakdown, best performing ads, budget pacing, forecast, and insights.",
        howToUse: "Switch anytime with the toggle at the top of Overview. Your choice isn't saved between visits yet, it always opens on Basic View.",
      },
      {
        slug: "attribution-models",
        title: "Attribution models",
        purpose:
          "When a lead touches multiple ad sources before buying, an attribution model decides how much revenue credit each touch gets. This dashboard supports several: first click, last click, linear (split evenly), time decay (recent touches weighted more), and u-shaped (first + last touch weighted most, middle touches split the rest).",
        metrics: [
          { term: "First / Last Click", definition: "100% of the credit goes to the very first or very last touch before conversion." },
          { term: "Linear", definition: "Credit is split evenly across every touch in the path." },
          { term: "Time Decay", definition: "A touch closer to the purchase gets more credit than one further back (7-day half-life)." },
          { term: "U-Shaped", definition: "40% credit to the first touch, 40% to the last, the remaining 20% split across whatever's in between." },
          { term: "Data-Driven (Markov)", definition: "A separate, more advanced model (see Data-Driven Attribution below) that estimates credit from real conversion-path patterns instead of a fixed rule." },
        ],
        howToUse: "Most reports let you pick a model per-report (see each Reporting page's own settings). Changing it recalculates which channel looks responsible for a sale, not the underlying data.",
      },
      {
        slug: "niches",
        title: "Niches",
        purpose:
          "Every client is tagged with a niche (Ecommerce, Call, Lead Gen, SaaS, Info Product, or Other) when it's created. The dashboard uses it to decide which extra widgets and nav items make sense for that business: a SaaS client sees Subscriptions and an MRR snapshot on Overview; an ecommerce client sees cart/checkout metrics; a call-based client sees a Calls snapshot and BOF call metrics on Funnel.",
        howToUse: "Set or change a client's niche from Settings → General. It only changes which widgets show, never the underlying tracked data.",
      },
      {
        slug: "customer-journey",
        title: "Where to see one customer's full journey",
        purpose:
          "\"Which ads did this person see, which platforms, how many touches before they converted\": that's the Leads tab. Search a lead by email and you get every session that led to them (source, campaign, click IDs), which session got attribution credit for which sale, every tag applied, and every call, in order.",
        howToUse: "Go to Leads (under Reporting), type an email, hit search. If the person converted via a CRM/webhook without ever being pixel-tracked, the purchase still shows up, flagged as unattributed rather than silently missing.",
      },
      {
        slug: "date-ranges",
        title: "Date ranges & comparison",
        purpose:
          "Every report is scoped to a date range (default last 30 days, adjustable per page) and most support a comparison toggle against the prior period of equal length.",
      },
    ],
  },
  {
    label: "Reports",
    entries: [
      {
        slug: "overview",
        title: "Overview",
        purpose: "The home dashboard for one client: headline ad spend/revenue/profit/ROAS/ROI, a profitability trend, conversion rate, budget pacing, a rough forecast, best performing ads, and AI insights.",
        metrics: [
          { term: "Ad Spend", definition: "Total ad spend across every connected platform in the date range, plus any manually-added custom costs." },
          { term: "Total Revenue", definition: "Revenue attributed to ad-driven sessions, per the active attribution model." },
          { term: "Profit", definition: "Revenue minus ad spend. \"True profit\" also subtracts COGS/payment fees/fulfillment cost if configured in Settings." },
          { term: "ROAS", definition: "Return on ad spend: revenue ÷ ad spend." },
          { term: "ROI", definition: "Profit ÷ ad spend, as a percentage." },
        ],
      },
      {
        slug: "insights",
        title: "Insights",
        purpose: "AI-generated, plain-language recommendations, scoped to the whole account or one platform. Click into any campaign for its own campaign- and creative-level insight.",
        howToUse: "Insights are generated on demand, not automatically refreshed overnight. Click \"Generate insights\" (or \"Regenerate\") to get a fresh read.",
      },
      {
        slug: "chat",
        title: "Ask Your Data",
        purpose: "A chat interface that queries this client's real data live to answer a plain-English question. It doesn't guess or hallucinate numbers, every answer is backed by an actual query.",
      },
      {
        slug: "campaigns",
        title: "Campaigns",
        purpose: "The main performance breakdown table: switch between Campaign, Source, Keyword, and Creative (ad-level) views, plus an LTV-by-acquisition-campaign tab.",
        metrics: [
          { term: "CTR / CPC", definition: "Click-through rate and cost per click, straight from the ad platform." },
          { term: "CPL / Ad Spend per Purchase", definition: "Ad spend divided by leads or by purchases, whichever this client's niche optimizes for." },
          { term: "ROAS", definition: "Revenue ÷ ad spend, per row." },
        ],
        howToUse: "Sort any column by clicking its header. Export the current view to CSV with the button above the table.",
      },
      {
        slug: "funnel",
        title: "Funnel (TOF / MOF / BOF)",
        purpose: "Three stages of the same funnel: TOF (leads coming in and what they cost), MOF (engagement between first click and conversion), BOF (who actually buys, how fast, and what sticks).",
        metrics: [
          { term: "TOF: Total Leads / CPL", definition: "How many leads came in and what each one cost." },
          { term: "MOF: Engagement Rate", definition: "Share of sessions with at least one further pageview after landing." },
          { term: "MOF: Cart Abandonment (ecommerce)", definition: "Checkouts initiated that never converted to a sale." },
          { term: "BOF: Lead to Buyer Rate", definition: "Share of leads that eventually purchased." },
          { term: "BOF: Refund Rate", definition: "Share of orders refunded in the range." },
        ],
      },
      {
        slug: "mmm",
        title: "Media Mix Model",
        purpose: "Estimates how much revenue each ad platform is actually responsible for from real spend/revenue history, independent of whichever attribution model drives the rest of the dashboard. Includes a budget scenario simulator: \"what if I moved $X/day from Platform A to B\".",
        howToUse: "Treat this as a second opinion alongside attribution-based numbers, not a replacement. The two methods can (and often do) disagree.",
      },
      {
        slug: "creative-patterns",
        title: "Creative Patterns",
        purpose: "Finds what your best-performing creatives have in common (format, hook style, length, etc.) so you know what to make more of.",
      },
      {
        slug: "data-driven-attribution",
        title: "Data-Driven Attribution",
        purpose: "A Markov-chain based model: estimates each channel's real contribution from patterns across every visitor's path to purchase, not just the people who bought. Separate from the fixed first/last/linear/time-decay/u-shaped rules used elsewhere.",
      },
      {
        slug: "leads",
        title: "Leads",
        purpose: "Search one lead by email to see their full journey: every session, which one got attribution credit for which sale, every tag, every call. This is the customer-journey / multi-touch lookup tool.",
      },
      {
        slug: "subscriptions",
        title: "Subscriptions",
        purpose: "MRR, trial conversion, and churn for SaaS clients (only shown for clients with niche = SaaS). Current MRR is a live snapshot; the rest is scoped to the selected date range.",
        metrics: [
          { term: "MRR", definition: "Monthly recurring revenue." },
          { term: "Churn Rate", definition: "Share of active subscriptions canceled in the range." },
          { term: "Trial Conversion", definition: "Share of trials that converted to a paid subscription." },
        ],
      },
      {
        slug: "email-sms",
        title: "Email & SMS",
        purpose: "Campaign performance pulled from a connected Klaviyo integration (trailing 30 days). Requires Klaviyo connected in Settings → Integrations.",
      },
      {
        slug: "cohorts",
        title: "Cohorts",
        purpose: "Customers grouped by acquisition month, using the same trailing-window LTV snapshots (30/60/90/180-day and lifetime) as the LTV report, refreshed nightly.",
      },
    ],
  },
  {
    label: "Testing & Automation",
    entries: [
      {
        slug: "remarketing",
        title: "Remarketing Agent",
        purpose: "Visitors identified by Customers.ai, with AI-drafted outreach copy awaiting your review. Approving a draft doesn't send anything by itself, it only marks the candidate ready for the next step (e.g. adding to a Klaviyo list).",
      },
      {
        slug: "pause-candidates",
        title: "Pause Candidates",
        purpose: "Ads flagged by daily anomaly detection for a ROAS drop vs. their own 7-day average. Advisory only: nothing pauses automatically, you confirm or dismiss each flag.",
      },
      {
        slug: "budget-reallocation",
        title: "Budget Reallocation",
        purpose: "Campaign pairs with a real ROAS gap (winner at least 1.5x the loser's ROAS over the last 7 days). Advisory only: confirm to actually move budget, dismiss to leave both unchanged.",
      },
      {
        slug: "creative-fatigue",
        title: "Creative Fatigue",
        purpose: "Creatives whose CTR has declined 30%+ over the last 3 days vs. the 7 days before that. A trend signal, distinct from Pause Candidates' ROAS-threshold alerts. Advisory only.",
      },
      {
        slug: "invalid-traffic",
        title: "Invalid Traffic",
        purpose: "Sessions flagged by user-agent (known bots/crawlers/headless browsers) or click-velocity signatures (many sessions from one IP in a short window). Advisory only: nothing is excluded from other reports automatically.",
      },
      {
        slug: "tracking-health",
        title: "Tracking Health",
        purpose: "Watches whether tracking itself is intact, not performance: a silent pixel, a traffic collapse, or a platform with real ad spend but no matching sessions. Advisory only.",
      },
      {
        slug: "incrementality",
        title: "Incrementality Testing",
        purpose: "Tests whether a campaign is really driving new sales, not just taking credit for sales that would have happened anyway. Pause it completely and watch what happens to TOTAL revenue, not just that campaign's own numbers.",
      },
      {
        slug: "geo-lift",
        title: "Geo-Lift Testing",
        purpose: "Same question as Incrementality Testing, different method: pause ads in a few \"holdout\" regions while they keep running everywhere else, then compare.",
      },
    ],
  },
  {
    label: "Configuration",
    entries: [
      {
        slug: "tags",
        title: "Tags & Stages",
        purpose: "Freeform labels and funnel stages for leads. Applying a product-type tag to a lead automatically generates a Sale record — useful for manually-closed deals with no processor webhook.",
      },
      {
        slug: "audiences",
        title: "Audiences",
        purpose: "Export lead/customer segments as Meta Custom Audiences or Google Customer Match lists. Lists are re-evaluated against live data on every sync, not a one-time snapshot.",
      },
      {
        slug: "settings",
        title: "Settings",
        purpose: "Per-client configuration: general info and niche, ad/payment platform integrations, call tracking numbers, CRM/Zapier webhooks, outbound webhooks, identity links, sharing, white-label branding, and the UTM builder.",
      },
      {
        slug: "help",
        title: "Help & Info",
        purpose: "This page.",
      },
    ],
  },
];
