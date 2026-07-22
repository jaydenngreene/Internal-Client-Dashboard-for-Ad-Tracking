"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getJourney,
  updateCallQualification,
  CALL_DISPOSITIONS,
  CallDisposition,
  Journey,
  JourneySession,
  JourneyCall,
} from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FieldLabel } from "@/components/ui/field-label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ClientKicker } from "@/components/client-kicker";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency, formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";

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
          {session.utm_medium && <Badge variant="outline" className="text-[10px]">medium: {session.utm_medium}</Badge>}
          {session.utm_content && <Badge variant="outline" className="text-[10px]">creative: {session.utm_content}</Badge>}
          {session.utm_term && <Badge variant="outline" className="text-[10px]">keyword: {session.utm_term}</Badge>}
          {session.fbclid && <Badge variant="outline" className="text-[10px]">fbclid</Badge>}
          {session.gclid && <Badge variant="outline" className="text-[10px]">gclid</Badge>}
          {session.ttclid && <Badge variant="outline" className="text-[10px]">ttclid</Badge>}
        </div>
        {(session.landing_page || session.referrer) && (
          <p className="truncate text-xs text-muted-foreground">
            {session.landing_page && <>Landed on {session.landing_page}</>}
            {session.landing_page && session.referrer && " — "}
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
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-3 text-sm">
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
  );
}

function JourneyView({ journey, clientId }: { journey: Journey; clientId: string }) {
  const sessionById = new Map(journey.sessions.map((s, i) => [s.id, { ...s, index: i }]));

  return (
    <div className="flex flex-col gap-4">
      {!journey.identified && (
        <div className="rounded-lg border border-status-warning/40 bg-status-warning/10 px-4 py-3 text-sm text-status-warning">
          This lead has never been tracked by the pixel — no ad session history exists for them. Any purchases below
          have no attribution, no LTV contribution, and never fired a conversion signal or outbound webhook.
        </div>
      )}

      <Card className="px-4">
        <CardHeader className="px-0">
          <CardTitle>Sessions ({journey.sessions.length})</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 px-0">
          {journey.sessions.length === 0 && (
            <p className="py-4 text-center text-sm text-muted-foreground">No tracked sessions for this lead.</p>
          )}
          {journey.sessions.map((s, i) => (
            <SessionRow key={s.id} session={s} index={i} />
          ))}
        </CardContent>
      </Card>

      <Card className="px-4">
        <CardHeader className="px-0">
          <CardTitle>Purchases ({journey.purchases.length})</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 px-0">
          {journey.purchases.length === 0 && (
            <p className="py-4 text-center text-sm text-muted-foreground">No purchases for this lead.</p>
          )}
          {journey.purchases.map((p) => (
            <div key={p.id} className="flex flex-col gap-1.5 rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{formatCurrency(p.revenue)}</span>
                {p.product && <span className="text-xs text-muted-foreground">{p.product}</span>}
                <span className="text-xs text-muted-foreground">{formatDateTime(p.purchased_at)}</span>
                {p.processor && <Badge variant="outline" className="text-[10px]">{p.processor}</Badge>}
                {p.refunded && (
                  <Badge variant="destructive" className="text-[10px]">
                    refunded
                  </Badge>
                )}
                <Badge
                  variant={p.attributed ? "secondary" : "outline"}
                  className={cn("text-[10px]", !p.attributed && "text-status-warning border-status-warning/40")}
                >
                  {p.attributed ? "attributed" : "unattributed"}
                </Badge>
              </div>
              {p.attributions.length > 0 && (
                <div className="flex flex-col gap-1 pl-1 text-xs text-muted-foreground">
                  {p.attributions.map((a, i) => {
                    const session = sessionById.get(a.session_id);
                    return (
                      <p key={i}>
                        {formatCurrency(a.attributed_revenue)} ({(a.credit_fraction * 100).toFixed(0)}%, {a.model}) credited to
                        touchpoint {session ? `#${session.index + 1} — ${sessionLabel(session)}` : "an untracked session"}
                      </p>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

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

export function LeadsClient({ clientId }: { clientId: string }) {
  const [email, setEmail] = useState("");
  const [searchedEmail, setSearchedEmail] = useState("");

  const { data: journey, isLoading, isError } = useQuery({
    queryKey: ["journey", clientId, searchedEmail],
    queryFn: () => getJourney(clientId, searchedEmail),
    enabled: searchedEmail.trim().length > 3,
  });

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <ClientKicker clientId={clientId} />
        <h1 className="text-lg font-semibold">Leads</h1>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Look up one lead by email to see their full journey — every session that led here, which one got credit for
          which sale, every tag, every call.
        </p>
      </div>

      <Card className="px-4">
        <CardContent className="flex flex-wrap items-end gap-2 px-0">
          <div className="flex flex-col gap-1">
            <FieldLabel>Lead email</FieldLabel>
            <Input
              className="w-72"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") setSearchedEmail(email.trim().toLowerCase());
              }}
              placeholder="lead@example.com"
            />
          </div>
          <Button size="sm" disabled={!email.trim()} onClick={() => setSearchedEmail(email.trim().toLowerCase())}>
            Search
          </Button>
        </CardContent>
      </Card>

      {isLoading && <Skeleton className="h-64 w-full" />}
      {isError && <p className="text-sm text-status-critical">Failed to load. Is the API running?</p>}
      {journey && <JourneyView journey={journey} clientId={clientId} />}
    </div>
  );
}
