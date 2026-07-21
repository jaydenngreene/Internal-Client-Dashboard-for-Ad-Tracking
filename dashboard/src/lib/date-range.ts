import { DateRange } from "./api";

export type RangePreset = "7d" | "14d" | "30d" | "60d" | "90d" | "this_month" | "last_month";

const DAY_PRESETS: { value: RangePreset; days: number }[] = [
  { value: "7d", days: 7 },
  { value: "14d", days: 14 },
  { value: "30d", days: 30 },
  { value: "60d", days: 60 },
  { value: "90d", days: 90 },
];

export const RANGE_PRESETS: { value: RangePreset; label: string }[] = [
  ...DAY_PRESETS.map((p) => ({ value: p.value, label: `Last ${p.days} days` })),
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

  const days = DAY_PRESETS.find((p) => p.value === preset)?.days ?? 30;
  const from = new Date(today);
  from.setUTCDate(from.getUTCDate() - (days - 1));
  return { from: isoDate(from), to: isoDate(today) };
}
