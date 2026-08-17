// The rundown cascade.
//
// This is the whole feature. Everything the day surface shows — every start
// time, the estimated wrap, the over/under, the gap and overlap warnings — is
// computed here, so a wrong number here is a wrong number on a call sheet.
//
// Two properties carry most of the weight:
//
// A HARD START HOLDS. When the plan does not fit around a pinned item, the pin
// does not move — the report does. Union meal breaks and permit windows are
// pins, and silently sliding one would be the single worst thing this could do.
//
// A DAY CAN CROSS MIDNIGHT. A night shoot calls at 18:00 and wraps at 04:00.
// Times accumulate past 1440 rather than wrapping, or the arithmetic reads as
// time travel and the wrap estimate comes out fourteen hours early.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeRundown, rundownFromCells, materializeLegacy, RUNDOWN_TUNING, RUNDOWN_KINDS,
  parseDuration, formatDuration, toMinutes, fromMinutes,
  rundownKey, isRundownKey, parseRundownKey, ordForIndex, ordForMove,
} from './rundown.js';

const D = '2026-09-08';
// ord keys ascend, so plain letters are enough to fix the order in a fixture.
const it = (ord, dur, extra = {}) =>
  ({ key: `d:${D}/r:${ord}`, ord, dur, type: 'text', ...extra });

const DAY = [
  it('a', 30, { html: 'Crew call', pin: '07:00' }),
  it('b', 30, { html: 'Breakfast' }),
  it('c', 45, { html: 'Rehearse 14A' }),
  it('d', 135, { html: 'Shoot 14A' }),
  it('e', 45, { html: 'Company move', kind: 'move' }),
  it('f', 87, { html: 'Shoot 22' }),
  it('g', 60, { html: 'Lunch', pin: '13:00', kind: 'break' }),
  it('h', 150, { html: 'Shoot 22B' }),
];

test('start times cascade from durations', () => {
  const r = computeRundown(DAY);
  assert.deepEqual(r.rows.map((x) => x.start),
    ['07:00', '07:30', '08:00', '08:45', '11:00', '11:45', '13:00', '14:00']);
  assert.equal(r.wrap, '16:30');
});

test('changing ONE duration re-times everything below it and nothing above', () => {
  // The entire reason for the rebuild: rehearsal runs 25 minutes long.
  const longer = DAY.map((x) => (x.ord === 'c' ? { ...x, dur: 70 } : x));
  const before = computeRundown(DAY);
  const after = computeRundown(longer);

  // Above the change: untouched.
  assert.deepEqual(after.rows.slice(0, 3).map((x) => x.start),
    before.rows.slice(0, 3).map((x) => x.start));
  // Below it, up to the next pin: shifted by exactly 25 minutes.
  assert.equal(after.rows[3].start, '09:10');   // was 08:45
  assert.equal(after.rows[4].start, '11:25');   // was 11:00
  assert.equal(after.rows[5].start, '12:10');   // was 11:45
});

test('a hard start does not move — it absorbs the overrun and reports it', () => {
  const r = computeRundown(DAY);
  const lunch = r.rows.find((x) => x.html === 'Lunch');
  // 11:45 + 1:27 = 13:12, twelve minutes past the pin.
  assert.equal(lunch.start, '13:00', 'the pin holds');
  assert.equal(lunch.overlapBefore, 12);
  assert.equal(lunch.gapBefore, 0);
  // And the afternoon carries on from the pin, not from the overrun.
  assert.equal(r.rows[7].start, '14:00');
});

test('a hard start with time to spare reports the dead air instead', () => {
  const early = DAY.map((x) => (x.ord === 'f' ? { ...x, dur: 30 } : x));
  const lunch = computeRundown(early).rows.find((x) => x.html === 'Lunch');
  assert.equal(lunch.start, '13:00');
  assert.equal(lunch.gapBefore, 45);            // 11:45 + 0:30 = 12:15
  assert.equal(lunch.overlapBefore, 0);
});

test('the first row never reports a gap against nothing', () => {
  const r = computeRundown(DAY);
  assert.equal(r.rows[0].gapBefore, 0);
  assert.equal(r.rows[0].overlapBefore, 0);
  assert.equal(r.rows[0].pinned, true);
});

test('over/under is measured against the planned wrap, and null when unset', () => {
  assert.equal(computeRundown(DAY).over, null, 'no target is not the same as on time');
  assert.equal(computeRundown(DAY, { plannedWrap: '16:00' }).over, 30);
  assert.equal(computeRundown(DAY, { plannedWrap: '17:00' }).over, -30);
  assert.equal(computeRundown(DAY, { plannedWrap: '16:30' }).over, 0);
});

test('the clock starts at the day start, the first pin, or the default', () => {
  assert.equal(computeRundown(DAY, { dayStart: '05:30' }).rows[0].start, '07:00',
    'an explicit start does not override a pin on the first row');
  const unpinned = DAY.map(({ pin, ...x }) => x);
  assert.equal(computeRundown(unpinned, { dayStart: '05:30' }).rows[0].start, '05:30');
  assert.equal(computeRundown(unpinned).rows[0].start, RUNDOWN_TUNING.DEFAULT_START);
});

test('a night shoot crosses midnight instead of travelling backwards', () => {
  const night = [
    it('a', 60, { html: 'Crew call', pin: '18:00' }),
    it('b', 240, { html: 'Shoot 8' }),
    it('c', 60, { html: 'Lunch', pin: '02:00', kind: 'break' }),
    it('d', 120, { html: 'Shoot 9' }),
  ];
  const r = computeRundown(night);
  assert.deepEqual(r.rows.map((x) => x.start), ['18:00', '19:00', '02:00', '03:00']);
  assert.equal(r.wrap, '05:00');
  assert.equal(r.wrapsNextDay, true);
  assert.equal(r.rows[2].startsNextDay, true, 'the 02:00 lunch is tomorrow');
  // 18:00 + 1:00 + 4:00 = 23:00, so there is an hour of slack before 02:00.
  assert.equal(r.rows[2].gapBefore, 180);
  assert.equal(r.total, 11 * 60);
});

test('an empty day is a wrap at the start, not a crash', () => {
  const r = computeRundown([], { dayStart: '07:00' });
  assert.deepEqual(r.rows, []);
  assert.equal(r.wrap, '07:00');
  assert.equal(r.total, 0);
  assert.deepEqual(computeRundown(null).rows, []);
});

test('every row pinned still cascades correctly between the pins', () => {
  const pinned = [
    it('a', 60, { pin: '09:00' }),
    it('b', 60, { pin: '11:00' }),
    it('c', 60, { pin: '12:00' }),
  ];
  const r = computeRundown(pinned);
  assert.deepEqual(r.rows.map((x) => x.start), ['09:00', '11:00', '12:00']);
  assert.equal(r.rows[1].gapBefore, 60, 'an hour of dead air');
  assert.equal(r.rows[2].gapBefore, 0, 'back to back');
});

test('a junk duration falls back to the default rather than poisoning the clock', () => {
  const bad = [it('a', 'nonsense', { pin: '07:00' }), it('b', null), it('c', -50), it('d', 99999)];
  const r = computeRundown(bad);
  assert.ok(r.rows.every((x) => Number.isFinite(x.startMin)), 'no NaN escapes');
  assert.equal(r.rows[0].dur, RUNDOWN_TUNING.DEFAULT_DUR);
  assert.equal(r.rows[2].dur, RUNDOWN_TUNING.MIN_DUR);
  assert.equal(r.rows[3].dur, RUNDOWN_TUNING.MAX_DUR);
});

test('a bad pin is ignored rather than resetting the day to midnight', () => {
  const bad = [it('a', 60, { pin: '07:00' }), it('b', 60, { pin: '25:99' })];
  const r = computeRundown(bad);
  assert.equal(r.rows[1].pinned, false);
  assert.equal(r.rows[1].start, '08:00', 'it just cascades');
});

// ── reading the old model ───────────────────────────────────────────────────

test('legacy hour items read as a chronological rundown, pinned to their hour', () => {
  const cells = {
    [`d:${D}/h:09/i:x`]: { type: 'text', html: 'Dailies' },
    [`d:${D}/h:14/m:30/i:y`]: { type: 'text', html: 'Notes' },
    [`d:${D}/h:07/i:z`]: { type: 'text', html: 'Crew call' },
    'd:2026-09-09/h:08/i:other': { type: 'text', html: 'Another day' },
  };
  const { items, hasLegacy, legacyKeys } = rundownFromCells(cells, D);
  assert.equal(hasLegacy, true);
  assert.equal(legacyKeys.length, 3, 'the other date is not touched');
  const r = computeRundown(items);
  assert.deepEqual(r.rows.map((x) => x.html), ['Crew call', 'Dailies', 'Notes']);
  assert.deepEqual(r.rows.map((x) => x.start), ['07:00', '09:00', '14:30']);
  assert.ok(r.rows.every((x) => x.pinned), 'pinned, because that is what the key said');
});

test('day-level loose items surface as untimed rather than vanishing', () => {
  const cells = {
    [`d:${D}/i:note`]: { type: 'text', html: 'Bring the generator' },
    [`d:${D}/h:09/i:x`]: { type: 'text', html: 'Dailies' },
  };
  const r = computeRundown(rundownFromCells(cells, D).items);
  assert.equal(r.untimed.length, 1);
  assert.equal(r.untimed[0].html, 'Bring the generator');
  assert.equal(r.rows.length, 1, 'untimed rows never consume the clock');
  assert.equal(r.rows[0].start, '09:00');
});

test('tombstones and src-less images are not resurrected as rows', () => {
  const cells = {
    [`d:${D}/r:a`]: { type: 'empty' },
    [`d:${D}/r:b`]: { type: 'image' },                 // no src
    [`d:${D}/r:c`]: { type: 'text', html: 'Real', ord: 'a' },
  };
  assert.equal(rundownFromCells(cells, D).items.length, 1);
});

test('a row can BE a board — the record is a normal cell record', () => {
  const cells = {
    [`d:${D}/r:a`]: { type: 'board', boardId: 'brd-1', name: 'Shoot 14A', ord: 'a', dur: 135, pin: '08:45' },
  };
  const r = computeRundown(rundownFromCells(cells, D).items);
  assert.equal(r.rows[0].type, 'board');
  assert.equal(r.rows[0].boardId, 'brd-1');
  assert.equal(r.rows[0].start, '08:45');
  assert.equal(r.rows[0].end, '11:00');
});

test('materialize rewrites the old keys once and deletes them', () => {
  const cells = {
    [`d:${D}/h:09/i:x`]: { type: 'text', html: 'Dailies' },
    [`d:${D}/i:n`]: { type: 'text', html: 'Note' },
    [`d:${D}/r:keep`]: { type: 'text', html: 'Already real', ord: 'm' },
  };
  let i = 0;
  const { writes, deletes } = materializeLegacy(cells, D, () => `u${i++}`);
  assert.equal(Object.keys(writes).length, 2, 'only the legacy ones');
  assert.deepEqual(deletes.sort(), [`d:${D}/h:09/i:x`, `d:${D}/i:n`].sort());
  assert.ok(Object.keys(writes).every(isRundownKey));
  // The rewritten rows keep their pin and carry an order key.
  const vals = Object.values(writes);
  assert.ok(vals.some((v) => v.pin === '09:00'));
  assert.ok(vals.every((v) => typeof v.ord === 'string' && v.ord));
  assert.ok(vals.every((v) => !('legacy' in v) && !('sortAt' in v)), 'no read-time noise persisted');
});

// ── keys, durations, ordering ───────────────────────────────────────────────

test('the key grammar round-trips and rejects its siblings', () => {
  const k = rundownKey(D, 'abc123');
  assert.equal(k, `d:${D}/r:abc123`);
  assert.deepEqual(parseRundownKey(k), { date: D, uid: 'abc123' });
  assert.equal(isRundownKey(k), true);
  for (const other of [`d:${D}`, `d:${D}/i:x`, `d:${D}/h:09`, `d:${D}/h:09/i:x`, '', null]) {
    assert.equal(isRundownKey(other), false, String(other));
  }
});

test('durations parse the way a person types them', () => {
  assert.equal(parseDuration('2:15'), 135);
  assert.equal(parseDuration('2h15'), 135);
  assert.equal(parseDuration('2h 15m'), 135);
  assert.equal(parseDuration('2h'), 120);
  assert.equal(parseDuration('45m'), 45);
  assert.equal(parseDuration('45'), 45);
  assert.equal(parseDuration('0:05'), 5);
  for (const junk of ['', '  ', 'soon', '2:99', null, undefined]) {
    assert.equal(parseDuration(junk), null, String(junk));
  }
});

test('durations render as h:mm, the way every rundown writes them', () => {
  assert.equal(formatDuration(135), '2:15');
  assert.equal(formatDuration(45), '0:45');
  assert.equal(formatDuration(0), '0:00');
  assert.equal(formatDuration(600), '10:00');
});

test('minutes convert both ways, carrying the day for an overnight', () => {
  assert.equal(toMinutes('07:00'), 420);
  assert.equal(toMinutes('nope'), null);
  assert.deepEqual(fromMinutes(420), { clock: '07:00', day: 0 });
  assert.deepEqual(fromMinutes(1680), { clock: '04:00', day: 1 });
});

test('dropping a row anywhere yields an order key that lands there', () => {
  const rows = computeRundown(DAY).rows;
  const head = ordForIndex(rows, 0);
  const tail = ordForIndex(rows, rows.length);
  const mid = ordForIndex(rows, 3);
  assert.ok(head < rows[0].ord);
  assert.ok(tail > rows[rows.length - 1].ord);
  assert.ok(rows[2].ord < mid && mid < rows[3].ord);
});

test('a move that goes nowhere returns null so it never enters undo', () => {
  const rows = computeRundown(DAY).rows;
  assert.equal(ordForMove(rows, 3, 3), null);
  assert.equal(ordForMove(rows, 3, 4), null, 'dropped back in its own slot');
  assert.equal(ordForMove(rows, -1, 2), null);
  assert.equal(ordForMove(rows, 99, 2), null);
});

test('moving a row up and down puts it exactly where it was dropped', () => {
  const rows = computeRundown(DAY).rows;
  // last row to the very top
  const up = ordForMove(rows, 7, 0);
  assert.ok(up < rows[0].ord, `${up} < ${rows[0].ord}`);
  // first row to the very bottom
  const down = ordForMove(rows, 0, 8);
  assert.ok(down > rows[7].ord, `${down} > ${rows[7].ord}`);
  // row 1 into the middle, between what will then be rows 4 and 5
  const inner = ordForMove(rows, 1, 5);
  assert.ok(rows[4].ord < inner && inner < rows[5].ord);
});

test('the kind vocabulary is the closed set the surface styles', () => {
  assert.deepEqual([...RUNDOWN_KINDS], ['item', 'break', 'move', 'note']);
});
