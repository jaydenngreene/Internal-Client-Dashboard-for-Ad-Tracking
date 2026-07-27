import {
  LayoutDashboard,
  Lightbulb,
  Bot,
  Megaphone,
  Filter,
  ChartNoAxesCombined,
  Waypoints,
  UserSearch,
  RefreshCw,
  Mail,
  Layers,
  Repeat2,
  PauseCircle,
  ArrowLeftRight,
  TrendingDown,
  ShieldAlert,
  FlaskConical,
  MapPinned,
  Tag,
  Users,
  Settings2,
  Sparkles,
  HelpCircle,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  slug: string;
  label: string;
  icon: LucideIcon;
  enabled: boolean;
  niches?: string[];
  // Clusters this item under a collapsible sub-header within its section (e.g.
  // "Reporting") instead of rendering it as a flat top-level link — see
  // Sidebar's grouping logic. Items without a group render exactly as before.
  group?: string;
  // Per-niche label override (Phase 2, 2026-07-28) — e.g. "Leads" reads
  // "Customer Buying Journey" for ecom clients, matching that page's own
  // header, without needing a second nav entry or a niche-specific route.
  // Falls back to `label` for any niche not listed here.
  nicheLabels?: Record<string, string>;
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

// Shared by Sidebar (renders the grouped nav) and CommandPalette (searches it) —
// a single source of truth so a new report page only needs to be added once.
// Grouped into labeled sections instead of one flat list: Reports is "what's
// happening," Testing & Automation is "things that watch or act on their own,"
// Configuration is "how this client's data is shaped." `niches` restricts an item
// to clients of that niche (e.g. Subscriptions only makes sense for niche='saas');
// omitted entirely means it shows for every client.
export const NAV_SECTIONS: NavSection[] = [
  {
    label: "Reports",
    items: [
      { slug: "overview", label: "Overview", icon: LayoutDashboard, enabled: true },
      { slug: "insights", label: "Insights", icon: Lightbulb, enabled: true },
      { slug: "chat", label: "Gojo", icon: Bot, enabled: true },
      { slug: "campaigns", label: "Campaigns", icon: Megaphone, enabled: true, group: "Reporting" },
      { slug: "funnel", label: "Funnel", icon: Filter, enabled: true, group: "Reporting" },
      { slug: "mmm", label: "Media Mix Model", icon: ChartNoAxesCombined, enabled: true, group: "Reporting" },
      { slug: "creative-patterns", label: "Creative Patterns", icon: Sparkles, enabled: true, group: "Reporting" },
      {
        slug: "data-driven-attribution",
        label: "Data-Driven Attribution",
        icon: Waypoints,
        enabled: true,
        group: "Reporting",
      },
      {
        slug: "leads",
        label: "Leads",
        icon: UserSearch,
        enabled: true,
        group: "Reporting",
        // Phase 3 (2026-07-28) — every niche gets its own label here,
        // matching lib/niche-vocabulary.ts's pageLabel exactly (the two must
        // never disagree — a mismatch was a real Phase 2 bug, and this list
        // caught itself making that exact mistake for 'other' during
        // verification: the vocabulary's generic fallback is "Conversions",
        // but without an explicit entry here this item would have fallen
        // through to its own base `label` ("Leads") instead — listed
        // explicitly rather than relying on the two fallbacks to agree by
        // coincidence. 'lead_gen' is the one niche genuinely safe to omit:
        // its vocabulary pageLabel ("Leads") IS this item's own base label.
        nicheLabels: {
          ecommerce: "Customer Buying Journey",
          info_product: "Customers",
          saas: "Subscribers",
          call: "Booked Calls",
          other: "Conversions",
        },
      },
      {
        slug: "subscriptions",
        label: "Subscriptions",
        icon: RefreshCw,
        enabled: true,
        niches: ["saas"],
        group: "Reporting",
      },
      { slug: "email-sms", label: "Email & SMS", icon: Mail, enabled: true, group: "Reporting" },
      { slug: "cohorts", label: "Cohorts", icon: Layers, enabled: true, group: "Reporting" },
    ],
  },
  {
    label: "Testing & Automation",
    items: [
      { slug: "remarketing", label: "Remarketing", icon: Repeat2, enabled: true },
      { slug: "pause-candidates", label: "Pause Candidates", icon: PauseCircle, enabled: true },
      { slug: "budget-reallocation", label: "Budget Reallocation", icon: ArrowLeftRight, enabled: true },
      { slug: "creative-fatigue", label: "Creative Fatigue", icon: TrendingDown, enabled: true },
      { slug: "invalid-traffic", label: "Invalid Traffic", icon: ShieldAlert, enabled: true },
      { slug: "tracking-health", label: "Tracking Health", icon: ShieldAlert, enabled: true },
      { slug: "incrementality", label: "Incrementality Testing", icon: FlaskConical, enabled: true },
      { slug: "geo-lift", label: "Geo-Lift Testing", icon: MapPinned, enabled: true },
    ],
  },
  {
    label: "Configuration",
    items: [
      { slug: "tags", label: "Tags & Stages", icon: Tag, enabled: true },
      { slug: "audiences", label: "Audiences", icon: Users, enabled: true },
      { slug: "settings", label: "Settings", icon: Settings2, enabled: true },
      { slug: "help", label: "Help & Info", icon: HelpCircle, enabled: true },
    ],
  },
];
