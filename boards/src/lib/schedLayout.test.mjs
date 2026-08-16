// The schedule layout engine — multi-month tiling and the move verb.
//
// Two properties here matter more than the rest.
//
// NO TWO SLOTS SHARE A KEY. A slot key IS a date (`d:2026-08-18`), and the
// whole card is wired by `data-cell-id`: drops, paste routing, focus, uploads
// and the peek all resolve through it. In a single-month grid the leading and
// trailing cells are `outside` days borrowed from the neighbouring months,
// which is harmless because only one month is on screen. Tile three months and
// those borrowed cells collide with the real thing — Aug 31 would exist twice,
// and every attribute-driven pipeline would hit whichever the DOM happened to
// return first. So the strip emits only in-month days.
//
// A MOVE PRESERVES THE UID. The date lives in the key, so changing an item's
// date is a re-key rather than a field write — and if the uid changed with it,
// the item would read as a delete plus an insert to undo, to awareness, and to
// any upload still in flight against that key.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeSchedSlots, monthGrid, schedLodTier, reslotItemKey, moveSlotSubtree,
  SCHED_TUNING, isItemKey, parseSlotKey, slotOfItem,
} from './schedLayout.js';

const TODAY = '2026-08-15';

// ---------------------------------------------------------------------------
// monthGrid

test('a single month is always one block', () => {
  assert.deepEqual(monthGrid(1, 420, 380), { cols: 1, rows: 1 });
});

test('a wide box lays months out as a horizontal strip', () => {
  assert.deepEqual(monthGrid(3, 1100, 420), { cols: 3, rows: 1 });
});

test('a tall box stacks them instead', () => {
  assert.deepEqual(monthGrid(3, 380, 900), { cols: 1, rows: 3 });
});

test('a squarish box wraps rather than squeezing one axis', () => {
  const g = monthGrid(6, 900, 700);
  assert.ok(g.cols > 1 && g.rows > 1, `expected a wrapped grid, got ${g.cols}x${g.rows}`);
  assert.ok(g.cols * g.rows >= 6);
});

test('the arrangement is chosen, not guessed — same box, same answer', () => {
  assert.deepEqual(monthGrid(3, 1100, 420), monthGrid(3, 1100, 420));
});

// ---------------------------------------------------------------------------
// Single month is untouched

test('months:1 still returns the weekday strip and no blocks', () => {
  const r = computeSchedSlots({ view: 'month', anchor: TODAY, w: 420, h: 380, todayIso: TODAY });
  assert.equal(r.weekdayLabels.length, 7);
  assert.equal(r.monthBlocks, null);
  const days = r.slots.filter((s) => s.kind === 'day');
  assert.equal(days.length % 7, 0, 'whole weeks');
  // August 2026 starts on a Saturday, so the grid borrows outside days.
  assert.ok(days.some((s) => s.outside), 'single-month grid keeps its outside days');
});

test('an explicit months:1 is identical to omitting it', () => {
  const a = computeSchedSlots({ view: 'month', anchor: TODAY, w: 420, h: 380, todayIso: TODAY });
  const b = computeSchedSlots({ view: 'month', anchor: TODAY, w: 420, h: 380, todayIso: TODAY, months: 1 });
  assert.deepEqual(b.slots, a.slots);
});

// ---------------------------------------------------------------------------
// The strip

test('a 3-month strip emits three captioned blocks in order', () => {
  const r = computeSchedSlots({
    view: 'month', anchor: '2026-08-15', w: 1100, h: 420, todayIso: TODAY, months: 3,
  });
  assert.equal(r.monthBlocks.length, 3);
  assert.deepEqual(r.monthBlocks.map((b) => b.label),
    ['August 2026', 'September 2026', 'October 2026']);
  assert.equal(r.weekdayLabels, null, 'each block carries its own strip');
});

test('the strip crosses a year boundary without losing a month', () => {
  const r = computeSchedSlots({
    view: 'month', anchor: '2026-11-01', w: 1100, h: 420, todayIso: TODAY, months: 3,
  });
  assert.deepEqual(r.monthBlocks.map((b) => b.label),
    ['November 2026', 'December 2026', 'January 2027']);
});

test('no date appears twice across the strip', () => {
  for (const months of [2, 3, 6]) {
    const r = computeSchedSlots({
      view: 'month', anchor: '2026-08-15', w: 1200, h: 800, todayIso: TODAY, months,
    });
    const keys = r.slots.filter((s) => s.kind === 'day').map((s) => s.key);
    assert.equal(new Set(keys).size, keys.length, `${months} months produced a duplicate date`);
  }
});

test('every day in the strip belongs to a month the strip is showing', () => {
  const r = computeSchedSlots({
    view: 'month', anchor: '2026-08-15', w: 1100, h: 420, todayIso: TODAY, months: 3,
  });
  const shown = new Set(['2026-08', '2026-09', '2026-10']);
  for (const s of r.slots.filter((x) => x.kind === 'day')) {
    assert.ok(shown.has(s.date.slice(0, 7)), `${s.date} is not in the strip's months`);
    assert.equal(s.outside, false, 'the strip never emits borrowed outside days');
  }
});

test('the strip shows every real day of each month exactly once', () => {
  const r = computeSchedSlots({
    view: 'month', anchor: '2026-02-01', w: 1100, h: 420, todayIso: TODAY, months: 2,
  });
  const days = r.slots.filter((s) => s.kind === 'day').map((s) => s.date);
  // 2026 is not a leap year: February has 28 days, March 31.
  assert.equal(days.filter((d) => d.startsWith('2026-02')).length, 28);
  assert.equal(days.filter((d) => d.startsWith('2026-03')).length, 31);
});

test('blocks share one row height so the lattice lines up across the strip', () => {
  const r = computeSchedSlots({
    view: 'month', anchor: '2026-08-15', w: 1100, h: 420, todayIso: TODAY, months: 3,
  });
  const heights = new Set(r.slots.filter((s) => s.kind === 'day')
    .map((s) => Math.round(s.rect.h * 100)));
  assert.equal(heights.size, 1, 'day cells must all be the same height');
});

test('nothing in the strip escapes the body box', () => {
  const w = 1100, h = 420;
  const r = computeSchedSlots({
    view: 'month', anchor: '2026-08-15', w, h, todayIso: TODAY, months: 3,
  });
  for (const s of r.slots) {
    assert.ok(s.rect.x >= -0.01 && s.rect.y >= -0.01, `${s.key} starts outside the box`);
    assert.ok(s.rect.x + s.rect.w <= w + 0.01, `${s.key} overflows the width`);
    assert.ok(s.rect.y + s.rect.h <= h + 0.01, `${s.key} overflows the height`);
  }
  for (const b of r.monthBlocks) {
    assert.ok(b.captionRect.y >= -0.01);
    assert.ok(b.gridRect.y + b.gridRect.h <= h + 0.01);
  }
});

test('today is still marked when it falls in a later block', () => {
  const r = computeSchedSlots({
    view: 'month', anchor: '2026-08-01', w: 1100, h: 420, todayIso: '2026-10-06', months: 3,
  });
  const flagged = r.slots.filter((s) => s.isToday);
  assert.equal(flagged.length, 1);
  assert.equal(flagged[0].date, '2026-10-06');
});

test('a day broken into hours still subdivides inside the strip', () => {
  const expand = { 'd:2026-09-10': 'hours' };
  const r = computeSchedSlots({
    view: 'month', anchor: '2026-08-15', w: 1200, h: 600, todayIso: TODAY, months: 3,
    expand, cellKeys: ['d:2026-09-10/h:07/i:a'],
  });
  const hours = r.slots.filter((s) => s.kind === 'hour' && s.date === '2026-09-10');
  assert.ok(hours.length > 0, 'expanded day emitted no hour rows');
  // 07:00 holds content, so the default 8–18 window must widen to include it.
  assert.ok(hours.some((s) => s.hour === 7), 'hour window did not widen for early content');
});

// ---------------------------------------------------------------------------
// LOD

test('a month card at its default size is unaffected by the months parameter', () => {
  assert.equal(schedLodTier({ view: 'month', w: 420, h: 380, scale: 1 }), 'full');
  assert.equal(schedLodTier({ view: 'month', w: 420, h: 380, scale: 1, months: 1 }), 'full');
});

test('a 3-month strip squeezed into one month\'s footprint demotes', () => {
  // Read against the whole card this would report 'full' while every cell was
  // ~18px — the exact unreadable render the block-relative measure prevents.
  // It lands on 'far' rather than 'mid' because ragged arrangements are no
  // longer allowed: 3 months can only be a strip or a stack, and the strip that
  // wins here is 3-across at 140px per block, below the 150px far threshold.
  assert.equal(schedLodTier({ view: 'month', w: 420, h: 380, scale: 1, months: 3 }), 'far');
});

test('a month count never produces a ragged grid', () => {
  // Three months in a 2x2 with an empty quadrant reads as broken however big
  // it makes the cells.
  for (const [months, w, h] of [[3, 640, 516], [3, 900, 900], [6, 900, 700], [2, 500, 500]]) {
    const g = monthGrid(months, w, h);
    assert.equal(g.cols * g.rows, months,
      `${months} months in ${w}x${h} gave ${g.cols}x${g.rows} — a hole`);
  }
});

test('a strip given room for three real months stays full', () => {
  assert.equal(schedLodTier({ view: 'month', w: 1100, h: 420, scale: 1, months: 3 }), 'full');
});

test('zooming out still demotes a large strip', () => {
  assert.equal(schedLodTier({ view: 'month', w: 1100, h: 420, scale: 0.25, months: 3 }), 'far');
});

// ---------------------------------------------------------------------------
// reslotItemKey

test('moving an item to another day keeps its uid', () => {
  assert.equal(reslotItemKey('d:2026-08-18/i:k3f9a2b', 'd:2026-08-20'),
    'd:2026-08-20/i:k3f9a2b');
});

test('an item can move out of an hour and up to the day', () => {
  assert.equal(reslotItemKey('d:2026-08-18/h:07/i:x9', 'd:2026-08-18'),
    'd:2026-08-18/i:x9');
});

test('an item can move down into a quarter-hour', () => {
  assert.equal(reslotItemKey('d:2026-08-18/i:x9', 'd:2026-08-18/h:07/m:30'),
    'd:2026-08-18/h:07/m:30/i:x9');
});

test('a move that changes nothing reports nothing to do', () => {
  assert.equal(reslotItemKey('d:2026-08-18/i:a', 'd:2026-08-18'), null);
});

test('a slot path is not an item and cannot be moved', () => {
  assert.equal(reslotItemKey('d:2026-08-18', 'd:2026-08-20'), null);
});

test('an unparseable destination is refused rather than minting a bad key', () => {
  assert.equal(reslotItemKey('d:2026-08-18/i:a', 'd:2026-02-30'), null, 'Feb 30 is not a date');
  assert.equal(reslotItemKey('d:2026-08-18/i:a', 'not-a-slot'), null);
  assert.equal(reslotItemKey('d:2026-08-18/i:a', ''), null);
});

test('a moved key is still a valid item key pointing at the new slot', () => {
  const next = reslotItemKey('d:2026-08-18/h:09/m:15/i:zz', 'd:2026-12-01/h:06');
  assert.ok(isItemKey(next));
  assert.equal(slotOfItem(next), 'd:2026-12-01/h:06');
  assert.deepEqual(parseSlotKey(slotOfItem(next)), { kind: 'hour', date: '2026-12-01', hour: 6 });
});

// ---------------------------------------------------------------------------
// moveSlotSubtree — a whole shoot day changing date

const DAY_CELLS = {
  'd:2026-08-18/i:a': { type: 'text', html: '<div>Crew call</div>' },
  'd:2026-08-18/h:07/i:b': { type: 'text', html: '<div>Talent</div>' },
  'd:2026-08-18/h:07/m:30/i:c': { type: 'image', src: 'r2:x' },
  'd:2026-08-19/i:d': { type: 'text', html: '<div>Other day</div>' },
};
const DAY_EXPAND = { 'd:2026-08-18': 'hours', 'd:2026-08-18/h:07': 'minutes', 'd:2026-08-19': 'hours' };

test('a whole day moves with its hour and minute structure intact', () => {
  const r = moveSlotSubtree(DAY_CELLS, DAY_EXPAND, 'd:2026-08-18', 'd:2026-08-20');
  assert.deepEqual(Object.keys(r.cells).sort(), [
    'd:2026-08-20/h:07/i:b',
    'd:2026-08-20/h:07/m:30/i:c',
    'd:2026-08-20/i:a',
  ]);
  assert.deepEqual(r.expand, { 'd:2026-08-20': 'hours', 'd:2026-08-20/h:07': 'minutes' });
});

test('the records themselves travel unchanged', () => {
  const r = moveSlotSubtree(DAY_CELLS, DAY_EXPAND, 'd:2026-08-18', 'd:2026-08-20');
  assert.deepEqual(r.cells['d:2026-08-20/h:07/m:30/i:c'], { type: 'image', src: 'r2:x' });
});

test('it is a move, not a copy — the source keys come back to be deleted', () => {
  const r = moveSlotSubtree(DAY_CELLS, DAY_EXPAND, 'd:2026-08-18', 'd:2026-08-20');
  assert.deepEqual(r.removeKeys.sort(), [
    'd:2026-08-18/h:07/i:b',
    'd:2026-08-18/h:07/m:30/i:c',
    'd:2026-08-18/i:a',
  ]);
  assert.deepEqual(r.removeExpand.sort(), ['d:2026-08-18', 'd:2026-08-18/h:07']);
});

test('a neighbouring day is left completely alone', () => {
  const r = moveSlotSubtree(DAY_CELLS, DAY_EXPAND, 'd:2026-08-18', 'd:2026-08-20');
  assert.ok(!Object.keys(r.cells).some((k) => k.includes('2026-08-19')));
  assert.ok(!r.removeKeys.includes('d:2026-08-19/i:d'));
  assert.ok(!r.removeExpand.includes('d:2026-08-19'));
});

test('dropping a day on itself does nothing at all', () => {
  const r = moveSlotSubtree(DAY_CELLS, DAY_EXPAND, 'd:2026-08-18', 'd:2026-08-18');
  assert.deepEqual(r, { cells: {}, expand: {}, removeKeys: [], removeExpand: [] });
});

test('moving an empty day is a no-op rather than an error', () => {
  const r = moveSlotSubtree(DAY_CELLS, DAY_EXPAND, 'd:2026-01-01', 'd:2026-01-02');
  assert.deepEqual(r.cells, {});
  assert.deepEqual(r.removeKeys, []);
});

test('an hour can be moved on its own without disturbing the rest of the day', () => {
  const r = moveSlotSubtree(DAY_CELLS, DAY_EXPAND, 'd:2026-08-18/h:07', 'd:2026-08-18/h:14');
  assert.deepEqual(Object.keys(r.cells).sort(),
    ['d:2026-08-18/h:14/i:b', 'd:2026-08-18/h:14/m:30/i:c']);
  // The day-level item never lived under the hour, so it stays put.
  assert.ok(!r.removeKeys.includes('d:2026-08-18/i:a'));
});

test('the tuning constants the CSS mirrors are present', () => {
  for (const k of ['MONTH_GAP_PX', 'MONTH_CAPTION_H', 'DAYTILE_H']) {
    assert.equal(typeof SCHED_TUNING[k], 'number', `${k} missing`);
  }
});
