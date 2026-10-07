// adminFixtures.test.mjs — node --test src/lib/adminFixtures.test.mjs
//
// The admin preview harness (?adminpreview=1, local/adminFixtures.js) is what
// every Playwright guard on the Today view's weekly read stands on. When a
// fixture drifts, those guards fail three layers up, in a browser, as a marker
// "in the wrong place" or a verdict nobody expected. So the fixture's own
// promises are pinned here, by name, where a broken one says what it broke.
//
// The module takes its Supabase client as an argument and imports none, so a
// plain object stands in for the client and the RPC shim is driven exactly as
// the dashboard drives it.
//
// What is pinned is STRUCTURE, never a date: every weekly row is a UTC Monday
// counted back from this week's. The expected Monday is worked out here from
// the clock by a different method from the fixture's (walking back one day at
// a time rather than its (day + 6) % 7 arithmetic), because a test that shares
// the fixture's calendar would share its bugs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { breaksFor, markerIndex } from './weeklySeries.js';

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

// This week's UTC Monday for an instant: from its UTC midnight, step back a day
// at a time until getUTCDay() says Monday.
function mondayOfInstant(ms) {
  const d = new Date(ms);
  let day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  while (new Date(day).getUTCDay() !== 1) day -= DAY_MS;
  return new Date(day).toISOString().slice(0, 10);
}

// The fixture fixes its calendar when it is first imported. The clock is read
// on both sides of the import, so a run that straddles UTC midnight into a
// Monday accepts either week instead of failing on the boundary. Every other
// run has one candidate, and the assertions are exact.
const before = Date.now();
const { installAdminPreviewMocks, HARNESS_BREAKS } = await import('../local/adminFixtures.js');
const after = Date.now();
const THIS_MONDAY = [...new Set([mondayOfInstant(before), mondayOfInstant(after)])];

const isMonday = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay() === 1;
const weeksBack = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) - n * WEEK_MS).toISOString().slice(0, 10);

const client = {};
installAdminPreviewMocks(client);

/** One RPC through the shim, as the dashboard makes it; the shim never errors. */
async function rpc(name, params) {
  const { data, error } = await client.rpc(name, params);
  assert.equal(error, null, `${name} returned an error`);
  return data;
}

/**
 * The shim reads ?weeks=N from window.location, which node does not have. A
 * stand-in exists only for the length of `fn`, so no other test sees a window.
 */
async function withSearch(search, fn) {
  const had = Object.prototype.hasOwnProperty.call(globalThis, 'window');
  const prev = globalThis.window;
  globalThis.window = { location: { search } };
  try {
    return await fn();
  } finally {
    if (had) globalThis.window = prev;
    else delete globalThis.window;
  }
}

const series = () => rpc('admin_weekly_series', { p_weeks: 14 });

test('the weekly series is fourteen UTC Mondays, a week apart, ending with this one', async () => {
  const rows = await series();
  assert.equal(rows.length, 14);
  rows.forEach((r, i) => {
    assert.ok(isMonday(r.week_start), `row ${i}: ${r.week_start} is not a Monday`);
    if (i > 0) {
      assert.equal(
        Date.parse(r.week_start) - Date.parse(rows[i - 1].week_start),
        WEEK_MS,
        `rows ${i - 1} and ${i} (${rows[i - 1].week_start}, ${r.week_start}) are not one week apart`,
      );
    }
  });
  assert.ok(
    THIS_MONDAY.includes(rows.at(-1).week_start),
    `the last row is ${rows.at(-1).week_start}, not this week's Monday (${THIS_MONDAY.join(' or ')})`,
  );
});

test('a weekly count is null exactly where its week was not measured', async () => {
  // NULL means "we were not counting" and 0 means "nobody"; the trend read
  // treats them differently, so the two must never be mixed up in a fixture.
  const rows = await series();
  for (const [col, flag] of [['work_users', 'work_measurable'], ['active_users', 'active_measurable']]) {
    rows.forEach((r, i) => {
      assert.equal(typeof r[flag], 'boolean', `row ${i}: ${flag} is ${JSON.stringify(r[flag])}`);
      assert.equal(
        r[col] === null,
        !r[flag],
        `row ${i}: ${col} is ${JSON.stringify(r[col])} with ${flag} ${r[flag]}`,
      );
      if (r[flag]) assert.ok(Number.isFinite(r[col]), `row ${i}: measured ${col} is not a number`);
    });
  }
  // The work series has both kinds of week, or the rule is vacuous for it.
  assert.ok(rows.some((r) => !r.work_measurable), 'no unmeasured work week');
  assert.ok(rows.some((r) => r.work_measurable), 'no measured work week');
});

test('only the last two weeks are settling, and only the last one is incomplete', async () => {
  const rows = await series();
  const last = rows.length - 1;
  assert.deepEqual(rows.map((r) => r.settling), rows.map((_, i) => i >= last - 1), 'settling flags');
  assert.deepEqual(rows.map((r) => r.complete), rows.map((_, i) => i < last), 'complete flags');
});

test("the ship note sits exactly on the fourth week's Monday", async () => {
  // The Playwright marker guard expects it at index 3 of 0..13, which is 3/13
  // of each chart's width. A day after the Monday would put it a seventh of a
  // column off, and the guard would be measuring the fixture, not the chart.
  const rows = await series();
  const ships = (await rpc('admin_markers')).filter((m) => m.kind === 'ship');
  assert.equal(ships.length, 1, 'the guard anchors on exactly one ship marker');
  const [ship] = ships;
  assert.equal(ship.source, 'note');
  assert.equal(ship.day, rows[3].week_start, 'not on WK[3]');
  assert.ok(
    THIS_MONDAY.map((m) => weeksBack(m, 10)).includes(ship.day),
    `${ship.day} is not ten weeks before this week's Monday`,
  );
  assert.deepEqual(markerIndex(ship.day, rows.map((r) => r.week_start)), { index: 3, edge: false });
});

test('the harness cut leaves the work tile three measured weeks, one short of a read', async () => {
  // Every Playwright test that reads the work tile waits for "Too few weeks
  // (3 of 4)", so this is what that wait stands on.
  const rows = await series();
  const cut = breaksFor('work_users', HARNESS_BREAKS).at(-1);
  assert.equal(cut?.week, rows[10].week_start, 'the cut does not fall on WK[10]');
  const scored = rows.filter((r) => r.complete && r.work_measurable && r.week_start >= cut.week);
  assert.equal(scored.length, 3);
});

test('?weeks=3 keeps the three newest complete weeks and the week so far', async () => {
  const all = await series();
  // p_weeks is still sent, as the dashboard hard-codes it; the switch wins.
  const rows = await withSearch('?weeks=3', series);
  assert.deepEqual(rows.map((r) => r.week_start), all.slice(-4).map((r) => r.week_start));
  assert.deepEqual(rows.map((r) => r.complete), [true, true, true, false]);
});

test('a note deletes once, and its undo restores the same note', async () => {
  // The Today view's remove-and-undo is a soft delete: the second delete of
  // one note reports false ("already removed"), and the restore hands back
  // the same row, id and all, not a copy under a new id.
  const today = (await series()).at(-1).week_start;
  const added = await rpc('admin_note_add', { p_day: today, p_label: 'Fixture test note', p_kind: 'note' });
  assert.ok(Number.isInteger(added?.id), 'admin_note_add returned no row');
  const listed = async () => (await rpc('admin_markers'))
    .filter((m) => m.source === 'note' && m.ref_id === added.id).length;
  assert.equal(await listed(), 1);

  assert.equal(await rpc('admin_note_delete', { p_id: added.id }), true);
  assert.equal(await rpc('admin_note_delete', { p_id: added.id }), false, 'a second delete must report nothing deleted');
  assert.equal(await listed(), 0);

  const restored = await rpc('admin_note_restore', { p_id: added.id });
  assert.equal(restored?.id, added.id, 'the undo restored a different id');
  assert.deepEqual(restored, added);
  assert.equal(await listed(), 1);
  assert.equal(await rpc('admin_note_restore', { p_id: added.id }), null, 'restored a note that was not deleted');

  // Leave the module's notes as they were found.
  assert.equal(await rpc('admin_note_delete', { p_id: added.id }), true);
});
