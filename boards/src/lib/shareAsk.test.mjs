// shareAsk.test.mjs
//
// Unit test for shouldAskToShare. Run with:
//   cd boards && node src/lib/shareAsk.test.mjs
//
// Plain Node ESM, no test framework — exit code 0 on pass, non-zero on failure
// (matches depthDock/upsellEligibility). The predicate is pure, so no backend.

import { shouldAskToShare, SHARE_ASK_MIN_CARDS, SHARE_ASK_GAP_MS } from './shareAsk.js';
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

// --- once a week per account ----------------------------------------------
const NOW = Date.UTC(2026, 9, 27, 12);
const DAY = 24 * 60 * 60 * 1000;
const weekly = (lastAskedAt) => ask({ lastAskedAt, now: NOW });

assert(SHARE_ASK_GAP_MS === 7 * DAY, 'the gap is a week');
assert(weekly(null), 'an account never asked is asked');
assert(weekly(undefined), 'no stamp at all is never asked');
assert(!weekly(NOW - DAY), 'asked yesterday: not again on another cluster');
assert(!weekly(String(NOW - DAY)), 'the stamp as localStorage hands it back (a string) still counts');
assert(!weekly(NOW - SHARE_ASK_GAP_MS + 1), 'a millisecond short of a week is still too soon');
assert(weekly(NOW - SHARE_ASK_GAP_MS), 'a week to the millisecond: ask again');
assert(weekly(NOW - 30 * DAY), 'a month ago: ask again');
assert(!weekly(NOW + 60 * 60 * 1000), 'a stamp an hour ahead (clock nudged back) still counts');
assert(weekly(NOW + 30 * DAY), 'a stamp a month ahead is a wrong clock, ignored, not obeyed');
for (const junk of ['', 'soon', NaN, {}, [] , 'Infinity']) {
  assert(weekly(junk), `a junk stamp is ignored, not obeyed: ${JSON.stringify(junk)}`);
}
assert(!ask({ lastAskedAt: Date.now() - DAY, now: NaN }), 'a junk clock falls back to the real one');
// The week never overrides the other suppressions.
assert(!ask({ lastAskedAt: NOW - 30 * DAY, now: NOW, dismissed: true }), 'a long-ago stamp does not undo a dismissal');
assert(!ask({ lastAskedAt: NOW - 30 * DAY, now: NOW, genuineCards: SHARE_ASK_MIN_CARDS - 1 }),
  'a long-ago stamp does not lower the floor');

// --- junk never throws into a render path ---------------------------------
for (const bad of [null, undefined, {}, { canEdit: true }, { genuineCards: NaN, canEdit: true },
                   { genuineCards: 'lots', canEdit: true }, { genuineCards: 10 },
                   { genuineCards: 10, canEdit: true, min: NaN }]) {
  assert(shouldAskToShare(bad) === false, `junk input is silent: ${JSON.stringify(bad)}`);
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
