import { useState } from "react";
import { DateRange } from "./api";

export type RangePreset = "7d" | "14d" | "30d" | "60d" | "90d" | "this_month" | "last_month" | "custom";

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
  { value: "custom", label: "Custom range" },
];

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function defaultCustomRange(): DateRange {
  const today = new Date();
  const from = new Date(today);
  from.setUTCDate(from.getUTCDate() - 29);
  return { from: isoDate(from), to: isoDate(today) };
}

// `custom` has no fixed formula — it resolves to whatever the picker's own from/to
// state holds, which resolveRange can't know on its own, so callers pass it through.
export function resolveRange(preset: RangePreset, customRange?: DateRange): DateRange {
  const today = new Date();

  if (preset === "custom") {
    return customRange ?? defaultCustomRange();
  }

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

// One hook to replace every page's own useState<RangePreset> + resolveRange(preset)
// pair — centralizing it here means the custom-range picker works everywhere at
// once instead of needing the same three lines threaded through a dozen pages by hand.
export function useDateRangeState(initial: RangePreset = "30d") {
  const [preset, setPreset] = useState<RangePreset>(initial);
  const [customRange, setCustomRange] = useState<DateRange | undefined>(undefined);
  const range = resolveRange(preset, customRange);
  return { preset, setPreset, customRange, setCustomRange, range };
}
