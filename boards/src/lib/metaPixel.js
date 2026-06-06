// metaPixel.js — browser-side helpers for the Meta Pixel (window.fbq), plus the
// bridge to server-side Conversions API (CAPI) for events that must be reliable.
//
// The base pixel snippet lives in boards/index.html and fires the initial
// PageView on cold load. This module adds:
//   • installSpaPageViews() — fire PageView on History API route changes (our
//     hand-rolled router uses history.replaceState), so /welcome, /pricing, etc.
//     register as pageviews. Deduped by pathname so frequent replaceState calls
//     (TierRouter) don't spam, and the cold-load PageView isn't double-fired.
//   • trackPurchase()       — deduped browser Purchase on the success page;
//     shares event_id (Stripe session id) with the server Purchase.
//   • trackRegistration()   — fires CompleteRegistration once, routed through the
//     track-conversion edge fn (CAPI) so it's reliable and the access token stays
//     server-side. Deduped browser pixel signal fires alongside under the same
//     event_id. Fires at first product use (first genuine card) via
//     skipAgeCheck:true; the legacy age gate is kept for any caller that still
//     wants the signup-time semantics.
//   • getFbCookies()        — read _fbp/_fbc for threading into checkout/waitlist.
//
// Everything is best-effort and never throws into the UI.

const TRACK_URL = (import.meta.env.VITE_SUPABASE_URL || '') + '/functions/v1/track-conversion';

function fbqReady() {
  return typeof window !== 'undefined' && typeof window.fbq === 'function';
}

// Durable _fbc fallback. The pixel sets the _fbc cookie from an fbclid on the
// landing page, but that cookie can be lost to Safari ITP / ad blockers, and our
// funnel spans DAYS (ad click → waitlist → approval → purchase) — longer than a
// session. So we also persist the click id to localStorage and backfill it
// whenever the cookie is missing, so every conversion (Lead, Registration,
// InitiateCheckout, Purchase) still carries the ad click for attribution.
const FBC_KEY = 'soleil.meta.fbc';

// Capture ?fbclid= from the current URL into a Meta-format _fbc and persist it.
// Format Meta expects: fb.1.<creationMs>.<fbclid> (the subdomain index is 1).
// Call once at startup (main.jsx). Latest click wins. No-op without an fbclid or
// localStorage (private mode) — never throws.
export function captureFbclid() {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return;
  try {
    const fbclid = new URLSearchParams(window.location.search).get('fbclid');
    if (!fbclid) return;
    localStorage.setItem(FBC_KEY, `fb.1.${Date.now()}.${fbclid}`);
  } catch (_) { /* private-mode / quota → skip */ }
}

function persistedFbc() {
  if (typeof localStorage === 'undefined') return null;
  try { return localStorage.getItem(FBC_KEY) || null; } catch (_) { return null; }
}

// Read the Meta cookies the pixel sets. Not httpOnly → JS-readable. _fbp exists
// once the pixel has run; _fbc only when the user arrived via an fbclid link.
// Returns {} so callers can spread safely.
export function getFbCookies() {
  if (typeof document === 'undefined') return {};
  const out = {};
  const fbp = document.cookie.match(/(?:^|;\s*)_fbp=([^;]+)/);
  const fbc = document.cookie.match(/(?:^|;\s*)_fbc=([^;]+)/);
  if (fbp) out.fbp = decodeURIComponent(fbp[1]);
  if (fbc) out.fbc = decodeURIComponent(fbc[1]);
  // Cookie wins when present (freshest); otherwise fall back to the persisted
  // click id so days-later / cookie-blocked conversions still match.
  if (!out.fbc) {
    const stored = persistedFbc();
    if (stored) out.fbc = stored;
  }
  return out;
}

// Fire a SPA route-change PageView. The base snippet already fired the cold load.
export function trackPageView() {
  if (!fbqReady()) return;
  try { window.fbq('track', 'PageView'); } catch (_) {}
}

// Deduped browser Purchase. eventId MUST equal the server Purchase's event_id
// (the Stripe checkout session id) so Meta collapses the two into one conversion.
export function trackPurchase({ eventId, value, currency } = {}) {
  if (!fbqReady() || !eventId) return;
  try {
    const params = {};
    if (typeof value === 'number' && !Number.isNaN(value)) params.value = value;
    if (currency) params.currency = String(currency).toUpperCase();
    window.fbq('track', 'Purchase', params, { eventID: eventId });
  } catch (_) {}
}

// Fire ViewContent when a pricing surface renders — a mid-funnel signal Meta uses
// to find purchase-intent users and to build retargeting audiences. Browser-only
// (high-volume, low-value, no server-trusted dedup key). Not deduped: the public
// page and the in-app modal are legitimately distinct views.
export function trackViewContent({ content_name, value, currency } = {}) {
  if (!fbqReady()) return;
  try {
    const params = { content_type: 'product' };
    if (content_name) params.content_name = String(content_name);
    if (typeof value === 'number' && !Number.isNaN(value)) params.value = value;
    if (currency) params.currency = String(currency).toUpperCase();
    window.fbq('track', 'ViewContent', params);
  } catch (_) {}
}

// Fire InitiateCheckout when the user starts Stripe Checkout. eventId is shared
// with the server-side CAPI mirror (create-checkout-session) so Meta collapses
// the browser + server signal into one event — same dedup pattern as Purchase.
export function trackInitiateCheckout({ value, currency, plan, eventId } = {}) {
  if (!fbqReady()) return;
  try {
    const params = { content_type: 'product', content_name: 'Creator' };
    if (plan) params.content_category = String(plan);
    if (typeof value === 'number' && !Number.isNaN(value)) params.value = value;
    if (currency) params.currency = String(currency).toUpperCase();
    window.fbq('track', 'InitiateCheckout', params, eventId ? { eventID: eventId } : undefined);
  } catch (_) {}
}

const REG_FLAG_PREFIX = 'soleil.meta.reg.';      // + userId
const REG_WINDOW_MS   = 15 * 60 * 1000;          // only accounts created in the last 15m are "new"

// Fire CompleteRegistration once per user. We go through the server
// (track-conversion) so it's reliable; the server dedups by reg:<userId>, so even
// if this misfires for an existing user on a fresh device it collapses into their
// original registration and can't double-count.
//
// skipAgeCheck:true is the first-product-use path — we fire when the user does
// something real (their first genuine card), which can be days after signup, so
// the 15m "new account" gate must be bypassed. Without it (the legacy default)
// the event only fires for accounts created in the last 15 minutes.
export async function trackRegistration(session, { skipAgeCheck = false } = {}) {
  try {
    const user  = session?.user;
    const token = session?.access_token;
    if (!user?.id || !token || typeof localStorage === 'undefined') return;

    const flag = REG_FLAG_PREFIX + user.id;
    if (localStorage.getItem(flag)) return;       // already handled on this device

    if (!skipAgeCheck) {
      // Only fire for recently-created accounts; mark-and-skip older ones so we
      // don't re-check on every load for the rest of the user's life.
      const createdMs = user.created_at ? Date.parse(user.created_at) : NaN;
      const isNew = Number.isFinite(createdMs) && (Date.now() - createdMs) < REG_WINDOW_MS;
      if (!isNew) { try { localStorage.setItem(flag, '1'); } catch (_) {} return; }
    }

    const eventId = 'reg:' + user.id;
    // Stamp before the network call so a StrictMode double-invoke can't double-POST
    // (the server reg:<userId> dedup would collapse it anyway, but this avoids the
    // duplicate request entirely).
    try { localStorage.setItem(flag, '1'); } catch (_) {}

    // Deduped browser pixel signal (collapsed with the server event by event_id).
    if (fbqReady()) {
      try { window.fbq('track', 'CompleteRegistration', {}, { eventID: eventId }); } catch (_) {}
    }

    const { fbp, fbc } = getFbCookies();
    await fetch(TRACK_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ event_name: 'CompleteRegistration', event_id: eventId, fbp, fbc }),
    });
  } catch (_) {
    // Never throw into the auth flow.
  }
}

const ADLEAD_FLAG_PREFIX = 'soleil.meta.adlead.';   // + userId

// Fire a Meta Lead ONCE for an ad-cohort user when they enter the demo — the
// parallel to the organic waitlist Lead (submit-waitlist), so Facebook/Instagram
// ad traffic produces a mid-funnel signal even though it skips the waitlist.
// Routed through track-conversion, which re-checks ad_signups membership and
// dedups by lead:<userId> (the SAME key as the waitlist Lead), so a stray call
// for a non-ad user is a safe server-side no-op.
export async function trackAdLead(session) {
  try {
    const user  = session?.user;
    const token = session?.access_token;
    if (!user?.id || !token || typeof localStorage === 'undefined') return;

    const flag = ADLEAD_FLAG_PREFIX + user.id;
    if (localStorage.getItem(flag)) return;        // already handled on this device

    const eventId = 'lead:' + user.id;

    // Deduped browser pixel signal (collapsed with the server event by event_id).
    if (fbqReady()) {
      try { window.fbq('track', 'Lead', {}, { eventID: eventId }); } catch (_) {}
    }

    const { fbp, fbc } = getFbCookies();
    await fetch(TRACK_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ event_name: 'Lead', event_id: eventId, fbp, fbc }),
    });
    try { localStorage.setItem(flag, '1'); } catch (_) {}
  } catch (_) {
    // Never throw into the enter-demo flow.
  }
}

// Patch the History API so SPA navigations fire PageView. Call once at startup.
let spaInstalled = false;
let lastPath = typeof window !== 'undefined' ? window.location.pathname : null;
export function installSpaPageViews() {
  if (spaInstalled || typeof window === 'undefined' || typeof window.history === 'undefined') return;
  spaInstalled = true;
  const fire = () => {
    const p = window.location.pathname;
    if (p === lastPath) return;     // ignore query/hash-only + repeated replaceState to the same path
    lastPath = p;
    trackPageView();
  };
  for (const method of ['pushState', 'replaceState']) {
    const orig = window.history[method];
    if (typeof orig !== 'function') continue;
    window.history[method] = function (...args) {
      const ret = orig.apply(this, args);
      try { fire(); } catch (_) {}
      return ret;
    };
  }
  window.addEventListener('popstate', fire);
}
