// Clock-time helpers for the schedule card (lib/schedDates.js).
//
// boards.day_start / day_end are bare Postgres `time`, which PostgREST hands
// back as 'HH:MM:SS'. This is the start time a crew member opens the card to
// read — every source on call sheets says it is the single most important line
// on the page — so the parse has to be strict rather than forgiving: a bad
// value must render as ABSENT, never silently as midnight. A call sheet that
// confidently says 12:00 AM because someone fat-fingered a field is worse than
// one that says nothing.

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseClock, formatClock, clockLabel, clockRange } from './schedDates.js';

test('parses what Postgres actually sends, and the shorter forms', () => {
  assert.deepEqual(parseClock('07:00:00'), { h: 7, m: 0 });
  assert.deepEqual(parseClock('07:00'), { h: 7, m: 0 });
  assert.deepEqual(parseClock('7:05'), { h: 7, m: 5 });
  assert.deepEqual(parseClock('  18:30:00  '), { h: 18, m: 30 });
  assert.deepEqual(parseClock('00:00:00'), { h: 0, m: 0 });
  assert.deepEqual(parseClock('23:59'), { h: 23, m: 59 });
});

test('a value out of range is absent, not clamped to midnight', () => {
  for (const bad of ['24:00', '07:60', '7', 'noon', '', null, undefined, 700, {}]) {
    assert.equal(parseClock(bad), null, String(bad));
  }
});

test('a round trip through the database is byte-identical', () => {
  const t = parseClock('06:30:00');
  assert.equal(formatClock(t.h, t.m), '06:30:00');
  assert.equal(formatClock(7), '07:00:00');
});

test('labels read as a call time, not as a database column', () => {
  assert.equal(clockLabel('07:00:00'), '7:00 AM');
  assert.equal(clockLabel('00:15:00'), '12:15 AM');
  assert.equal(clockLabel('12:00:00'), '12:00 PM');
  assert.equal(clockLabel('19:30:00'), '7:30 PM');
  assert.equal(clockLabel('23:59:00'), '11:59 PM');
});

test('an unparseable time labels as empty so a caller needs no second null check', () => {
  assert.equal(clockLabel(null), '');
  assert.equal(clockLabel('25:00'), '');
});

test('a range reads start to end, and survives half of one', () => {
  assert.equal(clockRange('07:00:00', '19:30:00'), '7:00 AM – 7:30 PM');
  assert.equal(clockRange('07:00:00', null), '7:00 AM');
  assert.equal(clockRange(null, '19:30:00'), 'until 7:30 PM');
  assert.equal(clockRange(null, null), '');
});

test('an overnight range is rendered, not rejected', () => {
  // A night shoot calls at 18:00 and wraps at 04:00. 0247 deliberately carries
  // no day_end >= day_start constraint for exactly this reason, so nothing
  // downstream may treat it as invalid either.
  assert.equal(clockRange('18:00:00', '04:00:00'), '6:00 PM – 4:00 AM');
});
