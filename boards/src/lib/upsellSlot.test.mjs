// upsellSlot.test.mjs
//
// Unit test for the upsell slot arbiter. Run with:
//   cd boards && node src/lib/upsellSlot.test.mjs
//
// Plain Node ESM, no test framework — exit code 0 on pass, non-zero on failure
// (matches upsellEligibility.test.mjs). The module is pure, so no backend/DOM.

import { claimUpsellSlot, upsellSlotBusy, __resetUpsellSlot, UPSELL_STACK_WINDOW_MS } from './upsellSlot.js';

let failed = 0;
let passed = 0;
function assert(cond, msg) {
  if (!cond) { console.error(`FAIL: ${msg}`); failed++; } else { passed++; }
}
function assertEq(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) { console.error(`FAIL: ${msg}\n  expected: ${b}\n  actual:   ${a}`); failed++; }
  else passed++;
}

const T = 1_000_000;  // fixed clock; the module never reads Date.now itself here

// --- fails closed ----------------------------------------------------------
__resetUpsellSlot();
for (const bad of [null, undefined, '', 'cap_hit', 'capHit', 'storage', 42, {}]) {
  assertEq(claimUpsellSlot(bad, T), false, `unknown kind is refused: ${JSON.stringify(bad)}`);
}
assertEq(upsellSlotBusy(T), false, 'a refused claim never takes the slot');

// A bad clock degrades to the real one rather than failing closed: refusing on
// a junk timestamp would SUPPRESS a surface, which is the worse mistake. null
// matters on its own — a parameter default only covers undefined, and
// Number(null) is a finite 0 that would otherwise claim at the epoch.
for (const bad of [null, undefined, NaN, 'soon']) {
  __resetUpsellSlot();
  assert(claimUpsellSlot('first-value', bad), `junk clock still shows the surface: ${JSON.stringify(bad)}`);
  assert(upsellSlotBusy(), 'and claims the slot against the real clock, not the epoch');
}

// --- an empty slot lets anything through -----------------------------------
__resetUpsellSlot();
assert(claimUpsellSlot('invite-nudge', T), 'invite-nudge takes a free slot');
assert(upsellSlotBusy(T), 'and the slot is then busy');

// --- the observed pile-up: nudge, then first-value 4s later ----------------
// invite_nudge_view 21:33:49 → first_value_upgrade_view 21:33:53. The old
// guard was one-directional and let this through.
__resetUpsellSlot();
assert(claimUpsellSlot('invite-nudge', T), 'nudge fires during the import');
assertEq(claimUpsellSlot('first-value', T + 4_000), false,
  'first-value stands down 4s behind the nudge (the ordering the old guard missed)');

// …and the reverse, which the old guard DID cover. Still covered.
__resetUpsellSlot();
assert(claimUpsellSlot('first-value', T), 'first-value fires first');
assertEq(claimUpsellSlot('invite-nudge', T + 4_000), false, 'nudge stands down behind it');

// --- the wall always wins, and always claims -------------------------------
__resetUpsellSlot();
assert(claimUpsellSlot('invite-nudge', T), 'nudge holds the slot');
assert(claimUpsellSlot('cap-hit', T + 1_000),
  'a blocked user is told why even 1s behind another surface — the block is a consequence, not a promotion');
assertEq(claimUpsellSlot('first-value', T + 3_000), false,
  'and the ambient surfaces then defer to the wall (the 7-second three-surface trace)');

__resetUpsellSlot();
assert(claimUpsellSlot('cap-hit', T), 'cap-hit takes a free slot');
assert(claimUpsellSlot('cap-hit', T + 500), 'a second refusal is never swallowed by the slot');

// --- the share ask is ambient too ------------------------------------------
__resetUpsellSlot();
assert(claimUpsellSlot('share-ask', T), 'share-ask takes a free slot');
assertEq(claimUpsellSlot('first-value', T + 2_000), false, 'and holds it against the others');

__resetUpsellSlot();
assert(claimUpsellSlot('cap-hit', T), 'the wall claims');
assertEq(claimUpsellSlot('share-ask', T + 2_000), false,
  'never ask someone to show off work in the same beat they were told they are blocked');

__resetUpsellSlot();
assert(claimUpsellSlot('share-ask', T), 'share-ask holds the slot');
assert(claimUpsellSlot('cap-hit', T + 1_000), 'but the wall still outranks it');

// --- the window expires ----------------------------------------------------
__resetUpsellSlot();
assert(claimUpsellSlot('first-value', T), 'first-value claims');
assertEq(claimUpsellSlot('invite-nudge', T + UPSELL_STACK_WINDOW_MS - 1), false,
  'still busy 1ms inside the window');
assert(claimUpsellSlot('invite-nudge', T + UPSELL_STACK_WINDOW_MS),
  'free again exactly at the window edge');

// --- a backwards clock must not wedge the slot shut ------------------------
__resetUpsellSlot();
assert(claimUpsellSlot('first-value', T), 'claim at T');
assertEq(upsellSlotBusy(T - 60_000), false,
  'a clock that jumped backwards reads as free rather than busy forever');

// --- peeking never consumes ------------------------------------------------
// The first-value caller branches on this before writing its once-per-account
// stamp; if asking could take the slot, the one-shot would be burned on a
// deferral and the banner would never fire again for that account.
__resetUpsellSlot();
assertEq(upsellSlotBusy(T), false, 'peek on an empty slot');
assertEq(upsellSlotBusy(T), false, 'peeking twice still empty — asking is not taking');
assert(claimUpsellSlot('first-value', T), 'so the real claim still succeeds');

// --- the ambient kinds all queue behind each other -------------------------
// This block used to sit BELOW the process.exit() call, written in node:test
// style in a file that has no test framework — so it never registered, never
// ran, and would have thrown on `assert.equal` (assert here is a bare function)
// if it ever had. Anything appended after the exit is dead; keep new cases
// above it.
__resetUpsellSlot();
assertEq(claimUpsellSlot('power-reveal', T), true, 'the power reveal takes a free slot');
assertEq(claimUpsellSlot('share-ask', T + 1000), false, 'and the share ask stands down inside the window');

// --- the storage gate ------------------------------------------------------
// The file-type / size / quota refusal. It arrives once per REFUSED FILE from
// call sites inside per-file loops, so without a claim a folder of six opened
// six modals in a row.
__resetUpsellSlot();
assertEq(claimUpsellSlot('storage-gate', T), true, 'the storage gate takes a free slot');
assertEq(claimUpsellSlot('storage-gate', T + 1000), false,
  'and the second refused file in the same batch stands down');

// The cap wall outranks it. Both fire on one over-cap drop of non-standard
// files; a refused CARD is the bigger fact and must not be replaced by a
// refused FILE.
__resetUpsellSlot();
assertEq(claimUpsellSlot('cap-hit', T), true, 'the wall always shows');
assertEq(claimUpsellSlot('storage-gate', T + 1000), false, 'and the storage gate defers to it');

// …but it is not itself ALWAYS_WINS: it must never displace the wall.
__resetUpsellSlot();
assertEq(claimUpsellSlot('storage-gate', T), true, 'the storage gate takes the moment');
assertEq(claimUpsellSlot('cap-hit', T + 1000), true, 'and the wall still overrides it');

// It is a real kind; the bare word 'storage' is deliberately NOT one, so a
// caller that passes the upgradeReason string straight through fails closed.
assertEq(claimUpsellSlot('storage', T), false, "'storage' is not a slot kind — 'storage-gate' is");

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
