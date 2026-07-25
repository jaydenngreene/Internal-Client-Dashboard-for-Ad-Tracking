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

const PLATFORM_LABELS: Record<string, string> = {
  facebook_ads: "Facebook",
  google_ads: "Google",
  bing_ads: "Bing",
  tiktok_ads: "TikTok",
  snapchat_ads: "Snapchat",
  pinterest_ads: "Pinterest",
  linkedin_ads: "LinkedIn",
  reddit_ads: "Reddit",
};

// A row's `platform` is either a real ad_costs.platform value (facebook_ads, etc,
// normalized here to a readable label) or, for a manual Custom Cost row, whatever
// free-text label the client typed in — shown as-is since there's no fixed taxonomy for it.
export function formatPlatformLabel(platform: string | null): string | null {
  if (!platform) return null;
  return PLATFORM_LABELS[platform] ?? platform;
}
