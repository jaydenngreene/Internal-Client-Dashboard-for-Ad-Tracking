"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  SlidersHorizontal,
  Plug,
  Users2,
  Wrench,
  AlertTriangle,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getClient,
  updateClientName,
  updateClientNiche,
  updateAttributionModel,
  updateClientMargin,
  updateClientCurrency,
  updateReportSchedule,
  updateClientBranding,
  updateBudgetTarget,
  generateShareLink,
  revokeShareLink,
  getUtmMismatches,
  getClientAuditLog,
  getIntegrations,
  saveIntegration,
  deleteIntegration,
  importShopifyOrders,
  generateTagWebhookSecret,
  getWebhookSubscriptions,
  createWebhookSubscription,
  deleteWebhookSubscription,
  getTrackingNumbers,
  createTrackingNumber,
  getIdentityLinks,
  createIdentityLink,
  deleteClient,
  getCollaborators,
  addCollaborator,
  removeCollaborator,
  OUTBOUND_WEBHOOK_EVENT_TYPES,
  Client,
  Niche,
} from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { FieldLabel } from "@/components/ui/field-label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ClientKicker } from "@/components/client-kicker";
import { Skeleton } from "@/components/ui/skeleton";
import { AuditLogSection } from "@/components/audit-log-section";

const NICHE_LABEL: Record<Niche, string> = {
  ecommerce: "Ecommerce",
  call: "Call-based / local service",
  lead_gen: "Lead generation",
  saas: "SaaS",
  info_product: "Info product / education",
  other: "Other",
};

const REPORT_SCHEDULE_LABEL: Record<Client["report_schedule_frequency"], string> = {
  none: "Off",
  weekly: "Weekly",
  monthly: "Monthly",
};

const ATTRIBUTION_LABEL: Record<Client["attribution_model"], string> = {
  first_click: "First Click",
  last_click: "Last Click",
  linear: "Linear",
  time_decay: "Time Decay",
  u_shaped: "U-Shaped (Position-Based)",
};

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
      <code>{children}</code>
    </pre>
  );
}

// A CodeBlock plus a Copy button, tracking its own "Copied!" flash — three
// separate install snippets on this page each need this (generic website tag,
// Shopify theme snippet, Shopify checkout script), same pattern
// UtmToolsSection's single copy button already uses.
function CopyBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-wrap items-start gap-2">
      <CodeBlock>{code}</CodeBlock>
      <Button
        size="xs"
        variant="outline"
        onClick={() => {
          navigator.clipboard.writeText(code);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? "Copied!" : "Copy"}
      </Button>
    </div>
  );
}

// The two Shopify liquid snippets (theme + checkout) mirror
// pixel/src/shopify/theme-snippet.liquid and checkout-tracking.liquid verbatim,
// with YOUR_API_URL/YOUR_PIXEL_KEY substituted for this client's real values —
// the same substitution scripts/setup-shopify-client.ts performs from the CLI,
// done here instead so it doesn't require someone running that script by hand.
function shopifyThemeSnippet(apiUrl: string, pixelKey: string): string {
  return `{% comment %}
  Ad Tracking Pixel — add to theme.liquid just before </body>
{% endcomment %}

<script>
  window.ADT_CONFIG = {
    apiUrl: '${apiUrl}',
    pixelKey: '${pixelKey}'
  };
</script>
<script src="${apiUrl}/pixel.js" async></script>

{% comment %} Identify logged-in customers automatically {% endcomment %}
{% if customer %}
<script>
  document.addEventListener('DOMContentLoaded', function() {
    if (window.ADT) {
      ADT.identify('{{ customer.email | escape }}', { lead_type: 'logged_in' });
    }
  });
</script>
{% endif %}

{% comment %} Product page view {% endcomment %}
{% if template contains 'product' %}
<script>
  document.addEventListener('DOMContentLoaded', function() {
    if (window.ADT) {
      ADT.trackViewContent(
        { id: '{{ product.id }}', name: '{{ product.title | escape }}' },
        {{ product.price | money_without_currency | remove: ',' | default: 0 }}
      );
    }
  });
</script>
{% endif %}

{% comment %} Add to cart — listens for Shopify's standard cart form submit {% endcomment %}
<script>
  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (form && form.action && form.action.indexOf('/cart/add') !== -1 && window.ADT) {
      ADT.trackAddToCart(
        { id: form.querySelector('[name="id"]') ? form.querySelector('[name="id"]').value : null },
        null
      );
    }
  });
</script>

{% comment %} Checkout initiation — fired from the cart page's checkout click {% endcomment %}
<script>
  document.addEventListener('click', function (e) {
    var el = e.target.closest('a[href*="/checkout"], [name="checkout"], [href="/checkout"]');
    if (el && window.ADT) {
      ADT.trackInitiateCheckout(null);
    }
  });
</script>`;
}

// Settings → Customer events → Add custom pixel. This is the theme-independent
// path for add-to-cart/checkout-start: Shopify dispatches product_added_to_cart
// and checkout_started itself from its own cart/checkout logic, so it fires
// reliably even on themes whose "Add to cart" button calls Shopify's AJAX cart
// API directly (fetch/XHR to /cart/add) instead of a real <form> submission —
// confirmed live on a real client site where the theme snippet's submit-event
// listener above never fired at all, not even a capture-phase one, because no
// native submit event was ever dispatched in the first place. Runs in Shopify's
// sandboxed pixel context (no window.ADT_CONFIG, no document.cookie) - values
// are inlined directly, matching the same per-client substitution the other
// snippets already do.
function shopifyCustomPixelSnippet(apiUrl: string, pixelKey: string): string {
  return `const API_URL = '${apiUrl}';
const PIXEL_KEY = '${pixelKey}';

async function getVisitorId() {
  // Same cookie the main pixel (pixel.js) sets on the top-level page -
  // browser.cookie reads the real top-frame cookie jar, not a sandbox-local one.
  try {
    const existing = await browser.cookie.get('_adt_vid');
    if (existing) return existing;
  } catch (err) {
    console.error('[Ad Dashboard pixel] cookie read failed', err);
  }
  const id = crypto.randomUUID();
  try {
    await browser.cookie.set('_adt_vid', id);
  } catch (err) {
    console.error('[Ad Dashboard pixel] cookie write failed', err);
  }
  return id;
}

async function post(endpoint, body) {
  try {
    const anonymous_id = await getVisitorId();
    const res = await fetch(API_URL + endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ pixel_key: PIXEL_KEY, anonymous_id }, body)),
    });
    console.log('[Ad Dashboard pixel]', endpoint, 'sent, status', res.status);
  } catch (err) {
    console.error('[Ad Dashboard pixel]', endpoint, 'failed', err);
  }
}

function send(eventType, product, value) {
  post('/track/event', {
    event_type: eventType,
    url: window.location.href,
    product_id: product ? String(product.id) : null,
    product_name: product ? product.name : null,
    value: value != null ? value : null,
  });
}

analytics.subscribe('product_added_to_cart', (event) => {
  // Confirmed live: a bundle/upsell app's own separate /cart/add call fires this
  // same event with a thinner cartLine shape than the main "Add to cart" button -
  // product.title missing, merchandise.price missing - which read as bare nulls
  // before. cost.totalAmount is the line's already-computed total (standard on
  // every cartLine regardless of which UI triggered the add), so it's a more
  // reliable value source than merchandise.price * quantity when that's absent.
  const line = event.data.cartLine;
  if (!line || !line.merchandise) return;
  const product = line.merchandise.product || {};
  const productId = product.id || null;
  if (!productId) return;
  const productName = product.title || line.merchandise.title || null;
  let value = null;
  if (line.cost && line.cost.totalAmount) {
    value = line.cost.totalAmount.amount;
  } else if (line.merchandise.price) {
    value = line.merchandise.price.amount * (line.quantity || 1);
  }
  send('add_to_cart', { id: productId, name: productName }, value);
});

analytics.subscribe('checkout_started', (event) => {
  const checkout = event.data.checkout;
  send('begin_checkout', null, checkout ? checkout.totalPrice.amount : null);
});

// Identify-only, deliberately not a second /track/conversion call here - the
// orders/create webhook (registered separately) already reliably records the
// purchase itself, and this event's checkout.order.id is a different ID format
// (Web Pixels GID) than the webhook's numeric Shopify order id, so sending it
// through here too would create a second, un-deduplicated purchase row instead
// of matching the webhook's. This just writes the email -> visitor link so
// whichever purchase record lands (from the webhook) can find it.
analytics.subscribe('checkout_completed', (event) => {
  const checkout = event.data.checkout;
  if (!checkout || !checkout.email) return;
  post('/track/identify', {
    email: checkout.email,
    lead_type: 'checkout',
    page: window.location.href,
  });
});`;
}

function shopifyCheckoutSnippet(apiUrl: string, pixelKey: string): string {
  return `{% comment %}
  Add in: Settings → Checkout → Order status page → Additional scripts
{% endcomment %}

<script>
  (function() {
    var API_URL = '${apiUrl}';
    var PIXEL_KEY = '${pixelKey}';

    function getCookie(name) {
      return document.cookie.split('; ').reduce(function(acc, pair) {
        var parts = pair.split('=');
        return parts[0] === name ? parts[1] : acc;
      }, null);
    }

    function send(endpoint, data) {
      var payload = JSON.stringify(Object.assign({ pixel_key: PIXEL_KEY }, data));
      if (navigator.sendBeacon) {
        navigator.sendBeacon(API_URL + endpoint, new Blob([payload], { type: 'application/json' }));
      } else {
        var xhr = new XMLHttpRequest();
        xhr.open('POST', API_URL + endpoint, true);
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.send(payload);
      }
    }

    var visitorId = getCookie('_adt_vid');

    {% if checkout %}
      var email = '{{ checkout.email | escape }}';
      var orderId = '{{ checkout.order_id }}';
      var revenue = {{ checkout.total_price | money_without_currency | remove: ',' }};
      var productName = '{{ checkout.line_items.first.title | escape }}';

      if (email) {
        send('/track/identify', {
          anonymous_id: visitorId,
          email: email,
          lead_type: 'checkout',
          page: window.location.href
        });
      }

      {% if first_time_accessed %}
        if (email && revenue > 0) {
          send('/track/conversion', {
            anonymous_id: visitorId,
            email: email,
            revenue: revenue,
            product: productName,
            order_id: String(orderId),
            processor: 'shopify'
          });
        }
      {% endif %}
    {% endif %}
  })();
</script>`;
}

function GeneralSection({ clientId, client }: { clientId: string; client: Client }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(client.name);
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

  const invalidateClient = () => {
    queryClient.invalidateQueries({ queryKey: ["clients"] });
    queryClient.invalidateQueries({ queryKey: ["client", clientId] });
  };
  const nameMutation = useMutation({
    mutationFn: () => updateClientName(clientId, name.trim()),
    onSuccess: invalidateClient,
  });
  const nicheMutation = useMutation({
    mutationFn: (niche: Niche) => updateClientNiche(clientId, niche),
    onSuccess: invalidateClient,
  });
  const attributionMutation = useMutation({
    mutationFn: (model: Client["attribution_model"]) => updateAttributionModel(clientId, model),
    onSuccess: invalidateClient,
  });

  const [cogsPercent, setCogsPercent] = useState(client.cogs_percent?.toString() ?? "");
  const [paymentFeePercent, setPaymentFeePercent] = useState(client.payment_fee_percent?.toString() ?? "");
  const [fulfillmentCostFlat, setFulfillmentCostFlat] = useState(client.fulfillment_cost_flat?.toString() ?? "");
  const marginMutation = useMutation({
    mutationFn: () =>
      updateClientMargin(clientId, {
        cogs_percent: cogsPercent.trim() === "" ? null : parseFloat(cogsPercent),
        payment_fee_percent: paymentFeePercent.trim() === "" ? null : parseFloat(paymentFeePercent),
        fulfillment_cost_flat: fulfillmentCostFlat.trim() === "" ? null : parseFloat(fulfillmentCostFlat),
      }),
    onSuccess: invalidateClient,
  });

  const [budgetTarget, setBudgetTarget] = useState(client.monthly_budget_target?.toString() ?? "");
  const budgetMutation = useMutation({
    mutationFn: () => updateBudgetTarget(clientId, budgetTarget.trim() === "" ? null : parseFloat(budgetTarget)),
    onSuccess: invalidateClient,
  });

  const [currency, setCurrency] = useState(client.currency);
  const currencyMutation = useMutation({
    mutationFn: () => updateClientCurrency(clientId, currency),
    onSuccess: invalidateClient,
  });

  const reportScheduleMutation = useMutation({
    mutationFn: (frequency: Client["report_schedule_frequency"]) => updateReportSchedule(clientId, frequency),
    onSuccess: invalidateClient,
  });

  // One-time historical backfill — separate from the live webhook above, which
  // only ever sees orders placed after it was registered. Reuses the exact same
  // recordPurchase/recordRefund path as that webhook, so a CSV that overlaps with
  // when the webhook went live just gets silently skipped as a duplicate rather
  // than double-counted.
  const shopifyImportMutation = useMutation({
    mutationFn: (file: File) => importShopifyOrders(clientId, file),
  });

  return (
    <Card className="px-4">
      <CardHeader className="px-0">
        <CardTitle>General</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 px-0">
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <FieldLabel>Client name</FieldLabel>
            <Input className="w-64" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <Button
            size="sm"
            disabled={!name.trim() || name.trim() === client.name || nameMutation.isPending}
            onClick={() => nameMutation.mutate()}
          >
            Save
          </Button>
        </div>

        <div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1">
            <FieldLabel>Niche</FieldLabel>
            <Select value={client.niche} onValueChange={(v) => nicheMutation.mutate(v as Niche)}>
              <SelectTrigger className="w-56">
                <SelectValue>{(v: Niche) => NICHE_LABEL[v]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(NICHE_LABEL) as Niche[]).map((n) => (
                  <SelectItem key={n} value={n}>
                    {NICHE_LABEL[n]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Controls which report tabs and KPIs apply.</p>
          </div>

          <div className="flex flex-col gap-1">
            <FieldLabel>Attribution model</FieldLabel>
            <Select
              value={client.attribution_model}
              onValueChange={(v) => attributionMutation.mutate(v as Client["attribution_model"])}
            >
              <SelectTrigger className="w-44">
                <SelectValue>{(v: Client["attribution_model"]) => ATTRIBUTION_LABEL[v]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(ATTRIBUTION_LABEL) as Client["attribution_model"][]).map((m) => (
                  <SelectItem key={m} value={m}>
                    {ATTRIBUTION_LABEL[m]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Which touchpoint gets credit for a sale.</p>
          </div>

          <div className="flex flex-col gap-1">
            <FieldLabel>Reporting currency</FieldLabel>
            <div className="flex items-center gap-2">
              <Input
                className="w-20 uppercase"
                maxLength={3}
                value={currency}
                onChange={(e) => setCurrency(e.target.value.toUpperCase())}
              />
              <Button
                size="sm"
                disabled={currency === client.currency || currencyMutation.isPending}
                onClick={() => currencyMutation.mutate()}
              >
                Save
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Ad spend/revenue in a different currency is converted to this automatically.
            </p>
            {currencyMutation.isError && (
              <p className="text-xs text-status-critical">{(currencyMutation.error as Error).message}</p>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <FieldLabel>Scheduled report email</FieldLabel>
            <Select
              value={client.report_schedule_frequency}
              onValueChange={(v) => reportScheduleMutation.mutate(v as Client["report_schedule_frequency"])}
            >
              <SelectTrigger className="w-44">
                <SelectValue>
                  {(v: Client["report_schedule_frequency"]) => REPORT_SCHEDULE_LABEL[v]}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(REPORT_SCHEDULE_LABEL) as Client["report_schedule_frequency"][]).map((f) => (
                  <SelectItem key={f} value={f}>
                    {REPORT_SCHEDULE_LABEL[f]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Sends a performance summary to your login email.</p>
          </div>
        </div>

        <div className="flex flex-col gap-3 border-t border-border pt-4">
          <div className="flex flex-col gap-1">
            <FieldLabel>Website install</FieldLabel>
            <p className="text-xs text-muted-foreground">
              Paste on every page (shared header/footer template, or a Google Tag Manager custom HTML tag),
              ideally right before <code>&lt;/body&gt;</code>. Then call{" "}
              <code>ADT.identify(email)</code> right before checkout completes so purchases attribute back
              to the right session. This runs independently of any native Meta/Facebook pixel already on
              the site, different cookies, different endpoints, safe to run both at once.
            </p>
            <CopyBlock
              code={`<script>\n  window.ADT_CONFIG = { apiUrl: '${apiUrl}', pixelKey: '${client.pixel_key}' };\n</script>\n<script src="${apiUrl}/pixel.js" async></script>`}
            />
          </div>

          <div className="flex flex-col gap-3 border-t border-border pt-3">
            <p className="text-sm font-medium">Shopify</p>
            <p className="text-xs text-muted-foreground">
              Shopify&apos;s checkout is a separate, script-restricted flow from the rest of the theme, so it
              needs its own snippet plus a webhook, in this order:
            </p>
            <ol className="flex list-decimal flex-col gap-3 pl-4 text-xs text-muted-foreground">
              <li>
                Register a webhook: Shopify Admin → Settings → Notifications → Webhooks. Create two: event{" "}
                <code>Order creation</code> → URL <code>{`${apiUrl}/webhooks/shopify/${clientId}/orders`}</code>,
                and event <code>Order refund</code> → URL{" "}
                <code>{`${apiUrl}/webhooks/shopify/${clientId}/refunds`}</code>, both format JSON. Paste
                the signing secret Shopify shows you into the Shopify row under Integrations below.
              </li>
              <li>
                <p>
                  Theme snippet: Online Store → Themes → Edit code → <code>layout/theme.liquid</code>,
                  paste just before <code>&lt;/body&gt;</code>:
                </p>
                <div className="mt-1">
                  <CopyBlock code={shopifyThemeSnippet(apiUrl, client.pixel_key)} />
                </div>
              </li>
              <li>
                <p>Checkout script: Settings → Checkout → Order status page → Additional scripts:</p>
                <div className="mt-1">
                  <CopyBlock code={shopifyCheckoutSnippet(apiUrl, client.pixel_key)} />
                </div>
              </li>
              <li>
                <p>
                  Add to cart / checkout tracking: <strong>Settings → Customer events → Add custom pixel</strong>.
                  Themes vary in how &quot;Add to cart&quot; actually works under the hood (some submit a real
                  form, many modern ones call Shopify&apos;s cart API directly via JavaScript instead), so this
                  step catches it reliably either way, straight from Shopify&apos;s own event system rather
                  than guessing at the page&apos;s markup. Paste into the pixel&apos;s Code box, Save, then
                  Connect. Runs independently in its own sandbox, doesn&apos;t conflict with Meta&apos;s pixel
                  or any other pixel already connected here.
                </p>
                <div className="mt-1">
                  <CopyBlock code={shopifyCustomPixelSnippet(apiUrl, client.pixel_key)} />
                </div>
              </li>
            </ol>

            <div className="flex flex-col gap-2 border-t border-border pt-3">
              <p className="text-sm font-medium">Import past orders</p>
              <p className="text-xs text-muted-foreground">
                The webhook above only ever sees orders placed after it&apos;s registered, it can&apos;t see
                anything from before today. To backfill history, export orders from Shopify Admin →{" "}
                <strong>Orders → Export</strong> (pick a date range, format &quot;CSV for Excel, Numbers, or other
                spreadsheet programs&quot;) and upload the file here. Safe to run more than once: orders already
                recorded are skipped, never duplicated.
              </p>
              <div className="flex items-center gap-2">
                <input
                  type="file"
                  accept=".csv"
                  id={`shopify-import-${clientId}`}
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) shopifyImportMutation.mutate(file);
                    e.target.value = "";
                  }}
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={shopifyImportMutation.isPending}
                  onClick={() => document.getElementById(`shopify-import-${clientId}`)?.click()}
                >
                  {shopifyImportMutation.isPending ? "Importing…" : "Upload order export CSV"}
                </Button>
              </div>
              {shopifyImportMutation.isError && (
                <p className="text-xs text-status-critical">{(shopifyImportMutation.error as Error).message}</p>
              )}
              {shopifyImportMutation.isSuccess && (
                <div className="rounded-md border border-border bg-muted/40 p-3 text-xs">
                  <p className="font-medium text-foreground">
                    {shopifyImportMutation.data.imported} order{shopifyImportMutation.data.imported === 1 ? "" : "s"}{" "}
                    imported, {shopifyImportMutation.data.skipped} skipped (already recorded, cancelled, or no
                    email), out of {shopifyImportMutation.data.ordersInFile} in the file.
                  </p>
                  {shopifyImportMutation.data.refundsApplied > 0 && (
                    <p className="mt-1 text-muted-foreground">
                      {shopifyImportMutation.data.refundsApplied} partial refund
                      {shopifyImportMutation.data.refundsApplied === 1 ? "" : "s"} applied.
                    </p>
                  )}
                  {shopifyImportMutation.data.errors.length > 0 && (
                    <div className="mt-2 flex flex-col gap-0.5 text-status-critical">
                      {shopifyImportMutation.data.errors.map((err, i) => (
                        <p key={i}>{err}</p>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2 border-t border-border pt-4">
          <p className="text-sm font-medium">True profit margin</p>
          <p className="text-xs text-muted-foreground">
            Every report's "Profit" figure is revenue minus ad spend only unless these are set. Fill in what applies,
            leave blank to skip.
          </p>
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex flex-col gap-1">
              <FieldLabel>Cost of goods (% of revenue)</FieldLabel>
              <Input
                className="w-40"
                type="number"
                min={0}
                step="0.1"
                placeholder="e.g. 30"
                value={cogsPercent}
                onChange={(e) => setCogsPercent(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <FieldLabel>Payment processing fee (%)</FieldLabel>
              <Input
                className="w-40"
                type="number"
                min={0}
                step="0.1"
                placeholder="e.g. 2.9"
                value={paymentFeePercent}
                onChange={(e) => setPaymentFeePercent(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <FieldLabel>Fulfillment cost ($ per order)</FieldLabel>
              <Input
                className="w-40"
                type="number"
                min={0}
                step="0.01"
                placeholder="e.g. 4.50"
                value={fulfillmentCostFlat}
                onChange={(e) => setFulfillmentCostFlat(e.target.value)}
              />
            </div>
            <Button size="sm" disabled={marginMutation.isPending} onClick={() => marginMutation.mutate()}>
              Save margin
            </Button>
          </div>
          {marginMutation.isError && (
            <p className="text-xs text-status-critical">{(marginMutation.error as Error).message}</p>
          )}
        </div>

        <div className="flex flex-col gap-2 border-t border-border pt-4">
          <p className="text-sm font-medium">Monthly ad-spend budget</p>
          <p className="text-xs text-muted-foreground">
            Account-wide, not per campaign. Powers the Budget Pacing card on Overview.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1">
              <FieldLabel>Target ($ / month)</FieldLabel>
              <Input
                className="w-40"
                type="number"
                min={0}
                step="1"
                placeholder="e.g. 10000"
                value={budgetTarget}
                onChange={(e) => setBudgetTarget(e.target.value)}
              />
            </div>
            <Button size="sm" disabled={budgetMutation.isPending} onClick={() => budgetMutation.mutate()}>
              Save target
            </Button>
          </div>
          {budgetMutation.isError && (
            <p className="text-xs text-status-critical">{(budgetMutation.error as Error).message}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

interface IntegrationFieldDef {
  key: string;
  label: string;
  type?: "text" | "password" | "checkbox";
  optional?: boolean;
}
interface IntegrationDef {
  platform: string;
  label: string;
  category: string;
  fields: IntegrationFieldDef[];
  helpText?: string;
}

const INTEGRATIONS: IntegrationDef[] = [
  { platform: "shopify", label: "Shopify", category: "Payment Processors", fields: [
    { key: "shop_domain", label: "Shop domain" },
    { key: "webhook_secret", label: "Webhook signing secret", type: "password" },
  ] },
  { platform: "stripe", label: "Stripe", category: "Payment Processors", fields: [
    { key: "webhook_secret", label: "Signing secret (whsec_...)", type: "password" },
  ] },
  { platform: "paypal", label: "PayPal", category: "Payment Processors", fields: [
    { key: "client_id", label: "App Client ID" },
    { key: "client_secret", label: "App Client Secret", type: "password" },
    { key: "webhook_id", label: "Webhook ID" },
  ] },
  { platform: "square", label: "Square", category: "Payment Processors", fields: [
    { key: "signature_key", label: "Signature key", type: "password" },
    { key: "notification_url", label: "Notification URL" },
  ] },
  { platform: "gohighlevel", label: "GoHighLevel", category: "Payment Processors", fields: [
    { key: "webhook_secret", label: "Shared secret", type: "password" },
  ] },
  { platform: "facebook-ads", label: "Facebook Ads", category: "Ad Platforms", fields: [
    { key: "access_token", label: "Access token", type: "password" },
    { key: "ad_account_id", label: "Ad account ID" },
    { key: "currency", label: "Ad account currency (e.g. USD, if different from reporting currency)", optional: true },
  ] },
  {
    platform: "facebook-capi",
    label: "Facebook Conversions API",
    category: "Ad Platforms",
    fields: [
      { key: "pixel_id", label: "Pixel ID" },
      { key: "access_token", label: "Access token", type: "password" },
    ],
    helpText:
      "Meta Events Manager → Data Sources → your pixel → Settings gives you the Pixel ID. On that same screen, under Conversions API, click \"Generate access token\" for the token. This sends server-side conversion signals to Meta for ad optimization, separate from (and doesn't require) the website pixel above.",
  },
  { platform: "google-ads", label: "Google Ads", category: "Ad Platforms", fields: [
    { key: "customer_id", label: "Customer ID" },
    { key: "login_customer_id", label: "Login customer ID (MCC)", optional: true },
    { key: "refresh_token", label: "Refresh token", type: "password", optional: true },
    { key: "conversion_action_purchase", label: "Purchase conversion action", optional: true },
    { key: "conversion_action_lead", label: "Lead conversion action", optional: true },
    { key: "currency", label: "Ad account currency (e.g. USD, if different from reporting currency)", optional: true },
  ] },
  { platform: "bing-ads", label: "Bing / Microsoft Ads", category: "Ad Platforms", fields: [
    { key: "customer_id", label: "Customer ID" },
    { key: "account_id", label: "Account ID" },
    { key: "refresh_token", label: "Refresh token", type: "password" },
    { key: "currency", label: "Ad account currency (e.g. USD, if different from reporting currency)", optional: true },
  ] },
  { platform: "tiktok-ads", label: "TikTok Ads", category: "Ad Platforms", fields: [
    { key: "access_token", label: "Access token", type: "password" },
    { key: "advertiser_id", label: "Advertiser ID" },
    { key: "pixel_code", label: "Pixel code" },
    { key: "currency", label: "Ad account currency (e.g. USD, if different from reporting currency)", optional: true },
  ] },
  { platform: "snapchat-ads", label: "Snapchat Ads", category: "Ad Platforms", fields: [
    { key: "access_token", label: "Access token", type: "password" },
    { key: "pixel_id", label: "Pixel ID" },
    { key: "ad_account_id", label: "Ad account ID" },
    { key: "currency", label: "Ad account currency (e.g. USD, if different from reporting currency)", optional: true },
  ] },
  { platform: "pinterest-ads", label: "Pinterest Ads", category: "Ad Platforms", fields: [
    { key: "access_token", label: "Access token", type: "password" },
    { key: "ad_account_id", label: "Ad account ID" },
    { key: "currency", label: "Ad account currency (e.g. USD, if different from reporting currency)", optional: true },
  ] },
  { platform: "linkedin-ads", label: "LinkedIn Ads", category: "Ad Platforms", fields: [
    { key: "access_token", label: "Access token", type: "password" },
    { key: "account_id", label: "Sponsored account ID", optional: true },
    { key: "conversion_id_purchase", label: "Purchase conversion ID", optional: true },
    { key: "conversion_id_lead", label: "Lead conversion ID", optional: true },
    { key: "currency", label: "Ad account currency (e.g. USD, if different from reporting currency)", optional: true },
  ] },
  { platform: "reddit-ads", label: "Reddit Ads", category: "Ad Platforms", fields: [
    { key: "access_token", label: "Access token", type: "password" },
    { key: "account_id", label: "Account ID" },
    { key: "currency", label: "Ad account currency (e.g. USD, if different from reporting currency)", optional: true },
  ] },
  { platform: "twilio", label: "Twilio", category: "Call Tracking", fields: [
    { key: "account_sid", label: "Account SID" },
    { key: "auth_token", label: "Auth token", type: "password" },
    { key: "voice_intelligence_service_sid", label: "Voice Intelligence Service SID (for call transcription)", optional: true },
  ] },
  { platform: "customers-ai", label: "Customers.ai", category: "CRM & Remarketing", fields: [
    { key: "webhook_secret", label: "Shared secret", type: "password" },
  ] },
  { platform: "klaviyo", label: "Klaviyo", category: "CRM & Remarketing", fields: [
    { key: "api_key", label: "API key", type: "password" },
    { key: "list_id", label: "List ID" },
  ] },
  { platform: "alerts", label: "Alerts (Slack / Email / SMS)", category: "Alerts", fields: [
    { key: "slack_webhook_url", label: "Slack incoming webhook URL", optional: true },
    { key: "alert_email", label: "Alert email", optional: true },
    { key: "alert_phone", label: "Alert phone (SMS, needs Twilio + a tracking number above)", optional: true },
  ] },
  { platform: "bigquery", label: "BigQuery Export", category: "Data Warehouse", fields: [
    { key: "project_id", label: "GCP project ID" },
    { key: "dataset_id", label: "Dataset ID (must already exist)" },
    { key: "service_account_key", label: "Service account key (paste the full JSON key file)", type: "password" },
  ] },
];

function IntegrationRow({
  clientId,
  def,
  connected,
  savedConfig,
}: {
  clientId: string;
  def: IntegrationDef;
  connected: boolean;
  savedConfig: Record<string, unknown> | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  // Seeded once from whatever the API already returned for this integration — not
  // secret fields (the API never sends those back, see clients.ts's redaction on
  // GET /integrations), just everything else: shop domain, ad account id, currency,
  // etc. Re-seeded whenever the row is opened, so it always reflects the latest
  // save rather than whatever was open the very first time this component mounted.
  const [values, setValues] = useState<Record<string, string>>({});
  const queryClient = useQueryClient();

  const openRow = () => {
    if (!open) {
      const seeded: Record<string, string> = {};
      for (const f of def.fields) {
        const saved = savedConfig?.[f.key];
        if (f.type !== "password" && typeof saved === "string") seeded[f.key] = saved;
      }
      setValues(seeded);
    }
    setOpen((o) => !o);
  };

  const mutation = useMutation({
    mutationFn: () => saveIntegration(clientId, def.platform, values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["integrations", clientId] });
      setOpen(false);
      setValues({});
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: () => deleteIntegration(clientId, def.platform),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["integrations", clientId] });
      setOpen(false);
      setValues({});
    },
  });

  // A password field left blank is fine once already connected — the backend falls
  // back to whatever secret is already stored (see resolveIntegrationFields in
  // clients.ts) rather than requiring it to be re-pasted just to change some other
  // field. Only a first-time connection actually needs it typed in.
  const requiredFilled = def.fields.every(
    (f) => f.optional || values[f.key]?.trim() || (f.type === "password" && connected)
  );

  return (
    <div className="rounded-lg border border-border">
      <button
        type="button"
        onClick={openRow}
        className="flex w-full items-center justify-between px-3 py-2 text-left text-sm"
      >
        <span className="font-medium">{def.label}</span>
        <span className="flex items-center gap-2">
          <Badge variant={connected ? "secondary" : "outline"}>{connected ? "Connected" : "Not connected"}</Badge>
          <span className="text-xs text-muted-foreground">{open ? "Hide" : connected ? "Edit" : "Connect"}</span>
        </span>
      </button>
      {open && (
        <div className="flex flex-col gap-3 border-t border-border p-3">
          {def.helpText && <p className="text-xs text-muted-foreground">{def.helpText}</p>}
          <div className="flex flex-wrap gap-2">
            {def.fields.map((f) => {
              // Password fields are always stripped from what the API sends back
              // (see the GET /integrations redaction), so "connected" is the only
              // signal available that one is already saved — the value itself
              // never round-trips here, by design.
              const isSavedSecret = f.type === "password" && connected;
              return (
                <div key={f.key} className="flex flex-col gap-1">
                  <FieldLabel>
                    {f.label}
                    {f.optional && <span className="normal-case"> (optional)</span>}
                  </FieldLabel>
                  <Input
                    className="w-56"
                    type={f.type === "password" ? "password" : "text"}
                    placeholder={f.type === "password" && connected ? "Saved, leave blank to keep" : undefined}
                    value={values[f.key] ?? ""}
                    onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  />
                  {isSavedSecret && <p className="text-[11px] text-muted-foreground">Currently saved</p>}
                </div>
              );
            })}
          </div>
          {mutation.isError && <p className="text-xs text-status-critical">Failed to save. Check the values and try again.</p>}
          {disconnectMutation.isError && (
            <p className="text-xs text-status-critical">Failed to disconnect. Try again.</p>
          )}
          <div className="flex items-center gap-2">
            <Button size="sm" disabled={!requiredFilled || mutation.isPending} onClick={() => mutation.mutate()}>
              {mutation.isPending ? "Saving…" : "Save"}
            </Button>
            {connected && !confirmingDisconnect && (
              <Button size="sm" variant="outline" onClick={() => setConfirmingDisconnect(true)}>
                Disconnect
              </Button>
            )}
            {connected && confirmingDisconnect && (
              <>
                <span className="text-xs text-muted-foreground">Stop sending data to this integration?</span>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={disconnectMutation.isPending}
                  onClick={() => disconnectMutation.mutate()}
                >
                  {disconnectMutation.isPending ? "Disconnecting…" : "Confirm disconnect"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmingDisconnect(false)}>
                  Cancel
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function IntegrationsSection({ clientId }: { clientId: string }) {
  const { data: integrations, isLoading } = useQuery({
    queryKey: ["integrations", clientId],
    queryFn: () => getIntegrations(clientId),
  });
  const connectedPlatforms = new Set((integrations ?? []).map((i) => i.platform.replace(/_/g, "-")));
  const configByPlatform = new Map((integrations ?? []).map((i) => [i.platform.replace(/_/g, "-"), i.config]));

  const categories = Array.from(new Set(INTEGRATIONS.map((i) => i.category)));

  return (
    <Card className="px-4">
      <CardHeader className="px-0">
        <CardTitle>Integrations</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5 px-0">
        {isLoading && <Skeleton className="h-32 w-full" />}
        {!isLoading &&
          categories.map((category) => (
            <div key={category} className="flex flex-col gap-2">
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{category}</p>
              <div className="flex flex-col gap-2">
                {INTEGRATIONS.filter((i) => i.category === category).map((def) => (
                  <IntegrationRow
                    key={def.platform}
                    clientId={clientId}
                    def={def}
                    connected={connectedPlatforms.has(def.platform)}
                    savedConfig={configByPlatform.get(def.platform)}
                  />
                ))}
              </div>
            </div>
          ))}
      </CardContent>
    </Card>
  );
}

function TrackingNumbersSection({ clientId }: { clientId: string }) {
  const [phoneNumber, setPhoneNumber] = useState("");
  const [forwardTo, setForwardTo] = useState("");
  const queryClient = useQueryClient();

  const { data: numbers, isLoading } = useQuery({
    queryKey: ["tracking-numbers", clientId],
    queryFn: () => getTrackingNumbers(clientId),
  });

  const mutation = useMutation({
    mutationFn: () => createTrackingNumber(clientId, { phone_number: phoneNumber.trim(), forward_to: forwardTo.trim() }),
    onSuccess: () => {
      setPhoneNumber("");
      setForwardTo("");
      queryClient.invalidateQueries({ queryKey: ["tracking-numbers", clientId] });
    },
  });

  return (
    <Card className="px-4">
      <CardHeader className="px-0">
        <CardTitle>Call Tracking Numbers</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-0">
        <p className="text-xs text-muted-foreground">
          Numbers purchased in the client&apos;s own Twilio account (this app never buys numbers or touches billing).
          Register them here so dynamic number insertion can assign one per visitor.
        </p>

        {isLoading && <Skeleton className="h-16 w-full" />}
        {!isLoading && numbers?.length === 0 && (
          <p className="text-xs text-muted-foreground">No tracking numbers registered yet.</p>
        )}
        {numbers && numbers.length > 0 && (
          <div className="flex flex-col gap-2">
            {numbers.map((n) => (
              <div key={n.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">
                <span className="font-medium">{n.phone_number}</span>
                <span className="text-xs text-muted-foreground">forwards to {n.forward_to}</span>
                <Badge variant={n.status === "assigned" ? "secondary" : "outline"} className="text-[10px]">
                  {n.status}
                </Badge>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-muted/30 p-3">
          <div className="flex flex-col gap-1">
            <FieldLabel>Tracking number</FieldLabel>
            <Input className="w-40" value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} placeholder="+15551234567" />
          </div>
          <div className="flex flex-col gap-1">
            <FieldLabel>Forwards to</FieldLabel>
            <Input className="w-40" value={forwardTo} onChange={(e) => setForwardTo(e.target.value)} placeholder="+15557654321" />
          </div>
          {mutation.isError && <p className="text-xs text-status-critical">Failed to register number.</p>}
          <Button size="sm" disabled={!phoneNumber.trim() || !forwardTo.trim() || mutation.isPending} onClick={() => mutation.mutate()}>
            Add number
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function TagWebhookSection({ clientId }: { clientId: string }) {
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

  const { data: integrations } = useQuery({
    queryKey: ["integrations", clientId],
    queryFn: () => getIntegrations(clientId),
  });
  const hasSecret = integrations?.some((i) => i.platform === "tag_webhook");

  const mutation = useMutation({
    mutationFn: () => generateTagWebhookSecret(clientId),
    onSuccess: (integration) => setRevealedSecret(integration.config.webhook_secret),
  });

  return (
    <Card className="px-4">
      <CardHeader className="px-0">
        <CardTitle>CRM / Zapier Tag Webhook</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-0">
        <p className="text-xs text-muted-foreground">
          Lets an external CRM or a Zapier &quot;Webhooks&quot; action apply a tag to a lead by email, used for
          revenue that closes outside this software (see Tags & Stages). Requires a secret so only calls that know
          it can apply tags.
        </p>
        <CodeBlock>{`POST ${apiUrl}/webhooks/tags/${clientId}\n{ "secret": "...", "email": "...", "tag_name": "..." }`}</CodeBlock>
        {revealedSecret ? (
          <div className="flex flex-col gap-1">
            <FieldLabel>Secret (copy it now, it won&apos;t be shown again)</FieldLabel>
            <CodeBlock>{revealedSecret}</CodeBlock>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            {hasSecret ? "A secret is already configured for this client." : "No secret configured yet."}
          </p>
        )}
        <div>
          <Button size="sm" disabled={mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending ? "Generating…" : hasSecret ? "Regenerate secret" : "Generate secret"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function OutboundWebhooksSection({ clientId }: { clientId: string }) {
  const [targetUrl, setTargetUrl] = useState("");
  const [eventTypes, setEventTypes] = useState<string[]>([]);
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: subscriptions, isLoading } = useQuery({
    queryKey: ["webhook-subscriptions", clientId],
    queryFn: () => getWebhookSubscriptions(clientId),
  });

  const createMutation = useMutation({
    mutationFn: () => createWebhookSubscription(clientId, { target_url: targetUrl.trim(), event_types: eventTypes }),
    onSuccess: (sub) => {
      setRevealedSecret(sub.signing_secret);
      setTargetUrl("");
      setEventTypes([]);
      queryClient.invalidateQueries({ queryKey: ["webhook-subscriptions", clientId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteWebhookSubscription(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["webhook-subscriptions", clientId] }),
  });

  function toggleEvent(value: string) {
    setEventTypes((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));
  }

  return (
    <Card className="px-4">
      <CardHeader className="px-0">
        <CardTitle>Outbound Webhooks</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-0">
        <p className="text-xs text-muted-foreground">
          Push events (a sale, an opted-in lead, a qualified call) to your own endpoint as they happen, HMAC-signed.
          Deliveries aren&apos;t retried. A failed delivery is logged and dropped.
        </p>

        {isLoading && <Skeleton className="h-16 w-full" />}
        {!isLoading && subscriptions?.length === 0 && (
          <p className="text-xs text-muted-foreground">No webhook subscriptions yet.</p>
        )}
        {subscriptions && subscriptions.length > 0 && (
          <div className="flex flex-col gap-2">
            {subscriptions.map((sub) => (
              <div key={sub.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                <div className="flex flex-col gap-1">
                  <span className="truncate text-sm font-medium">{sub.target_url}</span>
                  <div className="flex flex-wrap gap-1">
                    {sub.event_types.map((et) => (
                      <Badge key={et} variant="outline" className="text-[10px]">
                        {et}
                      </Badge>
                    ))}
                  </div>
                </div>
                <Button size="xs" variant="ghost" onClick={() => deleteMutation.mutate(sub.id)}>
                  ×
                </Button>
              </div>
            ))}
          </div>
        )}

        {revealedSecret && (
          <div className="flex flex-col gap-1">
            <FieldLabel>Signing secret for the subscription just created (copy it now)</FieldLabel>
            <CodeBlock>{revealedSecret}</CodeBlock>
          </div>
        )}

        <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/30 p-3">
          <div className="flex flex-col gap-1">
            <FieldLabel>Target URL</FieldLabel>
            <Input
              className="w-full"
              value={targetUrl}
              onChange={(e) => setTargetUrl(e.target.value)}
              placeholder="https://yourapp.com/webhooks/ad-tracking"
            />
          </div>
          <div className="flex flex-col gap-1">
            <FieldLabel>Events</FieldLabel>
            <div className="flex flex-wrap gap-3">
              {OUTBOUND_WEBHOOK_EVENT_TYPES.map((et) => (
                <label key={et.value} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={eventTypes.includes(et.value)}
                    onChange={() => toggleEvent(et.value)}
                  />
                  {et.label}
                </label>
              ))}
            </div>
          </div>
          {createMutation.isError && <p className="text-xs text-status-critical">Failed to create subscription.</p>}
          <div>
            <Button
              size="sm"
              disabled={!targetUrl.trim() || eventTypes.length === 0 || createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              Add subscription
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

const MECHANISM_LABEL: Record<string, string> = {
  session_id: "Same session",
  phone_number: "Matched phone",
  ip: "Matched IP",
  manual: "Manually linked",
};

function IdentityLinksSection({ clientId }: { clientId: string }) {
  const [primaryEmail, setPrimaryEmail] = useState("");
  const [linkedEmail, setLinkedEmail] = useState("");
  const queryClient = useQueryClient();

  const { data: links, isLoading } = useQuery({
    queryKey: ["identity-links", clientId],
    queryFn: () => getIdentityLinks(clientId),
  });

  const mutation = useMutation({
    mutationFn: () =>
      createIdentityLink(clientId, { primary_email: primaryEmail.trim(), linked_email: linkedEmail.trim() }),
    onSuccess: () => {
      setPrimaryEmail("");
      setLinkedEmail("");
      queryClient.invalidateQueries({ queryKey: ["identity-links", clientId] });
    },
  });

  return (
    <Card className="px-4">
      <CardHeader className="px-0">
        <CardTitle>Identity Links</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-0">
        <p className="text-xs text-muted-foreground">
          Cross-device matching links a returning visitor automatically when it can (same session, a matched phone
          number or IP), but an exact-match-only system will sometimes miss a real person across two devices. Use
          this to manually tell it two leads are the same person; their sessions and purchases stay separate rows,
          this just records that they belong together.
        </p>

        {isLoading && <Skeleton className="h-16 w-full" />}
        {!isLoading && links?.length === 0 && <p className="text-xs text-muted-foreground">No links yet.</p>}
        {links && links.length > 0 && (
          <div className="flex flex-col gap-2">
            {links.map((l) => (
              <div key={l.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">
                <span className="truncate">
                  {l.primary_email} <span className="text-muted-foreground">&harr;</span> {l.linked_email}
                </span>
                <Badge variant="outline" className="shrink-0 text-[10px]">
                  {MECHANISM_LABEL[l.mechanism] ?? l.mechanism}
                </Badge>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-muted/30 p-3">
          <div className="flex flex-col gap-1">
            <FieldLabel>First lead&apos;s email</FieldLabel>
            <Input className="w-56" value={primaryEmail} onChange={(e) => setPrimaryEmail(e.target.value)} placeholder="lead@example.com" />
          </div>
          <div className="flex flex-col gap-1">
            <FieldLabel>Second lead&apos;s email</FieldLabel>
            <Input className="w-56" value={linkedEmail} onChange={(e) => setLinkedEmail(e.target.value)} placeholder="same-person@example.com" />
          </div>
          {mutation.isError && <p className="text-xs text-status-critical">{(mutation.error as Error).message}</p>}
          <Button
            size="sm"
            disabled={!primaryEmail.trim() || !linkedEmail.trim() || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            Link
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// Sharing (migration 028) — a collaborator gets the exact same data access as the
// owner everywhere else in the dashboard; this section is the one place that
// distinction actually shows up. Anyone with access can see who else has it
// (transparency about who can see this client's data); only the owner sees the add/
// remove controls, matching the backend's own owner-only enforcement on those two
// actions.
function CollaboratorsSection({ clientId, isOwner }: { clientId: string; isOwner: boolean }) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");

  const { data: collaborators, isLoading } = useQuery({
    queryKey: ["collaborators", clientId],
    queryFn: () => getCollaborators(clientId),
  });

  const addMutation = useMutation({
    mutationFn: () => addCollaborator(clientId, email.trim().toLowerCase()),
    onSuccess: () => {
      setEmail("");
      queryClient.invalidateQueries({ queryKey: ["collaborators", clientId] });
    },
  });

  const removeMutation = useMutation({
    mutationFn: (userId: string) => removeCollaborator(clientId, userId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["collaborators", clientId] }),
  });

  return (
    <Card className="px-4">
      <CardHeader className="px-0">
        <CardTitle>Sharing</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-0">
        <p className="text-xs text-muted-foreground">
          {isOwner
            ? "Give another login full access to this client's data. They must already have a login created with npm run create:user - there's no invite-by-email signup."
            : "Everyone who currently has access to this client."}
        </p>

        {isLoading && <Skeleton className="h-10 w-full" />}

        {collaborators && collaborators.length === 0 && (
          <p className="text-sm text-muted-foreground">Not shared with anyone else yet.</p>
        )}

        {collaborators && collaborators.length > 0 && (
          <div className="flex flex-col gap-2">
            {collaborators.map((c) => (
              <div key={c.user_id} className="flex items-center justify-between rounded-lg border border-border p-2.5 text-sm">
                <div>
                  <p className="font-medium">{c.email}</p>
                  <p className="text-xs text-muted-foreground">{c.agency_name}</p>
                </div>
                {isOwner && (
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={removeMutation.isPending}
                    onClick={() => removeMutation.mutate(c.user_id)}
                  >
                    Remove
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}

        {isOwner && (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              addMutation.mutate();
            }}
          >
            <div className="flex flex-col gap-1">
              <FieldLabel>Share with (email)</FieldLabel>
              <Input
                className="w-64"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="teammate@example.com"
                required
              />
            </div>
            <Button type="submit" size="sm" disabled={addMutation.isPending || !email.trim()}>
              {addMutation.isPending ? "Sharing…" : "Share"}
            </Button>
          </form>
        )}
        {addMutation.isError && (
          <p className="text-xs text-status-critical">{(addMutation.error as Error).message}</p>
        )}
      </CardContent>
    </Card>
  );
}

function DangerZoneSection({ clientId, clientName }: { clientId: string; clientName: string }) {
  const [confirmText, setConfirmText] = useState("");
  const router = useRouter();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => deleteClient(clientId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      router.push("/agency");
    },
  });

  return (
    <Card className="border-status-critical/40 px-4">
      <CardHeader className="px-0">
        <CardTitle className="text-status-critical">Danger Zone</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-0">
        <p className="text-xs text-muted-foreground">
          Permanently deletes this client and everything tied to it: sessions, leads, purchases, integrations,
          reports. This cannot be undone. Type <span className="font-medium text-foreground">{clientName}</span> to
          confirm.
        </p>
        <Input
          className="w-64"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder={clientName}
        />
        {mutation.isError && (
          <p className="text-xs text-status-critical">{(mutation.error as Error).message}</p>
        )}
        <div>
          <Button
            variant="destructive"
            size="sm"
            disabled={confirmText !== clientName || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? "Deleting…" : "Delete this client"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// Step 40 — a shareable, unauthenticated read-only report link (user's explicit
// choice over a real client-role login). Regenerating overwrites/revokes the
// previous token immediately; the link's actual page is /share/[token], outside
// this app's login gate entirely (see app-shell.tsx's PUBLIC_PATH_PREFIXES).
function ShareLinkSection({ clientId, client }: { clientId: string; client: Client }) {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["client", clientId] });
  const generate = useMutation({ mutationFn: () => generateShareLink(clientId), onSuccess: invalidate });
  const revoke = useMutation({ mutationFn: () => revokeShareLink(clientId), onSuccess: invalidate });
  const [copied, setCopied] = useState(false);

  const shareUrl = client.public_share_token
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/share/${client.public_share_token}`
    : null;

  return (
    <Card className="px-4">
      <CardHeader className="px-0">
        <CardTitle>Public Share Link</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-0">
        <p className="text-xs text-muted-foreground">
          A clean, read-only overview report this client can view with no login: cost, revenue, profit, ROAS/ROI.
          No integration or credential details are ever exposed through it.
        </p>
        {shareUrl ? (
          <div className="flex flex-wrap items-center gap-2">
            <CodeBlock>{shareUrl}</CodeBlock>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                navigator.clipboard.writeText(shareUrl);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? "Copied!" : "Copy"}
            </Button>
            <Button size="sm" variant="outline" disabled={generate.isPending} onClick={() => generate.mutate()}>
              Regenerate (revokes old link)
            </Button>
            <Button size="sm" variant="outline" disabled={revoke.isPending} onClick={() => revoke.mutate()}>
              Revoke
            </Button>
          </div>
        ) : (
          <Button size="sm" disabled={generate.isPending} onClick={() => generate.mutate()}>
            {generate.isPending ? "Generating…" : "Generate share link"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

// Step 58 — white-label branding shown on the public share link. No file-upload
// storage exists in this app, so the logo is a URL the agency hosts themselves —
// same "paste a URL" pattern as every other asset field here. Both fields are
// independently clearable back to this app's own default branding.
function BrandingSection({ clientId, client }: { clientId: string; client: Client }) {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["client", clientId] });
  const [logoUrl, setLogoUrl] = useState(client.brand_logo_url ?? "");
  const [accentColor, setAccentColor] = useState(client.brand_accent_color ?? "");
  const mutation = useMutation({
    mutationFn: () =>
      updateClientBranding(clientId, {
        brand_logo_url: logoUrl.trim() === "" ? null : logoUrl.trim(),
        brand_accent_color: accentColor.trim() === "" ? null : accentColor.trim(),
      }),
    onSuccess: invalidate,
  });
  const dirty = logoUrl !== (client.brand_logo_url ?? "") || accentColor !== (client.brand_accent_color ?? "");

  return (
    <Card className="px-4">
      <CardHeader className="px-0">
        <CardTitle>White-Label Branding</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-0">
        <p className="text-xs text-muted-foreground">
          Replace this app&apos;s own logo/name on the public share link above with your own. Leave blank to use the
          default branding.
        </p>
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1">
            <FieldLabel>Logo URL</FieldLabel>
            <Input
              className="w-72"
              placeholder="https://yoursite.com/logo.png"
              value={logoUrl}
              onChange={(e) => setLogoUrl(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <FieldLabel>Accent color</FieldLabel>
            <div className="flex items-center gap-2">
              <input
                type="color"
                className="h-9 w-9 cursor-pointer rounded-md border border-border bg-transparent p-0.5"
                value={/^#[0-9a-fA-F]{6}$/.test(accentColor) ? accentColor : "#3987e5"}
                onChange={(e) => setAccentColor(e.target.value)}
              />
              <Input
                className="w-28 uppercase"
                placeholder="#3987e5"
                value={accentColor}
                onChange={(e) => setAccentColor(e.target.value)}
              />
            </div>
          </div>
          <Button size="sm" disabled={!dirty || mutation.isPending} onClick={() => mutation.mutate()}>
            Save
          </Button>
        </div>
        {mutation.isError && <p className="text-xs text-status-critical">{(mutation.error as Error).message}</p>}
      </CardContent>
    </Card>
  );
}

// Step 41 — a URL builder (pure client-side, no backend needed for construction
// itself) plus a naming-mismatch check that catches likely TYPOS between a
// session's utm_campaign and an ad platform's own campaign_name, preventing the
// UTM-tagging-mismatch problem at the source instead of only surfacing it after
// the fact via the funnel breakdown's "unmatched" flag (a known, deliberate scope
// cut documented since Step 7).
function UtmToolsSection({ clientId }: { clientId: string }) {
  const [baseUrl, setBaseUrl] = useState("");
  const [source, setSource] = useState("");
  const [medium, setMedium] = useState("cpc");
  const [campaign, setCampaign] = useState("");
  const [content, setContent] = useState("");
  const [term, setTerm] = useState("");
  const [copied, setCopied] = useState(false);

  const { data: mismatches, isLoading } = useQuery({
    queryKey: ["utm-mismatches", clientId],
    queryFn: () => getUtmMismatches(clientId),
  });

  let builtUrl = "";
  if (baseUrl.trim()) {
    try {
      const url = new URL(baseUrl.trim());
      if (source) url.searchParams.set("utm_source", source);
      if (medium) url.searchParams.set("utm_medium", medium);
      if (campaign) url.searchParams.set("utm_campaign", campaign);
      if (content) url.searchParams.set("utm_content", content);
      if (term) url.searchParams.set("utm_term", term);
      builtUrl = url.toString();
    } catch {
      builtUrl = "";
    }
  }

  return (
    <Card className="px-4">
      <CardHeader className="px-0">
        <CardTitle>UTM Builder & Naming Check</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 px-0">
        <div className="flex flex-wrap gap-2">
          <div className="flex flex-col gap-1">
            <FieldLabel>Destination URL</FieldLabel>
            <Input className="w-64" placeholder="https://example.com/page" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <FieldLabel>Source</FieldLabel>
            <Input className="w-32" placeholder="facebook" value={source} onChange={(e) => setSource(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <FieldLabel>Medium</FieldLabel>
            <Input className="w-28" value={medium} onChange={(e) => setMedium(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <FieldLabel>Campaign</FieldLabel>
            <Input className="w-40" placeholder="Match your ad platform exactly" value={campaign} onChange={(e) => setCampaign(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <FieldLabel>Content (optional)</FieldLabel>
            <Input className="w-32" value={content} onChange={(e) => setContent(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <FieldLabel>Term (optional)</FieldLabel>
            <Input className="w-32" value={term} onChange={(e) => setTerm(e.target.value)} />
          </div>
        </div>

        {builtUrl && (
          <div className="flex flex-wrap items-center gap-2">
            <CodeBlock>{builtUrl}</CodeBlock>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                navigator.clipboard.writeText(builtUrl);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? "Copied!" : "Copy"}
            </Button>
          </div>
        )}

        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <p className="text-sm font-medium">Possible naming mismatches (last 90 days)</p>
          {isLoading && <Skeleton className="h-16 w-full" />}
          {!isLoading && (!mismatches || mismatches.length === 0) && (
            <p className="text-xs text-muted-foreground">No likely typos found between session tagging and ad platform campaign names.</p>
          )}
          {mismatches && mismatches.length > 0 && (
            <div className="flex flex-col gap-1.5">
              {mismatches.map((m, i) => (
                <p key={i} className="rounded-md border border-status-warning/40 bg-status-warning/10 px-3 py-2 text-xs text-status-warning">
                  Session tag "{m.sessionCampaign}" ({m.platform}) doesn't exactly match your ad platform's "{m.closestAdCostsCampaign}",
                  likely just a typo ({m.editDistance} character{m.editDistance === 1 ? "" : "s"} different).
                </p>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

type TabKey = "general" | "integrations" | "sharing" | "advanced" | "danger";

interface TabDef {
  key: TabKey;
  label: string;
  icon: LucideIcon;
  ownerOnly?: boolean;
}

// General/Integrations/Sharing/Danger used to be one continuous scroll — General
// alone runs five sub-sections before Integrations (16 platform rows) even starts.
// Splitting into tabs means "where do I turn off SMS alerts" is one click, not a
// scroll past a dozen unrelated cards. "Advanced" holds the longer tail (call
// tracking numbers, webhooks, identity links, UTM tools, the audit log) that
// doesn't cleanly fit General/Integrations/Sharing but also isn't dangerous.
const TABS: TabDef[] = [
  { key: "general", label: "General", icon: SlidersHorizontal },
  { key: "integrations", label: "Integrations", icon: Plug },
  { key: "sharing", label: "Sharing", icon: Users2 },
  { key: "advanced", label: "Advanced", icon: Wrench },
  { key: "danger", label: "Danger Zone", icon: AlertTriangle, ownerOnly: true },
];

function SettingsTabs({ active, onChange, showDanger }: { active: TabKey; onChange: (t: TabKey) => void; showDanger: boolean }) {
  return (
    <div className="max-w-full overflow-x-auto border-b border-border">
      <div className="flex shrink-0 gap-1">
        {TABS.filter((t) => !t.ownerOnly || showDanger).map((tab) => {
          const Icon = tab.icon;
          const isActive = tab.key === active;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => onChange(tab.key)}
              className={cn(
                "flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
                isActive
                  ? tab.key === "danger"
                    ? "border-status-critical text-status-critical"
                    : "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="size-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function SettingsClient({ clientId }: { clientId: string }) {
  const { data: client, isLoading } = useQuery({ queryKey: ["client", clientId], queryFn: () => getClient(clientId) });
  const [tab, setTab] = useState<TabKey>("general");

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <ClientKicker clientId={clientId} />
        <h1 className="text-lg font-semibold">Settings</h1>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Client details, ad platform and processor connections, and integrations that reach outside this software.
        </p>
      </div>

      {isLoading && <Skeleton className="h-64 w-full" />}
      {client && (
        <>
          <SettingsTabs active={tab} onChange={setTab} showDanger={client.is_owner} />

          {tab === "general" && <GeneralSection clientId={clientId} client={client} />}

          {tab === "integrations" && <IntegrationsSection clientId={clientId} />}

          {tab === "sharing" && (
            <div className="flex flex-col gap-6">
              <CollaboratorsSection clientId={clientId} isOwner={client.is_owner} />
              <ShareLinkSection clientId={clientId} client={client} />
              <BrandingSection clientId={clientId} client={client} />
            </div>
          )}

          {tab === "advanced" && (
            <div className="flex flex-col gap-6">
              <TrackingNumbersSection clientId={clientId} />
              <TagWebhookSection clientId={clientId} />
              <OutboundWebhooksSection clientId={clientId} />
              <IdentityLinksSection clientId={clientId} />
              <UtmToolsSection clientId={clientId} />
              <AuditLogSection queryKey={["client-audit-log", clientId]} fetcher={() => getClientAuditLog(clientId)} />
            </div>
          )}

          {tab === "danger" && client.is_owner && <DangerZoneSection clientId={clientId} clientName={client.name} />}
        </>
      )}
    </div>
  );
}
