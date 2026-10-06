// resumeSitting.test.mjs — when the day-one "pick up where you left off" fires.
//
//   node --test src/lib/resumeSitting.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldGreetResume, lastTouchedCard, RESUME_GAP_MS, DAY_ONE_MS } from './resumeSitting.js';

const base = { awayMs: RESUME_GAP_MS, accountAgeMs: 3 * 3600_000, genuineCards: 4, greeted: false };

test('a real break on day one, back to real work, is greeted once', () => {
  assert.equal(shouldGreetResume(base), true);
  assert.equal(shouldGreetResume({ ...base, greeted: true }), false, 'once per page');
});

test('a short break, a later day, or nothing of their own is not', () => {
  assert.equal(shouldGreetResume({ ...base, awayMs: RESUME_GAP_MS - 1 }), false);
  assert.equal(shouldGreetResume({ ...base, accountAgeMs: DAY_ONE_MS }), false, 'day one only');
  assert.equal(shouldGreetResume({ ...base, accountAgeMs: -5 }), false, 'a clock in the future is not day one');
  assert.equal(shouldGreetResume({ ...base, genuineCards: 0 }), false, 'seed cards only');
  assert.equal(shouldGreetResume({ ...base, awayMs: NaN }), false);
  assert.equal(shouldGreetResume(), false);
});

test('the last-touched card is the newest of updatedAt and createdAt', () => {
  const cards = [
    { id: 'a', createdAt: '2026-10-05T10:00:00Z', updatedAt: '2026-10-05T10:00:00Z' },
    { id: 'b', createdAt: '2026-10-05T09:00:00Z', updatedAt: '2026-10-05T11:30:00Z' },
    { id: 'c', createdAt: '2026-10-05T11:00:00Z' },
    { id: null, createdAt: '2026-10-05T12:00:00Z' },
  ];
  assert.equal(lastTouchedCard(cards).id, 'b');
  assert.equal(lastTouchedCard([{ id: 'x' }]).id, 'x', 'undated still beats nothing');
  assert.equal(lastTouchedCard([]), null);
  assert.equal(lastTouchedCard(null), null);
});
