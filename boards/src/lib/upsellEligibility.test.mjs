// upsellEligibility.test.mjs
//
// Unit test for evaluateUpsell. Run with:
//   cd boards && node src/lib/upsellEligibility.test.mjs
//
// Plain Node ESM, no test framework — exit code 0 on pass, non-zero on failure
// (matches demoCardCap.test.mjs). The predicate is pure, so no backend.

import {
  evaluateUpsell, workFloor, THRESHOLDS, ELIGIBILITY_REV,
  nearCapAt, warnCapAt, shouldWarnNearCap, shouldWarnNearCapNow, atCapWall,
} from './upsellEligibility.js';

let failed = 0;
let passed = 0;
function assertEq(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) { console.error(`FAIL: ${msg}\n  expected: ${b}\n  actual:   ${a}`); failed++; }
  else passed++;
}
function assert(cond, msg) {
  if (!cond) { console.error(`FAIL: ${msg}`); failed++; } else { passed++; }
}

const demo = (over) => evaluateUpsell({ tier: 'demo', cardLimit: 100, accountAgeDays: 0, ...over });

// --- fails closed ----------------------------------------------------------
for (const tier of ['paid', 'admin', 'waitlist', null, undefined]) {
  assertEq(evaluateUpsell({ tier, demoCardCount: 90, cardLimit: 100 }).reason, 'not_demo',
    `tier ${tier} is never pitched`);
}
for (const cardLimit of [null, undefined, 0, -5, NaN, 'abc']) {
  const r = demo({ demoCardCount: 90, cardLimit });
  assertEq(r.reason, 'cap_unknown', `cap ${cardLimit} → cap_unknown`);
  assertEq(r.eligible, false, `cap ${cardLimit} → not eligible`);
  assertEq(r.capPct, null, `cap ${cardLimit} → capPct stays null, never a made-up number`);
}
assertEq(evaluateUpsell({}).eligible, false, 'empty input is ineligible');

// --- suppression reasons, most specific first ------------------------------
assertEq(demo({ demoCardCount: 0 }).reason, 'no_cards', 'zero cards → no_cards');
assertEq(demo({ demoCardCount: 3, accountAgeDays: 0 }).reason, 'same_day', 'day-zero user → same_day');
assertEq(demo({ demoCardCount: 3, accountAgeDays: 30 }).reason, 'below_floor', 'old but 3 cards → below_floor');
assertEq(demo({ demoCardCount: 11, accountAgeDays: 2 }).reason, 'low_intensity',
  'over the floor but young and not invested → low_intensity');

// --- the three qualifying rules -------------------------------------------
let r = demo({ demoCardCount: 40, accountAgeDays: 0 });
assert(r.eligible && r.reason === 'invested', '40/100 on day zero still qualifies (invested)');
r = demo({ demoCardCount: 25, accountAgeDays: 0 });
assert(r.eligible && r.reason === 'invested', '25/100 on day zero qualifies — the fraction line is 25%');
r = demo({ demoCardCount: 12, accountAgeDays: 0 });
assert(!r.eligible, '12/100 on day zero does not (12% and under the absolute floor)');
assertEq(r.reason, 'same_day', 'and the recorded reason is the day, not the count');
// The absolute body-of-work rule. Under e1 thirteen cards was "committed" under
// a 50 cap and "not yet" under the grandfathered 100 — the same board.
r = demo({ demoCardCount: 13, accountAgeDays: 0 });
assert(r.eligible && r.reason === 'invested', '13/100 on day zero qualifies by the absolute floor');
r = demo({ demoCardCount: 13, cardLimit: 200, accountAgeDays: 0 });
assert(r.eligible && r.reason === 'invested', '13/200 qualifies too — a body of work is a body of work under any cap');
r = demo({ demoCardCount: 12, cardLimit: 200, accountAgeDays: 0 });
assert(!r.eligible, '12/200 is 6% and one short of the absolute floor');

r = demo({ demoCardCount: 10, accountAgeDays: 7 });
assert(r.eligible && r.reason === 'retained', '10 cards + 7 days qualifies (retained)');
r = demo({ demoCardCount: 9, accountAgeDays: 7 });
assert(!r.eligible, '9 cards is under the floor of 10 for a cap of 100');
r = demo({ demoCardCount: 10, accountAgeDays: 6 });
assert(!r.eligible, '6 days is under the retention window');

r = demo({ demoCardCount: 10, accountAgeDays: 0, activeDays: 3 });
assert(r.eligible && r.reason === 'habit', 'activeDays is honored when supplied');
r = demo({ demoCardCount: 10, accountAgeDays: 0 });
assert(!r.eligible, 'omitting activeDays does not accidentally qualify anyone');

// --- pressure ladder -------------------------------------------------------
assertEq(demo({ demoCardCount: 40, accountAgeDays: 0 }).pressure, 'neutral', '40% → neutral');
assertEq(demo({ demoCardCount: 50, accountAgeDays: 0 }).pressure, 'count',   '50% → count');
assertEq(demo({ demoCardCount: 89, accountAgeDays: 0 }).pressure, 'count',   '89% → still count');
assertEq(demo({ demoCardCount: 90, accountAgeDays: 0 }).pressure, 'urgent',  '90% → urgent');
assertEq(demo({ demoCardCount: 100, accountAgeDays: 0 }).pressure, 'urgent', 'at the cap → urgent');
assertEq(demo({ demoCardCount: 0 }).pressure, 'none', 'ineligible users have no pressure');

// --- thresholds are cap-RELATIVE, with one absolute floor ------------------
// The fraction lets the cap move without silently re-timing the whole pitch;
// the absolute floor stops a bigger cap from hiding a real board.
assertEq(workFloor(100), 10, 'floor at cap 100');
assertEq(workFloor(40), 5, 'floor at cap 40 clamps to the minimum');
assertEq(workFloor(500), 50, 'floor at cap 500');
assert(demo({ demoCardCount: 10, cardLimit: 40, accountAgeDays: 0 }).eligible,
  '10/40 is 25% — invested by fraction under a small cap even below the absolute floor');
assert(!demo({ demoCardCount: 9, cardLimit: 40, accountAgeDays: 0 }).eligible,
  '9/40 is 22.5% — not yet');
assertEq(demo({ demoCardCount: 20, cardLimit: 40, accountAgeDays: 0 }).pressure, 'count',
  '20/40 is 50% → count, regardless of the absolute number');

// --- capPct is a real percentage ------------------------------------------
assertEq(demo({ demoCardCount: 50, accountAgeDays: 0 }).capPct, 50, 'capPct 50');
assertEq(demo({ demoCardCount: 33, cardLimit: 99, accountAgeDays: 0 }).capPct, 33, 'capPct rounds');
assert(demo({ demoCardCount: 150, accountAgeDays: 0 }).capPct === 150,
  'over-cap users report >100 rather than clamping (they exist: the cap can move)');

// --- negative / junk numeric input ----------------------------------------
assertEq(demo({ demoCardCount: -5, accountAgeDays: -3 }).reason, 'no_cards', 'negatives floor at zero');

assert(typeof ELIGIBILITY_REV === 'string' && ELIGIBILITY_REV.length > 0, 'ELIGIBILITY_REV is set');
assert(ELIGIBILITY_REV !== 'e1', 'the e2 thresholds carry a new revision marker so suppression can be attributed');
assert(THRESHOLDS.countFrac < THRESHOLDS.urgentFrac, 'count threshold sits below urgent');
assert(THRESHOLDS.investedFrac <= THRESHOLDS.countFrac,
  'a user can be eligible before the chip starts showing a count');
assert(THRESHOLDS.warnFrac < THRESHOLDS.urgentFrac,
  'the approaching-limit warning fires BEFORE the chip goes urgent, not on the same line');
assert(THRESHOLDS.investedMin >= THRESHOLDS.floorMin,
  'the absolute invested floor is never below the body-of-work floor');

// --- two lines: the chip goes urgent at 90%, the warning fires at 80% -------
assertEq(nearCapAt(50), 45, 'the chip goes urgent at 90% of a 50 cap');
assertEq(nearCapAt(100), 90, 'and at 90 for the grandfathered 100 cap');
assertEq(warnCapAt(50), 40, 'the warning line sits at 80% of a 50 cap');
assertEq(warnCapAt(100), 80, 'and at 80 for the grandfathered 100 cap');
assert(warnCapAt(50) < nearCapAt(50), 'warning before urgent, at every cap');

// --- the approaching-limit warning is a CROSSING, not an equality ----------
// This is the whole reason shouldWarnNearCap exists. The old inline rule was
// `count === nearCapAt(limit)`, which needs the counter to land exactly on the
// line. It doesn't: it comes from a cached RPC and moves in jumps, so the
// warning almost never fired even for users who went on to hit the cap.
const warn = (over) => shouldWarnNearCap({ limit: 50, warnedAtLimit: 0, ...over });

assert(warn({ count: 39, adding: 1 }), 'stepping 39 → 40 lands on the line and warns');
assert(warn({ count: 38, adding: 6 }),
  'JUMPING 38 → 44 skips the line entirely and must STILL warn (the old equality did not)');
assert(warn({ count: 0, adding: 41 }), 'one big drop from empty past the line warns');
assert(!warn({ count: 35, adding: 1 }), '36/50 is short of the line');
assert(!warn({ count: 39, adding: 0 }), 'an add of nothing warns about nothing');

// At the wall it is a block, and a block gets the modal — warning there would
// stack two interruptions on the same action.
assert(!warn({ count: 50, adding: 1 }), 'already at the cap is a block, not a warning');
assert(!warn({ count: 61, adding: 1 }), 'over the cap (it can move down) is not a warning either');

// The latch. A jump can only be caught once, so without this the warning would
// repeat on every subsequent add.
assert(!warn({ count: 41, adding: 1, warnedAtLimit: 50 }), 'already warned at this ceiling');
assert(warn({ count: 41, adding: 1, warnedAtLimit: 100 }),
  'a DIFFERENT ceiling re-arms it — raising the cap earns a fresh warning');
assert(warn({ count: 81, adding: 1, limit: 100, warnedAtLimit: 50 }),
  'and the grandfathered cap warns on its own line, not the new-account one');

// --- junk never throws into an add path ------------------------------------
for (const bad of [null, undefined, {}, { count: 1 }, { limit: 0 }, { limit: -5, count: 1 },
                   { limit: 50, count: NaN }, { limit: 50, count: 44, adding: NaN }]) {
  assert(shouldWarnNearCap(bad) === false, `junk input is silent: ${JSON.stringify(bad)}`);
}

// --- the reconcile-path rule: already past the line, nothing being added ----
// A returning user parked at 41/50 does nothing on that visit that counts as
// an add, so the crossing rule can never fire for them; this one can.
const now = (over) => shouldWarnNearCapNow({ limit: 50, warnedAtLimit: 0, ...over });
assert(now({ count: 41 }), '41/50 on arrival is owed the warning');
assert(now({ count: 40 }), 'exactly on the line counts');
assert(!now({ count: 39 }), '39/50 is not there yet');
assert(!now({ count: 50 }), 'at the wall it is a block, not a warning');
assert(!now({ count: 41, warnedAtLimit: 50 }), 'already warned at this ceiling');
assert(now({ count: 41, warnedAtLimit: 100 }), 'a different ceiling re-arms it');
for (const bad of [null, undefined, {}, { count: 41 }, { limit: 0, count: 41 }, { limit: 50, count: NaN }]) {
  assert(shouldWarnNearCapNow(bad) === false, `reconcile rule is silent on junk: ${JSON.stringify(bad)}`);
}

// --- atCapWall -------------------------------------------------------------
// The first-value banner's gate. Separate from eligibility on purpose.
assert(atCapWall({ demoCardCount: 50, cardLimit: 50 }), 'exactly at the cap is the wall');
assert(atCapWall({ demoCardCount: 51, cardLimit: 50 }),
  'over the cap too — an optimistic render can exceed it before the server refuses');
assert(!atCapWall({ demoCardCount: 49, cardLimit: 50 }), 'one short is not the wall');
assert(!atCapWall({ demoCardCount: 0, cardLimit: 50 }), 'a fresh account is not the wall');

// An at-cap user stays maximally ELIGIBLE — the chip must not go quiet at 100%,
// which is why this predicate is not folded into evaluateUpsell.
r = demo({ demoCardCount: 50, cardLimit: 50, accountAgeDays: 0 });
assert(r.eligible && r.reason === 'invested', 'at the cap the user is still eligible');
assertEq(r.pressure, 'urgent', 'and the chip is at its loudest, not switched off');

for (const bad of [null, undefined, {}, { demoCardCount: 10 }, { cardLimit: 0 },
                   { cardLimit: -5, demoCardCount: 10 }, { cardLimit: 50, demoCardCount: NaN },
                   { cardLimit: NaN, demoCardCount: 50 }]) {
  assert(atCapWall(bad) === false, `unknown cap never claims the wall: ${JSON.stringify(bad)}`);
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
