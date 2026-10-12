// adminStalledSignups.test.mjs — node --test src/lib/adminStalledSignups.test.mjs
//
// "Arrived and stalled" says "signed up ≤14d ago, no card ever". It filtered on
// days since last activity instead, so old accounts got in and people who
// never opened the app (no active day, days_dormant null) were dropped.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stalledSignups, daysSinceSignup } from '../pages/admin/analytics/stalledSignups.js';

const NOW = Date.parse('2026-10-12T15:00:00Z');
const row = (id, signup, extra = {}) => ({
  user_id: id, email: `${id}@example.com`, signup, did_card: false,
  last_active_day: null, days_dormant: null, active_day_count: 0, ...extra,
});

test('signup age is whole UTC days', () => {
  assert.equal(daysSinceSignup('2026-10-12', NOW), 0);
  assert.equal(daysSinceSignup('2026-09-28', NOW), 14);
  assert.equal(daysSinceSignup('nonsense', NOW), null);
});

test('never-opened recent signups are kept', () => {
  const { rows, total } = stalledSignups([row('a', '2026-10-10')], { now: NOW });
  assert.equal(total, 1);
  assert.equal(rows[0].user_id, 'a');
  assert.equal(rows[0].signup_age, 2);
});

test('an old account that was active recently is not a recent signup', () => {
  const old = row('old', '2026-06-01', { last_active_day: '2026-10-08', days_dormant: 4, active_day_count: 9 });
  assert.equal(stalledSignups([old], { now: NOW }).total, 0);
});

test('anyone with a card is out, and the window edge is inclusive', () => {
  const r = stalledSignups([
    row('carded', '2026-10-11', { did_card: true }),
    row('edge', '2026-09-28'),
    row('past', '2026-09-27'),
  ], { now: NOW });
  assert.deepEqual(r.rows.map((x) => x.user_id), ['edge']);
});

test('most-returning first, then newest; total counts past the limit', () => {
  const r = stalledSignups([
    row('n1', '2026-10-01'),
    row('n2', '2026-10-11'),
    row('back3', '2026-10-02', { active_day_count: 3, days_dormant: 2, last_active_day: '2026-10-10' }),
  ], { now: NOW, limit: 2 });
  assert.deepEqual(r.rows.map((x) => x.user_id), ['back3', 'n2']);
  assert.equal(r.total, 3);
});
