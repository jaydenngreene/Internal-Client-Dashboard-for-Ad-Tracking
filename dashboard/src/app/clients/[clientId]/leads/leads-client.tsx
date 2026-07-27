"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getJourney,
  updateCallQualification,
  getBestPaths,
  getClients,
  getBuyingJourney,
  CALL_DISPOSITIONS,
  CallDisposition,
  Journey,
  JourneySession,
  JourneyCall,
  ConvertedPerson,
} from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FieldLabel } from "@/components/ui/field-label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ClientKicker } from "@/components/client-kicker";
import { Skeleton } from "@/components/ui/skeleton";
import { SegmentedToggle } from "@/components/segmented-toggle";
import { StatTile } from "@/components/stat-tile";
import { useDateRangeState } from "@/lib/date-range";
import { formatCurrency, formatNumber, formatDuration } from "@/lib/format";
import { vocabularyForNiche, showsBestPaths, NicheVocabulary } from "@/lib/niche-vocabulary";
import { cn } from "@/lib/utils";

// Rockerbox's Marketing Paths view names its top findings ("fastest path,"
// "highest earning path") instead of leaving the reader to spot them in a raw
// journey table - a cheap, honest upgrade since the underlying data already
// exists (every purchase's attribution rows). See api/src/lib/bestPaths.ts.
// Purchase-revenue-path-driven — only shown for the two 'purchase'-event
// niches (see niche-vocabulary.ts's showsBestPaths); not generalized to
// leads/calls/subscriptions in Phase 3 (bestPaths.ts's own SQL is
// purchases-hardcoded, regeneralizing IT is a separate piece of work).
function BestPathsCallouts({ clientId }: { clientId: string }) {
  const { range } = useDateRangeState("30d");
  const { data } = useQuery({
    queryKey: ["best-paths", clientId, range.from, range.to],
    queryFn: () => getBestPaths(clientId, range),
  });

  if (!data) return null;
  if (!data.bestRevenuePath && !data.fastestPath) {
    return data.reason ? <p className="text-xs text-muted-foreground">{data.reason}</p> : null;
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {data.bestRevenuePath && (
        <Card className="border-status-good/30 bg-status-good/5 px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-status-good">Best-earning path</p>
          <p className="mt-1 text-sm font-medium">{data.bestRevenuePath.path}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {formatCurrency(data.bestRevenuePath.revenue)} from {formatNumber(data.bestRevenuePath.conversions)}{" "}
            customers who converted along this exact path
          </p>
        </Card>
      )}
      {data.fastestPath && (
        <Card className="border-primary/30 bg-primary/5 px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-primary">Fastest-converting path</p>
          <p className="mt-1 text-sm font-medium">{data.fastestPath.path}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Averages {data.fastestPath.avgDaysToConvert.toFixed(1)} days to convert across{" "}
            {formatNumber(data.fastestPath.conversions)} customers
          </p>
        </Card>
      )}
    </div>
  );
}

const DISPOSITION_LABEL: Record<CallDisposition, string> = {
  new_lead: "New lead",
  qualified: "Qualified",
  unqualified: "Unqualified",
  existing_customer: "Existing customer",
  wrong_number: "Wrong number",
  voicemail: "Voicemail",
  spam: "Spam",
};

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

function sessionLabel(s: JourneySession): string {
  return s.utm_campaign || s.utm_source || (s.fbclid ? "Facebook click" : s.gclid ? "Google click" : "Direct / no UTM");
}

function SessionRow({ session, index }: { session: JourneySession; index: number }) {
  return (
    <div className="flex gap-3 rounded-lg border border-border p-3">
      <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
        {index + 1}
      </div>
      <div className="flex flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{sessionLabel(session)}</span>
          <span className="text-xs text-muted-foreground">{formatDateTime(session.started_at)}</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {session.utm_source && <Badge variant="outline" className="text-[10px]">source: {session.utm_source}</Badge>}
          {session.utm_content && (
            <Badge variant="outline" className="text-[10px]">
              creative: {session.resolved_creative_name ?? session.utm_content}
            </Badge>
          )}
          {session.utm_term && <Badge variant="outline" className="text-[10px]">keyword: {session.utm_term}</Badge>}
          {session.fbclid && <Badge variant="outline" className="text-[10px]">fbclid</Badge>}
          {session.gclid && <Badge variant="outline" className="text-[10px]">gclid</Badge>}
          {session.ttclid && <Badge variant="outline" className="text-[10px]">ttclid</Badge>}
        </div>
        {(session.landing_page || session.referrer) && (
          <p className="truncate text-xs text-muted-foreground">
            {session.landing_page && <>Landed on {session.landing_page}</>}
            {session.landing_page && session.referrer && " · "}
            {session.referrer && <>from {session.referrer}</>}
          </p>
        )}
      </div>
    </div>
  );
}

function CallRow({ call, clientId, email }: { call: JourneyCall; clientId: string; email: string }) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (body: { qualification_score?: number; disposition?: CallDisposition }) =>
      updateCallQualification(call.id, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["journey", clientId, email] }),
  });

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span>{formatDateTime(call.started_at)}</span>
        {call.status && <Badge variant="outline" className="text-[10px]">{call.status}</Badge>}
        {call.duration_seconds != null && (
          <span className="text-xs text-muted-foreground">{formatDuration(call.duration_seconds)}</span>
        )}
        <Select
          value={call.disposition ?? ""}
          onValueChange={(v) => mutation.mutate({ disposition: v as CallDisposition })}
        >
          <SelectTrigger className="h-7 w-40">
            <SelectValue placeholder="Set disposition…">
              {(v: string) => (v ? DISPOSITION_LABEL[v as CallDisposition] : "Set disposition…")}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {CALL_DISPOSITIONS.map((d) => (
              <SelectItem key={d} value={d}>
                {DISPOSITION_LABEL[d]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="xs"
          variant={call.qualified ? "secondary" : "outline"}
          disabled={mutation.isPending}
          onClick={() => mutation.mutate({ qualification_score: call.qualified ? 0 : 1 })}
        >
          {call.qualified ? "Qualified" : "Mark qualified"}
        </Button>
      </div>

      {call.ai_summary && (
        <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
          <p className="font-medium uppercase tracking-wider text-muted-foreground">
            Gojo assessment
            {call.ai_disposition && ` · ${DISPOSITION_LABEL[call.ai_disposition as CallDisposition] ?? call.ai_disposition}`}
            {call.ai_qualification_score !== null && ` (${(call.ai_qualification_score * 100).toFixed(0)}%)`}
          </p>
          <p className="mt-1 text-foreground/90">{call.ai_summary}</p>
        </div>
      )}
      {call.transcript && !call.ai_summary && call.transcript !== "(transcription failed)" && (
        <p className="text-xs text-muted-foreground">Transcript ready, AI scoring pending…</p>
      )}
    </div>
  );
}

// Phase 3 (2026-07-28): generalized from a hardcoded "Purchases" card.
// `journey.eventType` decides both the header (via vocab) and which fields
// this row actually has — value/label are always present (null when not
// applicable), the rest (refunded/processor/order_id/attributions) are only
// ever populated for a 'purchase' event, status only for a subscription
// conversion, page only for a lead. Qualified calls never reach this card at
// all (journey.conversions is empty for that event type) — the existing
// Calls card below already covers that niche with its own richer
// disposition/AI-summary workflow.
function ConversionRow({ conversion, sessionById }: { conversion: Journey["conversions"][number]; sessionById: Map<string, JourneySession & { index: number }> }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        {conversion.value !== null && <span className="text-sm font-medium">{formatCurrency(conversion.value)}</span>}
        {conversion.label && <span className="text-xs text-muted-foreground">{conversion.label}</span>}
        <span className="text-xs text-muted-foreground">{formatDateTime(conversion.occurred_at)}</span>
        {conversion.status && <Badge variant="outline" className="text-[10px]">{conversion.status}</Badge>}
        {conversion.processor && <Badge variant="outline" className="text-[10px]">{conversion.processor}</Badge>}
        {conversion.refunded && (
          <Badge variant="destructive" className="text-[10px]">
            refunded
          </Badge>
        )}
        {conversion.attributed !== undefined && (
          <Badge
            variant={conversion.attributed ? "secondary" : "outline"}
            className={cn("text-[10px]", !conversion.attributed && "text-status-warning border-status-warning/40")}
          >
            {conversion.attributed ? "attributed" : "unattributed"}
          </Badge>
        )}
      </div>
      {conversion.attributions && conversion.attributions.length > 0 && (
        <div className="flex flex-col gap-1 pl-1 text-xs text-muted-foreground">
          {conversion.attributions.map((a, i) => {
            const session = sessionById.get(a.session_id);
            return (
              <p key={i}>
                {formatCurrency(a.attributed_revenue)} ({(a.credit_fraction * 100).toFixed(0)}%, {a.model}) credited to
                touchpoint {session ? `#${session.index + 1} · ${sessionLabel(session)}` : "an untracked session"}
              </p>
            );
          })}
        </div>
      )}
    </div>
  );
}

function JourneyView({ journey, clientId, vocab }: { journey: Journey; clientId: string; vocab: NicheVocabulary }) {
  const sessionById = new Map(journey.sessions.map((s, i) => [s.id, { ...s, index: i }]));

  return (
    <div className="flex flex-col gap-4">
      {!journey.identified && (
        <div className="rounded-lg border border-status-warning/40 bg-status-warning/10 px-4 py-3 text-sm text-status-warning">
          This {vocab.personNoun.toLowerCase()} has never been tracked by the pixel. No ad session history exists for
          them. Anything below has no attribution, no LTV contribution, and never fired a conversion signal or
          outbound webhook.
        </div>
      )}

      <Card className="px-4">
        <CardHeader className="px-0">
          <CardTitle>Sessions ({journey.sessions.length})</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 px-0">
          {journey.sessions.length === 0 && (
            <p className="py-4 text-center text-sm text-muted-foreground">No tracked sessions for this {vocab.personNoun.toLowerCase()}.</p>
          )}
          {journey.sessions.map((s, i) => (
            <SessionRow key={s.id} session={s} index={i} />
          ))}
        </CardContent>
      </Card>

      {journey.eventType !== "qualified_call" && (
        <Card className="px-4">
          <CardHeader className="px-0">
            <CardTitle>
              {vocab.conversionsSectionHeader} ({journey.conversions.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 px-0">
            {journey.conversions.length === 0 && (
              <p className="py-4 text-center text-sm text-muted-foreground">
                No {vocab.conversionsSectionHeader.toLowerCase()} for this {vocab.personNoun.toLowerCase()}.
              </p>
            )}
            {journey.conversions.map((c) => (
              <ConversionRow key={c.id} conversion={c} sessionById={sessionById} />
            ))}
          </CardContent>
        </Card>
      )}

      <Card className="px-4">
        <CardHeader className="px-0">
          <CardTitle>Tags ({journey.tags.length})</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          {journey.tags.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No tags applied.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {journey.tags.map((t, i) => (
                <Badge key={i} variant="secondary">
                  {t.name}
                  <span className="text-muted-foreground"> · {formatDateTime(t.applied_at)}</span>
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {journey.calls.length > 0 && (
        <Card className="px-4">
          <CardHeader className="px-0">
            <CardTitle>Calls ({journey.calls.length})</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 px-0">
            {journey.calls.map((c) => (
              <CallRow key={c.id} call={c} clientId={clientId} email={journey.email} />
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// Phase 2 (2026-07-28), generalized to every niche in Phase 3. Top 3
// converting creatives, then one row per converted person in the selected
// date range; clicking the identifier hands off to the single-person lookup
// view instead of duplicating that view's own detail rendering here.
function ConvertedPeopleTab({
  data,
  isLoading,
  vocab,
  onSelectIdentifier,
}: {
  data: { topConvertingCreatives: { name: string; customers: number }[]; people: ConvertedPerson[]; hasValue: boolean } | undefined;
  isLoading: boolean;
  vocab: NicheVocabulary;
  onSelectIdentifier: (identifier: string) => void;
}) {
  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (!data || data.people.length === 0) {
    return (
      <Card className="px-4 py-8">
        <CardContent className="px-0 text-center text-sm text-muted-foreground">
          No {vocab.personNoun.toLowerCase()}s converted in this range.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {data.topConvertingCreatives.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">Top Converting Creatives</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {data.topConvertingCreatives.map((c) => (
              <Card key={c.name} className="px-4 py-3">
                <p className="truncate text-sm font-medium">{c.name}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatNumber(c.customers)} {vocab.personNoun.toLowerCase()}
                  {c.customers === 1 ? "" : "s"} converted
                </p>
              </Card>
            ))}
          </div>
        </div>
      )}

      <Card className="overflow-hidden px-0 py-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-4 py-2 font-medium">Email</th>
                <th className="px-4 py-2 font-medium">Conversions</th>
                {vocab.valueColumnLabel && <th className="px-4 py-2 font-medium">{vocab.valueColumnLabel}</th>}
                <th className="px-4 py-2 font-medium">Sessions to convert</th>
              </tr>
            </thead>
            <tbody>
              {data.people.map((p) => (
                <tr key={p.identifier} className="border-b border-border last:border-0 hover:bg-muted/40">
                  <td className="px-4 py-2">
                    {/* A qualified call with no linked identity falls back to a
                        phone number here (see buyingJourney.ts) — the lookup
                        view is keyed by email, so there's nothing to look up
                        for a bare phone number; render it as plain text
                        instead of a dead-end button. */}
                    {p.identifier.includes("@") ? (
                      <button className="text-primary hover:underline" onClick={() => onSelectIdentifier(p.identifier)}>
                        {p.identifier}
                      </button>
                    ) : (
                      <span className="text-muted-foreground">{p.identifier}</span>
                    )}
                  </td>
                  <td className="px-4 py-2">{formatNumber(p.conversionCount)}</td>
                  {vocab.valueColumnLabel && (
                    <td className="px-4 py-2">{p.totalValue !== null ? formatCurrency(p.totalValue) : "—"}</td>
                  )}
                  <td className="px-4 py-2">{p.sessionsToConvert ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

type BuyingJourneyTab = "lookup" | "converted";

export function LeadsClient({ clientId }: { clientId: string }) {
  const searchParams = useSearchParams();
  // Lets a campaign/creative detail page's converted-customer list deep-link straight
  // into that customer's full ad-touch history (the "customer lifetime journey") instead
  // of only supporting a manually-typed search. Lazy-initialized from the URL rather
  // than synced via an effect — every deep link here arrives via a cross-route
  // navigation from a campaign/creative page, which always mounts a fresh instance of
  // this component, so the initial value is all that's ever needed.
  const emailFromUrl = searchParams.get("email");
  const [email, setEmail] = useState(emailFromUrl ?? "");
  const [searchedEmail, setSearchedEmail] = useState(emailFromUrl?.trim().toLowerCase() ?? "");
  const [tab, setTab] = useState<BuyingJourneyTab>("lookup");

  // Phase 3 (2026-07-28): every niche gets the full experience now (summary
  // metrics, the second tab) — vocab is the ONLY thing that varies per
  // niche, never a conditional fork of the page itself.
  const { data: clients } = useQuery({ queryKey: ["clients"], queryFn: getClients });
  const niche = clients?.find((c) => c.id === clientId)?.niche;
  const vocab = vocabularyForNiche(niche);

  const { range } = useDateRangeState("30d");

  const { data: journey, isLoading, isError } = useQuery({
    queryKey: ["journey", clientId, searchedEmail],
    queryFn: () => getJourney(clientId, searchedEmail),
    enabled: searchedEmail.trim().length > 3,
  });

  const { data: buyingJourney, isLoading: buyingJourneyLoading } = useQuery({
    queryKey: ["buying-journey", clientId, range.from, range.to],
    queryFn: () => getBuyingJourney(clientId, range),
  });

  function selectPerson(identifier: string) {
    setEmail(identifier);
    setSearchedEmail(identifier.trim().toLowerCase());
    setTab("lookup");
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <ClientKicker clientId={clientId} />
        <h1 className="text-lg font-semibold">{vocab.pageLabel}</h1>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Look up one {vocab.personNoun.toLowerCase()} to see their full journey, or browse everyone who converted in
          the selected date range.
        </p>
      </div>

      {showsBestPaths(niche) && <BestPathsCallouts clientId={clientId} />}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <StatTile
          label="Avg days to convert"
          value={buyingJourney?.avgDaysToConvert != null ? buyingJourney.avgDaysToConvert.toFixed(1) : "—"}
        />
        <StatTile
          label="Avg sessions to convert"
          value={buyingJourney?.avgSessionsToConvert != null ? buyingJourney.avgSessionsToConvert.toFixed(1) : "—"}
        />
      </div>
      <SegmentedToggle
        value={tab}
        onChange={(v) => setTab(v as BuyingJourneyTab)}
        options={[
          { value: "lookup", label: `Look up one ${vocab.personNoun.toLowerCase()}` },
          { value: "converted", label: vocab.convertedPeopleTabLabel },
        ]}
      />

      {tab === "lookup" && (
        <>
          <Card className="px-4">
            <CardContent className="flex flex-wrap items-end gap-2 px-0">
              <div className="flex flex-col gap-1">
                <FieldLabel>{vocab.emailFieldLabel}</FieldLabel>
                <Input
                  className="w-72"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") setSearchedEmail(email.trim().toLowerCase());
                  }}
                  placeholder={vocab.emailPlaceholder}
                />
              </div>
              <Button size="sm" disabled={!email.trim()} onClick={() => setSearchedEmail(email.trim().toLowerCase())}>
                Search
              </Button>
            </CardContent>
          </Card>

          {isLoading && <Skeleton className="h-64 w-full" />}
          {isError && <p className="text-sm text-status-critical">Failed to load. Is the API running?</p>}
          {journey && <JourneyView journey={journey} clientId={clientId} vocab={vocab} />}
        </>
      )}

      {tab === "converted" && (
        <ConvertedPeopleTab data={buyingJourney} isLoading={buyingJourneyLoading} vocab={vocab} onSelectIdentifier={selectPerson} />
      )}
    </div>
  );
}
