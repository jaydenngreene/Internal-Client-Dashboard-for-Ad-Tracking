"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { SegmentedToggle } from "@/components/segmented-toggle";
import { ClientKicker } from "@/components/client-kicker";
import { IncrementalityClient } from "../incrementality/incrementality-client";
import { GeoLiftClient } from "../geo-lift/geo-lift-client";

// 2026-08-01 nav consolidation — Incrementality and Geo-Lift were two separate
// nav items running the identical create/pending/running/completed test-card
// workflow, just differing in test design (time-pause vs. geo-holdout). Folded
// into one toggle, same "same shape, one nav item" pattern as Recommendations.
type ExperimentType = "incrementality" | "geo-lift";

const TYPE_OPTIONS: { value: ExperimentType; label: string }[] = [
  { value: "incrementality", label: "Incrementality" },
  { value: "geo-lift", label: "Geo-Lift" },
];
const TYPE_VALUES = TYPE_OPTIONS.map((o) => o.value);

export function ExperimentsClient({ clientId }: { clientId: string }) {
  const searchParams = useSearchParams();
  const requested = searchParams.get("type");
  const initial = (TYPE_VALUES as string[]).includes(requested ?? "") ? (requested as ExperimentType) : "incrementality";
  const [type, setType] = useState<ExperimentType>(initial);

  // See recommendations-client.tsx's identical effect for why this is needed —
  // a same-route ?type= link (e.g. the old /incrementality or /geo-lift
  // redirect) is a client-side navigation, not a remount, so the useState
  // initializer above wouldn't otherwise pick up a change in the URL.
  useEffect(() => {
    if (requested && (TYPE_VALUES as string[]).includes(requested)) {
      setType(requested as ExperimentType);
    }
  }, [requested]);

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <ClientKicker clientId={clientId} />
          <h1 className="text-lg font-semibold">Experiments</h1>
          <p className="mt-0.5 max-w-2xl text-xs text-muted-foreground">
            Tests whether a campaign is really driving new sales, not just taking credit for sales that would have
            happened anyway: two ways to measure it.
          </p>
        </div>
        <SegmentedToggle value={type} onChange={(v) => setType(v as ExperimentType)} options={TYPE_OPTIONS} />
      </div>

      {type === "incrementality" && <IncrementalityClient clientId={clientId} />}
      {type === "geo-lift" && <GeoLiftClient clientId={clientId} />}
    </div>
  );
}
