// Shoot-day creation.
//
// The assertion that matters most is the boring one: a bulk add is BOUNDED.
// Everything else here is arithmetic, but a mis-typed end date reaching
// createBoard in a loop makes clusters until something else stops it, and the
// thing that would stop it is the card cap firing sixty clusters too late.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  shootDayDates, nextDayNumber, shootDayCards, defaultShootRange,
  MAX_SHOOT_DAYS_PER_ADD,
  shootDayRundown,
} from './productionDayPlan.js';
import { computeRundown, isRundownKey } from './rundown.js';

test('a range covers every day inclusive of both ends', () => {
  assert.deepEqual(shootDayDates('2026-08-17', '2026-08-21'),
    ['2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21']);
});

test('a single-day range is one day, not zero', () => {
  assert.deepEqual(shootDayDates('2026-08-17', '2026-08-17'), ['2026-08-17']);
});

test('skipping weekends drops Saturday and Sunday', () => {
  // 2026-08-17 is a Monday.
  assert.deepEqual(shootDayDates('2026-08-17', '2026-08-23', { skipWeekends: true }),
    ['2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21']);
});

test('a six-day week is the default — weekends are kept unless asked', () => {
  assert.equal(shootDayDates('2026-08-17', '2026-08-23').length, 7);
});

test('the range crosses a month and a year without stumbling', () => {
  assert.deepEqual(shootDayDates('2026-12-30', '2027-01-02'),
    ['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
});

test('a backwards range produces nothing rather than looping', () => {
  assert.deepEqual(shootDayDates('2026-08-21', '2026-08-17'), []);
});

test('missing dates produce nothing', () => {
  assert.deepEqual(shootDayDates(null, '2026-08-17'), []);
  assert.deepEqual(shootDayDates('2026-08-17', null), []);
});

test('a fat-fingered end date is capped, not obeyed', () => {
  const many = shootDayDates('2026-01-01', '2099-01-01');
  assert.equal(many.length, MAX_SHOOT_DAYS_PER_ADD);
});

test('the cap survives weekend skipping too', () => {
  const many = shootDayDates('2026-01-01', '2099-01-01', { skipWeekends: true });
  assert.ok(many.length <= MAX_SHOOT_DAYS_PER_ADD);
});

// ---------------------------------------------------------------------------

test('numbering starts at 1 on an empty production', () => {
  assert.equal(nextDayNumber({}, 'p1'), 1);
});

test('a second bulk add continues the numbering instead of restarting', () => {
  const boards = {
    a: { parent_board_id: 'p1', scheduled_date: '2026-08-17', day_label: 'Day 1' },
    b: { parent_board_id: 'p1', scheduled_date: '2026-08-18', day_label: 'Day 2' },
    c: { parent_board_id: 'p1', scheduled_date: '2026-08-19', day_label: 'Day 12' },
  };
  assert.equal(nextDayNumber(boards, 'p1'), 13);
});

test('another production\'s days do not shift this one\'s numbering', () => {
  const boards = {
    a: { parent_board_id: 'p1', scheduled_date: '2026-08-17', day_label: 'Day 3' },
    b: { parent_board_id: 'OTHER', scheduled_date: '2026-08-18', day_label: 'Day 99' },
  };
  assert.equal(nextDayNumber(boards, 'p1'), 4);
});

test('undated clusters and free-text labels are ignored by the numbering', () => {
  const boards = {
    a: { parent_board_id: 'p1', scheduled_date: null, day_label: 'Day 40' },
    b: { parent_board_id: 'p1', scheduled_date: '2026-08-18', day_label: 'Company Move' },
    c: { parent_board_id: 'p1', scheduled_date: '2026-08-19', day_label: 'Day 2' },
  };
  assert.equal(nextDayNumber(boards, 'p1'), 3);
});

// ---------------------------------------------------------------------------

test('the scaffold is the four things a crew opens a day to find', () => {
  const kinds = shootDayCards('Day 1').map((c) => c.kind).sort();
  assert.deepEqual(kinds, ['doc', 'grid', 'note', 'schedule']);
});

test('the hour-by-hour reads its date from the cluster, not a copy of it', () => {
  const s = shootDayCards('Day 1').find((c) => c.kind === 'schedule');
  assert.equal(s.anchorMode, 'board');
  assert.equal(s.schedView, 'day');
  assert.ok(!('anchor' in s), 'a pinned anchor would go stale the moment the day moved');
});

test('a scaffolded day opens with a skeleton, not a blank page', () => {
  // An empty rundown is a blank page and a blank page is what people close.
  // Three rows: it starts, it breaks, and the break is PINNED — so the day
  // already demonstrates the behaviour the whole model exists for.
  const s = shootDayCards('Day 1', '2026-09-08').find((c) => c.kind === 'schedule');
  const rows = Object.entries(s.cells);
  assert.equal(rows.length, 3);
  assert.ok(rows.every(([k]) => isRundownKey(k)), 'seeded at rundown keys');
  assert.ok(rows.every(([k]) => k.startsWith('d:2026-09-08/')), 'on the right date');

  const r = computeRundown(rows.map(([key, v]) => ({ ...v, key })));
  assert.deepEqual(r.rows.map((x) => x.title), ['Crew call', 'First setup', 'Lunch']);
  assert.equal(r.rows[0].start, '07:00');
  assert.equal(r.rows[0].pinned, true, 'call time is a hard start');
  assert.equal(r.rows[2].start, '13:00', 'meal six hours after call');
  assert.equal(r.rows[2].pinned, true, 'so is the meal break');
});

test('an undated cluster scaffolds without a seed rather than at a wrong date', () => {
  // Rundown keys carry the date. With no date there is nowhere correct to put
  // the rows, and inventing one would bury three items on a day nobody picked.
  const s = shootDayCards('Day 1').find((c) => c.kind === 'schedule');
  assert.deepEqual(s.cells, {});
});

test('the seeded meal break wraps past midnight for a night call', () => {
  const rows = shootDayRundown('2026-09-08', '20:00');
  assert.equal(rows[0].pin, '20:00');
  assert.equal(rows[2].pin, '02:00', 'six hours after a 20:00 call is 02:00');
});

test('the scaffold never seeds a nested cluster card', () => {
  // Their ids point at the source workspace and a per-card doc store cannot be
  // cloned across boards — the reasoning showcaseClone.js already carries.
  for (const c of shootDayCards('Day 1')) {
    assert.ok(c.kind !== 'board' && c.kind !== 'boardlink', `seeded a ${c.kind} card`);
  }
});

test('scaffold cards have unique ids and real geometry', () => {
  const cards = shootDayCards('Day 1');
  assert.equal(new Set(cards.map((c) => c.id)).size, cards.length);
  for (const c of cards) {
    assert.ok(c.w > 0 && c.h > 0, `${c.kind} has no size`);
    assert.ok(Number.isFinite(c.x) && Number.isFinite(c.y), `${c.kind} has no position`);
  }
});

test('the scaffold cards do not overlap each other', () => {
  const cards = shootDayCards('Day 1');
  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) {
      const a = cards[i], b = cards[j];
      const apart = a.x + a.w <= b.x || b.x + b.w <= a.x
                 || a.y + a.h <= b.y || b.y + b.h <= a.y;
      assert.ok(apart, `${a.kind} overlaps ${b.kind}`);
    }
  }
});

test('a default range is a whole number of weeks ending on a day it includes', () => {
  const r = defaultShootRange('2026-08-17', 2);
  assert.equal(r.from, '2026-08-17');
  assert.equal(r.to, '2026-08-30');
  assert.equal(shootDayDates(r.from, r.to).length, 14);
});
