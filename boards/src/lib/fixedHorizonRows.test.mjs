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

test('a custom order picks and orders the groups; unnamed kinds are dropped', () => {
  const rows = [
    { dim: 'all', n: 50, returned: 10 },
    { dim: 'band:3-5', n: 10, returned: 2 },
    { dim: 'week:2026-09-07', n: 12, returned: 3 },
    { dim: 'device:desktop', n: 40, returned: 9 },
    { dim: 'link:3-12 · one sitting', n: 20, returned: 5 },
  ];
  const g = groupFixedHorizon(rows, ['link', 'week']);
  assert.deepEqual(g.groups.map((x) => x.key), ['link', 'week']);
  // The default order still ignores 'link', so the 0322 panel is unchanged.
  assert.deepEqual(groupFixedHorizon(rows).groups.map((x) => x.key), ['device', 'band', 'week']);
});

test('mode rows read hand, burst, none; mode_band rows read shallow to deep, hand before burst', () => {
  const g = groupFixedHorizon([
    { dim: 'all', n: 200, returned: 60 },
    { dim: 'mode:none', n: 50, returned: 6 },
    { dim: 'mode:burst', n: 34, returned: 9 },
    { dim: 'mode:hand', n: 116, returned: 45 },
    { dim: 'mode_band:13+ · burst', n: 18, returned: 5 },
    { dim: 'mode_band:3-12 · hand', n: 58, returned: 19 },
    { dim: 'mode_band:13+ · hand', n: 48, returned: 26 },
    { dim: 'mode_band:0-2 · hand', n: 46, returned: 3 },
    { dim: 'mode_band:3-12 · burst', n: 14, returned: 4 },
    { dim: 'mode_band:0-2 · burst', n: 2, returned: 0 },
  ], ['mode', 'mode_band']);
  assert.deepEqual(g.groups.map((x) => x.key), ['mode', 'mode_band']);
  assert.deepEqual(g.groups[0].rows.map((r) => r.label), ['hand', 'burst', 'none']);
  assert.deepEqual(g.groups[1].rows.map((r) => r.label), [
    '0-2 · hand', '0-2 · burst', '3-12 · hand', '3-12 · burst', '13+ · hand', '13+ · burst',
  ]);
  // The 0322 panel's default order still ignores both kinds.
  assert.deepEqual(groupFixedHorizon([{ dim: 'mode:hand', n: 1, returned: 1 }]).groups, []);
});

test('link rows read shallow to deep, one sitting before two+ inside each band', () => {
  const g = groupFixedHorizon([
    { dim: 'link:13+ · two+ sittings', n: 24, returned: 18 },
    { dim: 'link:0-2 · two+ sittings', n: 9, returned: 2 },
    { dim: 'link:3-12 · one sitting', n: 46, returned: 11 },
    { dim: 'link:13+ · one sitting', n: 31, returned: 7 },
    { dim: 'link:0-2 · one sitting', n: 72, returned: 5 },
    { dim: 'link:3-12 · two+ sittings', n: 10, returned: 7 },
  ], ['link']);
  assert.deepEqual(g.groups[0].rows.map((r) => r.label), [
    '0-2 · one sitting', '0-2 · two+ sittings',
    '3-12 · one sitting', '3-12 · two+ sittings',
    '13+ · one sitting', '13+ · two+ sittings',
  ]);
});
