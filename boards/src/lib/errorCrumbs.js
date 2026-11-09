// errorCrumbs.js — the last steps before an error, by name only.
//
// A ring of the last 20:
//   ev     an analytics event's name (analytics.js logEvent), which is also
//          how a trail shows the screens: board_open, pricing_view…
//   toast  an error or warning toast, by its code
//   http   a failed request, by service and route (netWatch.js)
//   net    the browser going offline or coming back
//   vis    the tab hidden or shown
//   err    an error already reported, by its kind
// Never a prop, a value or any text anyone typed. errorReporting.js takes a
// copy with every row, and 0580's _client_error_crumbs() keeps the same shape
// whatever a client sends.

const MAX = 20;
const ring = [];

// `u`, a failed request's address, stays in this page's memory: errorSender
// turns it into a service and route (errorCore.js crumbNames) before a crumb
// is sent anywhere.
export function crumb(k, n, u) {
  if (!n) return;
  ring.push({ k, n: String(n).slice(0, 60), at: performance.now(), u });
  if (ring.length > MAX) ring.shift();
}

// Each crumb's t is how many ms before the snapshot it happened (≤ 0).
export function crumbsSnapshot(at = performance.now()) {
  return ring.map((c) => ({ t: Math.round(c.at - at), k: c.k, n: c.n, u: c.u }));
}

export function __resetCrumbsForTest() { ring.length = 0; }

// Analytics events that say the landing page, the sign-in screen or the code
// step is on show (analyticsEvents.js EV). Time spent there is the person's
// own, not a boot that hung.
const SIGN_IN_EVENTS = new Set([
  'landing_view', 'landing_field_engage', 'landing_invite_prefill_seen', 'landing_join_prefill_seen',
  'email_submit', 'email_submit_error', 'otp_verify', 'otp_verify_error', 'landing_edit_email',
  'auth_code_restored', 'auth_mailbox_open', 'lp_view',
]);

// How many ms ago the newest sign-in step happened, over a crumbsSnapshot()
// (each t is ms before the snapshot, <= 0); null when the trail has none.
export function signInAgo(crumbs) {
  let ago = null;
  for (const c of crumbs || []) {
    if (!c || c.k !== 'ev' || !SIGN_IN_EVENTS.has(c.n) || typeof c.t !== 'number' || !Number.isFinite(c.t)) continue;
    if (ago === null || -c.t < ago) ago = -c.t;
  }
  return ago;
}
