"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  createClient,
  saveShopifyIntegration,
  saveStripeIntegration,
  savePaypalIntegration,
  saveSquareIntegration,
  saveGoHighLevelIntegration,
  NICHES,
  Niche,
  Client,
  ProcessorPlatform,
} from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FieldLabel } from "@/components/ui/field-label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const NICHE_LABEL: Record<Niche, string> = {
  ecommerce: "Ecommerce",
  call: "Call-based / local service",
  lead_gen: "Lead generation",
  saas: "SaaS",
  info_product: "Info product / education",
  other: "Other",
};

const PROCESSORS: { value: ProcessorPlatform | "none"; label: string }[] = [
  { value: "shopify", label: "Shopify" },
  { value: "stripe", label: "Stripe" },
  { value: "paypal", label: "PayPal" },
  { value: "square", label: "Square" },
  { value: "gohighlevel", label: "GoHighLevel" },
  { value: "none", label: "Skip for now" },
];

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
      <code>{children}</code>
    </pre>
  );
}

export function NewClientWizard() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [client, setClient] = useState<Client | null>(null);
  const [processor, setProcessor] = useState<ProcessorPlatform | "none">("none");

  // Step 1 fields — timezone isn't asked here, the API defaults to America/New_York
  // and can be changed later if it ever matters for a specific client.
  const [name, setName] = useState("");
  const [niche, setNiche] = useState<Niche>("ecommerce");

  // Step 2 fields, one set per processor
  const [shopDomain, setShopDomain] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [paypalClientId, setPaypalClientId] = useState("");
  const [paypalClientSecret, setPaypalClientSecret] = useState("");
  const [paypalWebhookId, setPaypalWebhookId] = useState("");
  const [squareSignatureKey, setSquareSignatureKey] = useState("");

  const createMutation = useMutation({
    mutationFn: () => createClient({ name: name.trim(), niche }),
    onSuccess: (created) => {
      setClient(created);
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      setStep(2);
    },
  });

  const webhookUrlFor = (platform: ProcessorPlatform) => `${apiUrl}/webhooks/${platform}/${client?.id}`;

  const integrationMutation = useMutation({
    mutationFn: async () => {
      if (!client) return;
      if (processor === "shopify") {
        await saveShopifyIntegration(client.id, { webhook_secret: webhookSecret, shop_domain: shopDomain });
      } else if (processor === "stripe") {
        await saveStripeIntegration(client.id, { webhook_secret: webhookSecret });
      } else if (processor === "paypal") {
        await savePaypalIntegration(client.id, {
          client_id: paypalClientId,
          client_secret: paypalClientSecret,
          webhook_id: paypalWebhookId,
        });
      } else if (processor === "square") {
        await saveSquareIntegration(client.id, {
          signature_key: squareSignatureKey,
          notification_url: webhookUrlFor("square"),
        });
      } else if (processor === "gohighlevel") {
        await saveGoHighLevelIntegration(client.id, { webhook_secret: webhookSecret });
      }
    },
    onSuccess: () => setStep(3),
  });

  const canCreateClient = name.trim().length > 0;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
      <div>
        <h1 className="text-lg font-semibold">Add Client</h1>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Same steps as the CLI setup scripts, in the dashboard: create the client, connect a payment
          processor, then install the pixel.
        </p>
      </div>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className={step === 1 ? "font-medium text-foreground" : ""}>1. Basics</span>
        <span>/</span>
        <span className={step === 2 ? "font-medium text-foreground" : ""}>2. Processor</span>
        <span>/</span>
        <span className={step === 3 ? "font-medium text-foreground" : ""}>3. Install</span>
      </div>

      {step === 1 && (
        <Card className="px-4">
          <CardHeader className="px-0">
            <CardTitle>Client basics</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 px-0">
            <div className="flex flex-col gap-1">
              <FieldLabel>Client name</FieldLabel>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Acme Apparel" />
            </div>
            <div className="flex flex-col gap-1">
              <FieldLabel>Niche</FieldLabel>
              <Select value={niche} onValueChange={(v) => setNiche(v as Niche)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {NICHES.map((n) => (
                    <SelectItem key={n} value={n}>
                      {NICHE_LABEL[n]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1 text-xs text-muted-foreground">
                Controls which report tabs and KPIs show up for this client (e.g. cost-per-lead vs.
                cost-per-purchase).
              </p>
            </div>
            {createMutation.isError && (
              <p className="text-xs text-status-critical">Failed to create client. Is the API running?</p>
            )}
            <div>
              <Button disabled={!canCreateClient || createMutation.isPending} onClick={() => createMutation.mutate()}>
                {createMutation.isPending ? "Creating…" : "Create client"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 2 && client && (
        <Card className="px-4">
          <CardHeader className="px-0">
            <CardTitle>Connect a payment processor</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 px-0">
            <div className="flex flex-col gap-1">
              <FieldLabel>Processor</FieldLabel>
              <Select value={processor} onValueChange={(v) => setProcessor(v as ProcessorPlatform | "none")}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROCESSORS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {processor === "shopify" && (
              <>
                <p className="text-xs text-muted-foreground">
                  Register these webhooks in Shopify Admin, Settings, Notifications, Webhooks (format: JSON):
                </p>
                <CodeBlock>{`orders/create   ->  ${webhookUrlFor("shopify")}/orders\nrefunds/create  ->  ${webhookUrlFor("shopify")}/refunds`}</CodeBlock>
                <div className="flex flex-col gap-1">
                  <FieldLabel>Shop domain</FieldLabel>
                  <Input value={shopDomain} onChange={(e) => setShopDomain(e.target.value)} placeholder="mystore.myshopify.com" />
                </div>
                <div className="flex flex-col gap-1">
                  <FieldLabel>Webhook signing secret</FieldLabel>
                  <Input value={webhookSecret} onChange={(e) => setWebhookSecret(e.target.value)} placeholder="Paste from Shopify" />
                </div>
              </>
            )}

            {processor === "stripe" && (
              <>
                <p className="text-xs text-muted-foreground">
                  Register this endpoint in Stripe, Developers, Webhooks, Add endpoint. Send: checkout.session.completed,
                  invoice.payment_succeeded, charge.refunded, customer.subscription.created/updated/deleted.
                </p>
                <CodeBlock>{webhookUrlFor("stripe")}</CodeBlock>
                <div className="flex flex-col gap-1">
                  <FieldLabel>Signing secret (whsec_...)</FieldLabel>
                  <Input value={webhookSecret} onChange={(e) => setWebhookSecret(e.target.value)} placeholder="whsec_..." />
                </div>
              </>
            )}

            {processor === "paypal" && (
              <>
                <p className="text-xs text-muted-foreground">
                  Register this endpoint in the PayPal Developer Dashboard, your app, Webhooks, Add Webhook.
                </p>
                <CodeBlock>{webhookUrlFor("paypal")}</CodeBlock>
                <div className="flex flex-col gap-1">
                  <FieldLabel>App Client ID</FieldLabel>
                  <Input value={paypalClientId} onChange={(e) => setPaypalClientId(e.target.value)} />
                </div>
                <div className="flex flex-col gap-1">
                  <FieldLabel>App Client Secret</FieldLabel>
                  <Input value={paypalClientSecret} onChange={(e) => setPaypalClientSecret(e.target.value)} />
                </div>
                <div className="flex flex-col gap-1">
                  <FieldLabel>Webhook ID</FieldLabel>
                  <Input value={paypalWebhookId} onChange={(e) => setPaypalWebhookId(e.target.value)} />
                </div>
              </>
            )}

            {processor === "square" && (
              <>
                <p className="text-xs text-muted-foreground">
                  Register this endpoint in the Square Developer Dashboard, your app, Webhooks, Add Endpoint.
                </p>
                <CodeBlock>{webhookUrlFor("square")}</CodeBlock>
                <div className="flex flex-col gap-1">
                  <FieldLabel>Signature key</FieldLabel>
                  <Input value={squareSignatureKey} onChange={(e) => setSquareSignatureKey(e.target.value)} />
                </div>
              </>
            )}

            {processor === "gohighlevel" && (
              <>
                <p className="text-xs text-muted-foreground">
                  Add a Custom Webhook action in your GHL workflow. No platform-level signing exists, so this uses a
                  shared secret instead.
                </p>
                <CodeBlock>{webhookUrlFor("gohighlevel")}</CodeBlock>
                <div className="flex flex-col gap-1">
                  <FieldLabel>Shared secret (choose one, paste it in both places)</FieldLabel>
                  <Input value={webhookSecret} onChange={(e) => setWebhookSecret(e.target.value)} />
                </div>
              </>
            )}

            {integrationMutation.isError && (
              <p className="text-xs text-status-critical">Failed to save integration.</p>
            )}

            <div className="flex gap-2">
              {processor === "none" ? (
                <Button onClick={() => setStep(3)}>Continue</Button>
              ) : (
                <Button disabled={integrationMutation.isPending} onClick={() => integrationMutation.mutate()}>
                  {integrationMutation.isPending ? "Saving…" : "Save and continue"}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {step === 3 && client && (
        <Card className="px-4">
          <CardHeader className="px-0">
            <CardTitle>Install the pixel</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 px-0">
            <p className="text-xs text-muted-foreground">
              Add pixel.js to every page on the client&apos;s site, with this pixel key baked in. Call
              ADT.identify(email) on the lead form or before checkout so purchases can attribute back to ad sessions.
            </p>
            <div className="flex flex-col gap-1">
              <FieldLabel>Pixel key</FieldLabel>
              <CodeBlock>{client.pixel_key}</CodeBlock>
            </div>
            <div className="flex flex-col gap-1">
              <FieldLabel>Client summary</FieldLabel>
              <CodeBlock>{`Name:      ${client.name}\nClient ID: ${client.id}\nNiche:     ${client.niche}\nAPI URL:   ${apiUrl}`}</CodeBlock>
            </div>
            <div className="flex gap-2">
              <Button onClick={() => router.push(`/clients/${client.id}/overview`)}>Go to client dashboard</Button>
              <Button variant="outline" onClick={() => router.push("/clients/new")}>
                Add another client
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
