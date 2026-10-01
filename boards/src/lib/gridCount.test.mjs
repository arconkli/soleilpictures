// gridCount.test.mjs
//
// Unit test for the weighted card-count helpers (grids count their FILLED cells).
// Run with:  cd boards && node src/lib/gridCount.test.mjs
// Plain Node ESM, no framework — exit 0 on pass, non-zero on failure.

import { isCellFilled, cellsWeight, cardWeight } from './gridCount.js';
import { hasLabelTag } from './gridSequence.js';

let failed = 0, passed = 0;
function assertEq(actual, expected, msg) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a !== b) { console.error(`FAIL: ${msg}\n  expected: ${b}\n  actual:   ${a}`); failed++; }
  else passed++;
}

// A non-grid card always weighs 1.
assertEq(cardWeight('note'), 1, 'note weighs 1');
assertEq(cardWeight('image'), 1, 'image card weighs 1');

// Empty cell states don't count.
assertEq(isCellFilled({ type: 'empty' }), false, 'empty cell: not filled');
assertEq(isCellFilled({ type: 'image' }), false, 'image cell w/o src: not filled');
assertEq(isCellFilled({ type: 'text', html: '' }), false, 'text cell w/ empty html: not filled');
assertEq(isCellFilled({ type: 'text', html: '<div><br></div>' }), false, 'text cell w/ blank html: not filled');
assertEq(isCellFilled(null), false, 'missing cell: not filled');

// Real content counts.
assertEq(isCellFilled({ type: 'image', src: 'r2:x' }), true, 'image w/ src: filled');
assertEq(isCellFilled({ type: 'text', html: '<div>Shot 1</div>' }), true, 'text w/ words: filled');
assertEq(isCellFilled({ type: 'link', source: 'https://a.com' }), true, 'link: filled');
assertEq(isCellFilled({ type: 'board', boardId: 'b1' }), true, 'board cell: filled');

// A grid weighs its filled cells and nothing else. An EMPTY grid weighs 0: the
// docs have always said an empty box adds nothing to your card count, and
// Generate matrix — "an empty N×M grid" — used to spend a card per empty copy.
assertEq(cardWeight('grid', {}), 0, 'empty grid weighs 0');
assertEq(cardWeight('grid'), 0, 'grid with no cells map weighs 0');
assertEq(cardWeight('grid', { a: { type: 'empty' }, b: { type: 'image' } }), 0, 'grid w/ only empties weighs 0');
assertEq(cardWeight('grid', { a: { type: 'image', src: 'r2:1' } }), 1, 'one filled box weighs 1');

// A slate — a text cell holding a sequence label — is what every stamped copy
// carries. It costs no card, alone or with literal text around the tag…
assertEq(cardWeight('grid', { a: { type: 'text', html: '<div>SHOT [#]</div>' } }), 0, 'slate-only grid weighs 0');
assertEq(cardWeight('grid', { a: { type: 'text', html: '[##][A]' } }), 0, 'bare tags weigh 0');
assertEq(cardWeight('grid', {
  a: { type: 'text', html: 'SHOT [#]' },
  b: { type: 'image', src: 'r2:1' },
}), 1, 'a slate beside a frame: only the frame counts');
// …and a 5×5 matrix stamped from a labelled panel costs what is drawn in it.
const matrix = {};
for (let i = 0; i < 25; i++) matrix[`g${i}`] = { a: { type: 'text', html: 'SHOT [#]' } };
assertEq(Object.values(matrix).reduce((n, cells) => n + cardWeight('grid', cells), 0), 0, 'an empty labelled 5×5 storyboard weighs 0');
// Text that merely looks like brackets is ordinary text and counts.
assertEq(cardWeight('grid', { a: { type: 'text', html: 'Take [2]' } }), 1, '[2] is not a label tag');
// The slate test is inlined to keep gridCount dependency-free; it must recognise
// exactly the tags the sequence renderer substitutes.
// A filled text cell is free exactly when hasLabelTag says it holds a tag.
for (const t of ['[#]', '[##]', '[###]', '[A]', 'SHOT [#]', '[####]', '[a]', '[2]', '#', 'A']) {
  const free = cardWeight('grid', { a: { type: 'text', html: t } }) === 0;
  assertEq(free, hasLabelTag(t), `slate test agrees with hasLabelTag on ${JSON.stringify(t)}`);
}
// The slate is still FILLED for a template re-cut, which must report it dropped.
assertEq(isCellFilled({ type: 'text', html: 'SHOT [#]' }), true, 'a slate is still filled');
assertEq(cellsWeight({
  a: { type: 'image', src: 'r2:1' },
  b: { type: 'image', src: 'r2:2' },
  c: { type: 'empty' },
  d: { type: 'text', html: '<div>cap</div>' },
}), 3, '3 filled of 4 cells');
const grid25 = {};
for (let i = 0; i < 25; i++) grid25[`c${i}`] = { type: 'image', src: `r2:${i}` };
assertEq(cardWeight('grid', grid25), 25, 'grid of 25 images weighs 25, not 1');

// A schedule weighs its filled items like a grid but keeps a minimum of 1 — a
// calendar is a placed card before anything is on it. A LEGACY schedule (rows
// table, no cells map) passes no cells and weighs 1.
assertEq(cardWeight('schedule'), 1, 'legacy schedule (no cells) weighs 1');
assertEq(cardWeight('schedule', {}), 1, 'empty schedule weighs 1');
assertEq(cardWeight('schedule', {
  'd:2026-07-15/i:a': { type: 'image', src: 'r2:1' },
  'd:2026-07-15/h:09/i:b': { type: 'board', boardId: 'b1' },
  'd:2026-07-16/i:c': { type: 'empty' },
}), 2, 'schedule weighs its 2 filled items');

// A RUNDOWN ROW IS NOT A CARD. The day view is an ordered list of items with
// durations keyed `d:<date>/r:<uid>`; those rows are one card's interior — the
// shape of a day — and "Set up this day" seeds three of them before anyone has
// typed a word. This loop is otherwise grammar-blind, so a fifteen-row shooting
// day was spending fifteen of a free account's fifty cards.
assertEq(cardWeight('schedule', {
  'd:2026-09-08/r:a': { type: 'text', html: 'Crew call' },
  'd:2026-09-08/r:b': { type: 'text', html: 'Shoot 14A' },
  'd:2026-09-08/r:c': { type: 'board', boardId: 'setup-1' },
}), 1, 'a day of rundown rows weighs 1, not 3');
assertEq(cardWeight('schedule', {
  'd:2026-09-08/i:a': { type: 'image', src: 'r2:1' },
  'd:2026-09-08/r:b': { type: 'image', src: 'r2:2' },
}), 1, 'loose content counts, the row beside it does not');
// The exclusion is a suffix test, so it must not swallow a grid cell that
// merely contains the letter r, or a loose item under an hour row.
assertEq(cardWeight('grid', {
  'r0c0': { type: 'image', src: 'r2:1' },
  'r1c1': { type: 'image', src: 'r2:2' },
}), 2, 'grid cell ids are untouched');
assertEq(cardWeight('schedule', {
  'd:2026-09-08/h:09/i:x': { type: 'image', src: 'r2:1' },
}), 1, 'an item under an hour row still counts');

console.log(`gridCount.test: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
