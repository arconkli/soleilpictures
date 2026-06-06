// demoCardCap.test.mjs
//
// Unit test for evaluateDemoCap. Run with:
//   cd boards && node src/lib/demoCardCap.test.mjs
//
// Plain Node ESM, no test framework — exit code 0 on pass, non-zero on failure
// (matches op_classifier.test.mjs). The helper is pure, so no backend/yjs.

import { evaluateDemoCap, DEMO_CARD_LIMIT } from './demoCardCap.js';

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

// The limit is the documented 100.
assertEq(DEMO_CARD_LIMIT, 100, 'DEMO_CARD_LIMIT is 100');

// Non-demo tiers are never capped (remaining Infinity, all accepted).
assertEq(evaluateDemoCap({ tier: 'paid', demoCardCount: 0, requested: 50 }),
  { accepted: 50, capHit: false, remaining: Infinity }, 'paid: passthrough');
assertEq(evaluateDemoCap({ tier: 'admin', demoCardCount: 999, requested: 5 }),
  { accepted: 5, capHit: false, remaining: Infinity }, 'admin: passthrough even past 100');
assertEq(evaluateDemoCap({ tier: null, demoCardCount: 0, requested: 3 }),
  { accepted: 3, capHit: false, remaining: Infinity }, 'null tier: passthrough');

// Demo, comfortably under the cap.
assertEq(evaluateDemoCap({ tier: 'demo', demoCardCount: 10, requested: 1 }),
  { accepted: 1, capHit: false, remaining: 90 }, 'demo under cap: single allowed');
assertEq(evaluateDemoCap({ tier: 'demo', demoCardCount: 50, requested: 20 }),
  { accepted: 20, capHit: false, remaining: 50 }, 'demo under cap: batch allowed');

// Demo, batch exactly fills the remaining room — allowed, no cap-hit.
assertEq(evaluateDemoCap({ tier: 'demo', demoCardCount: 95, requested: 5 }),
  { accepted: 5, capHit: false, remaining: 5 }, 'demo exact fit: no cap-hit');

// Demo, batch larger than remaining — slice to what fits + cap-hit.
assertEq(evaluateDemoCap({ tier: 'demo', demoCardCount: 95, requested: 10 }),
  { accepted: 5, capHit: true, remaining: 5 }, 'demo over by batch: sliced to remaining');

// Demo at exactly the cap — single card blocked.
assertEq(evaluateDemoCap({ tier: 'demo', demoCardCount: 100, requested: 1 }),
  { accepted: 0, capHit: true, remaining: 0 }, 'demo at cap: single blocked');

// Demo with a drifted/over count (>100) — still fully blocked, no negative remaining.
assertEq(evaluateDemoCap({ tier: 'demo', demoCardCount: 105, requested: 3 }),
  { accepted: 0, capHit: true, remaining: 0 }, 'demo drifted over: blocked, remaining clamped to 0');

// requested 0 (e.g. duplicating only board cards) never spuriously cap-hits.
assertEq(evaluateDemoCap({ tier: 'demo', demoCardCount: 100, requested: 0 }),
  { accepted: 0, capHit: false, remaining: 0 }, 'demo at cap, requested 0: no cap-hit');
assertEq(evaluateDemoCap({ tier: 'demo', demoCardCount: 50, requested: 0 }),
  { accepted: 0, capHit: false, remaining: 50 }, 'demo under cap, requested 0: no cap-hit');

// Defensive: negative/garbage requested is clamped to 0.
assertEq(evaluateDemoCap({ tier: 'demo', demoCardCount: 50, requested: -4 }),
  { accepted: 0, capHit: false, remaining: 50 }, 'demo negative requested: clamped to 0');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
