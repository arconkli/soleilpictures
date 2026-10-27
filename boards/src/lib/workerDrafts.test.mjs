// workerDrafts.test.mjs — the drafts' reaper (worker-drafts.js), without a
// network: mcp_draft_reap's rows in, Auth's admin API faked.
//
//   node --test src/lib/workerDrafts.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runDraftReap, isDraftIdentity, REAP_LIMIT } from '../worker-drafts.js';
import { draftEmail } from './mcpDrafts.js';
import { latestDefinition } from './migrationText.mjs';

const ENV = { SUPABASE_URL: 'https://db.example', SUPABASE_SERVICE_ROLE_KEY: 'svc' };
const D1 = 'd0000000-0000-4000-8000-000000000001';
const D2 = 'd0000000-0000-4000-8000-000000000002';
const D3 = 'd0000000-0000-4000-8000-000000000003';
const U1 = 'a0000000-0000-4000-8000-000000000001';
const U2 = 'a0000000-0000-4000-8000-000000000002';
const U3 = 'a0000000-0000-4000-8000-000000000003';
const draftUser = (id, draftId) => ({ id, email: draftEmail(draftId), user_metadata: { draft: true, host: 'chatgpt' } });

function fake({ rows, users = {}, refuseDelete = [], failGet = [] }) {
  const calls = { reap: [], get: [], del: [], reports: [] };
  return {
    calls,
    deps: {
      reap: async (env, limit) => { calls.reap.push(limit); return rows; },
      getUser: async (env, id) => {
        calls.get.push(id);
        if (failGet.includes(id)) throw new Error('admin/users 503');
        return users[id] ?? null;
      },
      deleteUser: async (env, id) => { calls.del.push(id); return !refuseDelete.includes(id); },
      report: async (env, error, phase) => { calls.reports.push({ message: error.message, phase }); },
    },
  };
}

test("a kept and an expired draft's identities are read back, then deleted", async () => {
  const { deps, calls } = fake({
    rows: [{ draft_id: D1, user_id: U1, outcome: 'kept' }, { draft_id: D2, user_id: U2, outcome: 'expired' }],
    users: { [U1]: draftUser(U1, D1), [U2]: draftUser(U2, D2) },
  });
  const out = await runDraftReap(ENV, deps);
  assert.deepEqual(out, { reaped: 2, kept: 1, expired: 1, deleted: 2, gone: 0, refused: 0, failed: 0 });
  assert.deepEqual(calls.reap, [REAP_LIMIT]);
  assert.deepEqual(calls.get, [U1, U2]);
  assert.deepEqual(calls.del, [U1, U2]);
  assert.deepEqual(calls.reports, []);
});

test("a person's account is never deleted, whatever the row says", async () => {
  const person = { id: U1, email: 'someone@example.com', user_metadata: {} };
  const otherDraft = draftUser(U2, D3);                                           // another draft's identity
  const unmarked = { id: U3, email: draftEmail(D3), user_metadata: {} };          // the address, no mark
  const { deps, calls } = fake({
    rows: [{ draft_id: D1, user_id: U1, outcome: 'kept' }, { draft_id: D2, user_id: U2, outcome: 'expired' },
           { draft_id: D3, user_id: U3, outcome: 'expired' }],
    users: { [U1]: person, [U2]: otherDraft, [U3]: unmarked },
  });
  const out = await runDraftReap(ENV, deps);
  assert.equal(out.refused, 3);
  assert.equal(out.deleted, 0);
  assert.deepEqual(calls.del, []);
  assert.equal(calls.reports.length, 3);
  assert.ok(calls.reports.every((r) => r.phase === 'check' && !/@/.test(r.message)), 'reported by draft id, never an address');
});

test('nothing to delete: the user is gone already, or the row has none', async () => {
  const { deps, calls } = fake({
    rows: [{ draft_id: D1, user_id: null, outcome: 'expired' }, { draft_id: D2, user_id: U2, outcome: 'kept' }],
    users: {},
  });
  const out = await runDraftReap(ENV, deps);
  assert.deepEqual(out, { reaped: 2, kept: 1, expired: 1, deleted: 0, gone: 2, refused: 0, failed: 0 });
  assert.deepEqual(calls.get, [U2]);
  assert.deepEqual(calls.del, []);
});

test("one that can't be read or deleted is left for the next run, reported once", async () => {
  const { deps, calls } = fake({
    rows: [{ draft_id: D1, user_id: U1, outcome: 'kept' }, { draft_id: D2, user_id: U2, outcome: 'expired' },
           { draft_id: D3, user_id: U3, outcome: 'expired' }],
    users: { [U2]: draftUser(U2, D2), [U3]: draftUser(U3, D3) },
    failGet: [U1],
    refuseDelete: [U2],
  });
  const out = await runDraftReap(ENV, deps);
  assert.deepEqual(out, { reaped: 3, kept: 1, expired: 2, deleted: 1, gone: 0, refused: 0, failed: 2 });
  assert.deepEqual(calls.del, [U2, U3], 'a failure goes on to the rest');
  assert.equal(calls.reports.length, 1);
  assert.match(calls.reports[0].phase, /^delete \(2 failed\)$/);
});

test('no service key, no run', async () => {
  const { deps, calls } = fake({ rows: [] });
  assert.deepEqual(await runDraftReap({}, deps), { skipped: 'no service key' });
  assert.deepEqual(calls.reap, []);
});

test("a draft's identity is its own address and its mark, nothing looser", () => {
  assert.equal(isDraftIdentity(draftUser(U1, D1), D1), true);
  assert.equal(isDraftIdentity({ ...draftUser(U1, D1), email: draftEmail(D1).toUpperCase() }, D1), true);
  assert.equal(isDraftIdentity(draftUser(U1, D1), D2), false);
  assert.equal(isDraftIdentity({ ...draftUser(U1, D1), user_metadata: { draft: 'true' } }, D1), false);
  assert.equal(isDraftIdentity(draftUser(U1, D1), 'not-a-uuid'), false);
  assert.equal(isDraftIdentity(null, D1), false);
});

test('the reaper runs hourly, watched, and the database half is what it expects', () => {
  const worker = readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
  const hourly = worker.slice(worker.indexOf("} else if (which === '15 * * * *') {"), worker.indexOf("} else if (which === '0 4 * * *') {"));
  assert.match(hourly, /ctx\.waitUntil\(watch\('mcp_drafts', runDraftReap\(env\)\)\);/);
  const reap = latestDefinition('mcp_draft_reap');
  assert.match(reap.body, /returns table \(draft_id uuid, user_id uuid, outcome text\)/);
  assert.match(reap.body, /least\(coalesce\(p_limit, 25\), 200\)/);
  assert.ok(REAP_LIMIT <= 200);
  // Deleting the identity is what ends a row's turn: user_id sets null with it.
  assert.match(readFileSync(new URL('../../../supabase/migrations/0705_mcp_drafts.sql', import.meta.url), 'utf8'),
    /user_id\s+uuid unique references auth\.users\(id\) on delete set null,/);
  assert.match(reap.body, /or \(m\.reaped_at is not null and m\.user_id is not null\)/);
});
