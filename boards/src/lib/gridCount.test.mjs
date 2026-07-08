// gridCount.test.mjs
//
// Unit test for the weighted card-count helpers (grids count their FILLED cells).
// Run with:  cd boards && node src/lib/gridCount.test.mjs
// Plain Node ESM, no framework — exit 0 on pass, non-zero on failure.

import { isCellFilled, cellsWeight, cardWeight } from './gridCount.js';

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

// A grid weighs its filled cells (min 1 — the container is one placed card).
assertEq(cardWeight('grid', {}), 1, 'empty grid weighs 1');
assertEq(cardWeight('grid', { a: { type: 'empty' }, b: { type: 'image' } }), 1, 'grid w/ only empties weighs 1');
assertEq(cellsWeight({
  a: { type: 'image', src: 'r2:1' },
  b: { type: 'image', src: 'r2:2' },
  c: { type: 'empty' },
  d: { type: 'text', html: '<div>cap</div>' },
}), 3, '3 filled of 4 cells');
const grid25 = {};
for (let i = 0; i < 25; i++) grid25[`c${i}`] = { type: 'image', src: `r2:${i}` };
assertEq(cardWeight('grid', grid25), 25, 'grid of 25 images weighs 25, not 1');

console.log(`gridCount.test: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
