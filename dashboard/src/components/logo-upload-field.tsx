"use client";

import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { uploadLogo } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// Shared by agency branding (account settings) and client branding (Settings
// > Sharing) — both need the exact same "paste a URL you host yourself, OR
// upload one from your device" choice, backed by the same /uploads/logo
// endpoint. Rounded-corner display is CSS only (`rounded-xl` on the preview),
// same as every other in-app logo treatment — the uploaded file itself is
// never shape-modified, since it's reused in differently-shaped places.
export function LogoUploadField({
  label,
  value,
  onChange,
  previewClassName,
}: {
  label: string;
  value: string | null;
  onChange: (url: string | null) => void;
  previewClassName?: string;
}) {
  const [urlDraft, setUrlDraft] = useState(value ?? "");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const uploadMutation = useMutation({
    mutationFn: (file: File) => uploadLogo(file),
    onSuccess: (data) => {
      setUrlDraft(data.url);
      onChange(data.url);
    },
  });

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <div className="flex flex-wrap items-center gap-3">
        <div
          className={cn(
            "flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-muted/40",
            previewClassName
          )}
        >
          {value ? (
            // eslint-disable-next-line @next/next/no-img-element -- arbitrary
            // agency-hosted or uploaded URLs, not a static local asset next/image
            // can optimize at build time.
            <img src={value} alt="" className="size-full object-contain" />
          ) : (
            <span className="text-[10px] text-muted-foreground">No logo</span>
          )}
        </div>
        <div className="flex flex-1 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) uploadMutation.mutate(file);
                e.target.value = "";
              }}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={uploadMutation.isPending}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploadMutation.isPending ? "Uploading…" : "Upload from device"}
            </Button>
            {value && (
              <Button type="button" size="sm" variant="ghost" onClick={() => { setUrlDraft(""); onChange(null); }}>
                Remove
              </Button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              className="w-64"
              placeholder="or paste an image URL"
              value={urlDraft}
              onChange={(e) => setUrlDraft(e.target.value)}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={urlDraft.trim() === (value ?? "")}
              onClick={() => onChange(urlDraft.trim() || null)}
            >
              Use URL
            </Button>
          </div>
          {uploadMutation.isError && (
            <p className="text-xs text-status-critical">{(uploadMutation.error as Error).message}</p>
          )}
        </div>
      </div>
    </div>
  );
}
