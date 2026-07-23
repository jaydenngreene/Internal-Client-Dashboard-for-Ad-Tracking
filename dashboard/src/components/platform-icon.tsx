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

// simple-icons dropped Bing and LinkedIn's marks (Microsoft trademark takedown) —
// those two fall back to a brand-colored initial chip instead of a real logo.
const PLATFORM_META: Record<string, PlatformMeta> = {
  facebook_ads: { Icon: SiFacebook, color: "#0866FF", initial: "f" },
  google_ads: { Icon: SiGoogleads, color: "#4285F4", initial: "G" },
  bing_ads: { color: "#008373", initial: "b" },
  tiktok_ads: { Icon: SiTiktok, color: "#000000", initial: "T" },
  snapchat_ads: { Icon: SiSnapchat, color: "#FFFC00", initial: "S" },
  pinterest_ads: { Icon: SiPinterest, color: "#BD081C", initial: "P" },
  linkedin_ads: { color: "#0A66C2", initial: "in" },
  reddit_ads: { Icon: SiReddit, color: "#FF4500", initial: "r" },
};

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
  const meta = PLATFORM_META[platform];

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
