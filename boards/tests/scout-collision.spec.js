// Scout must NEVER cover or overwrite existing work on a board.
//
// A bot write has no undo story and no human watching it. If an ingest lands on
// top of a card someone spent an hour arranging, they may not notice for days,
// and there is nothing to press Cmd+Z on. So the guarantee is asserted here
// against deliberately hostile boards rather than inferred from the layout
// helper's docstring.
//
// arrangeInFreeSpace anchors below the bounding box of what it is GIVEN, which
// is correct but only as good as its inputs — a stale read, a collaborator
// adding cards mid-flight, or one card with broken geometry can all defeat it.
// pushClearOf is the backstop that makes the property unconditional.

import { expect, test } from '@playwright/test';
import { composeBatch, pushClearOf } from '../src/lib/scoutCards.js';

const overlaps = (a, b) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const img = (w = 4032, h = 3024) => ({ key: `ws/${Math.random().toString(36).slice(2)}.jpg`, width: w, height: h });

function assertClearOf(placed, existing, label) {
  for (const c of placed) {
    for (const e of existing) {
      expect(overlaps(c, e), `${label}: ${c.id} covered an existing card`).toBe(false);
    }
  }
}

test('never lands on a card sitting exactly where the batch would go', () => {
  // A single card parked far below everything else — precisely the spot
  // "anchor below the bounding box" would otherwise choose.
  const existing = [
    { id: 'a', x: 0, y: 0, w: 300, h: 200 },
    { id: 'b', x: 40, y: 300, w: 4000, h: 4000 },   // enormous, spans the landing zone
  ];
  const placed = composeBatch({
    existingCards: existing,
    images: Array.from({ length: 9 }, () => img()),
    topic: 'Scene 4 — Diner',
  });
  assertClearOf(placed, existing, 'giant card');
});

test('survives existing cards that overlap each other', () => {
  const existing = [
    { id: 'a', x: 100, y: 100, w: 500, h: 500 },
    { id: 'b', x: 300, y: 300, w: 500, h: 500 },
    { id: 'c', x: 200, y: 550, w: 900, h: 200 },
  ];
  const placed = composeBatch({
    existingCards: existing,
    images: Array.from({ length: 6 }, () => img()),
    noteText: 'gate code 4417',
  });
  assertClearOf(placed, existing, 'overlapping existing');
});

test('a card with broken geometry cannot poison placement', () => {
  // One NaN would otherwise make boundsOfCards() return NaN and drop the whole
  // batch at an arbitrary coordinate — on top of everything.
  const good = { id: 'good', x: 0, y: 0, w: 400, h: 400 };
  const existing = [
    good,
    { id: 'nan', x: NaN, y: 10, w: 100, h: 100 },
    { id: 'missing', x: 50 },
    { id: 'zero', x: 0, y: 0, w: 0, h: 0 },
    { id: 'str', x: '10', y: '10', w: '10', h: '10' },
    null,
    undefined,
  ];
  const placed = composeBatch({
    existingCards: existing,
    images: Array.from({ length: 4 }, () => img()),
  });
  expect(placed.length).toBe(4);
  for (const c of placed) {
    expect(Number.isFinite(c.x) && Number.isFinite(c.y)).toBe(true);
  }
  assertClearOf(placed, [good], 'broken geometry');
});

test('the section header is cleared with its batch, not into it', () => {
  // The header sits ABOVE the batch. Clearing them separately would push a
  // colliding header DOWN onto its own photos.
  const existing = [{ id: 'blocker', x: 0, y: 0, w: 2000, h: 2000 }];
  const placed = composeBatch({
    existingCards: existing,
    images: Array.from({ length: 5 }, () => img()),
    topic: 'Scene 4 — Diner',
  });
  const header = placed.find((c) => c.sectionHeader);
  const body = placed.filter((c) => !c.sectionHeader);

  expect(header).toBeTruthy();
  assertClearOf(placed, existing, 'header clear');
  // Still above its batch, and not on top of it.
  expect(header.y).toBeLessThan(Math.min(...body.map((c) => c.y)));
  for (const c of body) {
    expect(overlaps(header, c), 'header landed on its own batch').toBe(false);
  }
});

test('cards added between our read and our write are still avoided', () => {
  // Simulates a collaborator dropping a card into the landing zone after the
  // layout was computed. pushClearOf is what makes this recoverable.
  const known = [{ id: 'a', x: 0, y: 0, w: 300, h: 200 }];
  const placed = composeBatch({ existingCards: known, images: Array.from({ length: 4 }, () => img()) });

  const latecomer = { id: 'late', x: placed[0].x, y: placed[0].y, w: 900, h: 900 };
  const recleared = pushClearOf([...known, latecomer], placed);

  assertClearOf(recleared, [...known, latecomer], 'latecomer');
  // Relative layout is preserved — the batch moves as one block.
  const dx = new Set(recleared.map((c, i) => c.x - placed[i].x));
  const dy = new Set(recleared.map((c, i) => c.y - placed[i].y));
  expect(dx.size).toBe(1);
  expect(dy.size).toBe(1);
});

test('pushClearOf terminates against pathological input', () => {
  // A dense wall of cards. Must finish, and must end clear.
  const existing = Array.from({ length: 300 }, (_, i) => ({
    id: `w${i}`, x: (i % 20) * 100, y: Math.floor(i / 20) * 100, w: 120, h: 120,
  }));
  const started = Date.now();
  const placed = composeBatch({ existingCards: existing, images: Array.from({ length: 12 }, () => img()) });
  expect(Date.now() - started).toBeLessThan(1500);
  assertClearOf(placed, existing, 'dense wall');
});

test('negative and far-flung coordinates are handled', () => {
  const existing = [
    { id: 'neg', x: -5000, y: -5000, w: 400, h: 400 },
    { id: 'far', x: 900000, y: 900000, w: 400, h: 400 },
    { id: 'origin', x: 0, y: 0, w: 200, h: 200 },
  ];
  const placed = composeBatch({ existingCards: existing, images: Array.from({ length: 5 }, () => img()) });
  assertClearOf(placed, existing, 'extreme coords');
  for (const c of placed) expect(c.y).toBeGreaterThanOrEqual(0);
});

test('an empty board still produces a clean, non-overlapping grid', () => {
  const placed = composeBatch({ existingCards: [], images: Array.from({ length: 7 }, () => img()) });
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      expect(overlaps(placed[i], placed[j])).toBe(false);
    }
  }
});
