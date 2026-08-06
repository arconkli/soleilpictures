// Colour-ordered masonry layout (src/lib/moodboard.js) and the filing composer
// (composeMoodboard in src/lib/scoutCards.js).
//
// Two properties matter and they pull against each other: the block must LOOK
// arranged (colour-contiguous columns, level bottoms) and it must never touch
// anything already on the board. The second is absolute — a bot write has no
// undo story, so every test here that could produce an overlap asserts there
// isn't one.

import { expect, test } from '@playwright/test';
import {
  layoutMoodboard, partitionByHeight, columnCount, pushClearOf, blockBounds,
} from '../src/lib/moodboard.js';
import { srgbToOklab } from '../src/lib/oklab.js';
import { composeMoodboard } from '../src/lib/scoutCards.js';

const overlaps = (a, b) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function assertNoOverlaps(cards) {
  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) {
      expect(overlaps(cards[i], cards[j]),
        `${cards[i].id} overlaps ${cards[j].id}`).toBe(false);
    }
  }
}

const photo = (id, w = 260, h = 195, srgb = [128, 128, 128]) => ({
  id, kind: 'image', src: `r2:ws/${id}.jpg`, w, h, color: srgbToOklab(...srgb),
});

test('column count stays squarish and capped', () => {
  expect(columnCount(1)).toBe(1);
  expect(columnCount(6)).toBe(3);
  expect(columnCount(12)).toBe(4);
  expect(columnCount(20)).toBe(5);
  // Capped: a 60-photo block must not march 8 columns off the side of the canvas.
  expect(columnCount(60)).toBe(6);
});

test('columns take CONTIGUOUS runs — that is what keeps each one a colour family', () => {
  const items = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, h: 200 }));
  const chunks = partitionByHeight(items, 4);
  const flat = chunks.flat().map((i) => i.id);
  expect(flat).toEqual(items.map((i) => i.id));       // order preserved exactly
  expect(chunks).toHaveLength(4);
  for (const c of chunks) expect(c.length).toBeGreaterThan(0);
});

test('columns balance by height, not by count, so mixed aspects end level', () => {
  // Six tall then six short. Splitting by COUNT would give wildly uneven columns.
  const items = [
    ...Array.from({ length: 6 }, (_, i) => ({ id: `tall${i}`, h: 400 })),
    ...Array.from({ length: 6 }, (_, i) => ({ id: `short${i}`, h: 100 })),
  ];
  const chunks = partitionByHeight(items, 3);
  const heights = chunks.map((c) => c.reduce((s, i) => s + i.h + 24, 0));
  const spread = Math.max(...heights) - Math.min(...heights);
  const mean = heights.reduce((a, b) => a + b, 0) / heights.length;
  expect(spread).toBeLessThan(mean);   // roughly level rather than 2400 vs 600
});

test('every column is non-empty even when items barely outnumber columns', () => {
  for (const n of [2, 3, 4, 5]) {
    const items = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, h: 1000 }));
    const chunks = partitionByHeight(items, n);
    expect(chunks).toHaveLength(n);
    for (const c of chunks) expect(c.length).toBeGreaterThan(0);
  }
});

test('a laid-out block never overlaps itself', () => {
  const items = Array.from({ length: 17 }, (_, i) => photo(
    `p${i}`, 200 + (i % 4) * 30, 150 + (i % 5) * 60,
    [(i * 37) % 255, (i * 91) % 255, (i * 53) % 255],
  ));
  assertNoOverlaps(layoutMoodboard([], items));
});

test('a laid-out block never overlaps EXISTING board content', () => {
  const existing = [
    { id: 'e1', x: 0, y: 0, w: 900, h: 700 },
    { id: 'e2', x: 200, y: 800, w: 600, h: 500 },
  ];
  const placed = layoutMoodboard(existing, Array.from({ length: 9 }, (_, i) => photo(`p${i}`)));
  for (const p of placed) {
    for (const e of existing) {
      expect(overlaps(p, e), `${p.id} landed on ${e.id}`).toBe(false);
    }
  }
  assertNoOverlaps(placed);
});

test('a card with NaN geometry cannot poison placement', () => {
  // One malformed existing card used to drag boundsOfCards to NaN and drop the
  // whole batch at an arbitrary coordinate — on top of everything.
  const existing = [
    { id: 'ok', x: 0, y: 0, w: 400, h: 300 },
    { id: 'nan', x: NaN, y: 0, w: 200, h: 200 },
    { id: 'missing', x: 10 },
    { id: 'str', x: '40', y: '40', w: '100', h: '100' },
  ];
  const placed = layoutMoodboard(existing, Array.from({ length: 5 }, (_, i) => photo(`p${i}`)));
  for (const p of placed) {
    expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
    expect(overlaps(p, existing[0])).toBe(false);
  }
});

test('pushClearOf shifts the batch as ONE unit, preserving the grid', () => {
  const placed = [
    { id: 'a', x: 100, y: 100, w: 100, h: 100 },
    { id: 'b', x: 220, y: 100, w: 100, h: 100 },
  ];
  const cleared = pushClearOf([{ id: 'e', x: 0, y: 0, w: 600, h: 400 }], placed);
  // Same relative geometry, moved together.
  expect(cleared[1].x - cleared[0].x).toBe(120);
  expect(cleared[0].y).toBe(cleared[1].y);
  expect(cleared[0].y).toBeGreaterThanOrEqual(400);
});

test('composeMoodboard keeps every card and drops the transient colour field', () => {
  const cards = Array.from({ length: 8 }, (_, i) => ({
    id: `img-${i}`, kind: 'image', src: `r2:ws/${i}.jpg`, w: 260, h: 200,
    lab: [0.1 * i, 0.05 * (i % 3), -0.04 * (i % 4)],
  }));
  const out = composeMoodboard({ existingCards: [], cards, topic: null });

  expect(out).toHaveLength(8);
  expect(new Set(out.map((c) => c.id)).size).toBe(8);
  for (const c of out) {
    expect(c.color).toBeUndefined();        // layout input, not card state
    expect(Array.isArray(c.lab)).toBe(true); // durable form survives
    expect(Number.isFinite(c.x) && Number.isFinite(c.y)).toBe(true);
  }
  assertNoOverlaps(out);
});

test('composeMoodboard sorts by colour rather than preserving arrival order', () => {
  // Alternating dark/light on purpose — a sorted result must NOT match input.
  const cards = [
    { id: 'w1', kind: 'image', src: 'r2:a', w: 200, h: 200, lab: [0.95, 0, 0] },
    { id: 'k1', kind: 'image', src: 'r2:b', w: 200, h: 200, lab: [0.05, 0, 0] },
    { id: 'w2', kind: 'image', src: 'r2:c', w: 200, h: 200, lab: [0.90, 0, 0] },
    { id: 'k2', kind: 'image', src: 'r2:d', w: 200, h: 200, lab: [0.10, 0, 0] },
    { id: 'm1', kind: 'image', src: 'r2:e', w: 200, h: 200, lab: [0.50, 0, 0] },
  ];
  const out = composeMoodboard({ existingCards: [], cards, topic: null });
  // Reading order is column-major; the two darks should be adjacent in it.
  const ids = out.map((c) => c.id);
  expect(Math.abs(ids.indexOf('k1') - ids.indexOf('k2'))).toBe(1);
  expect(Math.abs(ids.indexOf('w1') - ids.indexOf('w2'))).toBe(1);
});

test('a section header clears existing content together with its own photos', () => {
  // Clearing them separately is wrong: pushClearOf only moves DOWN, so a
  // colliding header would be shoved into the block it labels.
  const existing = [{ id: 'e', x: 0, y: 0, w: 800, h: 600 }];
  const cards = Array.from({ length: 6 }, (_, i) => ({
    id: `img-${i}`, kind: 'image', src: `r2:${i}`, w: 260, h: 200, lab: [0.2 + i * 0.1, 0, 0],
  }));
  const out = composeMoodboard({ existingCards: existing, cards, topic: 'Diner Recce' });

  const header = out.find((c) => c.sectionHeader);
  expect(header).toBeTruthy();
  expect(overlaps(header, existing[0])).toBe(false);
  assertNoOverlaps(out);
  // The header sits ABOVE the photos it labels.
  const top = Math.min(...out.filter((c) => !c.sectionHeader).map((c) => c.y));
  expect(header.y).toBeLessThan(top);
});

test('blockBounds ignores malformed cards and returns null when nothing is real', () => {
  expect(blockBounds([{ id: 'x', x: NaN, y: 0, w: 1, h: 1 }])).toBeNull();
  const b = blockBounds([
    { x: 10, y: 20, w: 100, h: 50 },
    { x: 200, y: 5, w: 40, h: 40 },
  ]);
  expect(b).toEqual({ x: 10, y: 5, w: 230, h: 65, right: 240, bottom: 70 });
});

test('an empty batch is a no-op, not a crash', () => {
  expect(layoutMoodboard([{ id: 'e', x: 0, y: 0, w: 10, h: 10 }], [])).toEqual([]);
  expect(composeMoodboard({ existingCards: [], cards: [] })).toEqual([]);
});
