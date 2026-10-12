import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placeCommentPopover } from './commentPopoverPlace.js';

const rect = (left, top, right, bottom) => ({ left, top, right, bottom });
const overlaps = (a, p, h) =>
  a.left < p.left + p.width && a.right > p.left && a.top < p.top + h && a.bottom > p.top;

// VS-DOCS-04: measured in the sweep at 390x844 — the mark spanned x 124-170 at
// top 146, and the old placement put a 320-wide popover at left 62, top 146,
// right on top of it.
test('phone: the popover opens below the commented word, not on it', () => {
  const mark = rect(124, 146, 170, 168);
  const p = placeCommentPopover(mark, 200, 390, 844);
  assert.ok(!overlaps(mark, p, 200), JSON.stringify(p));
  assert.equal(p.top, mark.bottom + 6);
  assert.ok(p.left >= 8 && p.left + p.width <= 390 - 8);
});

test('desktop: it does not sit on the same line as the comment', () => {
  const mark = rect(600, 254, 680, 276);
  const p = placeCommentPopover(mark, 200, 1440, 900);
  assert.ok(p.top >= mark.bottom, 'below the line, so the rest of the sentence stays readable');
  assert.equal(p.left, 600);
  assert.equal(p.width, 320);
});

test('flips above when there is no room below', () => {
  const mark = rect(200, 760, 260, 782);
  const p = placeCommentPopover(mark, 200, 1440, 900);
  assert.equal(p.top, 760 - 6 - 200);
  assert.ok(!overlaps(mark, p, 200));
});

test('a narrow viewport shrinks the popover to fit', () => {
  const p = placeCommentPopover(rect(10, 100, 40, 120), 200, 300, 800);
  assert.equal(p.width, 284);
  assert.equal(p.left, 8);
});

test('a popover taller than either side stays on screen', () => {
  const vh = 500;
  const p = placeCommentPopover(rect(100, 200, 150, 220), 420, 1024, vh);
  assert.ok(p.top >= 8 && p.top + 420 <= vh - 8 + 0.001, JSON.stringify(p));
});
