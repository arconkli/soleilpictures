// teamActions.test.mjs — each Team page action reaches the right call, with
// the right arguments, and failures read as refusals. The api is a fake.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runTeamAction, normalizeDomain } from './teamActions.js';

const NAMES = [
  'renameTeam', 'setTeamRole', 'removeFromTeam', 'revokeTeamInvite', 'approveTeamRequest',
  'keepTeamRequestViewer', 'removeTeamSeat', 'addTeamSeats', 'setTeamWhenFull', 'inviteToTeam',
  'setTeamLink', 'resetTeamLink', 'setTeamDomainOn', 'addTeamDomain', 'removeTeamDomain',
  'checkTeamDomain', 'closeTeam', 'leaveTeam', 'openTeamPortal', 'setTeamSeatPerk',
];

function fake(over = {}) {
  const calls = [];
  const api = {};
  for (const n of NAMES) api[n] = async (...args) => { calls.push([n, ...args]); return over[n] ?? null; };
  return { api, calls };
}

const O = 'org-1';

async function one(type, payload, over) {
  const { api, calls } = fake(over);
  const res = await runTeamAction(api, O, type, payload);
  return { res, calls };
}

test('each action calls the right function with the right arguments', async () => {
  const cases = [
    ['rename', { name: 'New' }, ['renameTeam', { p_org_id: O, p_name: 'New', p_color: null }]],
    ['role', { personId: 'u2', role: 'admin', addSeats: true }, ['setTeamRole', { p_org_id: O, p_user_id: 'u2', p_role: 'admin', p_add_seats: true }]],
    ['remove', { personId: 'u2' }, ['removeFromTeam', { p_org_id: O, p_user_id: 'u2' }]],
    ['revoke', { personId: 'invite:abc' }, ['revokeTeamInvite', { p_invite_id: 'abc' }]],
    ['approve', { requestId: 'r1', addSeat: true }, ['approveTeamRequest', { p_request_id: 'r1', p_add_seat: true }]],
    ['keepViewer', { requestId: 'r1' }, ['keepTeamRequestViewer', { p_request_id: 'r1' }]],
    ['removeSeat', {}, ['removeTeamSeat', { p_org_id: O }]],
    ['addSeats', { seats: 7, requestId: 'q', prorationDate: 99 }, ['addTeamSeats', O, 7, { requestId: 'q', prorationDate: 99 }]],
    ['whenFull', { mode: 'auto', current: { mode: 'ask', monthlyLimit: 5 } }, ['setTeamWhenFull', { p_org_id: O, p_mode: 'auto', p_monthly_limit: 5 }]],
    ['monthlyLimit', { value: '12', current: { mode: 'auto', monthlyLimit: null } }, ['setTeamWhenFull', { p_org_id: O, p_mode: 'auto', p_monthly_limit: 12 }]],
    ['monthlyLimit', { value: '', current: { mode: 'auto', monthlyLimit: 3 } }, ['setTeamWhenFull', { p_org_id: O, p_mode: 'auto', p_monthly_limit: null }]],
    ['invite', { emails: ['a@x.co'], role: 'editor', addSeats: true }, ['inviteToTeam', { p_org_id: O, p_emails: ['a@x.co'], p_role: 'member', p_add_seats: true }]],
    ['invite', { emails: ['a@x.co'], role: 'viewer' }, ['inviteToTeam', { p_org_id: O, p_emails: ['a@x.co'], p_role: 'viewer', p_add_seats: false }]],
    ['link', { on: true }, ['setTeamLink', { p_org_id: O, p_on: true }]],
    ['linkRole', { role: 'editor' }, ['setTeamLink', { p_org_id: O, p_role: 'member' }]],
    ['linkRole', { role: 'viewer' }, ['setTeamLink', { p_org_id: O, p_role: 'viewer' }]],
    ['newLink', {}, ['resetTeamLink', { p_org_id: O }]],
    ['domainOn', { domain: 'x.co', on: false }, ['setTeamDomainOn', { p_org_id: O, p_domain: 'x.co', p_on: false }]],
    ['removeDomain', { domain: 'x.co' }, ['removeTeamDomain', { p_org_id: O, p_domain: 'x.co' }]],
    ['checkDomain', { domain: 'x.co' }, ['checkTeamDomain', O, 'x.co']],
    ['close', {}, ['closeTeam', { p_org_id: O }]],
    ['leave', {}, ['leaveTeam', { p_org_id: O }]],
    ['portal', {}, ['openTeamPortal', O]],
    ['seatPerk', { on: true }, ['setTeamSeatPerk', { p_org_id: O, p_on: true }]],
  ];
  for (const [type, payload, want] of cases) {
    const { res, calls } = await one(type, payload);
    assert.equal(res.ok, true, type);
    assert.deepEqual(calls, [want], type);
  }
});

test('domainOn with several domains sets each', async () => {
  const { res, calls } = await one('domainOn', { domains: ['a.co', 'b.co'], on: true });
  assert.equal(res.ok, true);
  assert.deepEqual(calls.map((c) => c[1].p_domain), ['a.co', 'b.co']);
});

test('addDomain normalises: trim, lowercase, @, and an IDN to its xn-- form', async () => {
  assert.equal(normalizeDomain('  @Example.COM '), 'example.com');
  assert.equal(normalizeDomain('Bücher.de'), 'xn--bcher-kva.de');
  const { calls } = await one('addDomain', { domain: ' Bücher.DE ' });
  assert.deepEqual(calls, [['addTeamDomain', { p_org_id: O, p_domain: 'xn--bcher-kva.de' }]]);
});

test('resend is not available yet', async () => {
  const { res, calls } = await one('resend', { personId: 'invite:abc' });
  assert.deepEqual(res, { ok: false, refusal: { code: 'not_yet' } });
  assert.deepEqual(calls, []);
});

test('revoke only handles team invites', async () => {
  for (const personId of ['pending:abc', 'u2', undefined]) {
    const { res, calls } = await one('revoke', { personId });
    assert.deepEqual(res, { ok: false, refusal: { code: 'unsupported' } });
    assert.deepEqual(calls, []);
  }
  const { res } = await one('nope', {});
  assert.equal(res.refusal.code, 'unsupported');
});

test('a thrown team refusal reads through teamRefusal', async () => {
  const { api } = fake();
  api.removeFromTeam = async () => { throw { hint: 'team_not_admin', message: 'no' }; };
  assert.deepEqual(await runTeamAction(api, O, 'remove', { personId: 'u' }),
    { ok: false, refusal: { code: 'team_not_admin', needed: null } });
  api.setTeamRole = async () => { throw { hint: 'team_seats_needed', details: '2' }; };
  assert.deepEqual(await runTeamAction(api, O, 'role', { personId: 'u', role: 'member' }),
    { ok: false, refusal: { code: 'team_seats_needed', needed: 2 } });
  api.leaveTeam = async () => { throw new Error('boom'); };
  assert.deepEqual(await runTeamAction(api, O, 'leave', {}),
    { ok: false, refusal: { code: 'failed', message: 'boom' } });
});

test('a team-billing { ok:false, error } passes through with its fields', async () => {
  const { res } = await one('addSeats', { seats: 7, requestId: 'q' },
    { addTeamSeats: { ok: false, error: 'stale_preview', amount: 12 } });
  assert.deepEqual(res, { ok: false, refusal: { code: 'stale_preview', amount: 12 } });
  const good = await one('portal', {}, { openTeamPortal: { ok: true, url: 'https://x' } });
  assert.deepEqual(good.res, { ok: true, data: { ok: true, url: 'https://x' } });
});
