// Shared checkout / billing-portal client helpers. Every surface that starts
// a Stripe Checkout (PricingPage, PricingModal, WaitlistConfirm) or opens the
// Customer Portal (BillingPage, SettingsPanel) calls these instead of
// duplicating the getSession → fetch → redirect dance.
//
// Already-paid safety: create-checkout-session is the authoritative backstop —
// if the caller already has an active subscription it returns a Customer
// Portal URL ({ mode: 'portal', url }) rather than creating a second
// subscription. startCheckout redirects to whatever URL comes back, so a
// double-charge is impossible even if the client-side tier gate is bypassed.

import { supabase } from './supabase.js';
import { logEvent, logEventNow } from './analytics.js';
import { EV } from './analyticsEvents.js';
import { getFbCookies, gpcOn, trackInitiateCheckout } from './metaPixel.js';
import { PRICING } from './billingCopy.js';
import { checkoutErrorKind } from './checkoutErrors.js';
import { isGalleryActive } from './galleryState.js';
import { noteCheckoutStart, notePendingImport } from './checkoutReturn.js';
import { AWAIT_PAYMENT_MS, hasHeld, letGoHeld, noteAwaitingPayment } from './heldUploads.js';

const CHECKOUT_URL = (import.meta.env.VITE_SUPABASE_URL || '') + '/functions/v1/create-checkout-session';
const PORTAL_URL   = (import.meta.env.VITE_SUPABASE_URL || '') + '/functions/v1/create-portal-session';
const ACCOUNT_ACTION_URL = (import.meta.env.VITE_SUPABASE_URL || '') + '/functions/v1/admin-account-action';

// The iOS and Android app: a page on another host opens in the system
// browser and the app stays where it was (Capacitor, no allowNavigation), so
// held files survive a checkout there without a second tab.
function inNativeApp() {
  try { return Boolean(window.Capacitor?.isNativePlatform?.()); } catch (_) { return false; }
}

// A tab for Checkout, opened while files are held in this one (below). Null
// where one cannot be opened: a popup blocker, or the app (above).
function openCheckoutTab() {
  if (inNativeApp()) return null;
  try {
    const tab = window.open('', '_blank');
    if (!tab) return null;
    try { tab.opener = null; } catch (_) { /* Stripe's page has no use for us */ }
    try { tab.document.title = 'Opening checkout…'; tab.document.body.textContent = 'Opening Stripe Checkout…'; } catch (_) {}
    return tab;
  } catch (_) { return null; }
}

async function authedToken() {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error('Not signed in.');
  return token;
}

// Start Stripe Checkout for `plan` ('monthly' | 'annual'). Redirects the
// browser to the returned URL (Checkout, or the Customer Portal if the server
// detected an existing subscription). Throws on failure so callers can show
// an inline error and re-enable their button. Resolves { tab: true } when it
// opened a new tab instead (below), which the caller must treat as done.
//
// `trial: true` asks for the Creator trial. The server decides — it re-checks
// the caller's own tier row and Stripe's memory of the customer — so a client
// that asks when it should not simply gets `trial_not_available` back.
//
// While files are held in this tab waiting for room (lib/heldUploads.js),
// Checkout opens in a NEW tab: this one keeps the files, and uploads them when
// the plan lands. The tab is opened before the first await, because a browser
// lets a page open one only inside the click that asked; where it cannot be
// opened the files are let go and the return asks for them again.
export async function startCheckout({ plan, surface, header = null, via = null, trial = false }) {
  // The one previewable action with a real external consequence. Clicking
  // "Try Creator" inside the admin Surface Gallery would otherwise create a
  // live Stripe Checkout session against the admin's own customer record and
  // — since the trial is one per account, swept by email — could spend the
  // owner's single trial on a screenshot. Refuse, loudly enough that the
  // caller's existing error path explains itself.
  if (isGalleryActive()) throw new Error('gallery_preview');
  // Noted before the tab opens: a tab opened by this one starts with a copy of
  // its sessionStorage, which is where the success page reads whether this was
  // the trial (checkoutReturn.js).
  const holding = hasHeld();
  if (holding) noteCheckoutStart({ trial: Boolean(trial), plan });
  const tab = holding ? openCheckoutTab() : null;
  try {
    const token = await authedToken();
    logEventNow(EV.CHECKOUT_OPEN, { plan, surface, header, via, trial: Boolean(trial) });   // must-land: redirect follows
    // Thread Meta match cookies through to create-checkout-session, which stashes
    // them in the Stripe session metadata for the server-side Purchase (CAPI).
    const { fbp, fbc } = getFbCookies();

    // Meta InitiateCheckout — purchase-intent signal for ad optimization. One
    // event_id is shared by the browser pixel (here) and the server-side CAPI
    // mirror in create-checkout-session, so Meta collapses them into one event.
    // Fire before the fetch so the intent is recorded even if the call fails.
    const icEventId = `ic:${(globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`)}`;
    const priced = PRICING[plan] || PRICING.annual;
    trackInitiateCheckout({ value: priced.billed, currency: 'USD', plan, eventId: icEventId });

    const res = await fetch(CHECKOUT_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ plan, fbp, fbc, gpc: gpcOn(), ic_event_id: icEventId, trial: Boolean(trial), surface, header, via }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.url) {
      // Carry the server's REASON, not just its error code. A trial refusal is
      // either `already_trialed` (the anti-abuse sweep working as designed) or
      // `too_early`/`cards_unknown` (our cached count was stale and we offered
      // something we should not have) — opposite problems that were previously
      // byte-identical in telemetry. This is the drift detector the twin-file
      // trialCore design exists to provide, disabled by one missing read.
      const err = new Error(body.error || `HTTP ${res.status}`);
      if (body.reason) err.reason = body.reason;
      throw err;
    }
    if (body.mode === 'portal') logEventNow(EV.BILLING_PORTAL_OPEN, { surface, via: 'checkout_guard' });
    // The success page cannot tell a trial from a purchase — verify answers
    // "activated", not "charged" — so say which this was before the tab leaves.
    else noteCheckoutStart({ trial: Boolean(trial), plan });
    if (tab) {
      // Closed before Stripe answered: they changed their mind. The files
      // stay held, and nothing is awaited.
      if (tab.closed) return { tab: true };
      tab.location.href = body.url;
      // This tab stays, holding the files, and watches for the plan to land
      // until that tab closes. The caller's button must not wait on a
      // navigation that will not come. The portal sells nothing that makes
      // room, so it is not waited on.
      if (body.mode !== 'portal') noteAwaitingPayment(Date.now(), AWAIT_PAYMENT_MS, tab);
      return { tab: true };
    }
    if (holding && inNativeApp()) {
      // Checkout opens in the system browser and the app keeps its page, and
      // with it the files: coming back to the app is what releases them.
      if (body.mode !== 'portal') noteAwaitingPayment();
      window.location.assign(body.url);
      return { tab: true };
    }
    // Same tab with files held: they cannot come along. Let them go, so the
    // leave guard does not stand in the way of the page they are waiting on,
    // and have a checkout's return ask for them again.
    if (holding) {
      const n = letGoHeld();
      if (body.mode !== 'portal') notePendingImport({ n });
    }
    window.location.assign(body.url);
    return { tab: false };
  } catch (e) {
    try { tab?.close(); } catch (_) { /* already gone */ }
    // Surfaces paid drop-off between checkout_open and checkout_success — the
    // failed/abandoned attempts that were previously invisible in the funnel.
    // `kind` separates a misconfigured price/URL (ours, permanent, needs a
    // human) from an outage or a dead session, which the raw message alone
    // did not: every unmapped failure rendered as "try again in a moment".
    logEvent(EV.CHECKOUT_ERROR, { plan, surface, header, via, trial: Boolean(trial), kind: checkoutErrorKind(e), reason: e?.reason ?? null, message: (e?.message || String(e)).slice(0, 200) });
    throw e;
  }
}

// Admin-only account lifecycle actions handled server-side (need the service
// role / Stripe SDK): cancel_subscription, ban, unban, delete, resync_subscription.
// The edge fn re-verifies the caller is admin; this just forwards the call.
// Returns the parsed JSON body; throws with the server's error message on failure.
export async function adminAccountAction({ userId, action, reason } = {}) {
  const token = await authedToken();
  const res = await fetch(ACCOUNT_ACTION_URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ user_id: userId, action, reason }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

// Open the Stripe Customer Portal for the signed-in user. Redirects on success.
export async function startPortal({ surface } = {}) {
  if (isGalleryActive()) throw new Error('gallery_preview');   // see startCheckout
  try {
    const token = await authedToken();
    logEventNow(EV.BILLING_PORTAL_OPEN, { surface });   // must-land: redirect follows
    const res = await fetch(PORTAL_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.url) throw new Error(body.error || `HTTP ${res.status}`);
    window.location.assign(body.url);
  } catch (e) {
    logEvent(EV.BILLING_PORTAL_ERROR, { surface, message: (e?.message || String(e)).slice(0, 200) });
    throw e;
  }
}
