import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commentTimeWords, commentFullDate } from './commentTime.js';

// Local-time dates, so the words are the same in whatever zone the test runs.
const at = (y, mo, d, h = 12, mi = 0, s = 0) => new Date(y, mo - 1, d, h, mi, s).getTime();
const NOW = at(2026, 11, 15, 14, 5);   // Sunday 15 November 2026, 14:05

test('minutes and hours', () => {
  assert.equal(commentTimeWords(NOW, NOW), 'now');
  assert.equal(commentTimeWords(NOW - 59 * 1000, NOW), 'now');
  assert.equal(commentTimeWords(NOW + 5000, NOW), 'now', 'a clock a little ahead');
  assert.equal(commentTimeWords(NOW - 60 * 1000, NOW), '1m');
  assert.equal(commentTimeWords(NOW - 5 * 60 * 1000, NOW), '5m');
  assert.equal(commentTimeWords(NOW - 59 * 60 * 1000, NOW), '59m');
  assert.equal(commentTimeWords(NOW - 60 * 60 * 1000, NOW), '1h');
  assert.equal(commentTimeWords(at(2026, 11, 15, 0, 10), NOW), '13h');
});

test('across midnight: hours while it is recent, then Yesterday', () => {
  const early = at(2026, 11, 15, 2, 0);
  assert.equal(commentTimeWords(at(2026, 11, 14, 23, 0), early), '3h');
  assert.equal(commentTimeWords(at(2026, 11, 14, 19, 0), early), 'Yesterday');
  assert.equal(commentTimeWords(at(2026, 11, 14, 9, 0), NOW), 'Yesterday');
});

test('a weekday within the week, then the date, day first', () => {
  assert.equal(commentTimeWords(at(2026, 11, 13, 9, 0), NOW), 'Fri');
  assert.equal(commentTimeWords(at(2026, 11, 9, 9, 0), NOW), 'Mon');
  assert.equal(commentTimeWords(at(2026, 11, 8, 9, 0), NOW), '8 Nov');
  assert.equal(commentTimeWords(at(2026, 1, 2, 9, 0), NOW), '2 Jan');
});

test('another year carries the year', () => {
  assert.equal(commentTimeWords(at(2025, 11, 12, 9, 0), NOW), '12 Nov 2025');
  assert.equal(commentTimeWords(at(2025, 12, 31, 23, 0), at(2026, 1, 20)), '31 Dec 2025');
});

test('ISO strings and nothing', () => {
  assert.equal(commentTimeWords(new Date(NOW - 2 * 3600 * 1000).toISOString(), NOW), '2h');
  assert.equal(commentTimeWords('', NOW), '');
  assert.equal(commentTimeWords(null, NOW), '');
  assert.equal(commentTimeWords('nonsense', NOW), '');
});

test('mid-line, the day word is lower case', () => {
  assert.equal(commentTimeWords(at(2026, 11, 14, 9, 0), NOW, { midLine: true }), 'yesterday');
  assert.equal(commentTimeWords(at(2026, 11, 13, 9, 0), NOW, { midLine: true }), 'Fri');
  assert.equal(commentTimeWords(at(2026, 11, 8, 9, 0), NOW, { midLine: true }), '8 Nov');
  assert.equal(commentTimeWords(NOW - 5 * 60 * 1000, NOW, { midLine: true }), '5m');
});

test('the whole date, short: weekday, day, month, then the clock in the reader\'s locale', () => {
  const t = at(2026, 11, 14, 7, 58);
  assert.equal(commentFullDate(t, { locale: 'en-GB', now: NOW }), 'Sat 14 Nov, 07:58');
  assert.match(commentFullDate(t, { locale: 'en-US', now: NOW }), /^Sat 14 Nov, 7:58\s?AM$/);
  assert.equal(commentFullDate(at(2026, 1, 1, 0, 0), { locale: 'en-GB', now: NOW }), 'Thu 1 Jan, 00:00');
  assert.equal(commentFullDate(new Date(t).toISOString(), { locale: 'en-GB', now: NOW }), 'Sat 14 Nov, 07:58');
  assert.equal(commentFullDate(null), '');
  assert.equal(commentFullDate('nonsense'), '');
  // a locale the runtime doesn't know still gives a date
  assert.match(commentFullDate(t, { locale: 'not_a_locale!', now: NOW }), /^Sat 14 Nov, /);
});

test('the whole date carries the year when it is not this one', () => {
  assert.equal(commentFullDate(at(2025, 11, 15, 7, 58), { locale: 'en-GB', now: NOW }), 'Sat 15 Nov 2025, 07:58');
  assert.equal(commentFullDate(at(2025, 12, 31, 23, 0), { locale: 'en-GB', now: at(2026, 1, 20) }), 'Wed 31 Dec 2025, 23:00');
});
