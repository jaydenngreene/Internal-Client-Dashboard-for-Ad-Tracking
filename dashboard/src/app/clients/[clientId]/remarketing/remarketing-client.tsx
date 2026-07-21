"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getRemarketingCandidates,
  approveRemarketingCandidate,
  rejectRemarketingCandidate,
  RemarketingCandidate,
  RemarketingStatus,
} from "@/lib/api";
import { SegmentedToggle } from "@/components/segmented-toggle";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

const STATUS_OPTIONS: { value: RemarketingStatus; label: string }[] = [
  { value: "pending", label: "Pending Review" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "dispatched", label: "Dispatched" },
];

function CandidateCard({ candidate, clientId }: { candidate: RemarketingCandidate; clientId: string }) {
  const queryClient = useQueryClient();

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["remarketing-candidates", clientId] });

  const approve = useMutation({
    mutationFn: () => approveRemarketingCandidate(candidate.id),
    onSuccess: invalidate,
  });
  const reject = useMutation({
    mutationFn: () => rejectRemarketingCandidate(candidate.id),
    onSuccess: invalidate,
  });

  const name = [candidate.first_name, candidate.last_name].filter(Boolean).join(" ") || candidate.email;
  const isPending = candidate.status === "pending";

  return (
    <Card className="px-4 py-3">
      <CardContent className="flex flex-col gap-3 px-0">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-medium">{name}</p>
            <p className="text-xs text-muted-foreground">{candidate.email}</p>
            {candidate.page_title || candidate.page_url ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Last seen: {candidate.page_title ?? candidate.page_url}
              </p>
            ) : null}
          </div>
          <Badge variant="outline" className="shrink-0">
            {new Date(candidate.identified_at).toLocaleDateString()}
          </Badge>
        </div>

        {candidate.draft_error ? (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
            Draft generation failed: {candidate.draft_error}
          </p>
        ) : candidate.draft_subject && candidate.draft_body ? (
          <div className="rounded-md border border-border bg-muted/40 px-3 py-2">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              AI-drafted subject
            </p>
            <p className="mt-0.5 text-sm font-medium">{candidate.draft_subject}</p>
            <p className="mt-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">Body</p>
            <p className="mt-0.5 whitespace-pre-wrap text-sm text-foreground/90">{candidate.draft_body}</p>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Draft still generating…</p>
        )}

        {isPending && (
          <div className="flex gap-2">
            <Button size="sm" onClick={() => approve.mutate()} disabled={approve.isPending || reject.isPending}>
              Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => reject.mutate()}
              disabled={approve.isPending || reject.isPending}
            >
              Reject
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function RemarketingClient({ clientId }: { clientId: string }) {
  const [status, setStatus] = useState<RemarketingStatus>("pending");

  const { data: candidates, isLoading } = useQuery({
    queryKey: ["remarketing-candidates", clientId, status],
    queryFn: () => getRemarketingCandidates(clientId, status),
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Remarketing Agent</h1>
          <p className="text-sm text-muted-foreground">
            Visitors identified by Customers.ai, with AI-drafted outreach copy awaiting review.
            Approving here does not send anything — it only marks a candidate ready for a
            separate, deliberate dispatch step.
          </p>
        </div>
        <SegmentedToggle
          value={status}
          onChange={(v) => setStatus(v as RemarketingStatus)}
          options={STATUS_OPTIONS}
        />
      </div>

      {isLoading && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
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
