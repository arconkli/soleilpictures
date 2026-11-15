import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { adminReport, SHARED_REPORTS, _resetAdminReportForTests } from './adminReport.js';

// A fake client: each rpc call is recorded and answered by handler(fn, args).
function fakeClient(handler) {
  const c = { calls: [] };
  c.rpc = async (fn, args) => { c.calls.push({ fn, args }); return handler(fn, args); };
  return c;
}

beforeEach(() => _resetAdminReportForTests());

test('a shared report goes through admin_report and unwraps data and at', async () => {
  const c = fakeClient(() => ({ data: { data: { n: 1 }, at: '2026-11-15T00:00:00Z' }, error: null }));
  const r = await adminReport(c, 'admin_tests_read', { p_days: 7 });
  assert.deepEqual(c.calls, [{ fn: 'admin_report', args: { p_fn: 'admin_tests_read', p_args: { p_days: 7 }, p_fresh: false } }]);
  assert.deepEqual(r, { data: { n: 1 }, error: null, at: '2026-11-15T00:00:00Z' });
});

test('fresh true passes p_fresh true', async () => {
  const c = fakeClient(() => ({ data: { data: 1, at: 'x' }, error: null }));
  await adminReport(c, SHARED_REPORTS[0], {}, { fresh: true });
  assert.equal(c.calls[0].args.p_fresh, true);
});

test('undefined args send p_args {}', async () => {
  const c = fakeClient(() => ({ data: { data: 1, at: 'x' }, error: null }));
  await adminReport(c, SHARED_REPORTS[0], undefined);
  assert.deepEqual(c.calls[0].args.p_args, {});
});

for (const code of ['PGRST202', '42883']) {
  test(`${code} falls back to the direct call and stays direct`, async () => {
    const c = fakeClient((fn) => (fn === 'admin_report'
      ? { data: null, error: { code } }
      : { data: { rows: 2 }, error: null }));
    const r = await adminReport(c, 'admin_built_return', { a: 1 });
    assert.deepEqual(r, { data: { rows: 2 }, error: null, at: null });
    assert.deepEqual(c.calls.map((x) => x.fn), ['admin_report', 'admin_built_return']);
    assert.deepEqual(c.calls[1].args, { a: 1 });
    await adminReport(c, 'admin_tests_read', {});
    assert.deepEqual(c.calls.map((x) => x.fn), ['admin_report', 'admin_built_return', 'admin_tests_read']);
  });
}

test('another error code is returned with no fallback', async () => {
  const err = { code: '42501' };
  const c = fakeClient(() => ({ data: null, error: err }));
  const r = await adminReport(c, 'admin_tests_read');
  assert.deepEqual(r, { data: null, error: err, at: null });
  assert.equal(c.calls.length, 1);
});

test('a report that is not shared goes direct', async () => {
  const c = fakeClient(() => ({ data: [1], error: null }));
  const r = await adminReport(c, 'admin_overview', { x: 1 });
  assert.deepEqual(c.calls, [{ fn: 'admin_overview', args: { x: 1 } }]);
  assert.deepEqual(r, { data: [1], error: null, at: null });
});

test('a direct error resolves data null with the error', async () => {
  const err = { code: 'x' };
  const c = fakeClient(() => ({ data: [1], error: err }));
  const r = await adminReport(c, 'admin_overview');
  assert.deepEqual(r, { data: null, error: err, at: null });
});

test('a thrown error resolves { error }', async () => {
  const boom = new Error('boom');
  const c = fakeClient(() => { throw boom; });
  assert.deepEqual(await adminReport(c, 'admin_tests_read'), { data: null, error: boom, at: null });
  assert.deepEqual(await adminReport(c, 'admin_overview'), { data: null, error: boom, at: null });
});
