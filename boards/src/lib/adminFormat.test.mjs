// adminFormat's date helpers read a bare 'YYYY-MM-DD' as the calendar day it
// names. The admin RPCs' `day` columns are UTC days, and new Date('2026-10-19')
// is UTC midnight, the evening of the 18th in California, so every day-grain
// axis label read one day early there.

import test from 'node:test';
import assert from 'node:assert/strict';
import { shortDate, fmtDate, fmtDateTime } from './adminFormat.js';

// West of Greenwich is where the old reading went wrong. Node applies a TZ
// change at runtime, and this file runs in its own process under node --test.
process.env.TZ = 'America/Los_Angeles';

test('a day string is the day it names, west of Greenwich', () => {
  assert.equal(shortDate('2026-10-19'), '10/19');
  assert.equal(shortDate('2026-01-01'), '1/1');
  assert.equal(fmtDate('2026-10-19'), new Date(2026, 9, 19).toLocaleDateString());
  assert.equal(fmtDateTime('2026-10-19'), new Date(2026, 9, 19).toLocaleString());
});

test('an instant is still an instant, shown in local time', () => {
  // 03:00 UTC on the 19th is 20:00 on the 18th in Los Angeles.
  assert.equal(shortDate('2026-10-19T03:00:00Z'), '10/18');
  assert.equal(shortDate(Date.UTC(2026, 9, 19, 20)), '10/19');
});

test('bad input never renders NaN', () => {
  assert.equal(shortDate('not a date'), '');
  assert.equal(shortDate('2026-13-45x'), '');
  assert.equal(fmtDate(null), '—');
  assert.equal(fmtDateTime(''), '');
});
