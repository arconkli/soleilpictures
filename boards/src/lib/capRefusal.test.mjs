// capRefusal — a card-cap refusal may take back only what this tab just placed
// through the cap gate. Everything else it refuses is existing work, and before
// 2026-10-01 the refusal deleted it with no undo: the first sync after a paid
// period ended removed every card whose 10-second sync had not run while the
// account was paid.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPlacementLedger, WITHDRAW_WINDOW_MS } from './capRefusal.js';

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, p), 'utf8');

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

test('a card this tab just placed through the gate is taken back; nothing else is', () => {
  const c = clock();
  const ledger = createPlacementLedger({ now: c.now });
  ledger.note(['image-new-1', 'image-new-2']);
  const { withdraw, keep } = ledger.split(['image-new-1', 'image-old', 'image-new-2', 'note-restored']);
  assert.deepEqual(withdraw, ['image-new-1', 'image-new-2']);
  assert.deepEqual(keep, ['image-old', 'note-restored']);
});

test('a refusal with an empty ledger keeps every card (the paid-period-ended case)', () => {
  // Cards placed while paid were never noted: the gate did not apply to them.
  const ledger = createPlacementLedger();
  const { withdraw, keep } = ledger.split(['a', 'b', 'c']);
  assert.deepEqual(withdraw, []);
  assert.deepEqual(keep, ['a', 'b', 'c']);
});

test('a placement older than the window is existing work and is kept', () => {
  const c = clock();
  const ledger = createPlacementLedger({ now: c.now });
  ledger.note(['card-1']);
  c.advance(WITHDRAW_WINDOW_MS + 1);
  const { withdraw, keep } = ledger.split(['card-1']);
  assert.deepEqual(withdraw, []);
  assert.deepEqual(keep, ['card-1']);
  assert.equal(ledger.size, 0, 'expired entries are pruned');
});

test('inside the window a slow refusal still takes the card back', () => {
  const c = clock();
  const ledger = createPlacementLedger({ now: c.now });
  ledger.note(['card-1']);
  c.advance(WITHDRAW_WINDOW_MS - 1);
  assert.deepEqual(ledger.split(['card-1']).withdraw, ['card-1']);
});

test('the window comfortably covers the 10-second sync that normally carries the refusal', () => {
  assert.ok(WITHDRAW_WINDOW_MS >= 60_000);
  // …and is short enough that a tab left open across a plan change cannot
  // reach back into work placed hours earlier.
  assert.ok(WITHDRAW_WINDOW_MS <= 15 * 60_000);
});

test('a withdrawn id leaves the ledger, so a later refusal of the same id keeps it', () => {
  const ledger = createPlacementLedger();
  ledger.note(['x']);
  assert.deepEqual(ledger.split(['x']).withdraw, ['x']);
  assert.deepEqual(ledger.split(['x']), { withdraw: [], keep: ['x'] });
});

test('split works on rows through idOf, and returns the rows themselves', () => {
  const ledger = createPlacementLedger();
  ledger.note(['image-1']);
  const rows = [{ card_id: 'image-1', kind: 'image' }, { card_id: 'note-9', kind: 'note' }];
  const { withdraw, keep } = ledger.split(rows, (r) => r.card_id);
  assert.equal(withdraw[0], rows[0]);
  assert.equal(keep[0], rows[1]);
});

test('ids are compared as strings, and empty ids are never noted', () => {
  const ledger = createPlacementLedger();
  ledger.note([42, null, undefined, '']);
  assert.equal(ledger.size, 1);
  assert.deepEqual(ledger.split(['42']).withdraw, ['42']);
});

test('clear() forgets everything (sign-out)', () => {
  const ledger = createPlacementLedger();
  ledger.note(['a', 'b']);
  ledger.clear();
  assert.deepEqual(ledger.split(['a', 'b']).withdraw, []);
});

// ── Wiring. Playwright is not in CI, so the guards that matter live here. ──

const boardsApi = read('./boardsApi.js');
const app = read('../App.jsx');

const capBranch = (() => {
  const start = boardsApi.indexOf("if (ups.error?.code === '42501'");
  const end = boardsApi.indexOf("} else if (ups.error) {", start);
  assert.ok(start > 0 && end > start, 'cap branch found');
  return boardsApi.slice(start, end);
})();

test('syncCardIndex sends only the ledger\'s cards as withdrawable ids', () => {
  assert.match(capBranch, /_placements\.split\(fresh, r => r\.card_id\)/);
  assert.match(capBranch, /cardIds: withdraw\.map\(r => r\.card_id\)/);
  assert.match(capBranch, /rejected: withdraw\.length/);
  assert.match(capBranch, /kept: keep\.length/);
  assert.doesNotMatch(capBranch, /cardIds: fresh/, 'every refused card used to be withdrawn');
});

test('the cap branch no longer returns before the orphan cleanup', () => {
  // A board holding a refused card otherwise never releases the count of the
  // cards deleted from it — deleting to make room makes none.
  assert.doesNotMatch(capBranch.replace(/\/\/.*$/gm, ''), /\breturn\b/);
});

test('every add mutator notes its placements only when the cap gate applied', () => {
  assert.match(app, /if \(gated && placedId\) notePlacedThroughCap\(\[placedId\]\);/);
  assert.match(app, /if \(csBatch\.capped\) notePlacedThroughCap\(placedIds\);/);
  assert.match(app, /if \(csDup\.capped\) notePlacedThroughCap\(newIds\);/);
  // addCard's flag is set inside the capped branch, nowhere else. (A card that
  // costs nothing — an empty grid — never enters that branch, and the server
  // never refuses it, so it is never noted.)
  assert.match(app, /if \(cs\.capped && cost > 0\) \{\s*gated = true;/);
});

test('a kept-only refusal is logged as held, never as a blocked create, and opens no wall', () => {
  const start = app.indexOf('const onCapped = (e) => {');
  const body = app.slice(start, app.indexOf("window.addEventListener('soleil:card-index-capped'", start));
  const held = body.indexOf('EV.CARD_INDEX_HELD');
  const bail = body.indexOf('if (!(Number(e?.detail?.rejected) > 0)) return;');
  const blocked = body.indexOf('EV.CARD_CREATE_BLOCKED');
  const withdraw = body.indexOf('deleteCardsSilent');
  const wall = body.indexOf('pitchCapWall(');
  assert.ok(held > 0 && bail > held, 'held is logged before the bail-out');
  assert.ok(blocked > bail && withdraw > bail && wall > bail, 'nothing past the bail-out runs for kept cards');
});
