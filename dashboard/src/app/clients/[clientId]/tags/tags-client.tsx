"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getTags, createTag, deleteTag, getLeadTags, applyLeadTag, Tag, TagType } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { FieldLabel } from "@/components/ui/field-label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatCurrency } from "@/lib/format";

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
        <FieldLabel>Tag name</FieldLabel>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. webinar_attended" />
      </div>
      <div className="flex flex-col gap-1">
        <FieldLabel>Type</FieldLabel>
        <Select value={tagType} onValueChange={(v) => setTagType(v as TagType)}>
          <SelectTrigger className="w-44">
            <SelectValue>{(v: TagType) => TAG_TYPE_LABEL[v]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="freeform">Freeform</SelectItem>
            <SelectItem value="funnel_stage">Funnel Stage</SelectItem>
            <SelectItem value="product">Product (auto-sale)</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {tagType === "funnel_stage" && (
        <div className="flex flex-col gap-1">
          <FieldLabel>Stage order</FieldLabel>
          <Input type="number" className="w-20" value={stageOrder} onChange={(e) => setStageOrder(e.target.value)} />
        </div>
      )}
      {tagType === "product" && (
        <div className="flex flex-col gap-1">
          <FieldLabel>Product value</FieldLabel>
          <Input type="number" min="0" step="0.01" className="w-24" value={productValue} onChange={(e) => setProductValue(e.target.value)} />
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
              {tag.tag_type === "product" && tag.product_value != null ? formatCurrency(tag.product_value) : tag.stage_order ?? "-"}
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
            <FieldLabel>Lead email</FieldLabel>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="lead@example.com" />
          </div>
          <div className="flex flex-col gap-1">
            <FieldLabel>Tag</FieldLabel>
            <Select value={selectedTagId} onValueChange={(v) => setSelectedTagId(v ?? "")}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="Select a tag…">
                  {(v: string) => tags.find((t) => t.id === v)?.name ?? "Select a tag…"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {tags.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
          Freeform labels, funnel stages, and product tags. Applying a product tag to a lead generates a Sale automatically
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
