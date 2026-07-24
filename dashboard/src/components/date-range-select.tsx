"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { RANGE_PRESETS, RangePreset } from "@/lib/date-range";
import { DateRange } from "@/lib/api";

export function DateRangeSelect({
  value,
  onChange,
  customRange,
  onCustomRangeChange,
}: {
  value: RangePreset;
  onChange: (value: RangePreset) => void;
  customRange?: DateRange;
  onCustomRangeChange?: (range: DateRange) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Select value={value} onValueChange={(v) => onChange(v as RangePreset)}>
        <SelectTrigger className="w-40">
          <SelectValue>
            {(v: RangePreset) => RANGE_PRESETS.find((preset) => preset.value === v)?.label}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {RANGE_PRESETS.map((preset) => (
            <SelectItem key={preset.value} value={preset.value}>
              {preset.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {value === "custom" && onCustomRangeChange && (
        <div className="flex items-center gap-1.5">
          <Input
            type="date"
            className="w-36"
            value={customRange?.from ?? ""}
            max={customRange?.to}
            onChange={(e) => onCustomRangeChange({ from: e.target.value, to: customRange?.to ?? e.target.value })}
          />
          <span className="text-xs text-muted-foreground">to</span>
          <Input
            type="date"
            className="w-36"
            value={customRange?.to ?? ""}
            min={customRange?.from}
            onChange={(e) => onCustomRangeChange({ from: customRange?.from ?? e.target.value, to: e.target.value })}
          />
        </div>
      )}
    </div>
  );
}
