// checkoutErrors — turn the raw failure from startCheckout/startPortal into a
// line a buyer can act on.
//
// Why this exists: startCheckout throws `body.error || 'HTTP ' + status`, and
// every caller rendered that string verbatim. A prospect who clicked "Get
// Creator" could be shown `HTTP 500`, `already_subscribed`, or a bare Stripe
// SDK message — at the exact moment they had decided to pay. This mirrors the
// REASON_COPY map that already exists for the post-checkout verify step in
// auth/PricingSuccess.jsx.
//
// This is a RENDER-TIME transform only. checkout.js keeps throwing the raw
// message so `checkout_error` / `billing_portal_error` analytics stay
// debuggable — mapping there would blind the funnel.
//
// Pure + dependency-free so it can be unit-tested under node (see the sibling
// .test.mjs).

export const SUPPORT_EMAIL = 'hello@soleilpictures.com';

const GENERIC = `Checkout didn't open — that's on us, not you. Try again in a moment, and if it keeps happening email ${SUPPORT_EMAIL}.`;

// Keyed by the exact `error` strings the edge functions return
// (supabase/functions/create-checkout-session, create-portal-session) plus the
// one client-side throw from checkout.js's authedToken().
const COPY = {
  // Session/auth — recoverable by the user, so say how.
  'Not signed in.':  'Your session expired. Sign in again and the upgrade will pick up where it left off.',
  'auth required':   'Your session expired. Sign in again and the upgrade will pick up where it left off.',
  'invalid token':   'Your session expired. Sign in again and the upgrade will pick up where it left off.',

  // The user already has access — this is good news, phrased as such. Happens
  // to comped/admin-granted accounts with no Stripe customer record.
  already_subscribed: "You already have Creator — there's nothing to buy. If you're trying to change a payment method or cancel, use Manage billing in Settings.",

  // Portal-specific: no Stripe customer exists to manage.
  'no subscription found': "There's no Stripe subscription on this account to manage. If you have complimentary access, there's no billing to change.",

  // Shouldn't reach a user (the client always sends a valid plan/JSON/method),
  // so keep them generic rather than exposing protocol detail.
  'POST only':    GENERIC,
  'invalid json': GENERIC,
  "plan must be 'monthly' or 'annual'": GENERIC,
};

// checkoutErrorMessage(err) -> string
//   err: an Error, a string, or anything stringifiable.
// Always returns copy that tells the user what to do next; never returns the
// raw server/HTTP string.
export function checkoutErrorMessage(err) {
  const raw = (err?.message ?? (typeof err === 'string' ? err : String(err ?? ''))).trim();
  if (!raw) return GENERIC;

  if (Object.prototype.hasOwnProperty.call(COPY, raw)) return COPY[raw];

  // `HTTP 500` / `HTTP 404` — checkout.js's fallback when the body carried no
  // `error` field. A 5xx is ours; a 4xx here means a malformed request we sent.
  const http = /^HTTP (\d{3})$/.exec(raw);
  if (http) return GENERIC;

  // Network-layer failures (fetch rejects before any status).
  if (/failed to fetch|networkerror|load failed/i.test(raw)) {
    return "Couldn't reach the checkout server — check your connection and try again.";
  }

  // Anything else is an unmapped Stripe SDK message off the 500 branch.
  return GENERIC;
}

// Convenience for surfaces that show the support address alongside the message.
export function checkoutSupportHref(subject = 'Clusters: checkout failed', detail = '') {
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}${detail ? `&body=${encodeURIComponent(detail)}` : ''}`;
}
