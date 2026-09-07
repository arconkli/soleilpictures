// reframeLayout.test.mjs — the ephemeral phone reframe.
//
// This geometry is substituted for the real card array on its way to the
// canvas, which makes two properties load-bearing in a way that is easy to get
// wrong and impossible to notice by looking:
//
//   1. EVERY CARD SURVIVES, EXACTLY ONCE, IN ORDER. The consumer is rendering
//      from this array. Dropping a card hides it; reordering the array
//      reshuffles React keys and z-order under the renderer.
//   2. NOTHING IS EVER NaN. A single NaN propagates into card transforms, the
//      bounding-box maths and every arrow endpoint attached to it, and the
//      failure surfaces far away from the cause.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reframeCards, widthForFrame, RIGID_KINDS } from './reframeLayout.js';

const card = (id, x, y, w, h, extra = {}) => ({ id, kind: 'image', x, y, w, h, ...extra });

// A wide, sparse field — the shape the feature exists to fix.
const WIDE = [
  card('a', 100, 100, 400, 300),
  card('b', 560, 100, 300, 400),
  card('c', 920, 100, 400, 200),
  card('d', 100, 460, 320, 240),
  card('e', 480, 460, 500, 280),
];

const boxes = (out) => out.map(c => ({ id: c.id, x: c.x, y: c.y, w: c.w, h: c.h }));
const finite = (c) => [c.x, c.y, c.w, c.h].every(Number.isFinite);

// ── The two load-bearing invariants ────────────────────────────────────────

test('every card survives, exactly once, in the original order', () => {
  const out = reframeCards(WIDE, { width: 700 });
  assert.equal(out.length, WIDE.length);
  assert.deepEqual(out.map(c => c.id), WIDE.map(c => c.id));
});

test('no geometry is ever NaN, even from junk input', () => {
  const junk = [
    card('ok', 0, 0, 200, 100),
    { id: 'nogeo', kind: 'note' },
    card('zero', 0, 0, 0, 0),
    card('nan', NaN, NaN, NaN, NaN),
    card('neg', -50, -50, -10, -10),
  ];
  const out = reframeCards(junk, { width: 600 });
  for (const c of out) {
    assert.ok(finite(c), `${c.id} produced ${JSON.stringify(boxes([c]))}`);
    assert.ok(c.w > 0 && c.h > 0, `${c.id} has a non-positive size`);
  }
});

test('non-geometry fields pass through untouched', () => {
  const src = [card('a', 0, 0, 200, 100, { text: 'hi', z: 3.5, rotation: 12, custom: { deep: 1 } }),
               card('b', 300, 0, 200, 100)];
  const out = reframeCards(src, { width: 400 });
  assert.equal(out[0].text, 'hi');
  assert.equal(out[0].z, 3.5);
  assert.equal(out[0].rotation, 12);
  assert.equal(out[0].custom, src[0].custom, 'nested objects keep identity — no deep clone');
  assert.equal(out[0].kind, 'image');
});

// ── Shape ──────────────────────────────────────────────────────────────────

test('the result fits the requested width', () => {
  const out = reframeCards(WIDE, { width: 700 });
  const right = Math.max(...out.map(c => c.x + c.w));
  const left = Math.min(...out.map(c => c.x));
  assert.ok(right - left <= 700 + 1, `block is ${right - left} wide, asked for 700`);
});

test('a narrow frame makes the board taller than it is wide', () => {
  const out = reframeCards(WIDE, { width: 420 });
  const w = Math.max(...out.map(c => c.x + c.w)) - Math.min(...out.map(c => c.x));
  const h = Math.max(...out.map(c => c.y + c.h)) - Math.min(...out.map(c => c.y));
  assert.ok(h > w, `expected a column: got ${w}×${h}`);
});

test('the block stays anchored where the board already was', () => {
  const out = reframeCards(WIDE, { width: 700 });
  assert.equal(Math.min(...out.map(c => c.x)), 100);
  assert.equal(Math.min(...out.map(c => c.y)), 100);
});

test('the same input twice gives the same output', () => {
  const a = reframeCards(WIDE, { width: 500 });
  const b = reframeCards(WIDE, { width: 500 });
  assert.deepEqual(boxes(a), boxes(b));
});

test('reframing a reframe is stable — no drift on repeat', () => {
  const once = reframeCards(WIDE, { width: 500 });
  const twice = reframeCards(once, { width: 500 });
  assert.deepEqual(boxes(twice), boxes(once));
});

test('fewer than two cards is a no-op, by identity', () => {
  const one = [card('a', 0, 0, 10, 10)];
  assert.equal(reframeCards(one, { width: 300 }), one);
  assert.equal(reframeCards([], { width: 300 }).length, 0);
  assert.deepEqual(reframeCards(null, { width: 300 }), []);
});

// ── Groups stay coherent ───────────────────────────────────────────────────

test('a group keeps its members\' relative arrangement under a uniform scale', () => {
  const src = [
    card('g1', 0, 0, 100, 100, { groupId: 'G' }),
    card('g2', 120, 0, 100, 100, { groupId: 'G' }),
    card('g3', 0, 120, 100, 100, { groupId: 'G' }),
    card('solo', 400, 0, 300, 200),
  ];
  const out = reframeCards(src, { width: 500 });
  const g = Object.fromEntries(out.filter(c => c.groupId === 'G').map(c => [c.id, c]));

  // g1→g2 is horizontal, g1→g3 is vertical, and both offsets were 120 — so
  // after any uniform scale they must still be equal and still axis-aligned.
  const dx = g.g2.x - g.g1.x;
  const dy = g.g3.y - g.g1.y;
  assert.equal(g.g2.y, g.g1.y, 'group members drifted vertically');
  assert.equal(g.g3.x, g.g1.x, 'group members drifted horizontally');
  assert.ok(Math.abs(dx - dy) <= 1, `offsets sheared: ${dx} vs ${dy}`);
  assert.ok(Math.abs(g.g1.w - g.g1.h) <= 1, 'a square member stopped being square');
});

test('a group of one is treated as a plain card', () => {
  const src = [card('lonely', 0, 0, 400, 200, { groupId: 'G' }), card('b', 500, 0, 400, 200)];
  const out = reframeCards(src, { width: 300 });
  // It must be resized to fit, which a rigid-body group would refuse to do.
  assert.ok(out[0].w <= 300, 'a one-member group was treated as rigid');
});

// ── Bands ──────────────────────────────────────────────────────────────────

test('a section header spans the frame and breaks the flow around it', () => {
  const src = [
    card('top1', 0, 0, 200, 200),
    card('top2', 220, 0, 200, 200),
    card('hdr', 0, 240, 300, 60, { kind: 'note', sectionHeader: true }),
    card('bot1', 0, 320, 200, 200),
    card('bot2', 220, 320, 200, 200),
  ];
  const out = reframeCards(src, { width: 600 });
  const by = Object.fromEntries(out.map(c => [c.id, c]));

  assert.equal(by.hdr.w, 600, 'the header did not take the full frame width');
  assert.equal(by.hdr.h, 60, 'the header height was solved away');
  // Nothing from the first band may fall below the header, and nothing from the
  // second may rise above it — that is what "band" means.
  assert.ok(by.top1.y + by.top1.h <= by.hdr.y, 'a card leaked below the header');
  assert.ok(by.top2.y + by.top2.h <= by.hdr.y, 'a card leaked below the header');
  assert.ok(by.bot1.y >= by.hdr.y + by.hdr.h, 'a card leaked above the header');
  assert.ok(by.bot2.y >= by.hdr.y + by.hdr.h, 'a card leaked above the header');
});

test("span:'full' breaks a band too", () => {
  const src = [
    card('a', 0, 0, 200, 200),
    card('wide', 0, 240, 300, 80, { span: 'full' }),
    card('b', 0, 340, 200, 200),
  ];
  const out = reframeCards(src, { width: 600 });
  const by = Object.fromEntries(out.map(c => [c.id, c]));
  assert.equal(by.wide.w, 600);
  assert.ok(by.a.y + by.a.h <= by.wide.y);
  assert.ok(by.b.y >= by.wide.y + by.wide.h);
});

test('a rigid kind keeps its own size instead of being solved into a row', () => {
  assert.ok(RIGID_KINDS.includes('schedule'));
  const src = [
    card('img1', 0, 0, 400, 300),
    card('sched', 420, 0, 500, 400, { kind: 'schedule' }),
    card('img2', 0, 320, 400, 300),
  ];
  const out = reframeCards(src, { width: 900 });
  const s = out.find(c => c.id === 'sched');
  assert.equal(s.w, 500, 'the schedule card was resized');
  assert.equal(s.h, 400, 'the schedule card was resized');
});

test('a rigid card wider than the frame is scaled down rather than overflowing', () => {
  const src = [card('img', 0, 0, 200, 200), card('sched', 0, 240, 900, 600, { kind: 'schedule' })];
  const out = reframeCards(src, { width: 400 });
  const s = out.find(c => c.id === 'sched');
  assert.ok(s.w <= 400, `rigid card overflowed the frame at ${s.w}`);
  assert.ok(Math.abs((s.w / s.h) - (900 / 600)) < 0.05, 'aspect was not preserved');
});

// ── Reading order ──────────────────────────────────────────────────────────

test('reflow follows what you SEE, not the order things were created', () => {
  // Array order is deliberately the reverse of the visual order.
  const src = [
    card('bottom', 0, 500, 200, 200),
    card('topright', 300, 0, 200, 200),
    card('topleft', 0, 0, 200, 200),
  ];
  const out = reframeCards(src, { width: 460 });
  const by = Object.fromEntries(out.map(c => [c.id, c]));
  assert.ok(by.topleft.y <= by.bottom.y, 'the visually-top card did not stay on top');
  assert.ok(by.topleft.x < by.topright.x || by.topleft.y < by.topright.y,
    'left-to-right within a row was not preserved');
});

// ── widthForFrame ──────────────────────────────────────────────────────────

test('widthForFrame scales with how many cards should read across', () => {
  const narrow = widthForFrame(WIDE, 2.4);
  const wide = widthForFrame(WIDE, 5.0);
  assert.ok(wide > narrow, 'a landscape frame should carry more across');
  assert.ok(Number.isFinite(narrow) && narrow > 0);
});

test('widthForFrame survives an empty board and junk sizes', () => {
  assert.ok(widthForFrame([], 2.4) > 0);
  assert.ok(widthForFrame([{ id: 'x' }], 2.4) > 0);
  assert.ok(widthForFrame(WIDE, 0) > 0, 'a zero cardsAcross must fall back, not divide by zero');
  assert.ok(widthForFrame(null, NaN) > 0);
});
