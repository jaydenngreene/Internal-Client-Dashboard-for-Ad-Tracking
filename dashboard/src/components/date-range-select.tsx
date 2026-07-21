"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RANGE_PRESETS, RangePreset } from "@/lib/date-range";

export function DateRangeSelect({
  value,
  onChange,
}: {
  value: RangePreset;
  onChange: (value: RangePreset) => void;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as RangePreset)}>
      <SelectTrigger className="w-40">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {RANGE_PRESETS.map((preset) => (
          <SelectItem key={preset.value} value={preset.value}>
            {preset.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
