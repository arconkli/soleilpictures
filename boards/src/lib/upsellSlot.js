// upsellSlot — which upgrade surface gets this moment.
//
// Why this exists: a bulk import takes demoCardCount from 3 to the cap in ONE
// second. That single tick crosses upsellEligibility's investedFrac line, so a
// user who was correctly suppressed as `same_day` moments earlier becomes
// eligible at the exact instant the server cap refusal arrives. Three
// independent surfaces then fire within seconds of each other — the invite
// nudge, the first-value banner, and the cap-hit modal — each of them
// individually correct, collectively a pile-up that gets dismissed on sight.
//
// Pairwise coordination already existed but only in ONE direction:
// ReferralNudge deferred to first-value (a `.fv-banner` DOM query plus a
// dispatch timestamp), while first-value deferred to nothing and the cap-hit
// modal — which arrives from a completely different path, the server's
// card-index refusal — deferred to nothing and was deferred to by nobody.
// This module is that guard, made symmetric and shared.
//
// Pure and dependency-free (mirrors upsellEligibility.js and depthDock.js) so
// it is unit-testable under node with no React/DOM — see the sibling .test.mjs.
// A DOM query cannot answer "did something just show" for a surface that has
// not painted yet, which is why the old guard needed a timestamp beside it.

// How long one upsell surface owns the moment. Matches the 60s stacking guard
// this replaces in ReferralNudge — deliberately NOT that component's
// COOLDOWN_MS, which is the seven-day cadence between nudge SHOWS and answers a
// different question.
export const UPSELL_STACK_WINDOW_MS = 60_000;

// The wall is not a promotion, it is a consequence: a user whose card was
// refused is owed the explanation whatever else has just been on screen. Every
// other surface is ambient and can wait for the next card.
const ALWAYS_WINS = 'cap-hit';

// 'share-ask' is ambient like the other two: it offers to show a cluster, and
// an offer can always wait for the next card. It must never land on top of the
// wall — being asked to show off work at the moment you were told you're
// blocked is the worst possible pairing.
//
// 'mix-prompt' is ambient for the same reason, and belongs here specifically
// because of WHEN it becomes eligible: it triggers on a board going image-heavy
// with no writing on it, which is precisely what a bulk import does in a single
// tick — the same tick that crosses the cap and the investedFrac line. Without
// a claim it would join the exact pile-up this module was written to stop.
// 'return-reason' is ambient like the rest, and belongs here for the same
// reason share-ask does: it is a request for the user's attention that can
// always wait for another day. It is also the only one that arrives on a
// TIMER rather than off a card count, so without a claim it would be the one
// surface capable of landing on top of any of the others at random.
const KINDS = new Set([ALWAYS_WINS, 'first-value', 'invite-nudge', 'share-ask', 'mix-prompt', 'return-reason']);

// Module scope = page lifetime, like boardsApi's _capAnnounced. No auth reset
// is wired for it on purpose: the claim self-expires in a minute, so the worst
// a stale one can do after a user switch is defer an ambient nudge by <60s.
let lastClaim = { kind: null, at: 0 };

// A destructuring/parameter default only covers `undefined`, never `null`, and
// `Number(null)` is a perfectly finite 0 — which would silently record a claim
// at the epoch. A clock argument degrades to the real clock rather than failing
// closed: refusing on a bad timestamp would suppress a surface, which is the
// more expensive mistake.
function resolveNow(now) {
  // null must be tested BEFORE the finite check: Number(null) is 0, which is
  // finite, so a null clock would otherwise record a claim at the epoch and the
  // slot would read as free forever after. Caught by the unit test.
  if (now === null || now === undefined) return Date.now();
  const t = Number(now);
  return Number.isFinite(t) ? t : Date.now();
}

// Is a surface currently holding the moment?
//
// Non-mutating, so a caller can branch on it without consuming the slot — the
// mistake that killed the first-value banner permanently in a previous pass was
// exactly this shape (a gate that burned a one-shot just by asking).
export function upsellSlotBusy(now = Date.now()) {
  if (!lastClaim.kind) return false;
  const elapsed = resolveNow(now) - lastClaim.at;
  return elapsed >= 0 && elapsed < UPSELL_STACK_WINDOW_MS;
}

// Try to take the moment for `kind`. Returns true if the surface should show.
//
// IMPORTANT for callers with a once-per-account one-shot: a `false` here must
// return BEFORE any stamp is written. Deferring is not declining — App
// re-dispatches the first-value signal on every card change, so a surface that
// stands down here simply arrives at the next card. Burning the one-shot on a
// deferral would retire the surface for that account forever.
export function claimUpsellSlot(kind, now = Date.now()) {
  if (!KINDS.has(kind)) return false;            // fail closed on a typo'd kind
  const t = resolveNow(now);

  // The wall always shows, and still claims — so the ambient surfaces stand
  // down around it rather than stacking on top of the explanation.
  if (kind === ALWAYS_WINS) {
    lastClaim = { kind, at: t };
    return true;
  }

  if (upsellSlotBusy(t)) return false;
  lastClaim = { kind, at: t };
  return true;
}

// Test seam. Also the honest way to express "this is module state" rather than
// letting a test reach in and mutate the binding.
export function __resetUpsellSlot() {
  lastClaim = { kind: null, at: 0 };
}
