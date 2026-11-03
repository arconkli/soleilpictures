// sessionRepair.test.mjs — a data request refused for an expired token is sent
// again once, after one shared refresh; nothing else is touched.
//
//   node --test src/lib/sessionRepair.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeSessionRepairFetch, bodyErrorCode } from './sessionRepair.js';

const REST = 'https://x.supabase.co/rest/v1/boards?select=*';
const RPC = 'https://x.supabase.co/rest/v1/rpc/board_tree';
const AUTH = 'https://x.supabase.co/auth/v1/token?grant_type=refresh_token';
const STORAGE = 'https://x.supabase.co/storage/v1/object/a/b';

const expired = () => new Response(JSON.stringify({ code: 'PGRST303', details: null, hint: null, message: 'JWT expired' }), { status: 401 });
const ok = (body = '[]') => new Response(body, { status: 200 });
const initWith = (token, extra = {}) => ({ method: 'GET', headers: new Headers({ apikey: 'k', Authorization: `Bearer ${token}` }), ...extra });

// A server that refuses `old` as expired and takes anything else; an auth
// client whose stored token is `stored` and whose refresh hands out `fresh`.
function world({ stored = 'old', fresh = 'new', refreshFails = false } = {}) {
  const sent = [];
  const auth = {
    token: stored,
    refreshes: 0,
    async getSession() { return { data: { session: this.token ? { access_token: this.token } : null }, error: null }; },
    async refreshSession() {
      this.refreshes += 1;
      await new Promise((r) => setTimeout(r, 5));
      if (refreshFails) { this.token = null; return { data: { session: null }, error: { code: 'refresh_token_not_found' } }; }
      this.token = fresh;
      return { data: { session: { access_token: fresh } }, error: null };
    },
  };
  const fetchNow = async (input, init) => {
    const bearer = new Headers(init?.headers).get('Authorization');
    sent.push({ url: String(input), bearer, body: init?.body });
    return bearer === 'Bearer old' ? expired() : ok();
  };
  return { sent, auth, f: makeSessionRepairFetch({ fetchNow, getAuth: () => auth }) };
}

test('an expired token on a data request: one refresh, sent again once with the new token', async () => {
  const w = world();
  const res = await w.f(REST, initWith('old'));
  assert.equal(res.status, 200);
  assert.equal(w.auth.refreshes, 1);
  assert.deepEqual(w.sent.map((s) => s.bearer), ['Bearer old', 'Bearer new']);
  assert.equal(new Headers(initWith('x').headers).get('apikey'), 'k');
});

test('an RPC and a write are sent again with their body', async () => {
  const w = world();
  const res = await w.f(RPC, initWith('old', { method: 'POST', body: '{"p_board_id":"b"}' }));
  assert.equal(res.status, 200);
  assert.deepEqual(w.sent.map((s) => s.body), ['{"p_board_id":"b"}', '{"p_board_id":"b"}']);
});

test('requests refused together share one refresh', async () => {
  const w = world();
  const all = await Promise.all([1, 2, 3, 4].map(() => w.f(REST, initWith('old'))));
  assert.deepEqual(all.map((r) => r.status), [200, 200, 200, 200]);
  assert.equal(w.auth.refreshes, 1);
});

test('a request refused after someone else refreshed takes the stored token, no second refresh', async () => {
  const w = world({ stored: 'new' });
  const res = await w.f(REST, initWith('old'));
  assert.equal(res.status, 200);
  assert.equal(w.auth.refreshes, 0);
  assert.deepEqual(w.sent.map((s) => s.bearer), ['Bearer old', 'Bearer new']);
});

test('a refresh the server refuses: the 401 goes back as it was, sent once', async () => {
  const w = world({ refreshFails: true });
  const res = await w.f(REST, initWith('old'));
  assert.equal(res.status, 401);
  assert.equal(bodyErrorCode(await res.text()), 'PGRST303', 'the caller still reads the body');
  assert.equal(w.sent.length, 1);
});

test('nothing else is retried', async () => {
  // Other 401s, other services, and a streamed body pass through untouched.
  const sent = [];
  const fetchNow = async (input, init) => {
    sent.push(String(input));
    return String(input).includes('/auth/') || String(input).includes('/storage/')
      ? expired()
      : new Response(JSON.stringify({ code: 'PGRST301', message: 'JWSError' }), { status: 401 });
  };
  const auth = { refreshes: 0, async getSession() { return { data: { session: { access_token: 'z' } } }; }, async refreshSession() { this.refreshes += 1; return { data: { session: { access_token: 'n' } } }; } };
  const f = makeSessionRepairFetch({ fetchNow, getAuth: () => auth });
  assert.equal((await f(REST, initWith('old'))).status, 401);
  assert.equal((await f(AUTH, initWith('old', { method: 'POST' }))).status, 401);
  assert.equal((await f(STORAGE, initWith('old'))).status, 401);
  assert.equal(auth.refreshes, 0);
  assert.equal(sent.length, 3);

  const w = world();
  const stream = new ReadableStream({ start(c) { c.close(); } });
  assert.equal((await w.f(REST, initWith('old', { method: 'POST', body: stream, duplex: 'half' }))).status, 401);
  assert.equal(w.auth.refreshes, 0);
});

test('a success or a non-401 failure is handed back untouched', async () => {
  const w = world({ stored: 'new' });
  const res = await w.f(REST, initWith('new'));
  assert.equal(res.status, 200);
  assert.equal(w.sent.length, 1);
  const f = makeSessionRepairFetch({ fetchNow: async () => new Response('{"code":"42501"}', { status: 403 }), getAuth: () => null });
  assert.equal((await f(REST, initWith('old'))).status, 403);
});

test('supabase.js loads the repair on the first 401', () => {
  const src = readFileSync(new URL('./supabase.js', import.meta.url), 'utf8');
  assert.ok(src.includes("import('./sessionRepair.js')"));
  assert.ok(src.includes('makeSessionRepair('));
  assert.ok(src.includes('global: { fetch: supabaseFetch }'));
});
