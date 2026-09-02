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
  SCHED_TUNING, isItemKey, parseSlotKey, slotOfItem, itemRole, parseItemKey,
  itemsForSlot, schedDayCounts, schedItems, schedLegacyRows,
  splitSchedPanes, schedVisibleRange, schedDayRows, schedNextDay, schedSizeForMonths,
} from './schedLayout.js';
import { rundownKey } from './rundown.js';

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

// ---------------------------------------------------------------------------
// Two panes
//
// The rail is only worth its 288px when the calendar beside it is still
// readable. Getting that wrong is not a cosmetic bug: a pane pushed under the
// LOD mid threshold turns the whole card into a density map, so the rail would
// win its space by destroying the thing it sits next to.

test('a card with room gets a rail, and the calendar keeps the rest', () => {
  const { calRect, railRect } = splitSchedPanes({ view: 'month', w: 920, h: 536 });
  assert.equal(railRect.w, SCHED_TUNING.RAIL_W);
  assert.equal(calRect.w + railRect.w, 920);
  assert.equal(railRect.x, calRect.w);
  assert.equal(calRect.x, 0);
});

test('a narrow or short card has no rail — the peek is still the way in', () => {
  for (const box of [{ w: 619, h: 536 }, { w: 920, h: 259 }]) {
    const r = splitSchedPanes({ view: 'month', ...box });
    assert.equal(r.railRect, null);
    assert.equal(r.calRect.w, box.w, 'the calendar takes the whole card');
  }
});

test('day and hour views never get a rail — they are already a list of rows', () => {
  for (const view of ['day', 'hour']) {
    assert.equal(splitSchedPanes({ view, w: 1200, h: 700 }).railRect, null);
  }
});

test('rail:false suppresses the rail without changing the calendar box', () => {
  const on = splitSchedPanes({ view: 'month', w: 920, h: 536, rail: true });
  const off = splitSchedPanes({ view: 'month', w: 920, h: 536, rail: false });
  assert.ok(on.railRect);
  assert.equal(off.railRect, null);
  assert.equal(off.calRect.w, 920);
});

test('a 3-month strip refuses a rail that would shrink each month below legibility', () => {
  // 920 - 288 = 632 for three months = 210 each, under the 330 mid threshold.
  assert.equal(splitSchedPanes({ view: 'month', w: 920, h: 536, months: 3 }).railRect, null);
  // Wide enough and it comes back.
  assert.ok(splitSchedPanes({ view: 'month', w: 1400, h: 536, months: 3 }).railRect);
});

test('every month span sizes to a card that is full tier WITH its rail', () => {
  for (const n of [1, 3, 6]) {
    const size = schedSizeForMonths(n, { w: 920, h: 580 });
    const body = { w: size.w, h: size.h - SCHED_TUNING.HEADER_H };
    const { railRect, calRect } = splitSchedPanes({ view: 'month', ...body, months: n });
    assert.ok(railRect, `${n} months should keep its rail`);
    assert.equal(schedLodTier({ view: 'month', ...body, scale: 1, months: n }), 'full', `${n} months`);
    const { cols } = monthGrid(n, calRect.w, body.h);
    assert.ok(calRect.w / cols >= 330, `${n} months: each block must clear midW`);
  }
});

test('sizing for a span never shrinks a card someone has already sized', () => {
  const big = schedSizeForMonths(1, { w: 1600, h: 1000 });
  assert.deepEqual(big, { w: 1600, h: 1000 });
});

// ---------------------------------------------------------------------------
// What the rail lists

test('the visible range is whole calendar months, not the padded week grid', () => {
  assert.deepEqual(schedVisibleRange({ view: 'month', anchor: '2026-09-15' }),
    { from: '2026-09-01', to: '2026-09-30' });
  // A 3-month strip runs to the end of the third month, including a leap Feb.
  assert.deepEqual(schedVisibleRange({ view: 'month', anchor: '2024-01-10', months: 3 }),
    { from: '2024-01-01', to: '2024-03-31' });
  assert.deepEqual(schedVisibleRange({ view: 'week', anchor: '2026-08-19' }),
    { from: '2026-08-17', to: '2026-08-23' });   // Monday-first
  assert.deepEqual(schedVisibleRange({ view: 'day', anchor: '2026-08-19' }),
    { from: '2026-08-19', to: '2026-08-19' });
});

const DAY = (id, date, extra = {}) => ({ id, scheduled_date: date, ...extra });

test('a row appears for any date with a day, loose content, or today — and no others', () => {
  const rows = schedDayRows({
    from: '2026-08-01', to: '2026-08-31',
    shootDays: { '2026-08-04': [DAY('a', '2026-08-04')] },
    dayCounts: { '2026-08-06': 2 },
    todayIso: '2026-08-15',
  });
  assert.deepEqual(rows.map((r) => r.date), ['2026-08-04', '2026-08-06', '2026-08-15']);
  assert.equal(rows[0].days.length, 1);
  assert.equal(rows[1].loose, 2);
  // Today earns a row even with nothing on it: "nothing is scheduled today" is
  // an answer someone opened the card to get.
  assert.equal(rows[2].isToday, true);
  assert.equal(rows[2].days.length, 0);
  assert.equal(rows[2].loose, 0);
});

test('rows come out in date order and flag weekends', () => {
  const rows = schedDayRows({
    from: '2026-08-01', to: '2026-08-10',
    shootDays: {
      '2026-08-09': [DAY('c', '2026-08-09')],   // Sunday
      '2026-08-03': [DAY('a', '2026-08-03')],   // Monday
      '2026-08-08': [DAY('b', '2026-08-08')],   // Saturday
    },
    todayIso: '2026-12-01',                      // out of range: no today row
  });
  assert.deepEqual(rows.map((r) => r.date), ['2026-08-03', '2026-08-08', '2026-08-09']);
  assert.deepEqual(rows.map((r) => r.weekend), [false, true, true]);
});

test('a backwards or unparseable range yields nothing rather than spinning', () => {
  assert.deepEqual(schedDayRows({ from: '2026-08-10', to: '2026-08-01' }), []);
  assert.deepEqual(schedDayRows({ from: 'nope', to: '2026-08-01' }), []);
});

test('"next" looks across the WHOLE production, and skips cancelled days', () => {
  const shootDays = {
    '2026-08-10': [DAY('past', '2026-08-10')],
    '2026-08-20': [DAY('x', '2026-08-20', { sched_status: 'cancelled' })],
    '2026-08-22': [DAY('real', '2026-08-22')],
    '2026-09-01': [DAY('later', '2026-09-01')],
  };
  const n = schedNextDay(shootDays, '2026-08-15');
  assert.equal(n.date, '2026-08-22');
  assert.equal(n.board.id, 'real');
  // Nothing ahead → null, not a throw.
  assert.equal(schedNextDay(shootDays, '2027-01-01'), null);
  assert.equal(schedNextDay(null, '2026-08-15'), null);
});

test('the rail tuning constants the CSS mirrors are present', () => {
  for (const k of ['RAIL_W', 'RAIL_MIN_W', 'RAIL_MIN_H', 'DAYTILE_COMPACT_W', 'DAYTILE_COMPACT_H']) {
    assert.equal(typeof SCHED_TUNING[k], 'number', `${k} missing`);
  }
});

// ---------------------------------------------------------------------------
// Two item roles, one grammar
//
// `d:<date>/r:<uid>` is a rundown row and `d:<date>/i:<uid>` is loose content,
// and BOTH are items. isItemKey used to match only the second, so every read
// that gates on it — the day counts, the "N items" caption, the month chips,
// thumbnails, the search index, the public page — silently skipped a day's
// entire running order. These tests exist so that cannot come back.

const ROW = rundownKey('2026-08-18', 'r1');
const LOOSE = 'd:2026-08-18/i:l1';
const HOURED = 'd:2026-08-18/h:09/i:h1';

test('a rundown row is an item, and knows it is a row', () => {
  assert.equal(isItemKey(ROW), true);
  assert.equal(isItemKey(LOOSE), true);
  assert.equal(itemRole(ROW), 'row');
  assert.equal(itemRole(LOOSE), 'item');
  assert.equal(itemRole(HOURED), 'item');
  assert.equal(itemRole('d:2026-08-18'), null, 'a slot path is not an item');
  assert.equal(isItemKey('d:2026-08-18'), false);
});

test('both roles resolve to the same day slot', () => {
  assert.equal(slotOfItem(ROW), 'd:2026-08-18');
  assert.equal(slotOfItem(LOOSE), 'd:2026-08-18');
  assert.equal(slotOfItem(HOURED), 'd:2026-08-18/h:09');
  assert.deepEqual(parseItemKey(ROW), { slotPath: 'd:2026-08-18', role: 'row', uid: 'r1' });
  assert.equal(parseSlotKey(slotOfItem(ROW)).date, '2026-08-18');
});

test('moving a row to another date KEEPS it a row', () => {
  // lastIndexOf('/i:') returns -1 on a `/r:` key, so the old arithmetic sliced
  // from index 2 and would have re-minted the row as loose content whose uid
  // was a chunk of its own path.
  assert.equal(reslotItemKey(ROW, 'd:2026-08-19'), 'd:2026-08-19/r:r1');
  assert.equal(reslotItemKey(LOOSE, 'd:2026-08-19'), 'd:2026-08-19/i:l1');
  assert.equal(reslotItemKey(ROW, 'd:2026-08-18'), null, 'a move to home is a no-op');
});

test('a day with only a running order is not an empty day', () => {
  const cells = {
    [rundownKey('2026-08-18', 'a')]: { type: 'text', html: 'Crew call', dur: 30, pin: '07:00', ord: 'a0' },
    [rundownKey('2026-08-18', 'b')]: { type: 'text', html: 'Shoot 14A', dur: 135, ord: 'a1' },
  };
  assert.deepEqual(schedDayCounts(cells), { '2026-08-18': 2 },
    'the month grid and the LOD map count rundown rows');
  assert.equal(itemsForSlot('d:2026-08-18', Object.keys(cells)).length, 2);
  assert.equal(schedItems(cells).length, 2);
});

test('the summary reads a running order in the order it runs', () => {
  // Deliberately inserted with the LATER row first and a uid that sorts before
  // it, so plain key order would get this backwards.
  const cells = {
    [rundownKey('2026-08-18', 'aaa')]: { type: 'text', html: 'Shoot 14A', dur: 135, ord: 'a2' },
    [rundownKey('2026-08-18', 'zzz')]: { type: 'text', html: 'Crew call', dur: 30, pin: '07:00', ord: 'a1' },
  };
  const items = schedItems(cells);
  assert.deepEqual(items.map((i) => i.title), ['Crew call', 'Shoot 14A'],
    'ordered by the cascade, not by uid');

  // A PINNED row states its own time, so the summary may repeat it.
  assert.equal(items[0].hour, 7);
  assert.equal(items[0].minute, 0);
  // An unpinned row does NOT: its wall clock depends on boards.day_start, which
  // a cells map cannot see. Saying 09:15 when the card says 08:15 would be
  // worse than saying nothing.
  assert.equal(items[1].hour, null);
  assert.deepEqual(schedLegacyRows(items).map((r) => r.loc), ['7 AM', '']);
});

test('loose content sits above the clock, and mixes with rows on one date', () => {
  const cells = {
    'd:2026-08-18/i:note': { type: 'text', html: 'Bring the long lens' },
    [rundownKey('2026-08-18', 'a')]: { type: 'text', html: 'Crew call', dur: 30, pin: '07:00', ord: 'a0' },
    'd:2026-08-19/i:x': { type: 'image', src: 'r2:1' },
  };
  const items = schedItems(cells);
  assert.deepEqual(items.map((i) => i.date), ['2026-08-18', '2026-08-18', '2026-08-19']);
  assert.equal(items[0].title, 'Bring the long lens', 'untimed first, as the day view stacks it');
  assert.deepEqual(schedDayCounts(cells), { '2026-08-18': 2, '2026-08-19': 1 });
});

test('itemsForSlot orders rows by ord when it is given the records', () => {
  const cells = {
    [rundownKey('2026-08-18', 'zz')]: { type: 'text', html: 'second', ord: 'a2' },
    [rundownKey('2026-08-18', 'aa')]: { type: 'text', html: 'first', ord: 'a1' },
    'd:2026-08-18/i:l': { type: 'text', html: 'loose' },
  };
  const keys = Object.keys(cells);
  const ordered = itemsForSlot('d:2026-08-18', keys, { cells });
  assert.deepEqual(ordered, ['d:2026-08-18/i:l', rundownKey('2026-08-18', 'aa'), rundownKey('2026-08-18', 'zz')],
    'loose content, then the day in the order it runs');
  // Without the records it degrades to key order rather than throwing — every
  // pre-existing caller passes two arguments.
  assert.equal(itemsForSlot('d:2026-08-18', keys).length, 3);
});

test('direct vs deep still distinguishes an hour row from the day above it', () => {
  const keys = [ROW, LOOSE, HOURED];
  assert.deepEqual(itemsForSlot('d:2026-08-18', keys).sort(), [LOOSE, ROW].sort());
  assert.equal(itemsForSlot('d:2026-08-18', keys, { deep: true }).length, 3);
  assert.deepEqual(itemsForSlot('d:2026-08-18/h:09', keys), [HOURED]);
});
