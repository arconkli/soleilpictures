// schedDatesWords: English is schedDates.js byte for byte; other languages come
// from Intl, so they are checked for shape (names, order of magnitude), not ICU's words.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as en from './schedDates.js';
import * as words from './schedDatesWords.js';
import { calWeeks } from './schedCalendar.js';
import { setUiLocale } from './uiLocale.js';

afterEach(() => setUiLocale('en'));

const ISOS = ['2026-01-01', '2026-02-28', '2026-06-15', '2026-07-04', '2026-12-31', '2024-02-29'];
const CLOCKS = ['00:00:00', '07:00:00', '07:30', '12:00:00', '13:45:00', '23:59:00', 'nope', '', null];

test('English equals the shared module for every input', () => {
  assert.deepEqual(words.monthNames(), en.MONTHS);
  assert.deepEqual(words.monthShortNames(), en.MONTHS_SHORT);
  assert.deepEqual(words.weekdayShortNames(), en.WEEKDAYS);
  for (const iso of [...ISOS, 'bad', '', undefined]) {
    assert.equal(words.monthTitle(iso), en.monthTitle(iso), `monthTitle ${iso}`);
    assert.equal(words.weekTitle(iso), en.weekTitle(iso), `weekTitle ${iso}`);
    assert.equal(words.dayTitle(iso), en.dayTitle(iso), `dayTitle ${iso}`);
    assert.equal(words.shortDate(iso), en.shortDate(iso), `shortDate ${iso}`);
    for (const h of [0, 1, 9, 12, 13, 23]) assert.equal(words.hourTitle(iso, h), en.hourTitle(iso, h), `hourTitle ${iso} ${h}`);
  }
  for (const [a, b] of [['2026-06-01', '2026-06-07'], ['2026-06-29', '2026-07-05'], ['2026-12-28', '2027-01-03']]) {
    const wk = calWeeks({ from: a, to: b, pad: false })[0];
    assert.equal(words.weekRange(a, b), wk.label, `weekRange ${a} ${b}`);
  }
  assert.equal(words.weekRange('bad', '2026-06-07'), '');
  for (const h of [-1, 0, 1, 11, 12, 13, 23, 24]) {
    assert.equal(words.hourLabel(h), en.hourLabel(h), `hourLabel ${h}`);
    for (const m of [0, 5, 15, 45]) assert.equal(words.timeLabel(h, m), en.timeLabel(h, m), `timeLabel ${h}:${m}`);
  }
  for (const a of CLOCKS) {
    assert.equal(words.clockLabel(a), en.clockLabel(a), `clockLabel ${a}`);
    for (const b of CLOCKS) assert.equal(words.clockRange(a, b), en.clockRange(a, b), `clockRange ${a} ${b}`);
  }
});

test('another language: twelve month names, seven Monday-first weekdays, and every function returns text', () => {
  setUiLocale('es');
  assert.equal(words.monthNames().length, 12);
  assert.equal(words.monthShortNames().length, 12);
  assert.equal(words.weekdayShortNames().length, 7);
  assert.equal(new Set(words.monthNames()).size, 12);
  assert.equal(new Set(words.weekdayShortNames()).size, 7);
  assert.notEqual(words.monthNames()[0], 'January');
  assert.notEqual(words.weekdayShortNames()[0], 'Mon');
  for (const iso of ISOS) {
    for (const s of [words.monthTitle(iso), words.weekTitle(iso), words.dayTitle(iso), words.shortDate(iso), words.hourTitle(iso, 9)]) {
      assert.ok(typeof s === 'string' && s.length > 0, `${iso}: ${s}`);
    }
    assert.ok(words.monthTitle(iso).includes(iso.slice(0, 4)), 'the year is in the month title');
  }
  assert.ok(words.hourLabel(9).includes('9'));
  assert.match(words.clockLabel('13:45:00'), /45/);
  assert.equal(words.clockLabel('nope'), '');
  assert.equal(words.clockRange('', ''), '');
  assert.equal(words.clockRange('', '07:00:00'), `until ${words.clockLabel('07:00:00')}`);   // catalogs are empty in node
  assert.equal(words.clockRange('07:00:00', ''), words.clockLabel('07:00:00'));
  assert.ok(words.clockRange('07:00:00', '19:30:00').includes(' – '));
});

test('an unreadable date falls back to the shared module', () => {
  setUiLocale('es');
  assert.equal(words.shortDate('bad'), 'bad');
  assert.equal(words.monthTitle('bad'), '');
  assert.equal(words.dayTitle(''), '');
});
