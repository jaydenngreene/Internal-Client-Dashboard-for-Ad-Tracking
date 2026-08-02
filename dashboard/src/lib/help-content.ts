export interface HelpMetric {
  term: string;
  definition: string;
}

export interface HelpEntry {
  slug: string;
  title: string;
  purpose: string;
  metrics?: HelpMetric[];
  // A single string renders as one line. An array renders as a numbered list —
  // use it for anything that's actually a sequence of steps (most setup
  // guides) rather than cramming "1) ... 2) ... 3)..." into one paragraph.
  howToUse?: string | string[];
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
          { term: "Total Revenue", definition: "Every purchase recorded in the date range, whether or not it could be matched back to an ad-driven session." },
          { term: "Profit", definition: "Revenue minus ad spend. \"True profit\" also subtracts COGS/payment fees/fulfillment cost if configured in Settings." },
          { term: "ROAS", definition: "Attributed revenue ÷ ad spend: only counts revenue the dashboard could trace back to an ad." },
          { term: "Blended ROAS", definition: "Total revenue ÷ ad spend, counting every sale regardless of attribution. Runs higher than ROAS whenever revenue can't be matched to a session." },
          { term: "ROI", definition: "Profit ÷ ad spend, as a percentage." },
          { term: "Attribution Rate", definition: "Share of sales the dashboard could match to an ad-driven session. A low rate usually means a tracking gap, not that ads aren't working." },
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
        title: "Gojo",
        purpose: "This app's AI assistant. Ask it a plain-English question about this client's performance and it queries real data live to answer, it doesn't guess or hallucinate numbers, every answer is backed by an actual query.",
      },
      {
        slug: "campaigns",
        title: "Campaigns",
        purpose: "The main performance breakdown table: switch between Campaign, Source, Keyword, and Creative (ad-level) views, plus an LTV-by-acquisition-campaign tab. The Campaign tab also includes an attribution-model comparison (e.g. First-Touch vs Last-Touch), customer journey pattern clustering, and a Data-Driven Attribution card; the Creative tab includes a Creative Patterns card. These were separate pages until the 2026-08-01 nav consolidation folded them in here.",
        metrics: [
          { term: "CTR / CPC", definition: "Click-through rate and cost per click, straight from the ad platform." },
          { term: "CPL / Ad Spend per Purchase", definition: "Ad spend divided by leads or by purchases, whichever this client's niche optimizes for." },
          { term: "ROAS", definition: "Revenue ÷ ad spend, per row." },
          { term: "Data-Driven Attribution", definition: "A Markov-chain based model: estimates each channel's real contribution from patterns across every visitor's path to purchase, not just the people who bought. Shown for comparison only, separate from the fixed first/last/linear/time-decay/u-shaped rules that drive the rest of the dashboard." },
          { term: "Creative Patterns", definition: "What your best-performing AI-tagged creatives have in common (hook type, angle, tone), so you know what to make more of. Only populated once creatives have been tagged from their own detail page." },
        ],
        howToUse: "Sort any column by clicking its header. Export the current view to CSV with the button above the table.",
      },
      {
        slug: "funnel",
        title: "Funnel (TOF / MOF / BOF)",
        purpose: "Three stages of the same funnel: TOF (leads or purchases coming in and what they cost), MOF (engagement between first click and conversion), BOF (who actually buys, how fast, and what sticks). TOF and BOF's exact metrics adapt to the client's niche: ecommerce/info-product clients see Total Purchases and Ad Spend per Purchase instead of Total Leads and CPL, and an ecommerce-native buyer-conversion view instead of the lead-to-buyer rate.",
        metrics: [
          { term: "TOF: Total Leads / CPL", definition: "How many leads came in and what each one cost. Shows Total Purchases / Ad Spend per Purchase instead for ecommerce and info-product clients." },
          { term: "MOF: Engagement Rate", definition: "Share of sessions with more than one pageview (didn't bounce off the landing page)." },
          { term: "MOF: Cart Abandonment (ecommerce)", definition: "Add-to-carts that never converted to a sale by that visitor." },
          { term: "BOF: Lead to Buyer Rate", definition: "Share of leads that eventually purchased. Ecommerce/info-product clients see repeat-purchase rate and new-vs-returning customers instead." },
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
        // Pause Candidates/Budget Reallocation/Creative Fatigue/Tracking Health/
        // Invalid Traffic were five separate sidebar items and five separate
        // help entries here — folded into one Recommendations hub with an
        // internal type toggle (2026-08-01 nav consolidation, same slug as
        // lib/nav-items.ts's new entry).
        slug: "recommendations",
        title: "Recommendations",
        purpose: "Flagged items across your account that need a decision, one hub with a toggle between five types. Nothing here acts on its own: confirm to act, or dismiss to leave it as is.",
        metrics: [
          { term: "Pause Candidates", definition: "Ads flagged by daily anomaly detection for a ROAS drop vs. their own 7-day average." },
          { term: "Budget Reallocation", definition: "Campaign pairs with a real ROAS gap (winner at least 1.5x the loser's ROAS over the last 7 days)." },
          { term: "Creative Fatigue", definition: "Creatives with a sustained ROAS/CTR/CPA decline confirmed over both the last few days and the last couple weeks, not a one-day dip. A trend signal, distinct from Pause Candidates' threshold alerts." },
          { term: "Tracking Health", definition: "Watches whether tracking itself is intact, not performance: a silent pixel, a traffic collapse, or a platform with real ad spend but no matching sessions." },
          { term: "Invalid Traffic", definition: "Sessions flagged by user-agent (known bots/crawlers/headless browsers) or click-velocity signatures (many sessions from one IP in a short window). Nothing is excluded from other reports automatically." },
        ],
      },
      {
        // Incrementality/Geo-Lift Testing were two separate sidebar items
        // running the identical test-card workflow — folded into one
        // Experiments hub (2026-08-01 nav consolidation).
        slug: "experiments",
        title: "Experiments",
        purpose: "Tests whether a campaign is really driving new sales, not just taking credit for sales that would have happened anyway: two ways to measure it, toggled on one page.",
        metrics: [
          { term: "Incrementality", definition: "Pause a campaign completely and watch what happens to TOTAL revenue, not just that campaign's own numbers." },
          { term: "Geo-Lift", definition: "Same question, more rigorous method: pause ads in a few \"holdout\" regions while they keep running everywhere else, then compare revenue per visitor between the two groups. Also accounts for anything affecting the whole business at once (a seasonal dip, a site issue) that a plain Incrementality test can't rule out." },
        ],
      },
    ],
  },
  {
    label: "Configuration",
    entries: [
      {
        slug: "tags",
        title: "Tags & Stages",
        purpose: "Freeform labels and funnel stages for leads. Applying a product-type tag to a lead automatically generates a Sale record, useful for manually-closed deals with no processor webhook.",
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
  {
    label: "Integration Setup Guides",
    entries: [
      {
        slug: "guide-google-ads",
        title: "Connecting Google Ads",
        purpose:
          "Connects a client's Google Ads account so Kado can pull daily spend/impressions/clicks and, optionally, send Purchase/Lead conversions back as Enhanced Conversions. There are two setup paths depending on how this client's account relates to the agency's own Google Ads manager account (MCC). The field list looks identical either way, so it's easy to fill in the wrong combination without knowing which path applies.",
        metrics: [
          { term: "Customer ID", definition: "This client's own 10-digit Google Ads account number (shown as 123-456-7890 in the Google Ads UI, enter digits only, no dashes). Always required." },
          { term: "Login customer ID (MCC)", definition: "Only for a client managed under the agency's Google Ads manager account. It's the MCC's own ID, not the client's. Leave blank if this client has their own standalone login." },
          { term: "Refresh token", definition: "Only for a client OUTSIDE the agency's shared MCC. Comes from a one-time Google OAuth consent flow for that account; it doesn't expire the way a login session does. Clients under the shared MCC reuse credentials already configured in the backend and can leave this blank." },
          { term: "Purchase / Lead conversion action", definition: "Optional, only needed to send conversions back to Google. In the client's Google Ads account: Goals → Conversions, click the action, the resource name is in its details panel." },
        ],
        howToUse: [
          "Path A (most clients, under the agency's MCC): fill in Customer ID (the client's account) and Login customer ID (the agency's MCC). Leave Refresh token blank.",
          "Path B (client has their own independent Google Ads login): fill in Customer ID and Refresh token. Leave Login customer ID blank.",
          "If unsure which applies, ask whoever manages this client's ad accounts before saving. The wrong combination fails to sync silently rather than erroring.",
        ],
      },
      {
        slug: "guide-bing-ads",
        title: "Connecting Bing / Microsoft Ads",
        purpose:
          "Connects a client's Microsoft Advertising account for daily spend/click sync and keyword tracking. Same OAuth-refresh-token pattern as Google Ads, just Microsoft's own account IDs.",
        howToUse: [
          "Customer ID and Account ID are both under Accounts & Billing in Microsoft Advertising (Customer ID is the top-level account, Account ID the specific ad account beneath it).",
          "The refresh token comes from a one-time Microsoft OAuth consent flow for this account. Ask whoever manages the agency's Microsoft Advertising API access to generate one; it doesn't expire like a normal login.",
        ],
      },
      {
        slug: "guide-paypal",
        title: "Connecting PayPal",
        purpose:
          "Verifies that incoming PayPal payment webhooks genuinely came from PayPal (not spoofed) and records this client's purchases/refunds.",
        howToUse: [
          "In the PayPal Developer Dashboard (developer.paypal.com) → Apps & Credentials, create (or open) a REST API app for this client. That screen gives you the Client ID and Client Secret.",
          "In that same app, add a webhook: URL is /webhooks/paypal/<this client's ID, shown in the URL above>, subscribed to at least PAYMENT.CAPTURE.COMPLETED and PAYMENT.CAPTURE.REFUNDED.",
          "After saving, PayPal shows a Webhook ID. Paste that below.",
          "Use Sandbox credentials while testing. Switch to Live before the client goes live.",
        ],
      },
      {
        slug: "guide-gohighlevel",
        title: "Connecting GoHighLevel",
        purpose:
          "GoHighLevel has no fixed payment-webhook format the way Shopify or Stripe do. This connects through GHL's own Workflow Builder custom webhook action instead, so the exact fields sent depend on how that workflow is built for this client.",
        howToUse: [
          "Make up a shared secret (any string) and remember it.",
          "In GoHighLevel, open or build the workflow that fires when a deal closes or payment is taken, and add a Webhook action.",
          "Point its URL at /webhooks/gohighlevel/<this client's ID, shown in the URL above>.",
          "In that webhook action, map GHL's fields into this exact JSON shape: secret (your string from step 1), event, contact.email, amount, transaction_id.",
          "Paste the same secret below and save.",
          "Submit one real test lead through the live workflow afterward and confirm it shows up on the Leads tab. This mapping is hand-built per client, so a typo fails silently instead of erroring.",
        ],
      },
      {
        slug: "guide-housecallpro",
        title: "Connecting Housecall Pro",
        purpose:
          "Requires Housecall Pro's MAX plan. Webhooks aren't available on lower tiers. Records invoice payments/refunds as purchases for service-based clients.",
        howToUse: [
          "In Housecall Pro: Settings → Webhooks → Add Webhook. URL is /webhooks/housecallpro/<this client's ID, shown in the URL above>.",
          "Enable invoice.paid, invoice.payment.succeeded, and invoice.refund.succeeded.",
          "Housecall Pro shows a signing secret right after saving. Paste it below immediately, since it's normally only shown once.",
        ],
      },
      {
        slug: "guide-customers-ai",
        title: "Connecting Customers.ai",
        purpose:
          "Feeds anonymous-visitor identity matches (name/email resolved from on-site behavior) into the Remarketing tab as draft outreach candidates. Nothing sends automatically; a person reviews and approves every draft first.",
        howToUse: [
          "In Customers.ai, set up a Custom Webhook integration pointed at /webhooks/customers-ai/<this client's ID, shown in the URL above>, and pick a shared secret to include in its payload.",
          "Paste that same secret below.",
          "Easy to miss: Customers.ai also needs its own tracking script (their \"X-Ray\" pixel) installed on the client's site. It's a second, separate pixel from Kado's own, installed in addition to it, not instead of it.",
        ],
      },
      {
        slug: "guide-bigquery",
        title: "Connecting BigQuery Export",
        purpose:
          "Exports this client's raw event/attribution data into a client-owned BigQuery dataset on a schedule, for agencies or clients who want their own SQL/BI tooling on the raw data instead of only Kado's built-in reports.",
        howToUse: [
          "In Google Cloud Console, create a Service Account in the destination project (IAM & Admin → Service Accounts → Create).",
          "Grant it two roles: BigQuery Data Editor and BigQuery Job User.",
          "Create a JSON key for it (Keys tab → Add Key → JSON). It only downloads once, so save it somewhere safe.",
          "Create the destination dataset in BigQuery yourself first. This integration writes into an existing dataset, it won't create one.",
          "Paste the Project ID, Dataset ID, and the full contents of the downloaded JSON key file below.",
        ],
      },
    ],
  },
];
