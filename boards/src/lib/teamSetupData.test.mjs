import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadOwnPersonalWorkspaces, seatFloor, checkoutPlan } from './teamSetupData.js';

function fakeClient(result, calls = []) {
  const chain = {
    from(t) { calls.push(['from', t]); return chain; },
    select(c) { calls.push(['select', c]); return chain; },
    eq(k, v) { calls.push(['eq', k, v]); return chain; },
    is(k, v) { calls.push(['is', k, v]); return chain; },
    order(k, o) { calls.push(['order', k, o]); return Promise.resolve(result); },
  };
  return chain;
}

test('loadOwnPersonalWorkspaces asks for own, team-less workspaces by age', async () => {
  const calls = [];
  const rows = [{ id: 'a', name: 'One', created_at: '1' }, { id: 'b', name: 'Two', created_at: '2' }];
  const out = await loadOwnPersonalWorkspaces(fakeClient({ data: rows, error: null }, calls), 'u1');
  assert.deepEqual(out, [{ id: 'a', name: 'One' }, { id: 'b', name: 'Two' }]);
  assert.deepEqual(calls, [
    ['from', 'workspaces'], ['select', 'id, name, created_at'],
    ['eq', 'created_by', 'u1'], ['is', 'org_id', null], ['order', 'created_at', { ascending: true }],
  ]);
});

test('loadOwnPersonalWorkspaces returns [] on error, throw or no user', async () => {
  assert.deepEqual(await loadOwnPersonalWorkspaces(fakeClient({ data: null, error: { message: 'x' } }), 'u1'), []);
  assert.deepEqual(await loadOwnPersonalWorkspaces({ from() { throw new Error('boom'); } }, 'u1'), []);
  assert.deepEqual(await loadOwnPersonalWorkspaces(fakeClient({ data: [], error: null }), null), []);
});

test('seatFloor keeps the answer within 3..100', () => {
  assert.equal(seatFloor(undefined), 3);
  assert.equal(seatFloor(null), 3);
  assert.equal(seatFloor('x'), 3);
  assert.equal(seatFloor(1), 3);
  assert.equal(seatFloor(7), 7);
  assert.equal(seatFloor(250), 100);
});

test('checkoutPlan maps the billing choice to the Stripe plan', () => {
  assert.equal(checkoutPlan('year'), 'annual');
  assert.equal(checkoutPlan('month'), 'monthly');
  assert.equal(checkoutPlan(undefined), 'monthly');
});
