// Where a toolbar's popover goes against the control that opened it (a font
// list, a size list, a grid of swatches, a menu): seven bars each worked it
// out by hand, and each a little differently. One rule now: the side asked
// for when the panel fits there, else whichever side has more room, kept on
// screen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placeAnchored } from './anchoredPlacement.js';

const VP = { width: 1280, height: 800 };
const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });

test('under its button when it fits there', () => {
  const p = placeAnchored(rect(100, 100, 40, 24), { width: 200, height: 150 }, VP);
  assert.deepEqual(p, { top: 130, left: 100, side: 'below', maxHeight: null });
});

test('over its button when there is no room under it', () => {
  // A doc toolbar scrolled near the bottom of a short window.
  const p = placeAnchored(rect(100, 700, 40, 24), { width: 200, height: 150 }, VP);
  assert.equal(p.side, 'above');
  assert.equal(p.top, 700 - 6 - 150);
});

test('a bar along the bottom asks for above, and gets below only when above is too short', () => {
  const bar = rect(600, 740, 30, 28);
  const up = placeAnchored(bar, { width: 160, height: 120 }, VP, { side: 'above' });
  assert.equal(up.side, 'above');
  assert.equal(up.top, 740 - 6 - 120);
  const top = rect(600, 40, 30, 28);
  assert.equal(placeAnchored(top, { width: 160, height: 120 }, VP, { side: 'above' }).side, 'below');
});

test('with room on neither side it takes the larger one and stays on screen', () => {
  const vp = { width: 1280, height: 300 };
  const p = placeAnchored(rect(100, 100, 40, 24), { width: 200, height: 280 }, vp);
  assert.equal(p.side, 'below');
  assert.equal(p.top, 300 - 280 - 8, 'pulled up until its foot is 8px off the edge');
});

test('kept inside the window across', () => {
  const nearRight = placeAnchored(rect(1250, 100, 24, 24), { width: 200, height: 100 }, VP);
  assert.equal(nearRight.left, 1280 - 200 - 8);
  const nearLeft = placeAnchored(rect(2, 100, 24, 24), { width: 200, height: 100 }, VP, { align: 'end' });
  assert.equal(nearLeft.left, 8);
  const wider = placeAnchored(rect(10, 100, 24, 24), { width: 1400, height: 100 }, VP);
  assert.equal(wider.left, 8, 'wider than the window: pinned to its left edge');
});

test('lined up with its button\'s start, end or middle', () => {
  const b = rect(500, 100, 40, 24);
  const size = { width: 200, height: 100 };
  assert.equal(placeAnchored(b, size, VP).left, 500);
  assert.equal(placeAnchored(b, size, VP, { align: 'end' }).left, 540 - 200);
  assert.equal(placeAnchored(b, size, VP, { align: 'center' }).left, 520 - 100);
});

test('a long list is capped to the room it gets, and to 70% of the window', () => {
  // The font list off the note bar at the bottom of the canvas.
  const bar = rect(400, 740, 120, 28);
  const p = placeAnchored(bar, { width: 280, height: 1600 }, VP, { fitHeight: true });
  assert.equal(p.side, 'above');
  assert.equal(p.maxHeight, 560);
  assert.equal(p.top, 740 - 6 - 560);
  // Off the doc toolbar near the top: below, capped to what's under it.
  const vp = { width: 1280, height: 600 };
  const q = placeAnchored(rect(400, 200, 120, 28), { width: 280, height: 1600 }, vp, { fitHeight: true });
  assert.equal(q.side, 'below');
  assert.equal(q.maxHeight, 600 - 228 - 6 - 8);
  assert.equal(q.top, 234);
  // A short list keeps its own height.
  const r = placeAnchored(rect(400, 200, 120, 28), { width: 280, height: 120 }, VP, { fitHeight: true });
  assert.equal(r.top, 234);
  assert.equal(r.maxHeight, 800 - 228 - 6 - 8);
});

test('beside its button, for a menu off the tool rail, kept on screen down the window', () => {
  // The rail's + at the window's left edge: its menu hangs to the right, its
  // top on the button's.
  const plus = rect(19, 300, 30, 30);
  assert.deepEqual(placeAnchored(plus, { width: 184, height: 420 }, VP, { side: 'right', gap: 8 }),
    { top: 300, left: 57, side: 'right', maxHeight: null });
  // Low in a short window: pulled up until its foot is 8px off the edge.
  const low = placeAnchored(rect(15, 600, 40, 40), { width: 184, height: 400 }, VP, { side: 'right', gap: 8 });
  assert.equal(low.top, 800 - 400 - 8);
  assert.equal(low.left, 63);
  // Taller than the window (a phone held sideways): as tall as the window
  // lets it be, from the top, and it scrolls.
  const sideways = { width: 851, height: 393 };
  const p = placeAnchored(rect(15, 64, 40, 40), { width: 184, height: 420 }, sideways, { side: 'right', gap: 8, fitHeight: true });
  assert.deepEqual(p, { top: 8, left: 63, side: 'right', maxHeight: 393 - 16 });
  // Short enough: its own height, on the button.
  const q = placeAnchored(rect(15, 64, 40, 40), { width: 184, height: 300 }, sideways, { side: 'right', gap: 8, fitHeight: true });
  assert.deepEqual(q, { top: 64, left: 63, side: 'right', maxHeight: 393 - 16 });
});

test('the gap and the margin can be set', () => {
  const p = placeAnchored(rect(100, 100, 40, 24), { width: 200, height: 150 }, VP, { gap: 4, pad: 12 });
  assert.equal(p.top, 128);
  const q = placeAnchored(rect(1250, 100, 24, 24), { width: 200, height: 100 }, VP, { pad: 12 });
  assert.equal(q.left, 1280 - 200 - 12);
});

test('beside, with no room on the right, it hangs to the left, and says so', () => {
  // A submenu off a row of a menu at the window's right edge (the doc bar's ⋯).
  const row = rect(1080, 200, 180, 32);
  const p = placeAnchored(row, { width: 220, height: 160 }, VP, { side: 'right', gap: 2 });
  assert.deepEqual(p, { top: 200, left: 1080 - 2 - 220, side: 'left', maxHeight: null });
  // Room on the right: as before.
  const q = placeAnchored(rect(400, 200, 180, 32), { width: 220, height: 160 }, VP, { side: 'right', gap: 2 });
  assert.equal(q.side, 'right');
  assert.equal(q.left, 582);
  // No room on either side: the roomier one, kept inside the window.
  const narrow = { width: 400, height: 800 };
  const r = placeAnchored(rect(150, 200, 100, 32), { width: 220, height: 160 }, narrow, { side: 'right', gap: 2 });
  assert.equal(r.side, 'right');
  assert.equal(r.left, 400 - 220 - 8);
});
