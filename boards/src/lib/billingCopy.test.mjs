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
  capHitSummary,
} from './billingCopy.js';
import { DEMO_CARD_LIMIT, LEGACY_DEMO_CARD_LIMIT } from './demoCardCap.js';

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
  planLabel({ tier: 'demo', demoCardCount: 42, cardLimit: DEMO_CARD_LIMIT }),
  `Free Demo · 42/${DEMO_CARD_LIMIT} cards`,
  'demo label carries the live count',
);
// The cap is per-user since migration 0227. A grandfathered account passes its
// own higher effective_card_limit through, and Settings must show THAT, not the
// new-account default — otherwise every pre-0227 user is told their limit is
// lower than the one actually enforced.
assertEq(
  planLabel({ tier: 'demo', demoCardCount: 42, cardLimit: LEGACY_DEMO_CARD_LIMIT }),
  `Free Demo · 42/${LEGACY_DEMO_CARD_LIMIT} cards`,
  'demo label honors a grandfathered cap',
);
// Referral bonuses ride in on the same field (card_cap_base + bonus_card_credits).
assertEq(
  planLabel({ tier: 'demo', demoCardCount: 42, cardLimit: DEMO_CARD_LIMIT + 25 }),
  `Free Demo · 42/${DEMO_CARD_LIMIT + 25} cards`,
  'demo label honors referral bonus cards',
);
// No limit resolved yet (useMyTier placeholder) — fall back to the conservative
// new-account cap rather than inventing a bigger one.
assertEq(
  planLabel({ tier: 'demo', demoCardCount: 42 }),
  `Free Demo · 42/${DEMO_CARD_LIMIT} cards`,
  'demo label falls back to DEMO_CARD_LIMIT when no cap is threaded',
);
assertEq(planBilling('annual').save, 'Save $60/yr', 'annual savings line');
assertEq(planBilling('monthly').save, null, 'monthly has no savings line');

// --- capHitSummary ---------------------------------------------------------
// Degrades a clause at a time. The failure mode to avoid is telling someone
// who has uploaded nothing that they've built "0 B of files" at the exact
// moment we're asking them for money.
assertEq(capHitSummary({ cards: 100, clusters: 2, storageBytes: 244318208 }),
  '100 cards, 2 clusters · 233 MB of files', 'full summary');
assertEq(capHitSummary({ cards: 1, clusters: 1, storageBytes: 0 }),
  '1 card · 1 cluster', 'singulars, and zero bytes is omitted entirely');
assertEq(capHitSummary({ cards: 40 }), '40 cards', 'cards alone');
assertEq(capHitSummary({ cards: 40, clusters: 0, storageBytes: null }), '40 cards',
  'zero clusters is omitted rather than printed');
assertEq(capHitSummary({}), null, 'nothing to say → null, so the caller renders no line');
assertEq(capHitSummary(), null, 'no argument at all → null');
assertEq(capHitSummary({ cards: NaN, storageBytes: 'abc' }), null, 'junk input → null');
assert(/1\.4 GB/.test(capHitSummary({ cards: 5, storageBytes: 1503238553 })), 'GB rounds to one decimal');
assert(/12 GB/.test(capHitSummary({ cards: 5, storageBytes: 12884901888 })), 'double-digit GB drops the decimal');

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
