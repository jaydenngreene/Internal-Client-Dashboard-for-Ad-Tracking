"use client";

import { cn } from "@/lib/utils";

interface SegmentedToggleProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
}

export function SegmentedToggle<T extends string>({ value, onChange, options }: SegmentedToggleProps<T>) {
  return (
    // max-w-full + overflow-x-auto so this scrolls on a narrow viewport instead of
    // silently clipping its last option (it previously had neither — five options
    // is wider than a 390px screen and the trailing label was cut off mid-word
    // with no visual cue there was more to see).
    <div className="max-w-full overflow-x-auto">
      <div className="inline-flex shrink-0 rounded-lg border border-border bg-secondary/40 p-0.5">
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={cn(
              "shrink-0 rounded-md px-3 py-1 text-sm font-medium whitespace-nowrap transition-colors",
              value === opt.value
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
