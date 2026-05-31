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
//   • trackRegistration()   — fires CompleteRegistration once for a genuinely-new
//     account, routed through the track-conversion edge fn (CAPI) so it's
//     reliable and the access token stays server-side. Deduped browser pixel
//     signal fires alongside under the same event_id.
//   • getFbCookies()        — read _fbp/_fbc for threading into checkout/waitlist.
//
// Everything is best-effort and never throws into the UI.

const TRACK_URL = (import.meta.env.VITE_SUPABASE_URL || '') + '/functions/v1/track-conversion';

function fbqReady() {
  return typeof window !== 'undefined' && typeof window.fbq === 'function';
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

const REG_FLAG_PREFIX = 'soleil.meta.reg.';      // + userId
const REG_WINDOW_MS   = 15 * 60 * 1000;          // only accounts created in the last 15m are "new"

// Fire CompleteRegistration once for a genuinely-new account. We go through the
// server (track-conversion) so it's reliable; the server dedups by reg:<userId>,
// so even if this misfires for an existing user signing in on a fresh device it
// collapses into their original registration and can't double-count.
export async function trackRegistration(session) {
  try {
    const user  = session?.user;
    const token = session?.access_token;
    if (!user?.id || !token || typeof localStorage === 'undefined') return;

    const flag = REG_FLAG_PREFIX + user.id;
    if (localStorage.getItem(flag)) return;       // already handled on this device

    // Only fire for recently-created accounts; mark-and-skip older ones so we
    // don't re-check on every load for the rest of the user's life.
    const createdMs = user.created_at ? Date.parse(user.created_at) : NaN;
    const isNew = Number.isFinite(createdMs) && (Date.now() - createdMs) < REG_WINDOW_MS;
    if (!isNew) { try { localStorage.setItem(flag, '1'); } catch (_) {} return; }

    const eventId = 'reg:' + user.id;

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
    try { localStorage.setItem(flag, '1'); } catch (_) {}
  } catch (_) {
    // Never throw into the auth flow.
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
