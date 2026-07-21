import { DateRange } from "./api";

export type RangePreset = "7d" | "30d" | "90d" | "this_month" | "last_month";

export const RANGE_PRESETS: { value: RangePreset; label: string }[] = [
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "this_month", label: "This month" },
  { value: "last_month", label: "Last month" },
];

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function resolveRange(preset: RangePreset): DateRange {
  const today = new Date();

  if (preset === "this_month") {
    const from = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    return { from: isoDate(from), to: isoDate(today) };
  }

  if (preset === "last_month") {
    const from = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
    const to = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0));
    return { from: isoDate(from), to: isoDate(to) };
  }

  const days = preset === "7d" ? 6 : preset === "30d" ? 29 : 89;
  const from = new Date(today);
  from.setUTCDate(from.getUTCDate() - days);
  return { from: isoDate(from), to: isoDate(today) };
}
