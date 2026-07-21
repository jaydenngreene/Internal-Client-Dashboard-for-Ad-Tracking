"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { addCustomCost } from "@/lib/api";
import { Button } from "@/components/ui/button";

const inputClass =
  "h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

// Step 26 — inline manual ad-spend entry, matching how Hyros itself surfaces Custom
// Costs (inline in the spend view, not a separate page) for platforms with no native
// cost-sync integration.
export function AddCustomCostForm({ clientId }: { clientId: string }) {
  const [label, setLabel] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [spend, setSpend] = useState("");
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () =>
      addCustomCost(clientId, { platform_label: label.trim(), date, spend: parseFloat(spend) }),
    onSuccess: () => {
      setLabel("");
      setSpend("");
      queryClient.invalidateQueries({ queryKey: ["campaigns", clientId] });
      queryClient.invalidateQueries({ queryKey: ["overview", clientId] });
    },
  });

  const canSubmit = label.trim().length > 0 && date.length > 0 && parseFloat(spend) > 0;

  return (
    <form
      className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-muted/30 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit) mutation.mutate();
      }}
    >
      <div className="flex flex-col gap-1">
        <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Platform / label
        </label>
        <input
          className={inputClass}
          placeholder="e.g. Native Ad Network"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Date</label>
        <input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Spend</label>
        <input
          type="number"
          min="0"
          step="0.01"
          className={`${inputClass} w-28`}
          placeholder="0.00"
          value={spend}
          onChange={(e) => setSpend(e.target.value)}
        />
      </div>
      <Button type="submit" size="sm" disabled={!canSubmit || mutation.isPending}>
        Add manual spend
      </Button>
      {mutation.isError && <p className="text-xs text-status-critical">Failed to save.</p>}
      {mutation.isSuccess && <p className="text-xs text-muted-foreground">Added.</p>}
    </form>
  );
}
