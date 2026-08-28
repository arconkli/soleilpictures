// shareAsk.test.mjs
//
// Unit test for shouldAskToShare. Run with:
//   cd boards && node src/lib/shareAsk.test.mjs
//
// Plain Node ESM, no test framework — exit code 0 on pass, non-zero on failure
// (matches depthDock/upsellEligibility). The predicate is pure, so no backend.

import { shouldAskToShare, SHARE_ASK_MIN_CARDS } from './shareAsk.js';
import { DEPTH_DOCK_MAX } from './depthDock.js';

let failed = 0;
let passed = 0;
function assert(cond, msg) {
  if (!cond) { console.error(`FAIL: ${msg}`); failed++; } else { passed++; }
}

const ask = (over) => shouldAskToShare({ genuineCards: 10, canEdit: true, ...over });

// --- the threshold, expressed relative to the constant --------------------
assert(ask({ genuineCards: SHARE_ASK_MIN_CARDS }), 'at the floor, we ask');
assert(!ask({ genuineCards: SHARE_ASK_MIN_CARDS - 1 }), 'one short of the floor, we do not');
assert(ask({ genuineCards: SHARE_ASK_MIN_CARDS + 50 }), 'well past the floor, still ask');
assert(!ask({ genuineCards: 0 }), 'an empty cluster is never worth showing');

// The dock and the ask must hand off, not compete: the dock owns [1, MAX) and
// this picks up exactly where it stops. If someone moves one, this fails.
assert(SHARE_ASK_MIN_CARDS === DEPTH_DOCK_MAX,
  'the share ask begins exactly where the depth dock stops caring');

// --- the three suppressions ------------------------------------------------
assert(!ask({ canEdit: false }), 'a viewer cannot mint a link, so never ask them');
assert(!ask({ alreadyShared: true }),
  'a board with a live link has already been shared — asking again is nagging');
assert(!ask({ dismissed: true }), 'waved away for this board stays waved away');

// --- junk never throws into a render path ---------------------------------
for (const bad of [null, undefined, {}, { canEdit: true }, { genuineCards: NaN, canEdit: true },
                   { genuineCards: 'lots', canEdit: true }, { genuineCards: 10 },
                   { genuineCards: 10, canEdit: true, min: NaN }]) {
  assert(shouldAskToShare(bad) === false, `junk input is silent: ${JSON.stringify(bad)}`);
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
