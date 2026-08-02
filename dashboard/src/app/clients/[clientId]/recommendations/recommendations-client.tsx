"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { SegmentedToggle } from "@/components/segmented-toggle";
import { ClientKicker } from "@/components/client-kicker";
import { PauseCandidatesClient } from "../pause-candidates/pause-candidates-client";
import { BudgetReallocationClient } from "../budget-reallocation/budget-reallocation-client";
import { CreativeFatigueClient } from "../creative-fatigue/creative-fatigue-client";
import { TrackingHealthClient } from "../tracking-health/tracking-health-client";
import { InvalidTrafficClient } from "../invalid-traffic/invalid-traffic-client";

// 2026-08-01 nav consolidation — these five were separate top-level nav items,
// all the same shape (a list of flagged items, confirm-or-dismiss / advisory
// only), per a platform UX audit that flagged Testing & Automation as flat and
// cluttered next to Campaigns' own precedent of folding related views into
// tabs instead of new nav items. Each type keeps its own internal component
// and query keys untouched — only the page chrome (ClientKicker/h1/outer
// padding) was pulled up into this shared shell, same split as Funnel's
// TOF/MOF/BOF toggle.
type RecType = "pause-candidates" | "budget-reallocation" | "creative-fatigue" | "tracking-health" | "invalid-traffic";

const TYPE_OPTIONS: { value: RecType; label: string }[] = [
  { value: "pause-candidates", label: "Pause Candidates" },
  { value: "budget-reallocation", label: "Budget Reallocation" },
  { value: "creative-fatigue", label: "Creative Fatigue" },
  { value: "tracking-health", label: "Tracking Health" },
  { value: "invalid-traffic", label: "Invalid Traffic" },
];
const TYPE_VALUES = TYPE_OPTIONS.map((o) => o.value);

export function RecommendationsClient({ clientId }: { clientId: string }) {
  // Lets the notifications bell and old bookmarked routes land directly on one
  // type, e.g. /recommendations?type=creative-fatigue — same pattern as
  // Campaigns' ?view= and Funnel's stage toggle.
  const searchParams = useSearchParams();
  const requested = searchParams.get("type");
  const initial = (TYPE_VALUES as string[]).includes(requested ?? "") ? (requested as RecType) : "pause-candidates";
  const [type, setType] = useState<RecType>(initial);

  // The notifications bell links from elsewhere on THIS SAME route (just a
  // different ?type=), which Next.js handles as a client-side navigation that
  // re-renders but doesn't remount the page — so the useState initializer
  // above only ever fires once. Without this, clicking "Creative fatigue" in
  // the bell while already viewing Pause Candidates would change the URL but
  // leave the visible tab unchanged. Only reacts to an actual change in the
  // URL's own type param, so it never fights a manual toggle click (which
  // updates local state but not the URL, same as Campaigns' view toggle).
  useEffect(() => {
    if (requested && (TYPE_VALUES as string[]).includes(requested)) {
      setType(requested as RecType);
    }
  }, [requested]);

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <ClientKicker clientId={clientId} />
          <h1 className="text-lg font-semibold">Recommendations</h1>
          <p className="mt-0.5 max-w-2xl text-xs text-muted-foreground">
            Flagged items across your account that need a decision. Nothing here acts on its own — confirm to act,
            or dismiss to leave it as is.
          </p>
        </div>
        <SegmentedToggle value={type} onChange={(v) => setType(v as RecType)} options={TYPE_OPTIONS} />
      </div>

      {type === "pause-candidates" && <PauseCandidatesClient clientId={clientId} />}
      {type === "budget-reallocation" && <BudgetReallocationClient clientId={clientId} />}
      {type === "creative-fatigue" && <CreativeFatigueClient clientId={clientId} />}
      {type === "tracking-health" && <TrackingHealthClient clientId={clientId} />}
      {type === "invalid-traffic" && <InvalidTrafficClient clientId={clientId} />}
    </div>
  );
}
