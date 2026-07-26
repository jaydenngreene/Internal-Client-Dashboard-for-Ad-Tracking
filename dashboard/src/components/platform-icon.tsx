import {
  SiFacebook,
  SiGoogleads,
  SiTiktok,
  SiSnapchat,
  SiPinterest,
  SiReddit,
} from "@icons-pack/react-simple-icons";
import { cn } from "@/lib/utils";

type IconComponent = typeof SiFacebook;

interface PlatformMeta {
  Icon?: IconComponent;
  color: string;
  initial: string;
}

// simple-icons dropped Bing and LinkedIn's marks (Microsoft trademark takedown),
// and never carried Klaviyo's at all — those three fall back to a brand-colored
// initial chip instead of a real logo.
//
// Keyed by normalized platform (see normalizePlatformKey below) so both an
// ad_costs.platform value ("facebook_ads") and a bare utm_source value
// ("facebook", "Facebook") resolve to the same entry — a row assembled only
// from leads/revenue (no spend match) only ever has the bare utm_source form,
// and previously fell through to the generic gray-initial fallback below even
// for a real, recognized ad platform.
const PLATFORM_META: Record<string, PlatformMeta> = {
  facebook: { Icon: SiFacebook, color: "#0866FF", initial: "f" },
  google: { Icon: SiGoogleads, color: "#4285F4", initial: "G" },
  bing: { color: "#008373", initial: "b" },
  tiktok: { Icon: SiTiktok, color: "#000000", initial: "T" },
  snapchat: { Icon: SiSnapchat, color: "#FFFC00", initial: "S" },
  pinterest: { Icon: SiPinterest, color: "#BD081C", initial: "P" },
  linkedin: { color: "#0A66C2", initial: "in" },
  reddit: { Icon: SiReddit, color: "#FF4500", initial: "r" },
  // Not an ad platform (no ad_costs sync exists for it) — included here purely
  // so a Klaviyo-sourced row gets a real brand chip instead of the generic
  // gray-initial fallback. See isAdPlatform below for the ad-vs-not distinction.
  klaviyo: { color: "#000000", initial: "K" },
};

// The set of platforms Kado actually syncs ad spend for — used to decide whether
// a spend-less row ("matched: false") means a real tracking gap worth flagging,
// or just a non-ad source (Klaviyo, direct/organic) that was never going to have
// a spend row in the first place.
const AD_PLATFORM_KEYS = new Set([
  "facebook",
  "google",
  "bing",
  "tiktok",
  "snapchat",
  "pinterest",
  "linkedin",
  "reddit",
]);

export function normalizePlatformKey(platform: string | null): string {
  return (platform ?? "").trim().toLowerCase().replace(/_ads$/, "");
}

export function isAdPlatform(platform: string | null): boolean {
  return AD_PLATFORM_KEYS.has(normalizePlatformKey(platform));
}

const CHIP_PX: Record<"sm" | "md" | "lg", number> = { sm: 18, md: 22, lg: 28 };
const GLYPH_PX: Record<"sm" | "md" | "lg", number> = { sm: 11, md: 13, lg: 16 };

// Pairs a real brand logo (or brand-colored initial, for the two marks
// simple-icons had to remove) with the existing text label wherever a row's
// platform is shown — identity is never color/icon-alone, per the dataviz
// skill's accessibility rule, so this always sits next to formatPlatformLabel's
// text, never instead of it.
export function PlatformIcon({
  platform,
  size = "sm",
  className,
}: {
  platform: string | null;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  if (!platform) return null;
  const chipPx = CHIP_PX[size];
  const glyphPx = GLYPH_PX[size];
  const meta = PLATFORM_META[normalizePlatformKey(platform)];

  // Free-text Custom Cost label with no fixed taxonomy entry — neutral chip.
  if (!meta) {
    return (
      <span
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-full bg-muted font-semibold text-muted-foreground",
          className
        )}
        style={{ width: chipPx, height: chipPx, fontSize: glyphPx * 0.75 }}
      >
        {platform.slice(0, 1).toUpperCase()}
      </span>
    );
  }

  if (meta.Icon) {
    const Icon = meta.Icon;
    return (
      <span
        className={cn("inline-flex shrink-0 items-center justify-center rounded-full ring-1 ring-foreground/10", className)}
        style={{ width: chipPx, height: chipPx, backgroundColor: `${meta.color}1a` }}
      >
        <Icon size={glyphPx} color={meta.color} />
      </span>
    );
  }

  return (
    <span
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white", className)}
      style={{ width: chipPx, height: chipPx, backgroundColor: meta.color, fontSize: glyphPx * 0.6 }}
    >
      {meta.initial}
    </span>
  );
}
