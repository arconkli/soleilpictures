// importPreflight.test.mjs
//
//   cd boards && node src/lib/importPreflight.test.mjs
//
// Plain Node ESM, no framework — exit 0 on pass (matches demoCardCap.test.mjs).
//
// The case this file exists for is `unresolvedNeverReadsAsUncapped` at the
// bottom. Every other assertion here is arithmetic; that one is the bug that
// let 76- and 85-file batches past the client gate and into a server refusal
// that withdrew the whole drop.
//
// Counts are expressed relative to DEMO_CARD_LIMIT rather than typed in. The
// cap has moved once already (100 -> 50, migration 0229) and every literal in
// demoCardCap.test.mjs had to be rewritten; deriving them means the next move
// costs nothing.

import { planImport } from './importPreflight.js';
import { DEMO_CARD_LIMIT } from './demoCardCap.js';

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
const demo = (count, requested, over = {}) =>
  planImport({ capped: true, resolved: true, count, limit: CAP, requested, ...over });

// ---------------------------------------------------------------- the fits

assertEq(demo(0, 10).outcome, 'proceed', 'an empty account taking 10 just proceeds');
assertEq(demo(0, 10).take, 10, 'proceed takes the whole batch');
assertEq(demo(0, 10).over, 0, 'nothing is over when it all fits');
assertEq(demo(CAP - 1, 1).outcome, 'proceed', 'the very last card still fits');
assertEq(demo(0, CAP).outcome, 'proceed', 'a batch exactly the size of the cap fits');
assertEq(demo(0, CAP).take, CAP, 'and takes all of it');

// ------------------------------------------------------------- the partial
// The real shape: a fresh account drops a folder bigger than the whole cap.

const folder = demo(0, 76);
assertEq(folder.outcome, 'partial', 'a 76-file folder on a fresh account is partial');
assertEq(folder.take, CAP, 'it takes exactly the cap');
assertEq(folder.over, 76 - CAP, 'and reports the rest as over');
assertEq(folder.take + folder.over, 76, 'take + over always reconstructs the gesture');

// Partway in: room for 17, dropping 85. Today this loses all 85 — the whole
// point of the partial outcome is that 17 of them are owed to the user.
const midway = demo(CAP - 17, 85);
assertEq(midway.outcome, 'partial', 'room for 17 and dropping 85 is partial');
assertEq(midway.take, 17, 'the 17 that fit are taken, not withdrawn with the rest');
assertEq(midway.over, 68, 'only the genuine overflow is over');

// ------------------------------------------------------------- the blocked

assertEq(demo(CAP, 1).outcome, 'blocked', 'at the cap, one more card is blocked');
assertEq(demo(CAP, 40).outcome, 'blocked', 'at the cap, a folder is blocked');
assertEq(demo(CAP, 40).take, 0, 'blocked takes nothing');
assertEq(demo(CAP, 40).over, 40, 'blocked reports the whole gesture as over');
assertEq(demo(CAP + 5, 3).outcome, 'blocked', 'over the cap (grid weights) is still blocked');

// --------------------------------------------------------------- no-op drop
// A zero-file gesture must never open a dialog or a wall — the same boundary
// evaluateDemoCap draws for requested:0.

for (const n of [0, -1, null, undefined, NaN, 'nope']) {
  assertEq(demo(CAP, n).outcome, 'proceed', `a ${JSON.stringify(n)}-file gesture is a no-op, not a wall`);
  assertEq(demo(CAP, n).take, 0, `a ${JSON.stringify(n)}-file gesture takes nothing`);
}

// ------------------------------------------------------------ non-demo tiers

assertEq(planImport({ capped: false, resolved: true, count: 0, limit: CAP, requested: 500 }).outcome,
  'proceed', 'an uncapped subject proceeds');
assertEq(planImport({ capped: false, resolved: true, count: 0, limit: CAP, requested: 500 }).take,
  500, 'and takes everything');

// ------------------------------------------------- unresolved never reads as uncapped
//
// THE REGRESSION. useMyTier holds tier:null while loading and after a failed
// get_my_tier, and capSource() turned that into `capped: false` — the gate off
// entirely. Every one of these must refuse to guess.

function unresolvedNeverReadsAsUncapped() {
  for (const capped of [true, false]) {
    const p = planImport({ capped, resolved: false, count: 0, limit: CAP, requested: 76 });
    assertEq(p.outcome, 'unresolved', `resolved:false with capped:${capped} is unresolved`);
    assertEq(p.take, 0, `resolved:false with capped:${capped} places nothing on its own`);
    assertEq(p.over, 76, `resolved:false with capped:${capped} holds the whole gesture back`);
  }
  // Missing entirely is the same as false — a caller that forgets the field
  // must not get the permissive answer.
  for (const bad of [{}, null, undefined]) {
    const p = planImport(bad === null || bad === undefined ? bad : { requested: 76, capped: true });
    assertEq(p.outcome === 'unresolved' || p.take === 0, true,
      `absent state never places: ${JSON.stringify(bad)}`);
  }
}
unresolvedNeverReadsAsUncapped();

// An unresolved cap on a no-op gesture is still a no-op — resolving costs a
// round trip and there is nothing to resolve it for.
assertEq(planImport({ resolved: false, capped: true, requested: 0 }).outcome, 'proceed',
  'an empty gesture never triggers a resolve');

// --------------------------------------------------------------- junk input
// This runs inside a drop handler; a throw takes the canvas out.

for (const bad of [null, undefined, {}, { requested: 5 }, { requested: 5, resolved: true },
                   { requested: 5, resolved: true, capped: true, limit: 0 },
                   { requested: 5, resolved: true, capped: true, limit: NaN, count: NaN }]) {
  let threw = false;
  try { planImport(bad); } catch (_) { threw = true; }
  assertEq(threw, false, `never throws on ${JSON.stringify(bad)}`);
}

// An unknown limit must not invent room. evaluateDemoCap falls back to
// DEMO_CARD_LIMIT for a non-finite limit, so a resolved-but-junk cap still
// slices rather than waving 500 cards through.
assertEq(planImport({ capped: true, resolved: true, count: 0, limit: 0, requested: 500 }).take,
  CAP, 'a junk limit falls back to the default cap, not to unlimited');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
