// fixedHorizonRows.test.mjs — grouping admin_return_fixed_horizon rows for the panel.
//
//   node --test src/lib/fixedHorizonRows.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupFixedHorizon, BAND_ORDER } from './fixedHorizonRows.js';

test('splits dims into groups, keeps the all row aside, and orders bands by depth', () => {
  const g = groupFixedHorizon([
    { dim: 'all', n: 100, returned: 30, pct: 0.3 },
    { dim: 'band:13+', n: 10, returned: 7, pct: 0.7 },
    { dim: 'band:0', n: 40, returned: 6, pct: 0.15 },
    { dim: 'device:desktop', n: 80, returned: 28, pct: 0.35 },
    { dim: 'week:2026-09-07', n: 8, returned: 2, pct: 0.25 },
    { dim: 'week:2026-08-31', n: 30, returned: 12, pct: 0.4 },
  ]);
  assert.equal(g.all.n, 100);
  assert.equal(g.all.returned, 30);
  const band = g.groups.find((x) => x.key === 'band');
  assert.deepEqual(band.rows.map((r) => r.label), ['0', '13+']);
  const week = g.groups.find((x) => x.key === 'week');
  assert.deepEqual(week.rows.map((r) => r.label), ['2026-08-31', '2026-09-07']);
  assert.ok(band.rows[1].ci.lo > 0.3 && band.rows[1].ci.hi < 1, 'wilson interval attached');
  assert.equal(BAND_ORDER.indexOf('6-12'), 3);
  // Groups come out in a fixed order regardless of input order.
  assert.deepEqual(g.groups.map((x) => x.key), ['device', 'band', 'week']);
});

test('device and source rows sort by size, biggest first', () => {
  const g = groupFixedHorizon([
    { dim: 'source:reddit', n: 10, returned: 2 },
    { dim: 'source:google', n: 90, returned: 20 },
  ]);
  assert.deepEqual(g.groups[0].rows.map((r) => r.label), ['google', 'reddit']);
});

test('tolerates garbage rows and an empty input', () => {
  assert.equal(groupFixedHorizon(null).all, null);
  assert.deepEqual(groupFixedHorizon([{ dim: 42 }, {}, { dim: 'nocolon' }]).groups, []);
  assert.equal(groupFixedHorizon([{ dim: 'all', n: 'x', returned: null }]).all.n, 0);
});
