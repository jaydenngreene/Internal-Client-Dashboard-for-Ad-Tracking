"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getAudienceSyncs,
  createAudienceSync,
  runAudienceSync,
  AudienceSync,
  AudiencePlatform,
  SegmentType,
} from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FieldLabel } from "@/components/ui/field-label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatNumber } from "@/lib/format";

const PLATFORM_LABEL: Record<AudiencePlatform, string> = {
  facebook_custom_audience: "Meta Custom Audience",
  google_customer_match: "Google Customer Match",
};

const SEGMENT_LABEL: Record<SegmentType, string> = {
  all_customers: "All customers",
  ltv_above: "LTV above a threshold",
  tag: "Has a specific tag",
};

function CreateSyncForm({ clientId }: { clientId: string }) {
  const [name, setName] = useState("");
  const [platform, setPlatform] = useState<AudiencePlatform>("facebook_custom_audience");
  const [segmentType, setSegmentType] = useState<SegmentType>("all_customers");
  const [threshold, setThreshold] = useState("");
  const [tagName, setTagName] = useState("");
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () =>
      createAudienceSync(clientId, {
        name: name.trim(),
        platform,
        segment_definition: {
          type: segmentType,
          threshold: segmentType === "ltv_above" ? parseFloat(threshold) : undefined,
          tag_name: segmentType === "tag" ? tagName.trim() : undefined,
        },
      }),
    onSuccess: () => {
      setName("");
      setThreshold("");
      setTagName("");
      queryClient.invalidateQueries({ queryKey: ["audience-syncs", clientId] });
    },
  });

  return (
    <form
      className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-muted/30 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) mutation.mutate();
      }}
    >
      <div className="flex flex-col gap-1">
        <FieldLabel>Sync name</FieldLabel>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. High-LTV customers" />
      </div>
      <div className="flex flex-col gap-1">
        <FieldLabel>Platform</FieldLabel>
        <Select value={platform} onValueChange={(v) => setPlatform(v as AudiencePlatform)}>
          <SelectTrigger className="w-48">
            <SelectValue>{(v: AudiencePlatform) => PLATFORM_LABEL[v]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="facebook_custom_audience">Meta Custom Audience</SelectItem>
            <SelectItem value="google_customer_match">Google Customer Match</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1">
        <FieldLabel>Segment</FieldLabel>
        <Select value={segmentType} onValueChange={(v) => setSegmentType(v as SegmentType)}>
          <SelectTrigger className="w-48">
            <SelectValue>{(v: SegmentType) => SEGMENT_LABEL[v]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all_customers">All customers</SelectItem>
            <SelectItem value="ltv_above">LTV above a threshold</SelectItem>
            <SelectItem value="tag">Has a specific tag</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {segmentType === "ltv_above" && (
        <div className="flex flex-col gap-1">
          <FieldLabel>Threshold ($)</FieldLabel>
          <Input type="number" min="0" step="0.01" className="w-24" value={threshold} onChange={(e) => setThreshold(e.target.value)} />
        </div>
      )}
      {segmentType === "tag" && (
        <div className="flex flex-col gap-1">
          <FieldLabel>Tag name</FieldLabel>
          <Input value={tagName} onChange={(e) => setTagName(e.target.value)} />
        </div>
      )}
      <Button type="submit" size="sm" disabled={!name.trim() || mutation.isPending}>
        Create sync
      </Button>
    </form>
  );
}

function SyncRow({ clientId, sync }: { clientId: string; sync: AudienceSync }) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => runAudienceSync(sync.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["audience-syncs", clientId] }),
  });

  return (
    <Card className="px-4 py-3">
      <CardContent className="flex flex-col gap-2 px-0">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-sm font-medium">{sync.name}</p>
            <p className="text-xs text-muted-foreground">
              {PLATFORM_LABEL[sync.platform]}: {sync.segment_definition.type}
              {sync.segment_definition.type === "ltv_above" && ` $${sync.segment_definition.threshold}`}
              {sync.segment_definition.type === "tag" && ` "${sync.segment_definition.tag_name}"`}
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending ? "Syncing…" : "Run now"}
          </Button>
        </div>
        {sync.last_sync_error ? (
          <Badge variant="destructive">Last sync failed: {sync.last_sync_error.slice(0, 120)}</Badge>
        ) : sync.last_synced_at ? (
          <p className="text-xs text-muted-foreground">
            Last synced {new Date(sync.last_synced_at).toLocaleString()}, {formatNumber(sync.last_sync_count ?? 0)} members
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">Never synced yet</p>
        )}
      </CardContent>
    </Card>
  );
}

export function AudiencesClient({ clientId }: { clientId: string }) {
  const { data: syncs, isLoading } = useQuery({
    queryKey: ["audience-syncs", clientId],
    queryFn: () => getAudienceSyncs(clientId),
  });

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-lg font-semibold">Audiences</h1>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Export lead/customer segments as Meta Custom Audiences or Google Customer Match lists, re-evaluated against live data on every sync
        </p>
      </div>

      <CreateSyncForm clientId={clientId} />

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {!isLoading && syncs?.length === 0 && (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">No audience syncs configured yet.</p>
      )}
      <div className="flex flex-col gap-3">
        {syncs?.map((sync) => (
          <SyncRow key={sync.id} clientId={clientId} sync={sync} />
        ))}
      </div>
    </div>
  );
}
