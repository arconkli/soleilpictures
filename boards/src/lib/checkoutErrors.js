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

  // The server declined the trial (already had one, or not yet eligible by
  // its own read). Creator itself is still for sale — say so, don't dead-end.
  trial_not_available: "The trial isn't available on this account, but Creator is — choose a plan above and it starts right away.",

  // Shouldn't reach a user (the client always sends a valid plan/JSON/method),
  // so keep them generic rather than exposing protocol detail.
  'POST only':    GENERIC,
  'invalid json': GENERIC,
  "plan must be 'monthly' or 'annual'": GENERIC,
};

// A misconfiguration, as Stripe or the edge function would word it: a price ID
// from the wrong mode (live key, test price), a missing or malformed APP_URL
// behind success_url, a bad API key. These are not transient and "try again in
// a moment" is a lie for them. They get their own copy AND their own `kind` in
// checkout_error, so that a broken configuration can never read as an outage —
// on screen or in the funnel. No non-zero live charge has ever cleared this
// account, so this class is unproven rather than ruled out.
const CONFIG_RE = /no such price|no such plan|resource_missing|price .{0,40}(not found|does not exist|is not)|invalid price|success_url|cancel_url|not a valid url|invalid url|app_url|invalid api key|api key provided|provide an api key|no api key/i;
const CONFIG = `Checkout isn't set up right on our side — that's ours to fix, and it needs a human. Email ${SUPPORT_EMAIL} and we'll sort it out.`;

const NETWORK = "Couldn't reach the checkout server — check your connection and try again.";

// checkoutErrorKind(err) -> 'auth' | 'already' | 'no_subscription' | 'config' | 'network' | 'generic'
//   The class of failure, for checkout_error analytics. Pure, no copy.
export function checkoutErrorKind(err) {
  const raw = (err?.message ?? (typeof err === 'string' ? err : String(err ?? ''))).trim();
  if (!raw) return 'generic';
  if (raw === 'Not signed in.' || raw === 'auth required' || raw === 'invalid token') return 'auth';
  if (raw === 'already_subscribed') return 'already';
  if (raw === 'no subscription found') return 'no_subscription';
  if (raw === 'trial_not_available') return 'trial';
  if (CONFIG_RE.test(raw)) return 'config';
  if (/failed to fetch|networkerror|load failed/i.test(raw)) return 'network';
  return 'generic';
}

// checkoutErrorMessage(err) -> string
//   err: an Error, a string, or anything stringifiable.
// Always returns copy that tells the user what to do next; never returns the
// raw server/HTTP string.
export function checkoutErrorMessage(err) {
  const raw = (err?.message ?? (typeof err === 'string' ? err : String(err ?? ''))).trim();
  if (!raw) return GENERIC;

  if (Object.prototype.hasOwnProperty.call(COPY, raw)) return COPY[raw];

  // Not transient: say so, and say it needs us.
  if (CONFIG_RE.test(raw)) return CONFIG;

  // `HTTP 500` / `HTTP 404` — checkout.js's fallback when the body carried no
  // `error` field. A 5xx is ours; a 4xx here means a malformed request we sent.
  const http = /^HTTP (\d{3})$/.exec(raw);
  if (http) return GENERIC;

  // Network-layer failures (fetch rejects before any status).
  if (/failed to fetch|networkerror|load failed/i.test(raw)) return NETWORK;

  // Anything else is an unmapped Stripe SDK message off the 500 branch.
  return GENERIC;
}

// Convenience for surfaces that show the support address alongside the message.
export function checkoutSupportHref(subject = 'Clusters: checkout failed', detail = '') {
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}${detail ? `&body=${encodeURIComponent(detail)}` : ''}`;
}
