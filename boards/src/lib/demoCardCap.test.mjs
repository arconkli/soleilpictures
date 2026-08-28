// demoCardCap.test.mjs
//
// Unit test for evaluateDemoCap. Run with:
//   cd boards && node src/lib/demoCardCap.test.mjs
//
// Plain Node ESM, no test framework — exit code 0 on pass, non-zero on failure
// (matches op_classifier.test.mjs). The helper is pure, so no backend/yjs.
//
// Arithmetic here is expressed RELATIVE to DEMO_CARD_LIMIT rather than against a
// typed-in number. The cap moved once (100 → 50, migration 0229) and every
// literal in this file had to be rewritten; deriving them means the next move
// costs nothing and the assertions keep testing the behaviour rather than the
// constant. The one place a literal is still correct is the pair of cohort
// tests at the bottom, which exist precisely to pin the two real cap values.

import { evaluateDemoCap, rejectedNoun, DEMO_CARD_LIMIT, LEGACY_DEMO_CARD_LIMIT } from './demoCardCap.js';

let failed = 0;
let passed = 0;
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

const CAP = DEMO_CARD_LIMIT;

// The two cap cohorts that actually exist in the database. New accounts default
// to DEMO_CARD_LIMIT; accounts predating migration 0229 are grandfathered at
// LEGACY_DEMO_CARD_LIMIT and must never be lowered.
assertEq(DEMO_CARD_LIMIT, 50, 'DEMO_CARD_LIMIT is 50 (new accounts)');
assertEq(LEGACY_DEMO_CARD_LIMIT, 100, 'LEGACY_DEMO_CARD_LIMIT is 100 (grandfathered)');
assertEq(LEGACY_DEMO_CARD_LIMIT > DEMO_CARD_LIMIT, true,
  'the grandfathered cap is the HIGHER of the two — nobody was lowered');

// Non-demo tiers are never capped (remaining Infinity, all accepted).
assertEq(evaluateDemoCap({ tier: 'paid', demoCardCount: 0, requested: 50 }),
  { accepted: 50, capHit: false, remaining: Infinity }, 'paid: passthrough');
assertEq(evaluateDemoCap({ tier: 'admin', demoCardCount: 999, requested: 5 }),
  { accepted: 5, capHit: false, remaining: Infinity }, 'admin: passthrough even past the cap');
assertEq(evaluateDemoCap({ tier: null, demoCardCount: 0, requested: 3 }),
  { accepted: 3, capHit: false, remaining: Infinity }, 'null tier: passthrough');

// Demo, comfortably under the cap.
assertEq(evaluateDemoCap({ tier: 'demo', demoCardCount: 10, requested: 1 }),
  { accepted: 1, capHit: false, remaining: CAP - 10 }, 'demo under cap: single allowed');
assertEq(evaluateDemoCap({ tier: 'demo', demoCardCount: 10, requested: 20 }),
  { accepted: 20, capHit: false, remaining: CAP - 10 }, 'demo under cap: batch allowed');

// Demo, batch exactly fills the remaining room — allowed, no cap-hit.
assertEq(evaluateDemoCap({ tier: 'demo', demoCardCount: CAP - 5, requested: 5 }),
  { accepted: 5, capHit: false, remaining: 5 }, 'demo exact fit: no cap-hit');

// Demo, batch larger than remaining — slice to what fits + cap-hit.
assertEq(evaluateDemoCap({ tier: 'demo', demoCardCount: CAP - 5, requested: 10 }),
  { accepted: 5, capHit: true, remaining: 5 }, 'demo over by batch: sliced to remaining');

// Demo at exactly the cap — single card blocked.
assertEq(evaluateDemoCap({ tier: 'demo', demoCardCount: CAP, requested: 1 }),
  { accepted: 0, capHit: true, remaining: 0 }, 'demo at cap: single blocked');

// Demo with a drifted/over count — still fully blocked, no negative remaining.
// This is the shape a grandfathered user takes if their cap were ever lowered,
// and the shape any user takes after a weight-bearing grid card lands.
assertEq(evaluateDemoCap({ tier: 'demo', demoCardCount: CAP + 5, requested: 3 }),
  { accepted: 0, capHit: true, remaining: 0 }, 'demo drifted over: blocked, remaining clamped to 0');

// requested 0 (e.g. duplicating only board cards) never spuriously cap-hits.
assertEq(evaluateDemoCap({ tier: 'demo', demoCardCount: CAP, requested: 0 }),
  { accepted: 0, capHit: false, remaining: 0 }, 'demo at cap, requested 0: no cap-hit');
assertEq(evaluateDemoCap({ tier: 'demo', demoCardCount: 10, requested: 0 }),
  { accepted: 0, capHit: false, remaining: CAP - 10 }, 'demo under cap, requested 0: no cap-hit');

// Defensive: negative/garbage requested is clamped to 0.
assertEq(evaluateDemoCap({ tier: 'demo', demoCardCount: 10, requested: -4 }),
  { accepted: 0, capHit: false, remaining: CAP - 10 }, 'demo negative requested: clamped to 0');

// ── The grandfathered cohort ────────────────────────────────────────────────
// A pre-0229 account carries limit=100 through from get_my_tier's
// effective_card_limit. It must keep building well past the new-account cap.
assertEq(evaluateDemoCap({ tier: 'demo', demoCardCount: CAP + 10, requested: 1, limit: LEGACY_DEMO_CARD_LIMIT }),
  { accepted: 1, capHit: false, remaining: LEGACY_DEMO_CARD_LIMIT - CAP - 10 },
  'grandfathered: still building past the new-account cap');
assertEq(evaluateDemoCap({ tier: 'demo', demoCardCount: LEGACY_DEMO_CARD_LIMIT, requested: 1, limit: LEGACY_DEMO_CARD_LIMIT }),
  { accepted: 0, capHit: true, remaining: 0 }, 'grandfathered: blocked at their own cap, not ours');

// ── Referral bonus ──────────────────────────────────────────────────────────
// Bonus cards raise the cap via `limit` (server: card_cap_base + bonus_card_credits).
const BONUS_CAP = CAP + 25;
assertEq(evaluateDemoCap({ tier: 'demo', demoCardCount: CAP + 10, requested: 1, limit: BONUS_CAP }),
  { accepted: 1, capHit: false, remaining: 15 }, 'demo with +25 bonus: allowed past the base cap');
assertEq(evaluateDemoCap({ tier: 'demo', demoCardCount: CAP, requested: 5, limit: BONUS_CAP }),
  { accepted: 5, capHit: false, remaining: 25 }, 'demo with +25 bonus: batch fits over the base cap');
assertEq(evaluateDemoCap({ tier: 'demo', demoCardCount: BONUS_CAP, requested: 1, limit: BONUS_CAP }),
  { accepted: 0, capHit: true, remaining: 0 }, 'demo at raised cap: blocked');
assertEq(evaluateDemoCap({ tier: 'demo', demoCardCount: BONUS_CAP - 2, requested: 5, limit: BONUS_CAP }),
  { accepted: 2, capHit: true, remaining: 2 }, 'demo near raised cap: sliced to remaining');
// Bonus is irrelevant to non-demo tiers (always passthrough).
assertEq(evaluateDemoCap({ tier: 'paid', demoCardCount: 0, requested: 9, limit: BONUS_CAP }),
  { accepted: 9, capHit: false, remaining: Infinity }, 'paid with limit: still passthrough');

// Garbage/zero limit falls back to DEMO_CARD_LIMIT. This is the pre-resolution
// path — useMyTier's placeholder — so it must be the CONSERVATIVE cap, never a
// grandfathered one a caller hasn't proved they have.
assertEq(evaluateDemoCap({ tier: 'demo', demoCardCount: CAP - 5, requested: 10, limit: 0 }),
  { accepted: 5, capHit: true, remaining: 5 }, 'limit 0: falls back to DEMO_CARD_LIMIT');
assertEq(evaluateDemoCap({ tier: 'demo', demoCardCount: CAP - 5, requested: 10, limit: undefined }),
  { accepted: 5, capHit: true, remaining: 5 }, 'limit undefined: defaults to DEMO_CARD_LIMIT');

// --- rejectedNoun ----------------------------------------------------------
// The wall's copy. An all-image batch is the overwhelmingly common case (users
// reach the cap by dropping a folder of photos), and it is the only one allowed
// to say "photos" — a mixed batch must fall back or the sentence is just false.
assertEq(rejectedNoun({ image: 28 }, 28), 'photos', 'an all-image batch is photos');
assertEq(rejectedNoun({ image: 1 }, 1), 'photo', 'one image is a photo, singular');
assertEq(rejectedNoun({ image: 20, note: 3 }, 23), 'cards', 'a mixed batch falls back to cards');
assertEq(rejectedNoun({ note: 4 }, 4), 'cards', 'a non-image batch is cards');
assertEq(rejectedNoun({ image: 5, note: 0 }, 5), 'photos',
  'a zero-count kind does not make the batch mixed');
assertEq(rejectedNoun({ card: 2 }, 2), 'cards', 'the boardsApi fallback kind reads as cards');
// Never throws into the cap path, and never says "1 photos".
for (const bad of [null, undefined, {}, 'nope', 0]) {
  assertEq(rejectedNoun(bad, 3), 'cards', `junk kinds degrade to cards: ${JSON.stringify(bad)}`);
}
assertEq(rejectedNoun({ image: 1 }, '1'), 'photo', 'a stringified count still reads as singular');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
