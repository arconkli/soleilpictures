// adminReportHarness.test.mjs — node --test src/lib/adminReportHarness.test.mjs
//
// The preview harness (?adminpreview=1, local/adminFixtures.js) answers
// admin_report the way the database does: the named report's own fixture, for
// its own arguments, inside { data, at }. Driven through lib/adminReport.js, as
// the desktop views and the phone panel drive it.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { adminReport, SHARED_REPORTS, _resetAdminReportForTests } from './adminReport.js';

const { installAdminPreviewMocks } = await import('../local/adminFixtures.js');
const client = {};
installAdminPreviewMocks(client);

beforeEach(() => _resetAdminReportForTests());

// The arguments each report is read with somewhere in the admin.
const ARGS = {
  admin_return_fixed_horizon: { p_since: '2026-08-17', p_horizon_days: 7, p_exclude_internal: true, p_verified_only: true },
  admin_built_return: { p_horizon_days: 7, p_exclude_internal: true, p_verified_only: true },
  admin_second_sitting: { p_exclude_internal: true, p_verified_only: true },
  admin_return_by_mode: { p_horizon_days: 7, p_measure: 'any', p_exclude_internal: true, p_verified_only: true },
  admin_activity_heatmap: { p_days: 30, p_tz: 'UTC', p_exclude_internal: true },
  admin_sharing_overview: { p_days: 30, p_exclude_internal: true },
  admin_tests_read: {},
};

test('every shared report comes back as its own fixture, with when it was computed', async () => {
  for (const fn of SHARED_REPORTS) {
    assert.ok(ARGS[fn], `no arguments listed here for ${fn}`);
    const direct = await client.rpc(fn, ARGS[fn]);
    const shared = await adminReport(client, fn, ARGS[fn]);
    assert.equal(shared.error, null, fn);
    // The return by mode has no fixture of its own; the harness answers it as
    // it answers any report it does not know, and admin_report passes that on.
    if (fn !== 'admin_return_by_mode') assert.ok(shared.data != null, `${fn} has no fixture`);
    assert.deepEqual(shared.data, direct.data, `${fn} through admin_report is not its own fixture`);
    assert.ok(!Number.isNaN(Date.parse(shared.at)), `${fn} carries no "at"`);
  }
});

test('the arguments reach the fixture', async () => {
  const week = await adminReport(client, 'admin_sharing_overview', { p_days: 7, p_exclude_internal: true });
  const quarter = await adminReport(client, 'admin_sharing_overview', { p_days: 90, p_exclude_internal: true });
  const direct = await client.rpc('admin_sharing_overview', { p_days: 7, p_exclude_internal: true });
  assert.deepEqual(week.data, direct.data);
  assert.notDeepEqual(week.data, quarter.data);
});

test('the raw call is the database\'s shape: { data, at } in data', async () => {
  const { data, error } = await client.rpc('admin_report', { p_fn: 'admin_tests_read', p_args: {}, p_fresh: true });
  assert.equal(error, null);
  assert.deepEqual(Object.keys(data).sort(), ['at', 'data']);
});
