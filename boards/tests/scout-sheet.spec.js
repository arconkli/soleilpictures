// Layout maths for the pictures Scout texts back (src/lib/contactSheet.js).
//
// The confirmation sheet is the real guard against moving photos someone forgot
// about: a count can't convey "14 of these are from Monday", a picture with two
// labelled blocks can. So the properties that matter here are that groups stay
// separated, that the historical group is marked, and that the whole thing stays
// a sane size for a phone.

import { expect, test } from '@playwright/test';
import { sheetLayout, previewLayout, SHEET_W } from '../src/lib/contactSheet.js';

const items = (n, w = 4, h = 3) => Array.from({ length: n }, (_, i) => ({ key: `k${i}`, width: w, height: h }));

const overlaps = (a, b) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test('groups are stacked, labelled and never interleaved', () => {
  const laid = sheetLayout([
    { label: 'just now', dim: false, items: items(6) },
    { label: '3 days ago', dim: true, items: items(14) },
  ]);

  expect(laid.groups).toHaveLength(2);
  expect(laid.groups[0].count).toBe(6);
  expect(laid.groups[1].count).toBe(14);
  expect(laid.groups[0].dim).toBe(false);
  expect(laid.groups[1].dim).toBe(true);

  // Every tile of the recent group sits above every tile of the old one — that
  // vertical separation IS the message.
  const newestBottom = Math.max(...laid.groups[0].items.map((i) => i.y + i.h));
  const oldestTop = Math.min(...laid.groups[1].items.map((i) => i.y));
  expect(oldestTop).toBeGreaterThan(newestBottom);
});

test('no two tiles overlap, across groups or within one', () => {
  const laid = sheetLayout([
    { label: 'a', items: items(7, 3, 4) },
    { label: 'b', dim: true, items: items(11, 16, 9) },
  ]);
  const all = laid.groups.flatMap((g) => g.items);
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      expect(overlaps(all[i], all[j]), `${i} vs ${j}`).toBe(false);
    }
  }
});

test('mixed aspect ratios are fitted, never stretched', () => {
  const laid = sheetLayout([{ label: 'x', items: [
    { key: 'wide', width: 4000, height: 1000 },
    { key: 'tall', width: 1000, height: 4000 },
    { key: 'square', width: 500, height: 500 },
  ] }]);
  const [wide, tall, square] = laid.groups[0].items;
  expect(wide.w / wide.h).toBeCloseTo(4, 1);
  expect(tall.w / tall.h).toBeCloseTo(0.25, 1);
  expect(square.w).toBe(square.h);
  // Everything stays inside its cell.
  for (const it of laid.groups[0].items) {
    expect(it.w).toBeLessThanOrEqual(laid.cell);
    expect(it.h).toBeLessThanOrEqual(laid.cell);
  }
});

test('a huge bin is capped rather than producing unreadable scrollware', () => {
  const laid = sheetLayout([{ label: 'lots', items: items(300) }]);
  expect(laid.width).toBe(SHEET_W);
  expect(laid.height).toBeLessThanOrEqual(2200);
});

test('empty groups are skipped instead of leaving a labelled void', () => {
  const laid = sheetLayout([
    { label: 'nothing', items: [] },
    { label: 'something', items: items(3) },
  ]);
  expect(laid.groups).toHaveLength(1);
  expect(laid.groups[0].label).toBe('something');
});

test('an entirely empty sheet still produces valid dimensions', () => {
  const laid = sheetLayout([]);
  expect(laid.groups).toEqual([]);
  expect(laid.width).toBeGreaterThan(0);
  expect(laid.height).toBeGreaterThan(0);
});

// ── Moodboard preview ────────────────────────────────────────────────────────

test('the preview is a true miniature — relative geometry is preserved', () => {
  const cards = [
    { id: 'a', x: 1000, y: 500, w: 300, h: 200 },
    { id: 'b', x: 1324, y: 500, w: 300, h: 400 },
    { id: 'c', x: 1000, y: 724, w: 300, h: 300 },
  ];
  const laid = previewLayout(cards);
  expect(laid.items).toHaveLength(3);

  // Aspect ratios survive scaling.
  for (const it of laid.items) {
    const src = cards.find((c) => c.id === it.id);
    expect(it.w / it.h).toBeCloseTo(src.w / src.h, 1);
  }
  // Relative positions survive too: b is to the right of a, c is below a.
  const [a, b, c] = ['a', 'b', 'c'].map((id) => laid.items.find((i) => i.id === id));
  expect(b.x).toBeGreaterThan(a.x);
  expect(c.y).toBeGreaterThan(a.y);
  // The block is translated to the origin, so far-flung board coordinates don't
  // produce a mostly-empty image.
  expect(Math.min(...laid.items.map((i) => i.x))).toBeLessThan(64);
});

test('a single-column tower is scaled down rather than emitted 8000px tall', () => {
  const cards = Array.from({ length: 30 }, (_, i) => ({
    id: `p${i}`, x: 0, y: i * 320, w: 300, h: 300,
  }));
  const laid = previewLayout(cards);
  expect(laid.height).toBeLessThanOrEqual(2200);
  expect(laid.scale).toBeLessThan(1);
});

test('malformed cards are filtered, and an empty set returns null', () => {
  expect(previewLayout([])).toBeNull();
  expect(previewLayout([{ id: 'bad', x: NaN, y: 0, w: 10, h: 10 }])).toBeNull();
  const laid = previewLayout([
    { id: 'ok', x: 0, y: 0, w: 100, h: 100 },
    { id: 'bad', x: 0, y: 0, w: 0, h: 10 },
  ]);
  expect(laid.items).toHaveLength(1);
});
