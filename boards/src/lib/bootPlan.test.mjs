// bootPlan: what an open can read before the app asks, from what the device
// remembers. Run: node --test src/lib/bootPlan.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootPlan, landsInPersonal, storedTip, personalKey, SESSION_PREFIX } from './bootPlan.js';

const UID = 'u1';
function storage(entries = {}) {
  const m = new Map(Object.entries(entries));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null) };
}
const key = (rest) => `${SESSION_PREFIX}${UID}.${rest}`;
const json = (v) => JSON.stringify(v);

test('a device that never opened this account starts nothing that could create a workspace', () => {
  assert.deepEqual(bootPlan(storage(), UID), { rpc: false, roots: [], list: null, tip: null });
});

test('a remembered team workspace: both roots, its list, and the cluster it was in', () => {
  const s = storage({
    [key('workspace')]: json({ activeWorkspaceId: 'team' }),
    [personalKey(UID)]: json({ workspaceId: 'mine' }),
    [key('team')]: json({ stack: ['team-root', 'c1', 'c2'] }),
  });
  assert.deepEqual(bootPlan(s, UID), { rpc: true, roots: ['team', 'mine'], list: 'team', tip: 'c2' });
});

test('only the personal workspace remembered: it is the one that opens', () => {
  const s = storage({ [personalKey(UID)]: json({ workspaceId: 'mine' }), [key('mine')]: json({ stack: ['r'] }) });
  assert.deepEqual(bootPlan(s, UID), { rpc: true, roots: ['mine'], list: 'mine', tip: 'r' });
});

test('a new account a claim put in a workspace gets that workspace\'s reads, never the RPC', () => {
  // An invite, a cluster link or a workspace link writes `.workspace` (and the
  // stack) before the session is set, for an account that may be minutes old.
  const s = storage({
    [key('workspace')]: json({ activeWorkspaceId: 'team' }),
    [key('team')]: json({ stack: ['shared-cluster'] }),
  });
  assert.deepEqual(bootPlan(s, UID), { rpc: false, roots: ['team'], list: 'team', tip: 'shared-cluster' });
});

test('one root when the open workspace is the personal one; an empty stack names no cluster', () => {
  const s = storage({
    [key('workspace')]: json({ activeWorkspaceId: 'mine' }),
    [personalKey(UID)]: json({ workspaceId: 'mine' }),
    [key('mine')]: json({ stack: [] }),
  });
  assert.deepEqual(bootPlan(s, UID), { rpc: true, roots: ['mine'], list: 'mine', tip: null });
});

test('what cannot be read is treated as never written', () => {
  const s = storage({ [key('workspace')]: '{not json', [personalKey(UID)]: 'null' });
  assert.deepEqual(bootPlan(s, UID), { rpc: false, roots: [], list: null, tip: null });
  const throwing = { getItem() { throw new Error('denied'); } };
  assert.deepEqual(bootPlan(throwing, UID), { rpc: false, roots: [], list: null, tip: null });
  assert.equal(storedTip(storage({ [key('w')]: json({ stack: 'x' }) }), UID, 'w'), null);
});

const USER = { id: UID, created_at: '2026-10-20T10:00:00Z' };
const settled = (rows) => ({ value: { data: rows, error: null } });

test('landing in the personal workspace: the remembered one decides', () => {
  assert.equal(landsInPersonal(storage({ [key('workspace')]: json({ activeWorkspaceId: 'mine' }) }), USER, 'mine', null), true);
  assert.equal(landsInPersonal(storage({ [key('workspace')]: json({ activeWorkspaceId: 'team' }) }), USER, 'mine', null), false);
});

test('with none remembered it waits for the memberships, and a fresh invite wins', () => {
  assert.equal(landsInPersonal(storage(), USER, 'mine', null), null, 'not known yet');
  assert.equal(landsInPersonal(storage(), USER, 'mine', { error: new Error('x') }), null);
  assert.equal(landsInPersonal(storage(), USER, 'mine', { value: { data: null, error: { code: '42501' } } }), null);
  assert.equal(landsInPersonal(storage(), USER, 'mine', settled([])), true);
  const invited = { workspace_id: 'team', role: 'editor', created_at: '2026-10-20T10:01:00Z',
    workspaces: { id: 'team', created_by: 'someone-else' } };
  assert.equal(landsInPersonal(storage(), USER, 'mine', settled([invited])), false);
  const longAgo = { ...invited, created_at: '2026-09-01T10:00:00Z' };
  assert.equal(landsInPersonal(storage(), USER, 'mine', settled([longAgo])), true);
});
