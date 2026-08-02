"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { HELP_SECTIONS, HelpEntry } from "@/lib/help-content";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ClientKicker } from "@/components/client-kicker";
import { cn } from "@/lib/utils";

function matches(entry: HelpEntry, query: string): boolean {
  const q = query.toLowerCase();
  if (entry.title.toLowerCase().includes(q) || entry.purpose.toLowerCase().includes(q)) return true;
  return (entry.metrics ?? []).some(
    (m) => m.term.toLowerCase().includes(q) || m.definition.toLowerCase().includes(q)
  );
}

// Deep-linked from an InfoTooltip's "Full setup guide" link elsewhere in the
// app (e.g. an integration row in Settings) via ?topic=<slug> — forces that
// one entry open and scrolls it into view on arrival, with a brief highlight
// ring so it's obvious which card the link was pointing at among a whole
// section of them.
function HelpCard({ entry, forceOpen, focused }: { entry: HelpEntry; forceOpen: boolean; focused: boolean }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focused]);

  return (
    <Card
      ref={ref}
      id={entry.slug}
      className={cn("scroll-mt-6 px-0 py-0 transition-shadow", focused && "ring-2 ring-primary")}
    >
      <details open={forceOpen || focused || undefined} className="group/details">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-medium marker:content-none">
          {entry.title}
          <span className="text-muted-foreground transition-transform group-open/details:rotate-180">⌄</span>
        </summary>
        <div className="flex flex-col gap-3 border-t border-border px-4 py-3">
          <p className="text-sm text-muted-foreground">{entry.purpose}</p>
          {entry.metrics && entry.metrics.length > 0 && (
            <dl className="flex flex-col gap-2">
              {entry.metrics.map((m) => (
                <div key={m.term} className="text-sm">
                  <dt className="inline font-medium text-foreground">{m.term}</dt>
                  <dd className="inline text-muted-foreground">: {m.definition}</dd>
                </div>
              ))}
            </dl>
          )}
          {entry.howToUse && Array.isArray(entry.howToUse) ? (
            <div className="text-xs text-muted-foreground">
              <p className="font-medium text-foreground">How to use it</p>
              <ol className="mt-1 flex list-decimal flex-col gap-1 pl-4">
                {entry.howToUse.map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
              </ol>
            </div>
          ) : (
            entry.howToUse && (
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">How to use it: </span>
                {entry.howToUse}
              </p>
            )
          )}
        </div>
      </details>
    </Card>
  );
}

export function HelpClient({ clientId }: { clientId: string }) {
  const [query, setQuery] = useState("");
  const trimmed = query.trim();
  const topic = useSearchParams().get("topic");

  const sections = useMemo(() => {
    if (!trimmed) return HELP_SECTIONS;
    return HELP_SECTIONS.map((section) => ({
      ...section,
      entries: section.entries.filter((e) => matches(e, trimmed)),
    })).filter((section) => section.entries.length > 0);
  }, [trimmed]);

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <ClientKicker clientId={clientId} />
        <h1 className="text-lg font-semibold">Help & Info</h1>
        <p className="mt-0.5 text-xs text-muted-foreground">
          What every tab does and what its numbers mean, for anyone new to this dashboard.
        </p>
      </div>

      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search a tab or metric…"
          className="pl-8"
        />
      </div>

      {sections.length === 0 && <p className="text-sm text-muted-foreground">No matches for &quot;{trimmed}&quot;.</p>}

      <div className="flex flex-col gap-6">
        {sections.map((section) => (
          <div key={section.label} className="flex flex-col gap-2">
            <p className="px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {section.label}
            </p>
            <div className="flex flex-col gap-2">
              {section.entries.map((entry) => (
                <HelpCard key={entry.slug} entry={entry} forceOpen={!!trimmed} focused={entry.slug === topic} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
