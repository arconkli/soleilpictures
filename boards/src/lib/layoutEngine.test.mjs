// The layout engine.
//
// One assertion here matters more than the rest: NO TWO CARDS OVERLAP. Every
// other property — flush edges, balanced columns, a last row that does not tower
// over the block — is about looking composed. Overlap is about losing someone's
// picture underneath another one, and it is the failure a person notices last,
// because the card is still there and still correct and simply invisible.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  arrange, rearrange, relativeLayout, justifiedRows, naturalWidth, isLayout, layoutDrop,
  alignCards, distributeCards, ALIGNMENTS, AXES,
  LAYOUTS, DEFAULT_LAYOUT, LAYOUT_GAP, TARGET_ROW_HEIGHT,
  relativeLayoutByGroup, placeGrouped, GROUP_OUTLINE_PAD, GROUP_LABEL_ROOM,
} from './layoutEngine.js';

// A deliberately awkward corpus: portrait, panorama, square, tall, and one with
// no usable dimensions at all.
const MIXED = [
  { id: 'pano', w: 1600, h: 500 },
  { id: 'portrait', w: 600, h: 900 },
  { id: 'square', w: 800, h: 800 },
  { id: 'land', w: 1200, h: 800 },
  { id: 'tall', w: 400, h: 1000 },
  { id: 'land2', w: 1000, h: 667 },
  { id: 'square2', w: 500, h: 500 },
  { id: 'broken', w: 0, h: 0 },
];
const many = (n) => Array.from({ length: n }, (_, i) => ({
  id: `c${i}`, w: 400 + ((i * 137) % 900), h: 300 + ((i * 89) % 700),
}));

const rect = (c) => ({ x: c.x, y: c.y, w: c.w, h: c.h });
const overlaps = (a, b) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function assertNoOverlap(cards, label = '') {
  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) {
      assert.equal(overlaps(rect(cards[i]), rect(cards[j])), false,
        `${label}: ${cards[i].id} overlaps ${cards[j].id} — `
        + `${JSON.stringify(rect(cards[i]))} vs ${JSON.stringify(rect(cards[j]))}`);
    }
  }
}

const geometryIsSane = (cards, label) => {
  for (const c of cards) {
    assert.ok(Number.isFinite(c.x) && Number.isFinite(c.y), `${label}: ${c.id} has non-finite position`);
    assert.ok(c.w > 0 && c.h > 0, `${label}: ${c.id} has non-positive size`);
    assert.ok(c.x >= 8 && c.y >= 8, `${label}: ${c.id} is above the 8px floor`);
  }
};

// ── every layout, the invariants that hold for all of them ───────────────────

test('no layout ever overlaps two cards, for any of them', () => {
  for (const layout of LAYOUTS) {
    const out = arrange([], MIXED, { layout });
    assert.equal(out.length, MIXED.length, `${layout}: lost a card`);
    assertNoOverlap(out, layout);
    geometryIsSane(out, layout);
  }
});

test('no layout overlaps at scale either', () => {
  // 200 items with irregular sizes — where an off-by-one in a row solve shows up.
  for (const layout of LAYOUTS) {
    assertNoOverlap(arrange([], many(200), { layout }), `${layout} @200`);
  }
});

test('every layout is deterministic', () => {
  for (const layout of LAYOUTS) {
    const a = arrange([], MIXED, { layout }).map(rect);
    const b = arrange([], MIXED, { layout }).map(rect);
    assert.deepEqual(a, b, layout);
  }
});

test('a card with broken dimensions still gets placed', () => {
  // Dropping it would lose someone's card to a layout preference.
  for (const layout of LAYOUTS) {
    const out = arrange([], MIXED, { layout });
    const broken = out.find((c) => c.id === 'broken');
    assert.ok(broken, `${layout}: dropped the card with no dimensions`);
    assert.ok(broken.w > 0 && broken.h > 0, `${layout}: gave it no size`);
  }
});

test('the degenerate inputs do not throw', () => {
  for (const layout of LAYOUTS) {
    assert.deepEqual(arrange([], [], { layout }), []);
    assert.equal(arrange([], [{ id: 'only', w: 400, h: 300 }], { layout }).length, 1);
    assert.equal(arrange(null, null, { layout }).length, 0);
  }
});

test('an unknown layout name falls back rather than failing', () => {
  // A typo in a tool call should still place the cards.
  const out = arrange([], MIXED, { layout: 'hexagonal' });
  assert.equal(out.length, MIXED.length);
  assertNoOverlap(out, 'fallback');
  assert.equal(isLayout('hexagonal'), false);
  assert.equal(isLayout(DEFAULT_LAYOUT), true);
});

// ── justified rows ───────────────────────────────────────────────────────────

test('justified rows are flush on BOTH edges', () => {
  // The whole point of the algorithm. Every row except the last must end at the
  // same right edge it started measuring against.
  const width = 1400;
  const out = justifiedRows(many(30), { width, gap: LAYOUT_GAP });
  const rows = new Map();
  for (const c of out) {
    if (!rows.has(c.y)) rows.set(c.y, []);
    rows.get(c.y).push(c);
  }
  const ys = [...rows.keys()].sort((a, b) => a - b);
  assert.ok(ys.length >= 3, 'expected several rows');

  for (const y of ys.slice(0, -1)) {
    const row = rows.get(y).sort((a, b) => a.x - b.x);
    assert.equal(row[0].x, 0, 'row does not start at the left edge');
    const right = row.at(-1).x + row.at(-1).w;
    // Rounding to integers costs at most a pixel per item.
    assert.ok(Math.abs(right - width) <= row.length + 1,
      `row at y=${y} ends at ${right}, not ${width}`);
  }
});

test('every row shares one height', () => {
  const out = justifiedRows(many(24), { width: 1400 });
  const byRow = new Map();
  for (const c of out) byRow.set(c.y, [...(byRow.get(c.y) || []), c.h]);
  for (const [y, heights] of byRow) {
    assert.equal(new Set(heights).size, 1, `row at y=${y} has mixed heights: ${heights}`);
  }
});

test('aspect ratio is preserved', () => {
  const out = justifiedRows(MIXED.filter((c) => c.w > 0), { width: 1200 });
  for (const c of out) {
    const source = MIXED.find((m) => m.id === c.id);
    assert.ok(Math.abs((c.w / c.h) - (source.w / source.h)) < 0.05,
      `${c.id}: aspect ${(c.w / c.h).toFixed(2)} vs original ${(source.w / source.h).toFixed(2)}`);
  }
});

test('a lone last picture is NOT stretched across the block', () => {
  // Solve a final row of one to the full width and it towers over everything
  // above it. This is the recognisable way justified layout is got wrong.
  const items = [...many(6), { id: 'last', w: 1000, h: 1000 }];
  const out = justifiedRows(items, { width: 1400, rowHeight: TARGET_ROW_HEIGHT });
  const last = out.find((c) => c.id === 'last');
  const tallestOther = Math.max(...out.filter((c) => c.id !== 'last').map((c) => c.h));
  assert.ok(last.h <= TARGET_ROW_HEIGHT * 1.4,
    `last row is ${last.h}px tall against a ${TARGET_ROW_HEIGHT}px target`);
  assert.ok(last.h < tallestOther * 3, 'the last row dwarfs the block');
});

test('no row ever exceeds the container width', () => {
  // Rows are only closed once they have overflowed, so every solved height is
  // at or below target and nothing can spill past the right edge.
  const width = 900;
  const out = justifiedRows(many(40), { width });
  for (const c of out) {
    assert.ok(c.x + c.w <= width + 2, `${c.id} ends at ${c.x + c.w}, past ${width}`);
  }
});

test('the default width makes a roughly square block, not a strip', () => {
  // A canvas has no container to read a width from, so this is a choice — and
  // the wrong choice turns forty photographs into a 12,000px strip.
  for (const n of [6, 20, 40, 100]) {
    const out = arrange([], many(n), { layout: 'justified' });
    const w = Math.max(...out.map((c) => c.x + c.w)) - Math.min(...out.map((c) => c.x));
    const h = Math.max(...out.map((c) => c.y + c.h)) - Math.min(...out.map((c) => c.y));
    const ratio = w / h;
    assert.ok(ratio > 0.4 && ratio < 2.5, `${n} items came out ${ratio.toFixed(2)}:1 (${w}x${h})`);
  }
  assert.ok(naturalWidth(many(40)) > naturalWidth(many(6)), 'more items should be wider');
});

// ── anchoring ────────────────────────────────────────────────────────────────

const EXISTING = [
  { id: 'e1', x: 100, y: 100, w: 400, h: 300 },
  { id: 'e2', x: 600, y: 200, w: 300, h: 400 },
];

test('a new block never lands on top of existing work', () => {
  for (const layout of LAYOUTS) {
    const out = arrange(EXISTING, MIXED, { layout });
    for (const c of out) {
      for (const e of EXISTING) {
        assert.equal(overlaps(rect(c), e), false, `${layout}: ${c.id} landed on ${e.id}`);
      }
    }
  }
});

test('an explicit origin is honoured, because a person pointed there', () => {
  const out = arrange(EXISTING, MIXED, {
    layout: 'justified', origin: { x: 2000, y: 3000 }, avoidExisting: false,
  });
  const minX = Math.min(...out.map((c) => c.x));
  const minY = Math.min(...out.map((c) => c.y));
  assert.equal(minX, 2000);
  assert.equal(minY, 3000);
});

test('an origin does NOT by itself disable collision avoidance', () => {
  // Tidying ten cards must not bury the other forty. avoidExisting is explicit
  // precisely so it cannot be inferred from the presence of an origin.
  const onTop = { x: 100, y: 100 };
  const out = arrange(EXISTING, MIXED, { layout: 'grid', origin: onTop });
  for (const c of out) {
    for (const e of EXISTING) {
      assert.equal(overlaps(rect(c), e), false, `${c.id} buried ${e.id}`);
    }
  }
});

// ── re-arranging what already exists ─────────────────────────────────────────

const ON_BOARD = [
  { id: 'a', x: 900, y: 900, w: 400, h: 300 },
  { id: 'b', x: 1400, y: 950, w: 300, h: 400 },
  { id: 'c', x: 950, y: 1400, w: 500, h: 300 },
  { id: 'far', x: 5000, y: 5000, w: 200, h: 200 },
];

test('re-arranging stays where the cards already were', () => {
  // Tidying a selection must not migrate it to the bottom of the board.
  const out = rearrange(ON_BOARD, ['a', 'b', 'c'], { layout: 'justified' });
  assert.equal(out.length, 3);
  const minX = Math.min(...out.map((c) => c.x));
  const minY = Math.min(...out.map((c) => c.y));
  assert.equal(minX, 900, 'block did not keep its own left edge');
  assert.equal(minY, 900, 'block did not keep its own top edge');
  assertNoOverlap(out, 'rearrange');
});

test('re-arranging does not bury the cards it is not moving', () => {
  const near = [...ON_BOARD, { id: 'bystander', x: 900, y: 1300, w: 400, h: 200 }];
  const out = rearrange(near, ['a', 'b', 'c'], { layout: 'grid' });
  const bystander = near.find((c) => c.id === 'bystander');
  for (const c of out) {
    assert.equal(overlaps(rect(c), bystander), false, `${c.id} buried the bystander`);
  }
});

test('re-arranging an empty or unknown selection is a no-op, not a throw', () => {
  assert.deepEqual(rearrange(ON_BOARD, [], { layout: 'grid' }), []);
  assert.deepEqual(rearrange(ON_BOARD, ['nope'], { layout: 'grid' }), []);
  assert.deepEqual(rearrange([], ['a'], { layout: 'grid' }), []);
});

// A drop is centred on the pointer, so a board's cards sit left of and above
// (0, 0) as often as not. Each card used to be floored at 8px on its own once
// the block was anchored there, which pressed every row onto one line and
// every column onto one edge: Tidy up piled the selection on top of itself.
const PAST_ORIGIN = many(40).map((c, i) => ({
  ...c, x: -1800 + (i % 8) * 1400, y: -2400 + Math.floor(i / 8) * 1100,
}));

test('re-arranging cards left of and above the origin keeps the block whole, where it was', () => {
  const ids = PAST_ORIGIN.map((c) => c.id);
  for (const layout of LAYOUTS) {
    const out = rearrange(PAST_ORIGIN, ids, { layout });
    assert.equal(out.length, PAST_ORIGIN.length, `${layout}: lost a card`);
    assertNoOverlap(out, `${layout} past the origin`);
    assert.equal(Math.min(...out.map((c) => c.x)), -1800, `${layout}: the block left its own left edge`);
    assert.equal(Math.min(...out.map((c) => c.y)), -2400, `${layout}: the block left its own top edge`);
  }
});

test('a batch added below a board that reaches past the origin lines up under it, whole', () => {
  const existing = [
    { id: 'e1', x: -900, y: -600, w: 400, h: 300 },
    { id: 'e2', x: 200, y: -500, w: 300, h: 200 },
  ];
  for (const layout of LAYOUTS) {
    const out = arrange(existing, many(24), { layout });
    assertNoOverlap(out, `${layout} below a board past the origin`);
    assert.equal(Math.min(...out.map((c) => c.x)), -900, `${layout}: not under the board's left edge`);
    for (const c of out) {
      for (const e of existing) assert.equal(overlaps(rect(c), e), false, `${layout}: ${c.id} landed on ${e.id}`);
    }
  }
});

// ── the named options ────────────────────────────────────────────────────────

test('gap is respected, and zero is allowed', () => {
  const tight = arrange([], many(12), { layout: 'justified', gap: 0 });
  assertNoOverlap(tight, 'gap 0');
  const loose = arrange([], many(12), { layout: 'justified', gap: 80 });
  assertNoOverlap(loose, 'gap 80');
  const spanOf = (cards) => Math.max(...cards.map((c) => c.y + c.h)) - Math.min(...cards.map((c) => c.y));
  assert.ok(spanOf(loose) > spanOf(tight), 'a bigger gap should make a taller block');
});

test('columns caps the grid and masonry layouts', () => {
  // Both centre each item inside its cell, so distinct x values are NOT the
  // column count. Measure the block instead: two columns cannot be wider than
  // roughly twice the widest item.
  const items = many(20);
  const widest = Math.max(...items.map((c) => c.w));
  for (const layout of ['grid', 'masonry']) {
    const out = arrange([], items, { layout, columns: 2 });
    const width = Math.max(...out.map((c) => c.x + c.w)) - Math.min(...out.map((c) => c.x));
    assert.ok(width <= widest * 2 + LAYOUT_GAP * 2,
      `${layout}: block is ${width}px, wider than two ${widest}px columns`);
    const unbounded = arrange([], items, { layout });
    const wideWidth = Math.max(...unbounded.map((c) => c.x + c.w)) - Math.min(...unbounded.map((c) => c.x));
    assert.ok(wideWidth > width, `${layout}: columns had no effect`);
  }
});

test('row and column really are single lines', () => {
  const row = arrange([], MIXED, { layout: 'row' });
  assert.equal(new Set(row.map((c) => c.x)).size, MIXED.length, 'a row should have distinct x');
  const col = arrange([], MIXED, { layout: 'column' });
  assert.equal(new Set(col.map((c) => c.y)).size, MIXED.length, 'a column should have distinct y');
  assertNoOverlap(row, 'row');
  assertNoOverlap(col, 'column');
});

test('relativeLayout starts at the origin so a caller can measure first', () => {
  for (const layout of LAYOUTS) {
    const out = relativeLayout(MIXED, { layout });
    assert.equal(Math.min(...out.map((c) => c.x)), 0, layout);
    assert.equal(Math.min(...out.map((c) => c.y)), 0, layout);
  }
});

// ── a drop ───────────────────────────────────────────────────────────────────

test('a multi-image drop arrives as a BLOCK, not a strip', () => {
  // The bug this replaces: the canvas staggered each file 260px to the right,
  // so twenty photographs marched 5,200px off-screen and the ones past the
  // viewport edge were clamped into a pile on top of each other.
  const out = layoutDrop(many(20), { at: { x: 1000, y: 1000 }, layout: 'justified' });
  const width = Math.max(...out.map((c) => c.x + c.w)) - Math.min(...out.map((c) => c.x));
  assert.ok(width < 2600, `the drop is ${width}px wide — that is a strip again`);
  assertNoOverlap(out, 'drop');
});

test('a drop is centred on the cursor', () => {
  // The person pointed at a spot; the block belongs around it, not hanging
  // below and to the right of it.
  const at = { x: 4000, y: 2500 };
  const out = layoutDrop(many(9), { at, layout: 'justified' });
  const cx = (Math.min(...out.map((c) => c.x)) + Math.max(...out.map((c) => c.x + c.w))) / 2;
  const cy = (Math.min(...out.map((c) => c.y)) + Math.max(...out.map((c) => c.y + c.h))) / 2;
  assert.ok(Math.abs(cx - at.x) <= 2, `centre x is ${cx}, not ${at.x}`);
  assert.ok(Math.abs(cy - at.y) <= 2, `centre y is ${cy}, not ${at.y}`);
});

test('a drop of one file lands under the cursor', () => {
  const out = layoutDrop([{ id: 'one', w: 400, h: 300 }], { at: { x: 500, y: 500 } });
  assert.equal(out.length, 1);
  assert.ok(Math.abs((out[0].x + out[0].w / 2) - 500) <= 2);
  assert.ok(Math.abs((out[0].y + out[0].h / 2) - 500) <= 2);
});

test('a mixed drop keeps the uniform grid and still does not overlap', () => {
  // An image beside a PDF beside an audio clip reads as a matrix; justified
  // rows would stretch a 380x130 audio card to a photograph's height.
  const mixed = [
    { id: 'img', w: 320, h: 240 }, { id: 'pdf', w: 300, h: 388 },
    { id: 'vid', w: 360, h: 202 }, { id: 'aud', w: 380, h: 130 },
    { id: 'file', w: 240, h: 150 },
  ];
  const out = layoutDrop(mixed, { at: { x: 0, y: 0 }, layout: 'grid' });
  assertNoOverlap(out, 'mixed drop');
  // Sizes are preserved: only justified resizes.
  for (const c of out) {
    const src = mixed.find((m) => m.id === c.id);
    assert.equal(c.w, src.w, `${c.id} was resized`);
    assert.equal(c.h, src.h, `${c.id} was resized`);
  }
});

test('an empty drop is a no-op', () => {
  assert.deepEqual(layoutDrop([], { at: { x: 1, y: 1 } }), []);
  assert.deepEqual(layoutDrop(null, {}), []);
});

// ── align and distribute ─────────────────────────────────────────────────────

const RAGGED = [
  { id: 'a', x: 100, y: 100, w: 200, h: 100 },
  { id: 'b', x: 340, y: 160, w: 120, h: 200 },
  { id: 'c', x: 700, y: 130, w: 300, h: 140 },
];

test('align lines a selection up on its own bounding box', () => {
  const b = { left: 100, right: 1000, top: 100, bottom: 360 };
  assert.deepEqual(alignCards(RAGGED, 'left').map((c) => c.x).concat(100), [100, 100, 100]);
  for (const c of alignCards(RAGGED, 'right')) {
    assert.equal(c.x + c.w, b.right, `${c.id} is not flush right`);
  }
  for (const c of alignCards(RAGGED, 'top')) assert.equal(c.y, b.top);
  for (const c of alignCards(RAGGED, 'bottom')) assert.equal(c.y + c.h, b.bottom);
});

test('align never resizes anything', () => {
  for (const edge of ALIGNMENTS) {
    for (const c of alignCards(RAGGED, edge)) {
      const src = RAGGED.find((r) => r.id === c.id);
      assert.equal(c.w, src.w, `${edge} resized ${c.id}`);
      assert.equal(c.h, src.h, `${edge} resized ${c.id}`);
    }
  }
});

test('align returns only what actually moved', () => {
  // The patch list becomes one undo step, and a card that did not move should
  // not be in it.
  const already = [
    { id: 'a', x: 100, y: 0, w: 50, h: 50 },
    { id: 'b', x: 100, y: 90, w: 50, h: 50 },
  ];
  assert.deepEqual(alignCards(already, 'left'), []);
  assert.equal(alignCards(RAGGED, 'left').length, 2, 'a is already at the left edge');
});

// Three rows of eight, left of the origin as a drop leaves them. Left used to
// put each row's eight cards on top of one another, and Top each column's three.
const GRID = Array.from({ length: 24 }, (_, i) => ({
  id: `g${i}`, x: -600 + (i % 8) * 340, y: 200 + Math.floor(i / 8) * 280, w: 300, h: 240,
}));
const afterAlign = (cards, edge) => cards.map((c) => alignCards(cards, edge).find((m) => m.id === c.id) || c);

test('align lines a big selection up without piling it', () => {
  for (const edge of ALIGNMENTS) assertNoOverlap(afterAlign(GRID, edge), `align ${edge}`);
  // Left: one edge, the cards one under another in reading order.
  const left = afterAlign(GRID, 'left');
  assert.equal(new Set(left.map((c) => c.x)).size, 1, 'Left left more than one edge');
  assert.deepEqual([...left].sort((a, b) => a.y - b.y).map((c) => c.id), GRID.map((c) => c.id));
  // Top: one edge, the cards one after another from the left.
  const top = afterAlign(GRID, 'top');
  assert.equal(new Set(top.map((c) => c.y)).size, 1, 'Top left more than one edge');
  const byColumn = [...GRID].sort((a, b) => a.x - b.x || a.y - b.y).map((c) => c.id);
  assert.deepEqual([...top].sort((a, b) => a.x - b.x).map((c) => c.id), byColumn);
  // The first card in line stays where it was.
  assert.deepEqual(rect(left[0]), rect(GRID[0]));
  assert.deepEqual(rect(top[0]), rect(GRID[0]));
});

test('align moves a card along the line only when it would land on another', () => {
  // A row lined up on Top keeps its spacing; a column lined up on Left too.
  const row = [
    { id: 'a', x: 0, y: 40, w: 200, h: 100 },
    { id: 'b', x: 260, y: 0, w: 120, h: 200 },
    { id: 'c', x: 500, y: 90, w: 300, h: 140 },
  ];
  for (const c of alignCards(row, 'top')) assert.equal(c.x, row.find((r) => r.id === c.id).x, `${c.id} slid along`);
  const col = row.map((c, i) => ({ ...c, x: 40 * i, y: i * 300 }));
  for (const c of alignCards(col, 'left')) assert.equal(c.y, col.find((r) => r.id === c.id).y, `${c.id} slid down`);
});

test('align needs at least two cards, and a real edge', () => {
  assert.deepEqual(alignCards([RAGGED[0]], 'left'), []);
  assert.deepEqual(alignCards(RAGGED, 'diagonal'), []);
  assert.deepEqual(alignCards(null, 'left'), []);
});

test('distribute evens out the GAPS, not the centres', () => {
  // With mixed widths, equal centres still looks uneven — which is the thing
  // the command is being asked to fix.
  const out = distributeCards(RAGGED, 'horizontal');
  const final = RAGGED.map((r) => out.find((c) => c.id === r.id) || r)
    .sort((a, b) => a.x - b.x);
  const gaps = [];
  for (let i = 1; i < final.length; i++) {
    gaps.push(final[i].x - (final[i - 1].x + final[i - 1].w));
  }
  assert.ok(Math.abs(gaps[0] - gaps[1]) <= 1, `gaps are ${gaps}`);
  // The outermost two are held still, so the block does not creep.
  assert.equal(final[0].x, 100);
  assert.equal(final.at(-1).x + final.at(-1).w, 1000);
});

test('distribute works vertically too, and needs three cards', () => {
  const col = [
    { id: 'a', x: 0, y: 0, w: 100, h: 100 },
    { id: 'b', x: 0, y: 130, w: 100, h: 40 },
    { id: 'c', x: 0, y: 400, w: 100, h: 100 },
  ];
  const out = distributeCards(col, 'vertical');
  const final = col.map((r) => out.find((c) => c.id === r.id) || r).sort((a, b) => a.y - b.y);
  const g1 = final[1].y - (final[0].y + final[0].h);
  const g2 = final[2].y - (final[1].y + final[1].h);
  assert.ok(Math.abs(g1 - g2) <= 1, `gaps ${g1} vs ${g2}`);
  // Two cards have nothing to distribute BETWEEN.
  assert.deepEqual(distributeCards(col.slice(0, 2), 'vertical'), []);
  assert.deepEqual(distributeCards(col, 'sideways'), []);
});

test('distributing cards that already overlap does not stack them', () => {
  const crowded = [
    { id: 'a', x: 0, y: 0, w: 300, h: 50 },
    { id: 'b', x: 10, y: 0, w: 300, h: 50 },
    { id: 'c', x: 20, y: 0, w: 300, h: 50 },
  ];
  const out = distributeCards(crowded, 'horizontal');
  const xs = crowded.map((r) => (out.find((c) => c.id === r.id) || r).x);
  assert.equal(new Set(xs).size, 3, 'three cards collapsed onto the same x');
});

// ── Groups ───────────────────────────────────────────────────────────────────
//
// A group is drawn as one outline round all its cards, with its name above. The
// failure being pinned: an assistant added four groups' notes in one call, the
// layout set them out as one grid, and every outline took in other groups'
// cards. (The cards themselves never overlapped, which is why the overlap
// checks above never saw it.)

// The film board as the assistant sent it: 5 + 1 + 3 + 2 notes.
const FILM = ['canon', 'canon', 'canon', 'canon', 'canon', 'rewatch', 'journal', 'journal', 'journal', 'watch', 'watch']
  .map((groupId, i) => ({ id: `n${i}`, kind: 'note', groupId, w: 280, h: 180 }));

// The rectangle a group's outline and name take, as the canvas draws them.
function frameOf(cards, group) {
  const m = cards.filter((c) => c.groupId === group);
  const x = Math.min(...m.map((c) => c.x));
  const y = Math.min(...m.map((c) => c.y));
  const r = Math.max(...m.map((c) => c.x + c.w));
  const b = Math.max(...m.map((c) => c.y + c.h));
  return {
    x: x - GROUP_OUTLINE_PAD, y: y - GROUP_LABEL_ROOM,
    w: r - x + 2 * GROUP_OUTLINE_PAD, h: b - y + GROUP_LABEL_ROOM + GROUP_OUTLINE_PAD,
  };
}

function assertGroupsApart(cards, label = '') {
  assertNoOverlap(cards, label);
  const groups = [...new Set(cards.map((c) => c.groupId).filter(Boolean))];
  for (const g of groups) {
    const f = frameOf(cards, g);
    for (const c of cards) {
      if (c.groupId === g) continue;
      assert.equal(overlaps(f, rect(c)), false, `${label}: ${g}'s outline takes in ${c.id} (${c.groupId || 'no group'})`);
    }
    for (const h of groups) {
      if (h <= g) continue;
      assert.equal(overlaps(f, frameOf(cards, h)), false, `${label}: ${g}'s and ${h}'s outlines overlap`);
    }
  }
}

test('cards added in groups land a group at a time, no outline taking in another group', () => {
  const out = placeGrouped([], FILM);
  assert.deepEqual(out.map((c) => c.id), FILM.map((c) => c.id), 'order changed');
  assertGroupsApart(out, 'placeGrouped');
  // Below what is already on the board, as an ungrouped batch goes.
  const existing = [{ id: 'old', x: 80, y: 80, w: 600, h: 400 }];
  const below = placeGrouped(existing, FILM);
  assertGroupsApart([...existing, ...below], 'below a board');
  for (const c of below) assert.ok(c.y - GROUP_LABEL_ROOM >= 480, `${c.id}'s group name sits on the card above`);
});

test('every layout keeps each group together, and tidying a tidy board moves nothing', () => {
  // The board as the old placement left it: one grid, the groups interleaved.
  const messy = FILM.map((c, i) => ({ ...c, x: 80 + (i % 4) * 304, y: 80 + Math.floor(i / 4) * 204 }));
  for (const layout of LAYOUTS) {
    const once = rearrange(messy, messy.map((c) => c.id), { layout });
    assertGroupsApart(once, layout);
    const tidy = messy.map((c) => once.find((o) => o.id === c.id));
    const twice = rearrange(tidy, tidy.map((c) => c.id), { layout });
    for (const c of twice) {
      const was = tidy.find((t) => t.id === c.id);
      assert.deepEqual([c.x, c.y], [was.x, was.y], `${layout}: a second tidy moved ${c.id}`);
      // justified re-solves sizes from rounded ones, so a pixel can come and go.
      assert.ok(Math.abs(c.w - was.w) <= 1 && Math.abs(c.h - was.h) <= 1, `${layout}: a second tidy resized ${c.id}`);
    }
  }
});

test('without groups the layouts are what they were', () => {
  for (const layout of LAYOUTS) {
    assert.deepEqual(relativeLayoutByGroup(MIXED, { layout }), relativeLayout(MIXED, { layout }), layout);
  }
});

test('a grid keeps one gap: the first column and row are not pressed into the next', () => {
  const out = relativeLayout(FILM.slice(0, 9).map(({ groupId, ...c }) => c), { layout: 'grid' });
  const xs = [...new Set(out.map((c) => c.x))].sort((a, b) => a - b);
  const ys = [...new Set(out.map((c) => c.y))].sort((a, b) => a - b);
  assert.deepEqual(xs, [0, 304, 608]);
  assert.deepEqual(ys, [0, 204, 408]);
});

test('a group\'s new cards land under its cards, else beside them, else below the board', () => {
  const g = (id, x, y, groupId) => ({ id, x, y, w: 280, h: 180, groupId });
  const two = [g('a', 80, 80, 'G'), g('b', 384, 80, 'G')];
  const add = [{ id: 'new', kind: 'note', groupId: 'G', w: 280, h: 180 }];

  // Room underneath: the new card goes under the group's cards.
  const under = placeGrouped([...two, g('far', 2000, 80, 'H'), g('far2', 2304, 80, 'H')], add);
  assert.deepEqual([under[0].x, under[0].y], [80, 284]);

  // Another group's card right under it: beside, to the right.
  const blocked = [...two, g('h1', 80, 340, 'H'), g('h2', 384, 340, 'H')];
  const beside = placeGrouped(blocked, add);
  assert.deepEqual([beside[0].x, beside[0].y], [688, 80]);
  assertGroupsApart([...blocked, ...beside], 'beside');

  // Hemmed in on both sides: below everything, never stretching the outline over others.
  const hemmed = [...blocked, g('i1', 700, 80, 'I'), g('i2', 1004, 80, 'I')];
  const below = placeGrouped(hemmed, add);
  assert.ok(below[0].y >= 520 + 64, `landed at ${below[0].y}, inside the board`);
});

test('the outline and name room match what the canvas draws', () => {
  const src = fs.readFileSync(new URL('../components/CanvasSurface.jsx', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('const groupOutlineEls'), src.indexOf('const groupOutlineEls') + 3000);
  const pad = Number(body.match(/const PAD = (\d+);/)?.[1]);
  const above = Number(body.match(/const labelTop\s*=\s*minY - PAD - (\d+);/)?.[1]);
  assert.equal(pad, GROUP_OUTLINE_PAD, 'the outline pad moved');
  assert.equal(pad + above, GROUP_LABEL_ROOM, 'the name moved');
});
