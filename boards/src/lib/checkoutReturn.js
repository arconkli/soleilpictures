// checkoutReturn — what the return from Stripe needs to know that Stripe
// does not tell it.
//
// Two facts, both lost at the redirect:
//
//   • Whether this checkout was the TRIAL. verify-checkout-session answers
//     "activated", not "charged": a trial and a purchase come back with the
//     same body, so the success page told someone who had just started a free
//     trial "Payment received — Stripe took the payment". Wrong in exactly the
//     way that turns a trial into a dispute.
//   • The folder that was waiting. The over-cap import dialog's Upgrade cannot
//     carry its files across checkout (a FileList does not survive a page
//     load), so the person comes back with the folder still on disk and nothing
//     new on the canvas. Saying "drop it again — all N will fit" is the least
//     we owe them.
//
// sessionStorage, because Stripe returns to the same tab and nothing here
// should outlive it; an hour's expiry so a stale note can never greet an
// unrelated visit. Every access is guarded — storage throws in private mode
// and with blocked site data, and none of this may ever break a checkout.
// The storage is injectable so the node test can drive it.

const KEY = 'soleil.checkoutReturn.v1';
export const CHECKOUT_RETURN_TTL_MS = 60 * 60 * 1000;

function defaultStore() {
  try { return typeof window !== 'undefined' ? window.sessionStorage : null; } catch (_) { return null; }
}

function read(store, now) {
  if (!store) return null;
  try {
    const raw = store.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (!v || typeof v !== 'object' || !Number.isFinite(v.at) || now - v.at > CHECKOUT_RETURN_TTL_MS) {
      store.removeItem(KEY);
      return null;
    }
    return v;
  } catch (_) { return null; }
}

function write(patch, store, now) {
  if (!store) return;
  try {
    const cur = read(store, now) || {};
    store.setItem(KEY, JSON.stringify({ ...cur, ...patch, at: now }));
  } catch (_) { /* best-effort: the success page falls back to neutral copy */ }
}

// Called by startCheckout immediately before it hands the tab to Stripe.
export function noteCheckoutStart({ trial = false, plan = null } = {}, store = defaultStore(), now = Date.now()) {
  write({ trial: Boolean(trial), plan: plan || null }, store, now);
}

// Called when the over-cap import dialog's Upgrade is chosen.
export function notePendingImport({ n } = {}, store = defaultStore(), now = Date.now()) {
  const k = Math.max(0, Math.floor(Number(n) || 0));
  if (k > 0) write({ importN: k }, store, now);
}

// { trial, plan, importN } or null. Never throws.
export function readCheckoutReturn(store = defaultStore(), now = Date.now()) {
  const v = read(store, now);
  if (!v) return null;
  return {
    trial: Boolean(v.trial),
    plan: v.plan === 'monthly' || v.plan === 'annual' ? v.plan : null,
    importN: Math.max(0, Math.floor(Number(v.importN) || 0)),
  };
}

export function clearCheckoutReturn(store = defaultStore()) {
  try { store?.removeItem(KEY); } catch (_) { /* nothing to clear */ }
}
