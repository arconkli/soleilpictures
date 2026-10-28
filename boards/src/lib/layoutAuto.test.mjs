// `auto`: each section its own block, the blocks set out near a screen's shape
// (lib/layoutAuto.js). The route that uses it is in apiRoutes.test.mjs.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTO, API_LAYOUTS, autoLayout, arrangeAuto, rearrangeAuto, readingOrder, inOrder,
} from './layoutAuto.js';
import { LAYOUTS, GROUP_OUTLINE_PAD, GROUP_LABEL_ROOM } from './layoutEngine.js';
import { paletteSize } from './apiCards.js';

const note = (id, groupId, h = 180, w = 280) => ({ id, kind: 'note', groupId, w, h });
const pic = (id, groupId, aspect) => ({ id, kind: 'image', groupId, w: 280, h: 180, aspect });
const palette = (id, groupId, n = 5) => ({
  id, kind: 'palette', groupId, ...paletteSize(n), swatches: Array.from({ length: n }, (_, i) => ({ hex: `#00000${i}` })),
});

const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function assertNoOverlaps(cards) {
  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) {
      assert.ok(!overlaps(cards[i], cards[j]), `${cards[i].id} overlaps ${cards[j].id}`);
    }
  }
}

// Each section's outline with its name above it, as the canvas draws them.
function frames(cards) {
  const by = new Map();
  for (const c of cards) {
    if (!c.groupId) continue;
    const b = by.get(c.groupId) || { x: Infinity, y: Infinity, r: -Infinity, b: -Infinity };
    by.set(c.groupId, {
      x: Math.min(b.x, c.x), y: Math.min(b.y, c.y), r: Math.max(b.r, c.x + c.w), b: Math.max(b.b, c.y + c.h),
    });
  }
  return [...by].map(([id, b]) => ({
    id,
    x: b.x - GROUP_OUTLINE_PAD,
    y: b.y - GROUP_LABEL_ROOM,
    w: b.r - b.x + 2 * GROUP_OUTLINE_PAD,
    h: b.b - b.y + GROUP_LABEL_ROOM + GROUP_OUTLINE_PAD,
  }));
}

// The film diary ChatGPT made (2026-10-27): its notes at the heights they fit.
const DIARY = [
  note('canon-1', 'canon', 300), note('canon-2', 'canon', 282), note('canon-3', 'canon', 255),
  note('journal-1', 'journal', 210), note('journal-2', 'journal', 233), note('journal-3', 'journal', 165),
  note('watch-1', 'watch', 188), note('watch-2', 'watch', 143),
  note('ideas-1', 'ideas', 233), note('ideas-2', 'ideas', 120), note('ideas-3', 'ideas', 165),
];

test('the API takes auto and every layout the canvas shares, auto first', () => {
  assert.deepEqual(API_LAYOUTS, ['auto', ...LAYOUTS]);
});

test('a board of sections: nothing overlaps, no outline or name touches another, the sections in order', () => {
  const laid = autoLayout(DIARY);
  assert.equal(laid.length, DIARY.length);
  assert.deepEqual(laid.map((c) => c.id), DIARY.map((c) => c.id), 'the cards come back in the order given');
  assertNoOverlaps(laid);
  const fr = frames(laid);
  for (let i = 0; i < fr.length; i++) {
    for (let j = i + 1; j < fr.length; j++) assert.ok(!overlaps(fr[i], fr[j]), `${fr[i].id} touches ${fr[j].id}`);
  }
  for (const c of laid) assert.deepEqual([c.w, c.h], [DIARY.find((d) => d.id === c.id).w, DIARY.find((d) => d.id === c.id).h],
    'a note keeps its size');
  const read = readingOrder(laid);
  const sectionsRead = [...new Set(read.map((c) => c.groupId))];
  assert.deepEqual(sectionsRead, ['canon', 'journal', 'watch', 'ideas']);
  for (const g of sectionsRead) {
    assert.deepEqual(read.filter((c) => c.groupId === g).map((c) => c.id), DIARY.filter((c) => c.groupId === g).map((c) => c.id),
      `${g} reads in its order`);
  }
  const minX = Math.min(...laid.map((c) => c.x));
  const minY = Math.min(...laid.map((c) => c.y));
  assert.deepEqual([minX, minY], [0, 0], 'from (0, 0)');
});

test('the whole board comes out near a screen\'s shape, not a strip', () => {
  const many = Array.from({ length: 40 }, (_, i) => note(`n${i}`, null, 120 + (i * 37) % 300));
  const laid = autoLayout(many);
  const w = Math.max(...laid.map((c) => c.x + c.w));
  const h = Math.max(...laid.map((c) => c.y + c.h));
  assert.ok(w / h > 1 && w / h < 2.6, `${w}×${h}`);
  const sections = Array.from({ length: 9 }, (_, s) => Array.from({ length: 2 + (s % 4) }, (_, i) => note(`s${s}-${i}`, `g${s}`, 140 + (i * 53) % 200))).flat();
  const board = autoLayout(sections);
  const bw = Math.max(...board.map((c) => c.x + c.w));
  const bh = Math.max(...board.map((c) => c.y + c.h));
  assert.ok(bw / bh > 1 && bw / bh < 2.6, `${bw}×${bh}`);
});

test('a section of pictures is rows across it, every picture whole and the rows flush', () => {
  const aspects = [1.5, 0.67, 1.78, 1, 1.33, 0.8, 1.5, 2.2];
  const pics = aspects.map((a, i) => pic(`p${i}`, 'refs', a));
  const laid = autoLayout(pics);
  assertNoOverlaps(laid);
  laid.forEach((c, i) => assert.ok(Math.abs(c.w / c.h - aspects[i]) < 0.03, `${c.id} ${c.w}×${c.h} keeps ${aspects[i]}`));
  const rows = new Map();
  for (const c of laid) rows.set(c.y, [...(rows.get(c.y) || []), c]);
  assert.ok(rows.size > 1, 'more than one row');
  const rights = [...rows.values()].map((r) => Math.max(...r.map((c) => c.x + c.w)));
  assert.ok(Math.max(...rights) - Math.min(...rights) <= 1, `flush: ${rights}`);
  for (const r of rows.values()) assert.equal(new Set(r.map((c) => c.h)).size, 1, 'a row is one height');
});

test('a palette spans the top of its section, and a picture among notes takes the column\'s width', () => {
  const laid = autoLayout([
    pic('p1', 'mood', 1.5), palette('pal', 'mood', 4), pic('p2', 'mood', 0.75), pic('p3', 'mood', 1.33),
    note('n1', 'notes', 200), pic('p4', 'notes', 2), note('n2', 'notes', 150),
  ]);
  assertNoOverlaps(laid);
  const by = Object.fromEntries(laid.map((c) => [c.id, c]));
  const mood = laid.filter((c) => c.groupId === 'mood');
  const left = Math.min(...mood.map((c) => c.x));
  const right = Math.max(...mood.map((c) => c.x + c.w));
  assert.equal(by.pal.y, Math.min(...mood.map((c) => c.y)), 'the palette is at the top');
  assert.deepEqual([by.pal.x, by.pal.x + by.pal.w], [left, right], 'and as wide as its section');
  assert.equal(by.pal.h, paletteSize(4).h);
  assert.equal(by.p4.w, AUTO.column);
  assert.ok(Math.abs(by.p4.w / by.p4.h - 2) < 0.02);
});

test('cards come in the order named, then in reading order', () => {
  const cards = [{ id: 'a', x: 0, y: 300 }, { id: 'b', x: 400, y: 0 }, { id: 'c', x: 0, y: 0 }];
  assert.deepEqual(readingOrder(cards).map((c) => c.id), ['c', 'b', 'a']);
  assert.deepEqual(inOrder(readingOrder(cards), ['a', 'nope']).map((c) => c.id), ['a', 'c', 'b']);
});

// A board of mixed sections, from a seed.
function randomBoard(seed) {
  let s = seed;
  const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  const cards = [];
  const sections = 1 + Math.floor(rnd() * 8);
  let id = 0;
  for (let g = 0; g < sections; g++) {
    const groupId = rnd() < 0.15 ? null : `g${g}`;
    const kind = rnd();
    const n = 1 + Math.floor(rnd() * 9);
    for (let i = 0; i < n; i++) {
      const r = rnd();
      if (kind < 0.35 || r < 0.3) cards.push(pic(`c${id++}`, groupId, 0.5 + rnd() * 1.8));
      else if (r < 0.38) cards.push(palette(`c${id++}`, groupId, 2 + Math.floor(rnd() * 10)));
      else if (r < 0.45) cards.push({ id: `c${id++}`, kind: 'doc', groupId, w: 480, h: 360 });
      else cards.push(note(`c${id++}`, groupId, 72 + Math.floor(rnd() * 400), rnd() < 0.2 ? 320 : 280));
    }
  }
  return cards;
}

test('laying out a board laid out this way moves nothing', () => {
  for (let seed = 1; seed <= 150; seed++) {
    const first = arrangeAuto([], randomBoard(seed));
    assertNoOverlaps(first);
    const again = rearrangeAuto(first, first.map((c) => c.id));
    const was = new Map(first.map((c) => [c.id, c]));
    for (const c of again) {
      const b = was.get(c.id);
      assert.deepEqual([c.x, c.y, c.w, c.h], [b.x, b.y, b.w, b.h], `seed ${seed}: ${c.id} moved`);
    }
  }
});

test('a tidy stays where the cards were, clear of what it isn\'t moving; a new batch goes under the board', () => {
  const board = [
    { id: 'keep', kind: 'note', x: 0, y: 0, w: 280, h: 180 },
    { ...note('a', 'g', 200), x: 500, y: 40 }, { ...note('b', 'g', 150), x: 900, y: 400 },
  ];
  const moved = rearrangeAuto(board, ['a', 'b']);
  assert.equal(Math.min(...moved.map((c) => c.x)), 500);
  assert.equal(Math.min(...moved.map((c) => c.y)), 40);
  for (const c of moved) assert.ok(!overlaps(c, board[0]));
  const added = arrangeAuto(board, [note('x', 'h'), note('y', 'h')]);
  assert.ok(Math.min(...added.map((c) => c.y)) - GROUP_LABEL_ROOM >= 400 + 150, 'under the board, with room for its name');
});

test('a big board is laid out quickly', () => {
  const cards = Array.from({ length: 40 }, (_, g) => Array.from({ length: 25 }, (_, i) => (
    i % 3 ? note(`g${g}-${i}`, `g${g}`, 80 + (i * 41) % 380) : pic(`g${g}-${i}`, `g${g}`, 0.6 + (i % 7) * 0.25)))).flat();
  const t = Date.now();
  const laid = autoLayout(cards);
  assert.equal(laid.length, 1000);
  assert.ok(Date.now() - t < 3000, `${Date.now() - t}ms`);
  const lone = autoLayout(Array.from({ length: 1000 }, (_, i) => pic(`p${i}`, null, 0.6 + (i % 9) * 0.2)));
  assert.equal(lone.length, 1000);
});
