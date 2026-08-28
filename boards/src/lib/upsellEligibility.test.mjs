// upsellEligibility.test.mjs
//
// Unit test for evaluateUpsell. Run with:
//   cd boards && node src/lib/upsellEligibility.test.mjs
//
// Plain Node ESM, no test framework — exit code 0 on pass, non-zero on failure
// (matches demoCardCap.test.mjs). The predicate is pure, so no backend.

import { evaluateUpsell, workFloor, THRESHOLDS, ELIGIBILITY_REV, nearCapAt, shouldWarnNearCap, atCapWall } from './upsellEligibility.js';

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
assertEq(demo({ demoCardCount: 20, accountAgeDays: 2 }).reason, 'low_intensity',
  'over the floor but young and not invested → low_intensity');

// --- the three qualifying rules -------------------------------------------
let r = demo({ demoCardCount: 40, accountAgeDays: 0 });
assert(r.eligible && r.reason === 'invested', '40/100 on day zero still qualifies (invested)');
r = demo({ demoCardCount: 39, accountAgeDays: 0 });
assert(!r.eligible, '39/100 on day zero does not (just under the 40% line)');

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

// --- thresholds are cap-RELATIVE ------------------------------------------
// The same absolute count means different things under different caps; this is
// what lets the cap move without silently re-timing the whole pitch.
assertEq(workFloor(100), 10, 'floor at cap 100');
assertEq(workFloor(40), 5, 'floor at cap 40 clamps to the minimum');
assertEq(workFloor(500), 50, 'floor at cap 500');
assert(demo({ demoCardCount: 45, cardLimit: 100, accountAgeDays: 0 }).eligible,
  '45/100 is invested');
assert(!demo({ demoCardCount: 45, cardLimit: 200, accountAgeDays: 0 }).eligible,
  '45/200 is only 22% — the SAME count is not invested under a larger cap');
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
assert(THRESHOLDS.countFrac < THRESHOLDS.urgentFrac, 'count threshold sits below urgent');
assert(THRESHOLDS.investedFrac <= THRESHOLDS.countFrac,
  'a user can be eligible before the chip starts showing a count');

// --- the approaching-limit warning is a CROSSING, not an equality ----------
// This is the whole reason shouldWarnNearCap exists. The old inline rule was
// `count === nearCapAt(limit)`, which needs the counter to land exactly on the
// line. It doesn't: it comes from a cached RPC and moves in jumps, so the
// warning almost never fired even for users who went on to hit the cap.
assertEq(nearCapAt(50), 45, 'the line sits at 90% of a 50 cap');
assertEq(nearCapAt(100), 90, 'and at 90 for the grandfathered 100 cap');

const warn = (over) => shouldWarnNearCap({ limit: 50, warnedAtLimit: 0, ...over });

assert(warn({ count: 44, adding: 1 }), 'stepping 44 → 45 lands on the line and warns');
assert(warn({ count: 43, adding: 6 }),
  'JUMPING 43 → 49 skips the line entirely and must STILL warn (the old equality did not)');
assert(warn({ count: 0, adding: 46 }), 'one big drop from empty past the line warns');
assert(!warn({ count: 40, adding: 1 }), '41/50 is short of the line');
assert(!warn({ count: 44, adding: 0 }), 'an add of nothing warns about nothing');

// At the wall it is a block, and a block gets the modal — warning there would
// stack two interruptions on the same action.
assert(!warn({ count: 50, adding: 1 }), 'already at the cap is a block, not a warning');
assert(!warn({ count: 61, adding: 1 }), 'over the cap (it can move down) is not a warning either');

// The latch. A jump can only be caught once, so without this the warning would
// repeat on every subsequent add.
assert(!warn({ count: 46, adding: 1, warnedAtLimit: 50 }), 'already warned at this ceiling');
assert(warn({ count: 46, adding: 1, warnedAtLimit: 100 }),
  'a DIFFERENT ceiling re-arms it — raising the cap earns a fresh warning');
assert(warn({ count: 91, adding: 1, limit: 100, warnedAtLimit: 50 }),
  'and the grandfathered cap warns on its own line, not the new-account one');

// --- junk never throws into an add path ------------------------------------
for (const bad of [null, undefined, {}, { count: 1 }, { limit: 0 }, { limit: -5, count: 1 },
                   { limit: 50, count: NaN }, { limit: 50, count: 44, adding: NaN }]) {
  assert(shouldWarnNearCap(bad) === false, `junk input is silent: ${JSON.stringify(bad)}`);
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
