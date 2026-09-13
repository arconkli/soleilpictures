// returnVisit.test.mjs — did this person come back today?
//
//   node --test src/lib/returnVisit.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordSeen, takeReturn, __resetReturnVisit } from './returnVisit.js';

function mem() { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; }

test('first sighting returns null and stamps the day; a later day returns the gap', () => {
  __resetReturnVisit();
  const storage = mem();
  assert.equal(recordSeen('u1', { today: '2026-09-10', storage }), null);
  __resetReturnVisit();
  assert.equal(recordSeen('u1', { today: '2026-09-12', storage }), 2);
  assert.equal(takeReturn('u1'), 2);
});

test('same-day repeats do not re-announce a return', () => {
  __resetReturnVisit();
  const storage = mem();
  storage.setItem('soleil_last_seen_day_u2', '2026-09-11');
  assert.equal(recordSeen('u2', { today: '2026-09-12', storage }), 1);
  assert.equal(recordSeen('u2', { today: '2026-09-12', storage }), 1, 'idempotent within a page load');
  __resetReturnVisit();
  assert.equal(recordSeen('u2', { today: '2026-09-12', storage }), null, 'a second load the same day is not a return');
});

test('takeReturn is undefined when nobody recorded this uid, and storage failures never throw', () => {
  __resetReturnVisit();
  assert.equal(takeReturn('nobody'), undefined);
  const broken = { getItem: () => { throw new Error('quota'); }, setItem: () => { throw new Error('quota'); } };
  assert.equal(recordSeen('u3', { today: '2026-09-12', storage: broken }), null);
  assert.equal(recordSeen(null, { today: '2026-09-12', storage: mem() }), null);
});
