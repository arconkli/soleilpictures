// creatorIntent — "I want Creator", carried across sign-in.
//
// The public /pricing page cannot sell anything: a signed-out visitor has no
// session to bill, so its "Get Creator" button has only ever sent people to
// sign in at '/'. Until 2026-10-01 nothing remembered why. The new account
// landed on a seeded board with no buy button anywhere in sight — the upgrade
// chip waits for a real body of work — so the one click on the public site that
// says "I want to pay" dead-ended in the free product, and paying meant finding
// Settings → Plan & billing on your own.
//
// So the click is written down here, and the signed-in app reads it back and
// opens the Creator offer (useCreatorIntentResume). Nothing about the offer
// changes: the same modal, the same server-decided trial rule (a brand-new
// account is not eligible — the trial is for a real body of work), the same
// checkout. This only stops the intent from being thrown away.
//
// localStorage, not a URL parameter: sign-in emails a code AND a magic link,
// and the link redirects to the bare origin (AuthGate's emailRedirectTo), so a
// query string would not survive it. Same reasoning, and same key namespace, as
// AuthGate's PENDING_INVITE_KEY. Same-device only, which is the common case —
// the code is typed on the page that asked for it.
//
// Pure, DOM-free except for the storage it is handed, so it unit-tests under node.

export const CREATOR_INTENT_KEY = 'soleil.boards.pending.creator';

// A day. Long enough for someone who clicked, read the sign-in email over lunch
// and came back; short enough that a click from last week does not ambush a
// returning visitor with a price they had stopped thinking about.
export const CREATOR_INTENT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const PLANS = new Set(['monthly', 'annual']);

function store(storage) {
  if (storage) return storage;
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch (_) { return null; }
}

// The sign-in screen says what is waiting ("Sign in to finish getting Creator
// at $25/mo"), and it must not import billingCopy to do it: AuthGate is the
// first thing '/' paints and stays import-light. So /pricing, which already has
// billingCopy, writes the two labels in with the intent. Read back, they are
// shown only if they still look like a plan name and a price — storage is the
// visitor's own, but a garbled label should vanish rather than render.
const LABEL_RE = /^[\w$.,/ -]{1,40}$/;
const label = (v) => (typeof v === 'string' && LABEL_RE.test(v) ? v : null);

// Returns whether it stuck — a caller has no other way to know storage refused.
export function stashCreatorIntent({ plan, from = 'public_pricing', planName = null, priceLabel = null, now = Date.now() } = {}, storage) {
  const s = store(storage);
  if (!s) return false;
  try {
    s.setItem(CREATOR_INTENT_KEY, JSON.stringify({
      plan: PLANS.has(plan) ? plan : 'monthly',
      from: String(from || 'public_pricing').slice(0, 40),
      planName: label(planName),
      priceLabel: label(priceLabel),
      at: now,
    }));
    return true;
  } catch (_) {
    return false;
  }
}

// The intent, or null if there is none, it is unreadable, or it has expired.
// An expired or malformed entry is removed on read, so it cannot linger.
export function readCreatorIntent({ now = Date.now(), maxAgeMs = CREATOR_INTENT_MAX_AGE_MS } = {}, storage) {
  const s = store(storage);
  if (!s) return null;
  let raw = null;
  try { raw = s.getItem(CREATOR_INTENT_KEY); } catch (_) { return null; }
  if (!raw) return null;
  let v = null;
  try { v = JSON.parse(raw); } catch (_) { v = null; }
  const at = Number(v?.at);
  // Number(null) is 0 and finite — an entry with no timestamp must not read as
  // stamped at the epoch and then "expire" by accident or never.
  const valid = v && v.at !== null && v.at !== undefined && Number.isFinite(at) && PLANS.has(v.plan);
  const age = valid ? now - at : Infinity;
  if (!valid || age < 0 || age > maxAgeMs) {
    clearCreatorIntent(s);
    return null;
  }
  return {
    plan: v.plan, from: v.from || 'public_pricing', ageMs: age,
    planName: label(v.planName), priceLabel: label(v.priceLabel),
  };
}

// Does pressing this CTA mean "the free plan, not Creator"? Then a pending
// intent goes (the docs promise it: Start free, on any page, drops it).
//
// Every landing CTA counts as a signup for CTR (landingMetrics defaults intent
// to 'signup'), but not every one is a FREE START, and a wrong yes here throws
// away the one thing a visitor asked to pay for. Kept: browse links marked
// intent:'nav'; the logo and the docs/changelog "Open Clusters" links, which
// are how people get back into the app; a sign-in link; and a template's "Use
// this template", which adds a template and says nothing about plans.
const KEEPS_INTENT_POS = new Set(['nav', 'brand', 'signin']);
const KEEPS_INTENT_KINDS = new Set(['docs', 'changelog', 'template', 'template_community']);
export function isFreeStartCta(pageKind, pos, extra = null) {
  if (extra?.intent === 'nav') return false;
  if (KEEPS_INTENT_POS.has(String(pos || ''))) return false;
  if (KEEPS_INTENT_KINDS.has(String(pageKind || ''))) return false;
  return true;
}

export function clearCreatorIntent(storage) {
  const s = store(storage);
  if (!s) return;
  try { s.removeItem(CREATOR_INTENT_KEY); } catch (_) { /* nothing to clear */ }
}
