// teamSnapshot.test.mjs — get_team + get_team_billing folded into the
// TeamSnapshot (fixtures in the shapes 0535 and 0538 return).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toTeamSnapshot, snapshotIsReal } from './teamSnapshot.js';

const DAY = 864e5;

const TEAM = {
  id: 'o1', name: 'Atlas', letter: 'A', color: '#123456', sample: false, status: 'active',
  me: { id: 'u1', role: 'owner' },
  admins: [{ id: 'u1', name: 'Ana' }],
  people: [{ id: 'u1', name: 'Ana', email: 'ana@x.co', role: 'owner', invited: null }],
  requests: [], plan: null, storage: null, unpaid: null,
  seats: { bought: 5, used: 2, pending: 1, ceiling: 20 },
  whenFull: { mode: 'auto', monthlyLimit: 4 },
  joining: { link: { on: false, token: null, role: null }, domains: [] },
  workspaces: [{ id: 'w1', name: 'Main', letter: 'M', color: null, private: false }],
};

const BILLING = {
  status: 'active', is_owner: true, seats: 5, plan: 'annual', subscription_status: 'active',
  current_period_end: '2027-01-02T00:00:00Z', trial_end: null, cancel_at_period_end: true,
  auto_added_this_month: 2, storage_used_bytes: 100, storage_quota_bytes: 1e12,
  view_only_since: null, past_due_since: null, grace_ends_at: null,
};

test('owner with billing: plan, storage and whenFull fold in', () => {
  const t = toTeamSnapshot(TEAM, BILLING);
  assert.equal(snapshotIsReal(t), true);
  assert.deepEqual(t.plan, {
    interval: 'year', seats: 5, renewsAt: Date.parse('2027-01-02T00:00:00Z'), trialEndsAt: null,
    status: 'active', cancelAtPeriodEnd: true, card: null, receiptsTo: null,
  });
  assert.deepEqual(t.storage, { usedBytes: 100, quotaBytes: 1e12 });
  assert.deepEqual(t.whenFull, { mode: 'auto', monthlyLimit: 4, addedThisMonth: 2 });
  assert.equal(t.unpaid, null);
  assert.deepEqual(t.seats, TEAM.seats);
  assert.deepEqual(t.people, TEAM.people);
  assert.equal(toTeamSnapshot(TEAM, { ...BILLING, plan: 'monthly' }).plan.interval, 'month');
  assert.equal(toTeamSnapshot(TEAM, { ...BILLING, plan: null }).plan, null);
});

test('member: no billing, so plan, storage and unpaid are null and nothing is invented', () => {
  const member = {
    ...TEAM, me: { id: 'u2', role: 'member' }, requests: null, seats: null, whenFull: null, joining: null,
    people: [{ id: 'u1', name: 'Ana', email: null, role: 'owner', invited: null }],
  };
  const t = toTeamSnapshot(member, null);
  assert.equal(t.plan, null);
  assert.equal(t.storage, null);
  assert.equal(t.unpaid, null);
  assert.equal(t.whenFull, null);
  assert.equal(t.requests, null);
  assert.equal(t.joining, null);
  assert.equal(t.seats, null);
  assert.equal(t.people[0].email, null);
  assert.equal(JSON.stringify(t).includes('@'), false);
});

test('past due, in grace: failedAt and graceEndsAt, no deleteAt', () => {
  const t = toTeamSnapshot(TEAM, {
    ...BILLING, subscription_status: 'past_due',
    past_due_since: '2026-10-01T00:00:00Z', grace_ends_at: '2026-10-08T00:00:00Z',
  });
  assert.deepEqual(t.unpaid, {
    failedAt: Date.parse('2026-10-01T00:00:00Z'),
    graceEndsAt: Date.parse('2026-10-08T00:00:00Z'),
    viewOnly: false, deleteAt: null,
  });
});

test('view-only: deleteAt is 365 days after view_only_since', () => {
  const since = '2026-10-09T00:00:00Z';
  const t = toTeamSnapshot({ ...TEAM, status: 'view_only' }, {
    ...BILLING, status: 'view_only', view_only_since: since,
    past_due_since: '2026-10-01T00:00:00Z', grace_ends_at: '2026-10-08T00:00:00Z',
  });
  assert.equal(t.unpaid.viewOnly, true);
  assert.equal(t.unpaid.failedAt, Date.parse('2026-10-01T00:00:00Z'));
  assert.equal(t.unpaid.deleteAt, Date.parse(since) + 365 * DAY);
});
