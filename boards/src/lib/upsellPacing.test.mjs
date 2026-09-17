// upsellPacing — how often an upgrade surface is allowed to interrupt.
//
// upsellSlot.js is pure and well tested, but the defect this guards is not in
// the module: it is in which CALL SITES go through it. The storage / file-type
// gate opened the upgrade modal directly from four places, two of them inside
// per-file loops, so a folder of refused files opened the modal once per file.
// Measured in production: a single session took five of them, dismissed each
// in under four seconds, and never read a line of the offer.
//
// The cap wall solved the same problem a month earlier with a once-per-ceiling
// latch. This test exists so the storage gate's twin cannot quietly be removed
// or routed around, the way the direct calls were added one at a time.
//
// A DELIBERATE open — the list toolbar's Upgrade button — is a different thing
// and must NOT be latched: the user asked. That asymmetry is the whole point,
// so the test pins the count rather than banning the call outright.
//
// Comments are stripped before every scan. Three source guards in this repo
// have failed on their own explanatory prose; a test that fails on its own
// rationale is one people learn to delete.
//
// The stripper is LINE-BASED, deliberately. The obvious regex version
// (/\/\*[\s\S]*?\*\//g) matched a false block-comment opener inside a literal
// somewhere in App.jsx and silently swallowed 169KB of the 416KB file — which
// made this test pass and fail for reasons that had nothing to do with the
// code it guards. A stripper that can delete code is worse than no stripper.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const HERE = new URL('.', import.meta.url).pathname;
const src = (rel) => readFileSync(join(HERE, '..', rel), 'utf8');

// Drop whole-line comments in either style. Cannot delete code, which is the
// only property that matters here: an assertion must never be satisfiable by
// prose, and must never fail because prose moved.
function stripComments(text) {
  return text
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*\/|\*|\/\*)/.test(l))
    .join('\n');
}

test('the storage gate opens the modal from exactly one deliberate place', () => {
  const app = stripComments(src('App.jsx'));
  // pitchStorageGate's own body legitimately contains one, so cut it out
  // before counting: what is being pinned is how many OTHER places open it.
  const helperAt = app.indexOf('const pitchStorageGate');
  assert.ok(helperAt > 0, 'pitchStorageGate must exist');
  const outside = app.slice(0, helperAt) + app.slice(helperAt + 700);
  const direct = outside.match(/setUpgradeReason\('storage'\)/g) || [];
  assert.equal(direct.length, 1,
    `every refusal path must go through pitchStorageGate; found ${direct.length} direct opens`);
  // …and the one that remains is the toolbar button the user pressed.
  assert.match(app, /onStorageUpsell=\{\(\) => setUpgradeReason\('storage'\)\}/,
    'the one direct open must be the list toolbar Upgrade button — a deliberate ask, never latched');
});

test('pitchStorageGate latches, then claims, then opens — in that order', () => {
  const app = stripComments(src('App.jsx'));
  const at = app.indexOf('const pitchStorageGate');
  assert.ok(at > 0, 'pitchStorageGate must exist');
  const body = app.slice(at, at + 700);

  assert.match(body, /if \(storagePitchedRef\.current\) return false;/,
    'a second refusal in the same session must not re-interrupt');
  assert.match(body, /claimUpsellSlot\('storage-gate'\)/,
    'it must queue with the other upsell surfaces rather than landing on top of them');
  assert.match(body, /setUpgradeReason\('storage'\)/, 'and it must actually open the modal');

  const latchAt = body.indexOf('storagePitchedRef.current) return false');
  const claimAt = body.indexOf("claimUpsellSlot('storage-gate')");
  const stampAt = body.indexOf('storagePitchedRef.current = true');
  const openAt = body.indexOf("setUpgradeReason('storage')");
  assert.ok(latchAt < claimAt, 'the latch is cheaper than the claim and must be read first');
  assert.ok(claimAt < stampAt,
    'standing down must NOT latch — deferring is not declining, and the next refusal is owed the explanation');
  assert.ok(stampAt < openAt, 'the latch must be stamped before the modal opens, not after');
});

test('the interrupting upload paths are wired to the latched helper', () => {
  const app = stripComments(src('App.jsx'));
  // CanvasSurface funnels handleUploadReject (per file), the blocked-drop list
  // and the blocked paste through this one prop. All three are interruptions.
  assert.match(app, /onRequestStorageUpgrade=\{pitchStorageGate\}/,
    'the canvas refusal paths must go through the latch');
  // The two list-drop paths, one of which is inside a per-file loop.
  const viaHelper = app.match(/pitchStorageGate\(\)/g) || [];
  assert.ok(viaHelper.length >= 2,
    `both list-drop refusal paths must call pitchStorageGate; found ${viaHelper.length}`);
});

test("'storage-gate' is a real slot kind and 'storage' deliberately is not", () => {
  const slot = stripComments(src('lib/upsellSlot.js'));
  assert.match(slot, /'storage-gate'/,
    "claimUpsellSlot fails closed on an unknown kind, so the kind has to be in KINDS or the gate never shows");
  // The bare upgradeReason string must stay invalid, so a caller that passes it
  // straight through fails closed rather than silently claiming a typo'd kind.
  assert.doesNotMatch(slot, /KINDS = new Set\(\[[^\]]*'storage'[,\]]/,
    "'storage' must not become a kind — passing upgradeReason through must fail closed");
});

test('the storage gate does not outrank the cap wall', () => {
  // A refused CARD is a bigger fact than a refused FILE, and both fire on one
  // over-cap drop of non-standard files. Only one kind may be ALWAYS_WINS.
  const slot = stripComments(src('lib/upsellSlot.js'));
  assert.match(slot, /const ALWAYS_WINS = 'cap-hit';/,
    'the wall is the only surface that always shows');
  assert.doesNotMatch(slot, /ALWAYS_WINS[\s\S]{0,80}storage-gate/,
    'the storage gate must never be promoted to always-wins');
});
