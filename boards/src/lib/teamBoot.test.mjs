// teamBoot: the joins App runs at boot, against a fake api and fake storages.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runTeamBoot, domainOf } from './teamBoot.js';
import { stashTeamLink, readTeamLink, stashTeamNote } from './teamLinks.js';

const TOKEN = '7f0c2a9e-1b3d-4c5e-8f60-123456789abc';

function fakeStore() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}
async function withStorage(fn) {
  const had = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const prev = { localStorage: globalThis.localStorage, sessionStorage: globalThis.sessionStorage };
  const ls = fakeStore();
  const ss = fakeStore();
  globalThis.window = { localStorage: ls, sessionStorage: ss };
  globalThis.localStorage = ls;
  globalThis.sessionStorage = ss;
  try { return await fn(); } finally {
    if (had) Object.defineProperty(globalThis, 'window', had); else delete globalThis.window;
    for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete globalThis[k]; else globalThis[k] = v; }
  }
}

function fakeApi(over = {}) {
  const calls = [];
  const rec = (name, ret) => async (arg) => {
    calls.push([name, arg]);
    if (over[name] === 'throw') throw Object.assign(new Error('boom'), over.err || {});
    return over[name] !== undefined ? over[name] : ret;
  };
  return {
    calls,
    acceptTeamInvite: rec('acceptTeamInvite', [{ org_id: 'o1', role: 'member', status: 'joined' }]),
    listMyTeams: rec('listMyTeams', [{ org_id: 'o1', name: 'Northlight' }]),
    claimMyTeamInvites: rec('claimMyTeamInvites', 0),
    myTeamOffers: rec('myTeamOffers', []),
    answerTeamOffer: rec('answerTeamOffer', [{ org_id: 'o2', role: 'member', status: 'joined' }]),
  };
}
function harness() {
  const toasts = [];
  let changedCalls = 0;
  return { toasts, get changedCalls() { return changedCalls; }, args: { userId: 'u1', email: 'sam@Northlight.Studio ', toast: (m) => toasts.push(m), onChanged: () => { changedCalls += 1; } } };
}

test('domainOf: after the last @, trimmed and lowercased', () => {
  assert.equal(domainOf('sam@Northlight.Studio '), 'northlight.studio');
  assert.equal(domainOf('a@b@c.co'), 'c.co');
  assert.equal(domainOf('nobody'), '');
  assert.equal(domainOf(null), '');
});

test('a stashed invite is accepted, named from listMyTeams, and clears', () => withStorage(async () => {
  stashTeamLink({ kind: 'invite', token: TOKEN });
  const api = fakeApi();
  const h = harness();
  const out = await runTeamBoot(h.args, api);
  assert.deepEqual(api.calls[0], ['acceptTeamInvite', { p_token: TOKEN }]);
  assert.equal(readTeamLink(), null);
  assert.deepEqual(h.toasts, ['You’re in Northlight. Its workspaces are in your workspace menu.']);
  assert.equal(h.changedCalls, 1);
  assert.equal(out.changed, true);
}));

test('a different-email refusal says so and changes nothing', () => withStorage(async () => {
  stashTeamLink({ kind: 'invite', token: TOKEN });
  const api = fakeApi({ acceptTeamInvite: 'throw', err: { code: '42501', message: 'invite is for a different email' } });
  const h = harness();
  const out = await runTeamBoot(h.args, api);
  assert.deepEqual(h.toasts, ['That team invite went to a different email address. Sign out, then sign in with that address to join.']);
  assert.equal(h.changedCalls, 0);
  assert.equal(out.changed, false);
}));

test('a second run in the same session skips the session-once calls', () => withStorage(async () => {
  const api = fakeApi();
  await runTeamBoot(harness().args, api);
  assert.ok(api.calls.some(([n]) => n === 'claimMyTeamInvites'));
  const again = fakeApi();
  await runTeamBoot(harness().args, again);
  assert.equal(again.calls.filter(([n]) => n === 'claimMyTeamInvites' || n === 'myTeamOffers').length, 0);
}));

test('an auto offer is answered with the domain line; the first ask offer goes to the note, unanswered', () => withStorage(async () => {
  const api = fakeApi({
    claimMyTeamInvites: 2,
    myTeamOffers: [
      { org_id: 'o2', name: 'Northlight', mode: 'auto' },
      { org_id: 'o3', name: 'Other', mode: 'ask' },
    ],
  });
  const h = harness();
  const asked = [];
  const out = await runTeamBoot({ ...h.args, ask: async (o) => { asked.push(o.org_id); } }, api);
  assert.deepEqual(asked, ['o3']);
  const answers = api.calls.filter(([n]) => n === 'answerTeamOffer');
  assert.deepEqual(answers, [['answerTeamOffer', { p_org_id: 'o2', p_join: true }]]);
  assert.deepEqual(h.toasts, [
    'You joined 2 teams you were invited to. Their workspaces are in your workspace menu.',
    'You joined Northlight, your company’s team, because you signed up with a northlight.studio email. Its workspaces are in your workspace menu.',
  ]);
  assert.equal(h.changedCalls, 1);
  assert.equal(out.changed, true);
}));

// The note answering: ask hands it the answer, and done reports what came back.
const answerVia = (join, status) => withStorage(async () => {
  const api = fakeApi({
    myTeamOffers: [{ org_id: 'o3', name: 'Other', mode: 'ask' }],
    answerTeamOffer: [{ org_id: 'o3', role: 'member', status }],
  });
  const h = harness();
  await runTeamBoot({ ...h.args, ask: async (o, { answer, done }) => done(join, await answer(join)) }, api);
  return { answers: api.calls.filter(([n]) => n === 'answerTeamOffer'), toasts: h.toasts, changed: h.changedCalls };
});

test('the note answers an ask offer: Join says so and refreshes, No thanks stays quiet', async () => {
  const yes = await answerVia(true, 'joined');
  assert.deepEqual(yes.answers, [['answerTeamOffer', { p_org_id: 'o3', p_join: true }]]);
  assert.deepEqual(yes.toasts, ['You joined Other, your company’s team, because you signed up with a northlight.studio email. Its workspaces are in your workspace menu.']);
  assert.equal(yes.changed, 1);
  const no = await answerVia(false, 'declined');
  assert.deepEqual(no.answers, [['answerTeamOffer', { p_org_id: 'o3', p_join: false }]]);
  assert.deepEqual(no.toasts, []);
  assert.equal(no.changed, 0);
});

test('a stashed note is toasted first and is gone after', () => withStorage(async () => {
  stashTeamNote('You’re in Northlight. Its workspaces are in your workspace menu.');
  stashTeamLink({ kind: 'invite', token: TOKEN });
  const h = harness();
  await runTeamBoot(h.args, fakeApi());
  assert.equal(h.toasts[0], 'You’re in Northlight. Its workspaces are in your workspace menu.');
  const h2 = harness();
  await runTeamBoot({ ...h2.args, userId: 'u2' }, fakeApi());
  assert.deepEqual(h2.toasts, []);
}));

test('every api call throwing never throws', () => withStorage(async () => {
  stashTeamLink({ kind: 'invite', token: TOKEN });
  const api = fakeApi({ acceptTeamInvite: 'throw', claimMyTeamInvites: 'throw', myTeamOffers: 'throw', listMyTeams: 'throw', answerTeamOffer: 'throw' });
  const h = harness();
  const out = await runTeamBoot(h.args, api);
  assert.equal(out.changed, false);
  assert.equal(h.changedCalls, 0);
}));
