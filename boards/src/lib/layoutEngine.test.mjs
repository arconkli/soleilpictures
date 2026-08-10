// The layout engine.
//
// One assertion here matters more than the rest: NO TWO CARDS OVERLAP. Every
// other property — flush edges, balanced columns, a last row that does not tower
// over the block — is about looking composed. Overlap is about losing someone's
// picture underneath another one, and it is the failure a person notices last,
// because the card is still there and still correct and simply invisible.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  arrange, rearrange, relativeLayout, justifiedRows, naturalWidth, isLayout, layoutDrop,
  alignCards, distributeCards, ALIGNMENTS, AXES,
  LAYOUTS, DEFAULT_LAYOUT, LAYOUT_GAP, TARGET_ROW_HEIGHT,
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
