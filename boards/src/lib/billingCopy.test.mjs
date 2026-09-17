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
  PRICING,
  SAVINGS_PCT_LABEL,
  CREATOR_STORAGE_LABEL,
  PRICING_META_DESCRIPTION,
  planLabel,
  planBilling,
  capHitSummary,
  CTA,
  CREATOR_TRIAL_DAYS,
  PRICE_FROM_LABEL,
  TRIAL_FROM_LABEL,
  firstValueSentence,
  nearCapSentence,
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
// 'Edit Mode' and 'unlimited boards' lived on for months in the Worker's
// /pricing SERP description precisely because it bypassed this module — it is
// now PRICING_META_DESCRIPTION here, and both phrasings are banned.
const BANNED = [
  /edit access/i, /edit mode/i, /unlimited boards/i,
  /virtual \+ social/i, /creative tool, unlocked/i,
];
for (const pattern of BANNED) {
  assert(
    !CREATOR_FEATURES.some((f) => pattern.test(f)),
    `no Creator bullet matches ${pattern} (unimplemented or free-tier claim)`,
  );
  assert(
    !pattern.test(PRICING_META_DESCRIPTION),
    `/pricing meta description does not match ${pattern}`,
  );
}
assert(
  !DEMO_FEATURES.some((f) => /view mode only/i.test(f)),
  'demo tier is not described as view-only (0188 made editing free)',
);

// --- the workspace-scope line says SCOPE, not access or seats ---------------
// One subscription raising the ceiling for everyone in the workspace is real
// (0187 keys every gate to workspaces.created_by) and is the only line here a
// per-seat competitor cannot match. But it sits one word away from the claim
// this file already had to delete: editing is free for every tier (0188), and
// so are unlimited collaborators (collab_free_editor_cap is null). Selling
// either of those back as a Creator feature is the exact mistake 'edit access'
// was, so pin the shape of the line rather than trusting a future editor.
const scopeLine = CREATOR_FEATURES.find((f) => /workspace/i.test(f));
assert(scopeLine, 'a Creator bullet states the workspace-wide scope of the limits');
assert(
  /limits/i.test(scopeLine),
  'the workspace bullet sells the LIMITS carrying over, which is what is paid-only',
);
assert(
  !/\bfree\b|\bseats?\b|\binvite (?:them|people) free\b/i.test(scopeLine),
  'the workspace bullet does not sell free collaboration or seat count — both are free on every tier',
);
assert(
  CREATOR_FEATURE_KEYS[CREATOR_FEATURES.indexOf(scopeLine)] === 'workspace',
  'the workspace bullet keeps the stable up_feature_hover key "workspace"',
);

// --- the SERP description states only live, tested figures ------------------
assert(
  PRICING_META_DESCRIPTION.includes(PRICING.monthly.billedLabel),
  '/pricing meta description quotes the live monthly price',
);
assert(
  PRICING_META_DESCRIPTION.includes(CREATOR_STORAGE_LABEL),
  '/pricing meta description quotes the live storage figure',
);
assert(
  PRICING_META_DESCRIPTION.includes(String(DEMO_CARD_LIMIT)),
  '/pricing meta description quotes the live demo card limit',
);

// --- savings figures are arithmetic, never typed ----------------------------
assertEq(
  PRICING.annual.savings,
  `$${PRICING.monthly.perMonth * 12 - PRICING.annual.billed}/yr`,
  'annual savings derives from PRICING',
);
assertEq(
  SAVINGS_PCT_LABEL,
  `Save ${Math.round((1 - PRICING.annual.perMonth / PRICING.monthly.perMonth) * 100)}%`,
  'savings badge derives from PRICING',
);
assertEq(
  PRICING.annual.perMonth * 12,
  PRICING.annual.billed,
  'annual per-month and billed figures agree',
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
// The cap is per-user since migration 0229. A grandfathered account passes its
// own higher effective_card_limit through, and Settings must show THAT, not the
// new-account default — otherwise every pre-0229 user is told their limit is
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

// --- the ambient offer -----------------------------------------------------
//
// The three ambient surfaces (chip pill, first-value banner, approaching-limit
// toast) lead with the TRIAL when the viewer is eligible and the PRICE when
// they are not. Before studio_v4 the trial existed in exactly one rendering
// component — PricingModal — so it was only discoverable by clicking through,
// and only a small fraction of the people who saw a price ever saw it.
//
// These guards exist because the failure is silent in both directions: a trial
// variant that leaks a price reads as a discount, and a price variant that
// leaks trial wording promises something the server will refuse.
// The day count is a FACT, injected into the docs and put on the Stripe session
// by the edge function. A typed "14" here is how those three drift apart.
assert(
  TRIAL_FROM_LABEL.includes(String(CREATOR_TRIAL_DAYS)),
  'the trial label is built from CREATOR_TRIAL_DAYS, not a typed number',
);
assert(
  CTA.tryCreatorShort.includes('free') && !/\d/.test(CTA.tryCreatorShort),
  'the compact trial CTA says free and carries no number (the copy beside it does)',
);

// No price may appear in a trial variant. `$` is the tell: PRICE_FROM_LABEL is
// built from PRICING and always carries one.
for (const [name, text] of [
  ['chip label', TRIAL_FROM_LABEL],
  ['first-value banner', firstValueSentence(true)],
  ['near-cap toast', nearCapSentence({ count: 45, limit: 50, trialOffer: true })],
]) {
  assert(!text.includes('$'), `${name}: the trial variant names no price`);
  assert(
    text.toLowerCase().includes('free'),
    `${name}: the trial variant actually says free`,
  );
}

// …and the non-trial variants must still carry the number. This is the half
// that regressed silently before the price landed on these surfaces at all.
for (const [name, text] of [
  ['chip label', PRICE_FROM_LABEL],
  ['first-value banner', firstValueSentence(false)],
  ['near-cap toast', nearCapSentence({ count: 45, limit: 50, trialOffer: false })],
]) {
  assert(text.includes('$'), `${name}: the non-trial variant carries the price`);
}

// The toast states the user's own position on both variants — it is the one
// ambient surface that is genuinely about the ceiling.
for (const trialOffer of [true, false]) {
  assert(
    nearCapSentence({ count: 45, limit: 50, trialOffer }).includes('45/50'),
    `near-cap toast names the live count (trial=${trialOffer})`,
  );
  // The free route to the same outcome stays on offer beside the paid one.
  assert(
    nearCapSentence({ count: 45, limit: 50, trialOffer }).includes('invite'),
    `near-cap toast keeps the referral alternative (trial=${trialOffer})`,
  );
}

// The two variants must actually differ, in every case. A helper that returned
// the same sentence either way would pass every assertion above.
assert(TRIAL_FROM_LABEL !== PRICE_FROM_LABEL, 'chip variants differ');
assert(firstValueSentence(true) !== firstValueSentence(false), 'banner variants differ');
assert(
  nearCapSentence({ count: 1, limit: 2, trialOffer: true })
    !== nearCapSentence({ count: 1, limit: 2, trialOffer: false }),
  'toast variants differ',
);

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
