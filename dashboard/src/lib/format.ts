export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value >= 1000 ? 0 : 2,
  }).format(value);
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

export function formatRoas(value: number | null | undefined): string {
  if (value === null || value === undefined) return "-";
  return `${value.toFixed(2)}x`;
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return "-";
  return `${value.toFixed(1)}%`;
}

export function formatDuration(totalSeconds: number): string {
  const rounded = Math.round(totalSeconds);
  const minutes = Math.floor(rounded / 60);
  const seconds = rounded % 60;
  return `${minutes}m ${seconds}s`;
}

export function formatDateShort(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(d);
}

// Keyed by normalized platform (strip a trailing "_ads", lowercase) so both an
// ad_costs.platform value ("facebook_ads") and a bare utm_source value
// ("facebook", "Facebook") resolve to the same readable label — a spend-less
// row assembled only from leads/revenue only ever carries the bare utm_source
// form, and previously fell through to showing that raw, lowercase string.
const PLATFORM_LABELS: Record<string, string> = {
  facebook: "Facebook",
  google: "Google",
  bing: "Bing",
  tiktok: "TikTok",
  snapchat: "Snapchat",
  pinterest: "Pinterest",
  linkedin: "LinkedIn",
  reddit: "Reddit",
  klaviyo: "Klaviyo",
};

// A row's `platform` is either a real ad_costs.platform value (facebook_ads, etc),
// a bare utm_source value (facebook, Klaviyo), or, for a manual Custom Cost row,
// whatever free-text label the client typed in — shown as-is since there's no
// fixed taxonomy for that last case.
export function formatPlatformLabel(platform: string | null): string | null {
  if (!platform) return null;
  const normalized = platform.trim().toLowerCase().replace(/_ads$/, "");
  return PLATFORM_LABELS[normalized] ?? platform;
}
