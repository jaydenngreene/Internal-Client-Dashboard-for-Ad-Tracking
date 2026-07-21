"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getTags, createTag, deleteTag, getLeadTags, applyLeadTag, Tag, TagType } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency } from "@/lib/format";

const inputClass =
  "h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

const TAG_TYPE_LABEL: Record<TagType, string> = {
  freeform: "Freeform",
  funnel_stage: "Funnel Stage",
  product: "Product (auto-sale)",
};

function CreateTagForm({ clientId }: { clientId: string }) {
  const [name, setName] = useState("");
  const [tagType, setTagType] = useState<TagType>("freeform");
  const [stageOrder, setStageOrder] = useState("");
  const [productValue, setProductValue] = useState("");
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () =>
      createTag(clientId, {
        name: name.trim(),
        tag_type: tagType,
        stage_order: stageOrder ? parseInt(stageOrder, 10) : undefined,
        product_value: productValue ? parseFloat(productValue) : undefined,
      }),
    onSuccess: () => {
      setName("");
      setStageOrder("");
      setProductValue("");
      queryClient.invalidateQueries({ queryKey: ["tags", clientId] });
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
        <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Tag name</label>
        <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. webinar_attended" />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Type</label>
        <select
          className={inputClass}
          value={tagType}
          onChange={(e) => setTagType(e.target.value as TagType)}
        >
          <option value="freeform">Freeform</option>
          <option value="funnel_stage">Funnel Stage</option>
          <option value="product">Product (auto-sale)</option>
        </select>
      </div>
      {tagType === "funnel_stage" && (
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Stage order</label>
          <input type="number" className={`${inputClass} w-20`} value={stageOrder} onChange={(e) => setStageOrder(e.target.value)} />
        </div>
      )}
      {tagType === "product" && (
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Product value</label>
          <input type="number" min="0" step="0.01" className={`${inputClass} w-24`} value={productValue} onChange={(e) => setProductValue(e.target.value)} />
        </div>
      )}
      <Button type="submit" size="sm" disabled={!name.trim() || mutation.isPending}>
        Create tag
      </Button>
    </form>
  );
}

function TagsTable({ clientId, tags }: { clientId: string; tags: Tag[] }) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (tagId: string) => deleteTag(tagId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tags", clientId] }),
  });

  if (tags.length === 0) {
    return <p className="px-4 py-8 text-center text-sm text-muted-foreground">No tags defined yet.</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Name</TableHead>
          <TableHead className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Type</TableHead>
          <TableHead className="text-right text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Value</TableHead>
          <TableHead className="w-10" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {tags.map((tag) => (
          <TableRow key={tag.id}>
            <TableCell className="font-medium">{tag.name}</TableCell>
            <TableCell>
              <Badge variant="outline">{TAG_TYPE_LABEL[tag.tag_type]}</Badge>
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {tag.tag_type === "product" && tag.product_value != null ? formatCurrency(tag.product_value) : tag.stage_order ?? "—"}
            </TableCell>
            <TableCell>
              <Button size="xs" variant="ghost" onClick={() => mutation.mutate(tag.id)}>
                ×
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ApplyTagPanel({ clientId, tags }: { clientId: string; tags: Tag[] }) {
  const [email, setEmail] = useState("");
  const [selectedTagId, setSelectedTagId] = useState("");
  const queryClient = useQueryClient();

  const { data: leadTags, isLoading } = useQuery({
    queryKey: ["lead-tags", clientId, email],
    queryFn: () => getLeadTags(clientId, email),
    enabled: email.trim().length > 3,
  });

  const mutation = useMutation({
    mutationFn: () => applyLeadTag(clientId, email.trim().toLowerCase(), selectedTagId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["lead-tags", clientId, email] }),
  });

  return (
    <Card className="px-4">
      <CardHeader className="px-0">
        <CardTitle>Apply a tag to a lead</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-0">
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Lead email</label>
            <input className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="lead@example.com" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Tag</label>
            <select className={inputClass} value={selectedTagId} onChange={(e) => setSelectedTagId(e.target.value)}>
              <option value="">Select a tag…</option>
              {tags.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <Button
            size="sm"
            disabled={!email.trim() || !selectedTagId || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            Apply
          </Button>
        </div>
        {mutation.isError && <p className="text-xs text-status-critical">{(mutation.error as Error).message}</p>}

        {email.trim().length > 3 && (
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">Current tags</p>
            {isLoading && <p className="text-xs text-muted-foreground">Loading…</p>}
            {!isLoading && leadTags?.length === 0 && <p className="text-xs text-muted-foreground">No tags on this lead yet.</p>}
            <div className="flex flex-wrap gap-1.5">
              {leadTags?.map((t) => (
                <Badge key={t.id} variant="secondary">
                  {t.name}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function TagsClient({ clientId }: { clientId: string }) {
  const { data: tags, isLoading } = useQuery({
    queryKey: ["tags", clientId],
    queryFn: () => getTags(clientId),
  });

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-lg font-semibold">Tags & Stages</h1>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Freeform labels, funnel stages, and product tags — applying a product tag to a lead generates a Sale automatically
        </p>
      </div>

      <CreateTagForm clientId={clientId} />

      <Card className="px-0">
        <CardHeader className="px-4">
          <CardTitle>Tag Definitions</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          {isLoading ? <p className="px-4 py-8 text-center text-sm text-muted-foreground">Loading…</p> : <TagsTable clientId={clientId} tags={tags ?? []} />}
        </CardContent>
      </Card>

      <ApplyTagPanel clientId={clientId} tags={tags ?? []} />
    </div>
  );
}
