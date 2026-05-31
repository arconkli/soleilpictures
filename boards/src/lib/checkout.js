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
import { logEvent } from './analytics.js';
import { getFbCookies } from './metaPixel.js';

const CHECKOUT_URL = (import.meta.env.VITE_SUPABASE_URL || '') + '/functions/v1/create-checkout-session';
const PORTAL_URL   = (import.meta.env.VITE_SUPABASE_URL || '') + '/functions/v1/create-portal-session';
const ACCOUNT_ACTION_URL = (import.meta.env.VITE_SUPABASE_URL || '') + '/functions/v1/admin-account-action';

async function authedToken() {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error('Not signed in.');
  return token;
}

// Start Stripe Checkout for `plan` ('monthly' | 'annual'). Redirects the
// browser to the returned URL (Checkout, or the Customer Portal if the server
// detected an existing subscription). Throws on failure so callers can show
// an inline error and re-enable their button.
export async function startCheckout({ plan, surface }) {
  const token = await authedToken();
  logEvent('checkout_open', { plan, surface });
  // Thread Meta match cookies through to create-checkout-session, which stashes
  // them in the Stripe session metadata for the server-side Purchase (CAPI).
  const { fbp, fbc } = getFbCookies();
  const res = await fetch(CHECKOUT_URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ plan, fbp, fbc }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.url) throw new Error(body.error || `HTTP ${res.status}`);
  if (body.mode === 'portal') logEvent('billing_portal_open', { surface, via: 'checkout_guard' });
  window.location.assign(body.url);
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
  const token = await authedToken();
  logEvent('billing_portal_open', { surface });
  const res = await fetch(PORTAL_URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.url) throw new Error(body.error || `HTTP ${res.status}`);
  window.location.assign(body.url);
}
