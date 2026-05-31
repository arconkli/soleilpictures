# Meta Conversions API — full-funnel server-side tracking

**Date:** 2026-05-31
**Status:** Approved design, pending implementation plan
**Pixel ID:** `1671656413978924` (browser pixel already live in `boards/index.html`)

## Goal

Send conversion events to Meta from the **server** (Conversions API / CAPI), in
addition to the browser pixel, so conversions survive ad blockers, Safari/iOS
tracking restrictions, and the off-domain Stripe Checkout page where the browser
pixel can't see the purchase. Cover the full funnel — **Lead** (waitlist),
**CompleteRegistration** (account created), **Purchase** (paid subscription) —
with best-effort attribution (hashed email + `fbp`/`fbc` cookies + IP/UA).

## Non-goals

- No new analytics dashboard work — this is purely about emitting to Meta.
- No change to activation/billing logic; CAPI emits are strictly additive and
  fire-and-forget.
- No PII stored beyond what we already keep; PII sent to Meta is SHA-256 hashed.

## Architecture

### Shared helper: `supabase/functions/_shared/meta-capi.ts`

Single module every server emit point imports (mirrors how `_shared/activate.ts`
is shared today).

- `sha256Hex(value: string): Promise<string>` — normalize (lowercase + trim) then
  SHA-256 hex, via Web Crypto (`crypto.subtle.digest`). Used for `em` (email) and
  `external_id` (Supabase user id). `fbp`/`fbc`/IP/UA are sent **un-hashed**.
- `sendCapiEvent(opts)` — builds one event object and POSTs
  `{ data: [event], test_event_code? }` to
  `https://graph.facebook.com/<META_GRAPH_VERSION>/<META_PIXEL_ID>/events?access_token=<token>`.
  - `opts`: `{ eventName, eventId, eventTime?, actionSource='website',
    eventSourceUrl?, userData: { email?, externalId?, fbp?, fbc?, clientIpAddress?,
    clientUserAgent? }, customData? }`.
  - Runs inside `EdgeRuntime.waitUntil(...)` so it **adds no latency** to the
    caller's response and completes after the response is returned.
  - Fully wrapped in try/catch — **never throws into the caller**.
  - If `META_CAPI_TOKEN` is unset → logged no-op. **Deploying this code changes
    nothing until the secret is added.**

### Config (env / Supabase function secrets)

| Var | Required | Default | Notes |
|---|---|---|---|
| `META_CAPI_TOKEN` | yes (to actually send) | — | System-User token from Events Manager. Set in Supabase **dashboard** (MCP/CLI can't set secrets). Until set, all emits no-op. |
| `META_PIXEL_ID` | no | `1671656413978924` | Pixel id is public; hardcoded default is fine. |
| `META_GRAPH_VERSION` | no | `v21.0` | Bump as Meta deprecates versions. |
| `META_CAPI_TEST_EVENT_CODE` | no | — | When set, every emit includes it → events show in Events Manager → Test Events. Leave unset in prod. |

## Events

| Event | Emit point(s) | `event_id` (dedup key) | Value / custom_data |
|---|---|---|---|
| **Purchase** | `stripe-webhook` (`checkout.session.completed`) **and** `verify-checkout-session` | `session.id` (`cs_…`) | `value = session.amount_total / 100`, `currency = session.currency`; `custom_data: { plan, subscription_id }` |
| **Lead** | `submit-waitlist` | waitlist entry id | — |
| **CompleteRegistration** | new `track-conversion` edge fn (client-called once post-signup) | `reg:<userId>` | — |

### Dedup rationale

- **Purchase fires from two server paths** by design (the webhook *and* the
  success-page `verify-checkout-session` belt-and-suspenders activation). Keying
  both on `session.id` makes Meta collapse them into one conversion. Same key also
  dedups Stripe webhook retries and the optional browser Purchase (below).
- **Lead** keyed on the waitlist entry id (the submit fn is idempotent and returns
  the existing entry on resubmit → stable key).
- **CompleteRegistration** keyed on `reg:<userId>` (stable, one per user).

### Why a new `track-conversion` edge function for registration

Account creation completes in a Postgres trigger (`handle_new_user`), so there is
no existing edge function in the signup path. `track-conversion` is a small,
**auth-required** function with an **event-name allowlist** (initially just
`CompleteRegistration`). It:
- reads IP/UA from its own request headers,
- accepts `fbp`/`fbc` in the body,
- hashes the email + user id from the verified JWT,
- emits via the shared helper.

This keeps the CAPI token **server-side only** (never shipped to the browser) and
is reusable for any future browser-origin server event.

## Match-quality threading (`fbp` / `fbc` / IP / UA)

`_fbp`/`_fbc` are JS-readable cookies the browser pixel sets. IP and User-Agent
must be captured **where the user's request actually lands** — not at webhook time,
because the webhook request originates from Stripe, not the user.

- **Purchase path (indirect — needs threading through Stripe):**
  1. `startCheckout` (client, `checkout.js`) reads `_fbp`/`_fbc` cookies → sends in
     POST body.
  2. `create-checkout-session` reads client IP (`x-forwarded-for`) + `user-agent`
     from request headers, and `fbp`/`fbc` from the body → writes all four into
     `session.metadata` (`fbp`, `fbc`, `client_ip`, `client_ua`). (Stripe metadata:
     string values, ≤500 chars, ≤50 keys — all fit.)
  3. `stripe-webhook` / `verify-checkout-session` read `session.metadata` back into
     the CAPI `user_data`.
- **Lead / CompleteRegistration (direct):** these functions are called by the
  browser, so they read IP/UA from their own headers and take `fbp`/`fbc` in the
  body — no Stripe round-trip.

`external_id` (hashed Supabase user id) and `em` (hashed email) are included
everywhere they're known, further improving match quality.

## Browser side

### `boards/src/lib/metaPixel.js` (new)

- Thin wrapper over the global `fbq`, safe when `fbq` is undefined (no-op).
- **Explicit** internal→Meta event map (not automatic mirroring of every
  `logEvent`, which would be noise). Initial map:
  - `checkout_success` → `Purchase` (with `eventID = session_id`, value/currency)
- `trackPageView()` for SPA route changes.

### Dedup'd browser Purchase

On `PricingSuccess`, fire `fbq('track', 'Purchase', { value, currency },
{ eventID: session_id })` — same `eventID` as the server Purchase, so Meta dedups
but we still get the browser signal when it isn't blocked. `verify-checkout-session`
is extended to also return `amount_total` so the browser value is accurate.

### SPA route-change PageViews

The base pixel in `index.html` fires one `PageView` on cold load. Clusters is a
React SPA, so in-app navigation (opening a board, switching views) fires no further
PageViews. Add `trackPageView()` on route/view change (hooked into the existing
router/view-state in `App.jsx`) so Meta sees in-app navigation as pageviews. Guard
against double-firing the initial load (the inline snippet already fired it).

## Safety / failure model

- Every CAPI emit is fire-and-forget via `EdgeRuntime.waitUntil` + try/catch. A
  CAPI outage, bad token, or Meta 4xx can **never** block a checkout, activation,
  waitlist write, or registration.
- No token set → no-op. Wrong token → logged warning, no user impact.
- No new tables, no migrations.

## Testing & verification

1. **Unit (Deno):** test `sha256Hex` against known vectors and the payload builder
   shape (event_name, event_id, hashed fields present/un-hashed fields raw) without
   network.
2. **Events Manager → Test Events:** set `META_CAPI_TEST_EVENT_CODE`, run a real
   waitlist submit / signup / $0-promo checkout, confirm all three events appear and
   show good "Event Match Quality".
3. **Dedup check:** confirm webhook + verify Purchase collapse to one conversion,
   and the browser Purchase dedups against the server one (same `event_id`).
4. Remove the test event code for production.

## Files

**New**
- `supabase/functions/_shared/meta-capi.ts`
- `supabase/functions/track-conversion/index.ts`
- `boards/src/lib/metaPixel.js`

**Edit (server)**
- `supabase/functions/stripe-webhook/index.ts` — Purchase emit
- `supabase/functions/verify-checkout-session/index.ts` — Purchase emit + return `amount_total`
- `supabase/functions/create-checkout-session/index.ts` — capture IP/UA + `fbp`/`fbc` → session metadata
- `supabase/functions/submit-waitlist/index.ts` — Lead emit

**No config.toml change:** `track-conversion` is omitted from `config.toml` on purpose,
exactly like `create-checkout-session` / `verify-checkout-session` / `submit-waitlist`.
It relies on the gateway default (`verify_jwt=true`) *and* does its own Bearer check;
the browser always calls it with a valid session token. Only `stripe-webhook` needs
the `verify_jwt=false` override (Stripe sends no JWT).

**Edit (client)**
- `boards/src/lib/checkout.js` — send `fbp`/`fbc` to create-checkout-session
- `boards/src/auth/PricingSuccess.jsx` — dedup'd browser Purchase
- `boards/src/lib/analytics.js` and/or `boards/src/auth/AuthGate.jsx` — one-shot CompleteRegistration call for newly-created accounts
- `boards/src/App.jsx` (or router) — SPA route-change PageView

**Deploy**
- 5 edge functions (`stripe-webhook`, `verify-checkout-session`,
  `create-checkout-session`, `submit-waitlist`, `track-conversion`) via Supabase MCP.
- `META_CAPI_TOKEN` set by the user in the Supabase dashboard.

## Resolved implementation details

- **CompleteRegistration trigger:** `AuthGate` runs a `useEffect` on `session`;
  `trackRegistration(session)` fires once per device (localStorage flag
  `soleil.meta.reg.<uid>`) and only when `session.user.created_at` is within 15
  minutes (genuinely-new accounts). Server dedups by `reg:<uid>` so a misfire for an
  existing user collapses into their original registration.
- **SPA PageView scope:** `installSpaPageViews()` (called once in `main.jsx`)
  patches `history.pushState`/`replaceState` + `popstate` and fires `PageView` on
  **pathname change** (deduped). This covers route-level funnel pages
  (`/welcome`, `/pricing`, `/pricing/success`) — the same surface the existing CWA
  `spa:true` beacon tracks. It intentionally does NOT fire on in-app board opens /
  view switches (those don't change the URL and would be PageView spam, not useful
  for ad optimization).
- **`<noscript>` placement:** the pixel's `<noscript><img></noscript>` lives in
  `<body>`, not `<head>` — an `<img>` inside `<noscript>` is disallowed in `<head>`
  by the HTML spec and vite/parse5 reject the build otherwise.
- **`verify_jwt`:** `track-conversion` uses the gateway default (true) + its own
  Bearer check; no `config.toml` entry (see Files above).
- `fbclid` → `_fbc` construction fallback when the cookie is absent remains a
  future nice-to-have (not implemented; we send whatever `_fbc` the pixel set).
