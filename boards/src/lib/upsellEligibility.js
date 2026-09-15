// upsellEligibility — decides whether a demo user should be shown the upgrade
// pitch at all, and how much pressure it should carry.
//
// Why this exists: the upgrade chip mounted for every demo user from card #1,
// so the pitch's median viewer had a handful of cards and had signed up the
// same day. Those exposures were dismissed in a few seconds with zero feature
// rows read — the pitch was being spent on people who had no reason to want it
// yet, which trains the dismissal reflex before it can ever land.
//
// Two ideas the module keeps separate:
//   • ELIGIBLE — has this person invested enough that an upgrade ask is a fair
//     question? Below this, show nothing at all.
//   • PRESSURE — given they're eligible, how close are they to the wall? Drives
//     whether the chip is a quiet label, a meter, or a warning. A meter is
//     information; a price is a request. Don't send the request early.
//
// Thresholds are expressed as FRACTIONS of the live cap, not absolute card
// counts, so changing the cap re-targets everything automatically instead of
// silently making the pitch earlier or later.
//
// Pure and dependency-free (mirrors demoCardCap.js) so it is unit-testable
// under node with no React/Yjs/backend — see the sibling .test.mjs.

// Bump when the thresholds move; rides along in the telemetry so a change in
// suppression can be attributed to the rule rather than to user behavior.
//   e1 — invested at 40% of the cap; warning line shared with the chip's 90%.
//   e2 — invested at 25% OR an absolute body of work (investedMin), and the
//        approaching-limit warning moved to its own 80% line. The e1 rules
//        held the pitch back from most of the people who went on to build a
//        real board: under e1 more than half of the accounts that reached
//        thirteen cards had never been shown a price, and the warning had
//        reached a handful of people in the product's history.
export const ELIGIBILITY_REV = 'e2';

export const THRESHOLDS = Object.freeze({
  investedFrac: 0.25,  // used ≥25% of the cap → they've committed real work…
  investedMin:  13,    // …or an absolute body of work, whatever the cap (the
                       // depth at which people go on to keep a board; a
                       // grandfathered 100-cap account at 13 cards is as
                       // committed as a 50-cap account at 13)
  retainedDays: 7,     // account this old, with a real body of work, counts too
  floorFrac:    0.10,  // "a real body of work" = 10% of the cap…
  floorMin:     5,     // …but never fewer than 5 cards
  habitDays:    3,     // distinct active days (optional signal; see below)
  countFrac:    0.50,  // at/above this the chip shows the count
  warnFrac:     0.80,  // at/above this the approaching-limit warning fires
  urgentFrac:   0.90,  // at/above this the chip goes urgent
});

// The card count that counts as "a real body of work" for the given cap.
export function workFloor(cardLimit) {
  return Math.max(THRESHOLDS.floorMin, Math.round(cardLimit * THRESHOLDS.floorFrac));
}

// The count at which the chip goes urgent ("N cards left").
//
// This was a hardcoded `cap - 10` in App.jsx — which, against the 100-card cap it
// was written for, is exactly the 90% urgentFrac line the chip already used. The
// cap is per-user since 0229, so the literal had to become the fraction it always
// was: at a 100-card cap this returns 90, bit-identical to the old arithmetic;
// at 50 it returns 45 instead of the 40 the literal would have given.
export function nearCapAt(cardLimit) {
  const n = Number(cardLimit);
  if (!Number.isFinite(n) || n <= 0) return Infinity;   // unknown cap → never fire
  return Math.max(1, Math.round(n * THRESHOLDS.urgentFrac));
}

// The count at which the approaching-limit warning fires — one beat BEFORE
// the chip goes urgent. Under e1 the warning shared the chip's 90% line, and
// most people who reached it did so inside a single drop that carried them
// straight past the wall; 80% leaves a real gap between "you are close" and
// "you are stopped".
export function warnCapAt(cardLimit) {
  const n = Number(cardLimit);
  if (!Number.isFinite(n) || n <= 0) return Infinity;   // unknown cap → never fire
  return Math.max(1, Math.round(n * THRESHOLDS.warnFrac));
}

// Should this add fire the approaching-limit warning?
//
// The caller used to inline `count === nearCapAt(limit)`. That is an equality
// test against a number that arrives from a cached RPC and advances in jumps —
// dropping ten images moves it by ten — so landing exactly on the line is a
// coincidence, and near-cap warnings are correspondingly almost absent from the
// telemetry next to the cap hits they are supposed to precede.
//
// The rule is a CROSSING, not an equality, and it needs the caller's latch
// (`warnedAtLimit`) because a jump can clear the line in one step and there is
// no later moment to catch it. Keying the latch on the limit rather than a
// boolean means raising the cap re-arms the warning for the new ceiling.
//
//   count        cards already counted against the cap
//   limit        the effective cap
//   adding       how many this operation would add (default 1)
//   warnedAtLimit the limit we last warned at, or 0/null for never
export function shouldWarnNearCap(opts) {
  // A destructuring default only covers `undefined`; every add path can hand us
  // a null cap source, and this must never throw into a card create.
  const { count, limit, adding = 1, warnedAtLimit = 0 } = opts || {};
  const cap  = Number(limit);
  const have = Number(count);
  const add  = Number(adding);
  if (!Number.isFinite(cap) || cap <= 0) return false;
  if (!Number.isFinite(have) || have < 0) return false;
  if (!Number.isFinite(add) || add <= 0) return false;
  const near = warnCapAt(cap);
  if (!Number.isFinite(near)) return false;
  if (have >= cap) return false;             // at the wall already — that's a block, not a warning
  if (have + add < near) return false;       // not there yet
  return Number(warnedAtLimit) !== cap;      // already said it for this ceiling
}

// Is this user ALREADY standing past the warning line, with no add in flight?
//
// The add-path rule above only fires while a card is being placed, so someone
// who filled a board in one sitting and came back the next day at 41/50 —
// four of the most committed accounts in the product sat at 92–99% of their
// cap for weeks — is never warned: nothing they do on that visit is an add.
// This is the reconcile-path rule: evaluated when the server's count lands,
// it says whether the warning is owed right now. Same latch, same silence at
// the wall (a block owns that moment), same junk tolerance.
export function shouldWarnNearCapNow(opts) {
  const { count, limit, warnedAtLimit = 0 } = opts || {};
  const cap  = Number(limit);
  const have = Number(count);
  if (!Number.isFinite(cap) || cap <= 0) return false;
  if (!Number.isFinite(have) || have < 0) return false;
  const near = warnCapAt(cap);
  if (!Number.isFinite(near)) return false;
  if (have >= cap) return false;
  if (have < near) return false;
  return Number(warnedAtLimit) !== cap;
}

// Is this user standing AT the wall right now (their next card gets refused)?
//
// Deliberately NOT part of evaluateUpsell. At 100% of the cap a user is
// maximally `invested`, so eligibility is exactly right to be true and the
// upgrade chip should be at its loudest — folding this in would switch the chip
// off at the one moment it is most earned.
//
// It exists for the first-value banner, whose sentence ("You're building
// something") is simply the wrong one to hand somebody whose card was just
// refused; the cap-hit modal owns that moment and says something accurate.
// A bulk import crosses 0% to 100% in a single second, so the two surfaces
// otherwise fire within a few seconds of each other — which is what the live
// telemetry showed.
export function atCapWall(opts) {
  // Callers sit on render paths where a throw takes the canvas out, and a
  // destructuring default covers `undefined` but never `null`.
  const { demoCardCount, cardLimit } = opts || {};
  const limit = Number(cardLimit);
  const cards = Number(demoCardCount);
  if (!Number.isFinite(limit) || limit <= 0) return false;  // unknown cap → never claim the wall
  if (!Number.isFinite(cards) || cards < 0) return false;
  return cards >= limit;
}

// evaluateUpsell({ tier, demoCardCount, cardLimit, accountAgeDays, activeDays })
//   -> { eligible, pressure, reason, capFrac, capPct }
//
// `activeDays` is OPTIONAL. It is the one signal that needs a server round-trip
// (user_active_day), and against the current population it qualifies nobody the
// other two rules miss — so nothing depends on it. It is honored when supplied
// so a future caller can feed it without touching this module.
//
// Fails CLOSED: an unresolved tier or unknown cap yields ineligible. Pitching
// on placeholder data is how the previous version recorded made-up cap
// percentages, and a missing pitch is cheaper than a wrong one.
export function evaluateUpsell({
  tier,
  demoCardCount,
  cardLimit,
  accountAgeDays,
  activeDays,
} = {}) {
  const none = (reason) => ({ eligible: false, pressure: 'none', reason, capFrac: null, capPct: null });

  if (tier !== 'demo') return none('not_demo');

  const limit = Number(cardLimit);
  if (!Number.isFinite(limit) || limit <= 0) return none('cap_unknown');

  const cards = Math.max(0, Number(demoCardCount) || 0);
  const age   = Math.max(0, Number(accountAgeDays) || 0);
  const days  = Math.max(0, Number(activeDays) || 0);

  const capFrac = cards / limit;
  const capPct  = Math.round(capFrac * 100);
  const floor   = workFloor(limit);

  // Invested by fraction OR by an absolute body of work: the cap is per-user
  // (50 new, 100 grandfathered, plus referral credits), and a fraction alone
  // made the same thirteen cards "committed" under one cap and "not yet"
  // under another. Thirteen is where people go on to keep the board.
  const invested = capFrac >= THRESHOLDS.investedFrac || cards >= THRESHOLDS.investedMin;
  const retained = age >= THRESHOLDS.retainedDays && cards >= floor;
  const habit    = days >= THRESHOLDS.habitDays && cards >= floor;

  if (!invested && !retained && !habit) {
    // Ordered most-specific first so suppression is diagnosable in the data:
    // "nobody converts" and "nobody was ever asked" look identical otherwise.
    let reason;
    if (cards === 0)                      reason = 'no_cards';
    else if (age < 1 && days < 2)         reason = 'same_day';
    else if (cards < floor)               reason = 'below_floor';
    else                                  reason = 'low_intensity';
    return { eligible: false, pressure: 'none', reason, capFrac, capPct };
  }

  const pressure = capFrac >= THRESHOLDS.urgentFrac ? 'urgent'
                 : capFrac >= THRESHOLDS.countFrac  ? 'count'
                 : 'neutral';

  return {
    eligible: true,
    pressure,
    reason: invested ? 'invested' : retained ? 'retained' : 'habit',
    capFrac,
    capPct,
  };
}
