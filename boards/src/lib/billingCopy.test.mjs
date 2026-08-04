// billingCopy.test.mjs
//
// Guards on the pitch copy. Run with:
//   cd boards && node src/lib/billingCopy.test.mjs
//
// Plain Node ESM, no test framework — exit code 0 on pass, non-zero on failure
// (matches demoCardCap.test.mjs). billingCopy is pure data + pure functions.
//
// The lockstep assertion is the load-bearing one: PricingBits stamps
// data-up-featkey={CREATOR_FEATURE_KEYS[i]} onto each rendered feature row, so
// a keys array shorter than the copy array silently emits `undefined` keys into
// up_feature_hover and quietly corrupts the upsell scorecard.

import {
  CREATOR_FEATURES,
  CREATOR_FEATURE_KEYS,
  LEGACY_FEATURE_KEYS,
  DEMO_FEATURES,
  COPY_REV,
  planLabel,
  planBilling,
} from './billingCopy.js';

let failed = 0;
let passed = 0;
function assert(cond, msg) {
  if (!cond) { console.error(`FAIL: ${msg}`); failed++; } else { passed++; }
}
function assertEq(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) {
    console.error(`FAIL: ${msg}\n  expected: ${b}\n  actual:   ${a}`);
    failed++;
  } else {
    passed++;
  }
}

// --- the lockstep contract -------------------------------------------------
assertEq(
  CREATOR_FEATURES.length,
  CREATOR_FEATURE_KEYS.length,
  'CREATOR_FEATURES and CREATOR_FEATURE_KEYS are the same length',
);
assert(
  CREATOR_FEATURE_KEYS.every((k) => typeof k === 'string' && k.length > 0),
  'every feature key is a non-empty string',
);
assertEq(
  new Set(CREATOR_FEATURE_KEYS).size,
  CREATOR_FEATURE_KEYS.length,
  'feature keys are unique',
);

// Retired keys must not silently come back as live ones — the scorecard treats
// the two sets as disjoint when rendering historical hover rows.
assert(
  !CREATOR_FEATURE_KEYS.some((k) => LEGACY_FEATURE_KEYS.includes(k)),
  'live feature keys do not collide with retired ones',
);

// --- claims that must never return ----------------------------------------
// Each of these was shipped and was false: 'edit access' became free for every
// tier in migration 0188, and the other two never had an implementation at all.
const BANNED = [/edit access/i, /virtual \+ social/i, /creative tool, unlocked/i];
for (const pattern of BANNED) {
  assert(
    !CREATOR_FEATURES.some((f) => pattern.test(f)),
    `no Creator bullet matches ${pattern} (unimplemented or free-tier claim)`,
  );
}
assert(
  !DEMO_FEATURES.some((f) => /view mode only/i.test(f)),
  'demo tier is not described as view-only (0188 made editing free)',
);

// --- shape sanity ----------------------------------------------------------
assert(CREATOR_FEATURES.length >= 2, 'Creator pitch has at least two bullets');
assert(DEMO_FEATURES.length >= 1, 'Demo tier lists at least one line');
assert(typeof COPY_REV === 'string' && COPY_REV.length > 0, 'COPY_REV is set');

// --- planLabel / planBilling ----------------------------------------------
assertEq(planLabel({ tier: 'admin' }), 'Admin · Unlimited', 'admin plan label');
assertEq(
  planLabel({ tier: 'paid', grantBacked: true }),
  'Creator · Complimentary',
  'grant-backed paid label is honest about being comped',
);
assertEq(
  planLabel({ tier: 'demo', demoCardCount: 42 }),
  'Free Demo · 42/100 cards',
  'demo label carries the live count',
);
assertEq(planBilling('annual').save, 'Save $60/yr', 'annual savings line');
assertEq(planBilling('monthly').save, null, 'monthly has no savings line');

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
