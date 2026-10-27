// teamBillingApi.test.mjs — the team-billing and domain-check calls: URL,
// bearer, body and the never-throw shapes. supabase.js can't load under
// node (import.meta.env), so this tests teamBillingCore's factory, which
// teamBillingApi.js binds to the real session and fetch; a source check
// pins that binding.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTeamCalls } from './teamCalls.js';

const URL_ = 'https://p.supabase.co/functions/v1/team-billing?forceFunctionRegion=us-west-2';

function setup({ token = 'tok', respond } = {}) {
  const seen = [];
  const calls = makeTeamCalls({
    getToken: async () => token,
    fetchImpl: async (url, init) => {
      seen.push({ url, init, body: JSON.parse(init.body) });
      return respond ? respond() : { ok: true, status: 200, json: async () => ({ ok: true, url: 'u' }) };
    },
    billingUrl: URL_,
    domainCheckUrl: '/api/team/domain-check',
    getOrigin: () => 'https://app.test',
  });
  return { calls, seen };
}

test('posts to the URL with the bearer, the action and return_origin', async () => {
  const { calls, seen } = setup();
  const res = await calls.teamBilling('portal', { org_id: 'o1' });
  assert.deepEqual(res, { ok: true, url: 'u' });
  assert.equal(seen[0].url, URL_);
  assert.equal(seen[0].init.method, 'POST');
  assert.equal(seen[0].init.headers.authorization, 'Bearer tok');
  assert.deepEqual(seen[0].body, { action: 'portal', org_id: 'o1', return_origin: 'https://app.test' });
});

test('no session: auth required, and nothing is sent', async () => {
  const { calls, seen } = setup({ token: null });
  assert.deepEqual(await calls.teamBilling('sync', { org_id: 'o1' }), { ok: false, error: 'auth required' });
  assert.equal(seen.length, 0);
});

test('network failure and http errors resolve, never throw', async () => {
  const net = makeTeamCalls({
    getToken: async () => 't', fetchImpl: async () => { throw new TypeError('offline'); },
    billingUrl: URL_, domainCheckUrl: '/x', getOrigin: () => 'o',
  });
  assert.deepEqual(await net.teamBilling('sync'), { ok: false, error: 'network' });

  const bare = setup({ respond: () => ({ ok: false, status: 502, json: async () => { throw new Error('html'); } }) });
  assert.deepEqual(await bare.calls.teamBilling('sync'), { ok: false, error: 'http_502' });

  const srv = setup({ respond: () => ({ ok: false, status: 409, json: async () => ({ error: 'stale_preview', amount: 3 }) }) });
  assert.deepEqual(await srv.calls.teamBilling('seats_add'), { ok: false, error: 'stale_preview', amount: 3 });
});

test('the domain check posts { org_id, domain } to the Worker with the bearer', async () => {
  const { calls, seen } = setup({ respond: () => ({ ok: true, status: 200, json: async () => ({ ok: true, verified: false }) }) });
  assert.deepEqual(await calls.domainCheck('o1', 'x.co'), { ok: true, verified: false });
  assert.equal(seen[0].url, '/api/team/domain-check');
  assert.equal(seen[0].init.headers.authorization, 'Bearer tok');
  assert.deepEqual(seen[0].body, { org_id: 'o1', domain: 'x.co' });
});

test('teamBillingApi.js binds the real URL and each export sends its action and fields', () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'teamBillingApi.js'), 'utf8');
  assert.match(src, /\/functions\/v1\/team-billing\?forceFunctionRegion=us-west-2/);
  const want = {
    startTeamCheckout: ["'checkout'", 'workspace_ids', 'end_creator', 'org_id'],
    verifyTeamCheckout: ["'verify'", 'session_id'],
    openTeamPortal: ["'portal'", 'org_id'],
    previewTeamSeatsCost: ["'seats_preview'", 'seats'],
    addTeamSeats: ["'seats_add'", 'request_id', 'proration_date'],
    syncTeam: ["'sync'", 'org_id'],
  };
  for (const [fn, bits] of Object.entries(want)) {
    const m = src.match(new RegExp(`export function ${fn}\\([\\s\\S]*?\\n}\\n`));
    assert.ok(m, fn);
    for (const b of bits) assert.ok(m[0].includes(b), `${fn} ${b}`);
  }
});
