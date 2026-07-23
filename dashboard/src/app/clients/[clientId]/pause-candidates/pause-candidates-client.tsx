"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getPauseCandidates,
  confirmPauseCandidate,
  dismissPauseCandidate,
  PauseCandidate,
  PauseCandidateStatus,
} from "@/lib/api";
import { SegmentedToggle } from "@/components/segmented-toggle";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ClientKicker } from "@/components/client-kicker";

const STATUS_OPTIONS: { value: PauseCandidateStatus; label: string }[] = [
  { value: "pending", label: "Pending Review" },
  { value: "confirmed", label: "Confirmed" },
  { value: "dismissed", label: "Dismissed" },
  { value: "failed", label: "Failed" },
];

function CandidateCard({ candidate, clientId }: { candidate: PauseCandidate; clientId: string }) {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["pause-candidates", clientId] });

  const confirm = useMutation({
    mutationFn: () => confirmPauseCandidate(candidate.id),
    onSuccess: invalidate,
    onError: invalidate, // a failed confirm still moves the candidate to 'failed' server-side
  });
  const dismiss = useMutation({
    mutationFn: () => dismissPauseCandidate(candidate.id),
    onSuccess: invalidate,
  });

  const isPending = candidate.status === "pending";

  return (
    <Card className="px-4 py-3">
      <CardContent className="flex flex-col gap-2 px-0">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-medium">{candidate.ad_name ?? candidate.ad_id}</p>
            <p className="text-xs text-muted-foreground">
              {candidate.campaign_name ?? "No campaign"} &middot; {candidate.platform}
            </p>
          </div>
          <Badge variant="outline" className="shrink-0">
            {new Date(candidate.created_at).toLocaleDateString()}
          </Badge>
        </div>

        <p className="text-sm text-foreground/90">{candidate.reason}</p>

        {candidate.error && (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{candidate.error}</p>
        )}
        {confirm.isError && (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {(confirm.error as Error).message}
          </p>
        )}

        {isPending && (
          <div className="flex gap-2">
            <Button size="sm" onClick={() => confirm.mutate()} disabled={confirm.isPending || dismiss.isPending}>
              {confirm.isPending ? "Pausing…" : "Pause this ad"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => dismiss.mutate()}
              disabled={confirm.isPending || dismiss.isPending}
            >
              Dismiss
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function PauseCandidatesClient({ clientId }: { clientId: string }) {
  const [status, setStatus] = useState<PauseCandidateStatus>("pending");

  const { data: candidates, isLoading } = useQuery({
    queryKey: ["pause-candidates", clientId, status],
    queryFn: () => getPauseCandidates(clientId, status),
  });

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <ClientKicker clientId={clientId} />
          <h1 className="text-lg font-semibold">Pause Candidates</h1>
          <p className="text-sm text-muted-foreground">
            Ads flagged by daily anomaly detection for a ROAS drop vs. their 7-day average. Nothing is
            paused automatically — confirm here to actually pause it, or dismiss to leave it running.
          </p>
        </div>
        <SegmentedToggle value={status} onChange={(v) => setStatus(v as PauseCandidateStatus)} options={STATUS_OPTIONS} />
      </div>

      {isLoading && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      )}

      {!isLoading && candidates?.length === 0 && (
        <Card className="px-4 py-8">
          <CardContent className="px-0 text-center text-sm text-muted-foreground">
            No {status} candidates yet.
          </CardContent>
        </Card>
      )}

      {!isLoading && candidates && candidates.length > 0 && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {candidates.map((c) => (
            <CandidateCard key={c.id} candidate={c} clientId={clientId} />
          ))}
        </div>
      )}
    </div>
  );
}
