# True Attribution Overlay (prototype)

A Chrome extension that overlays real cost/revenue/ROAS numbers from the internal
dashboard directly onto Facebook Ads Manager and Google Ads pages, so the numbers show
without switching tabs. **Prototype, unpublished** — this is plain unbundled JS with no
build step, loaded as an unpacked extension for local use.

## Load it

1. `chrome://extensions`
2. Enable "Developer mode" (top right)
3. "Load unpacked" → select this `extension/` folder
4. Click the extension's toolbar icon, fill in:
   - **API URL** — wherever the API is running (e.g. `http://localhost:3001`)
   - **API Secret** — the `API_SECRET` value from `.env` (this calls the authenticated
     `/api/v1/*` Public Attribution API, not the internal unauthenticated routes)
   - **Client ID** — copy from the internal dashboard (there's no client-listing
     endpoint under `/api/v1` yet, so this is pasted in rather than picked from a
     dropdown)
5. Reload a Facebook Ads Manager or Google Ads tab — a small panel appears top-right
   with that client's last-30-days cost/revenue/profit/ROAS.

## Known limitations

- Not published to the Chrome Web Store — that needs a Google developer account and
  a store listing/review, which is a business step, not code
- No client picker (see above) — needs `/api/v1` to also expose a client list endpoint
- Numbers are the account-wide Overview totals, not scoped to whatever campaign/ad set
  is currently on screen — matching per-campaign context to what's rendered in Meta's/
  Google's own UI would need parsing their DOM for the active campaign ID, which is
  fragile against their own UI changes and out of scope for this prototype
