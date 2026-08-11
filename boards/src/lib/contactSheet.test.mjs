// The geometry behind the pictures Scout texts back.
//
// The confirmation sheet is the actual guard against the worst thing filing can
// do — moving photos somebody had forgotten about. The words carry the count;
// the picture carries WHICH. So the two must never disagree.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { sheetLayout, previewLayout, SHEET_W } from './contactSheet.js';

const items = (n) => Array.from({ length: n }, (_, i) => ({ key: `k${i}`, width: 4, height: 3 }));

test('tiles are laid in a grid and stay inside the sheet', () => {
  const out = sheetLayout([{ label: 'just now', items: items(7) }]);
  assert.equal(out.width, SHEET_W);
  const laid = out.groups[0].items;
  assert.equal(laid.length, 7);
  for (const it of laid) {
    assert.ok(it.x >= 0 && it.x + it.w <= SHEET_W, `${it.key} overflows horizontally`);
    assert.ok(it.y >= 0 && it.y + it.h <= out.height, `${it.key} overflows vertically`);
  }
});

test('a historical group is marked dim so the strays are obvious', () => {
  const out = sheetLayout([
    { label: 'just now', items: items(3) },
    { label: '3 days ago', dim: true, items: items(14) },
  ]);
  assert.equal(out.groups.length, 2);
  assert.equal(out.groups[0].dim, false);
  assert.equal(out.groups[1].dim, true);
  // The older block sits below the new one, which is what makes "these are the
  // ones you just sent" readable without reading anything.
  assert.ok(out.groups[1].labelY > out.groups[0].labelY);
});

test('the label counts the CARDS, not the tiles', () => {
  // A voice note, a plain note and a PDF with no page-1 raster are cards you
  // cannot draw. A sheet labelled "3" over six cards would tell somebody three
  // things are moving when six are — precisely the misunderstanding this whole
  // confirmation exists to prevent.
  const out = sheetLayout([{ label: 'just now', count: 6, items: items(3) }]);
  assert.equal(out.groups[0].count, 6);
  assert.equal(out.groups[0].items.length, 3);
  // Absent, it still falls back to the tile count.
  assert.equal(sheetLayout([{ label: 'x', items: items(4) }]).groups[0].count, 4);
});

test('an empty group is dropped rather than drawn as a bare label', () => {
  const out = sheetLayout([{ label: 'nothing', items: [] }, { label: 'some', items: items(2) }]);
  assert.equal(out.groups.length, 1);
  assert.equal(out.groups[0].label, 'some');
});

test('the sheet never grows into unreadable scrollware', () => {
  const out = sheetLayout([{ label: 'a lot', items: items(400) }]);
  assert.ok(out.height <= 2200, `height ${out.height} must stay phone-readable`);
});

test('the moodboard preview is a true miniature, translated to the origin', () => {
  const cards = [
    { key: 'a', x: 1000, y: 2000, w: 300, h: 200 },
    { key: 'b', x: 1320, y: 2000, w: 300, h: 200 },
  ];
  const out = previewLayout(cards);
  assert.ok(out);
  // Same left-to-right relationship, same proportions, anchored at the origin.
  assert.ok(out.items[0].x < out.items[1].x);
  assert.ok(Math.min(...out.items.map((i) => i.x)) >= 0);
  assert.ok(Math.min(...out.items.map((i) => i.y)) >= 0);
  const srcRatio = 300 / 200;
  for (const it of out.items) {
    assert.ok(Math.abs(it.w / it.h - srcRatio) < 0.1, 'aspect preserved');
  }
});

test('cards with junk geometry cannot poison the preview', () => {
  assert.equal(previewLayout([]), null);
  assert.equal(previewLayout(null), null);
  assert.equal(previewLayout([{ x: NaN, y: 0, w: 10, h: 10 }]), null);
  const mixed = previewLayout([{ x: 0, y: 0, w: 10, h: 10 }, { x: NaN, y: 0, w: 5, h: 5 }]);
  assert.equal(mixed.items.length, 1, 'the good card survives, the junk one is dropped');
});
