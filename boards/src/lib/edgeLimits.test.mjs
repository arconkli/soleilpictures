// edgeLimits — the limits counted across isolates, the bindings that count
// them, and the endpoints that ask: the OAuth endpoints that reach the database
// before anyone has proven anything, and the API's token check, which keeps the
// database's refusals instead of asking again.
//
// Run: node --test src/lib/edgeLimits.test.mjs

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { EDGE_LIMITS, makeEdgeLimiter } from './edgeLimits.js';
import { handleOAuthRoute } from '../worker-oauth.js';
import { resolveApiToken } from './apiAuth.js';

const WRANGLER = readFileSync(new URL('../../wrangler.toml', import.meta.url), 'utf8');

// Each [[ratelimits]] table in wrangler.toml, up to the next table that is not
// its own [ratelimits.simple].
function ratelimitBindings(toml) {
  return toml.split(/^\[\[ratelimits\]\]\s*$/m).slice(1).map((chunk) => {
    const body = chunk.split(/^\s*\[(?!ratelimits\.simple\])/m)[0];
    const get = (key) => body.match(new RegExp(`^\\s*${key}\\s*=\\s*"?([^"\\n]+?)"?\\s*$`, 'm'))?.[1];
    return {
      name: get('name'), namespaceId: get('namespace_id'),
      limit: Number(get('limit')), period: Number(get('period')),
    };
  });
}

// ── The table and the bindings ───────────────────────────────────────────────

test('every limit is a binding in wrangler.toml with the same numbers, and nothing else is', () => {
  const bindings = ratelimitBindings(WRANGLER);
  assert.deepEqual(bindings.map((b) => b.name).sort(), Object.keys(EDGE_LIMITS).sort());
  for (const b of bindings) {
    const want = EDGE_LIMITS[b.name];
    assert.equal(b.limit, want.limit, `${b.name} limit`);
    assert.equal(b.period, want.period, `${b.name} period`);
    assert.match(b.namespaceId, /^[1-9]\d*$/, `${b.name} namespace_id is a positive integer`);
  }
  const ids = bindings.map((b) => b.namespaceId);
  assert.equal(new Set(ids).size, ids.length, 'a namespace_id counts one limit, never two');
});

test('a period is one Cloudflare offers', () => {
  for (const [name, { limit, period }] of Object.entries(EDGE_LIMITS)) {
    assert.ok(period === 10 || period === 60, `${name}: the binding takes 10 or 60 seconds`);
    assert.ok(Number.isInteger(limit) && limit > 0, `${name}: a positive whole limit`);
  }
});

test('an unknown limit is a mistake in code, never a silent pass', () => {
  assert.throws(() => makeEdgeLimiter('NOPE'), /no limit named NOPE/);
});

// ── Counting ─────────────────────────────────────────────────────────────────

test('without a binding the isolate counts, and says how long to wait', async () => {
  let t = 1_000_000;
  const allow = makeEdgeLimiter('OAUTH_REGISTER', { now: () => t });
  const { limit, period } = EDGE_LIMITS.OAUTH_REGISTER;
  for (let i = 0; i < limit; i++) assert.deepEqual(await allow({}, '203.0.113.1'), { ok: true });
  t += 15_000;
  assert.deepEqual(await allow({}, '203.0.113.1'), { ok: false, retryAfter: period - 15 });
  assert.deepEqual(await allow({}, '203.0.113.2'), { ok: true }, 'another address has its own count');
  t += (period - 15) * 1000;
  assert.deepEqual(await allow({}, '203.0.113.1'), { ok: true }, 'a new window');
});

test('with a binding the binding counts, by the same key', async () => {
  const keys = [];
  let left = 2;
  const env = { OAUTH_TOKEN: { limit: async ({ key }) => { keys.push(key); return { success: left-- > 0 }; } } };
  const allow = makeEdgeLimiter('OAUTH_TOKEN');
  assert.deepEqual(await allow(env, '198.51.100.9'), { ok: true });
  assert.deepEqual(await allow(env, '198.51.100.9'), { ok: true });
  assert.deepEqual(await allow(env, '198.51.100.9'), { ok: false, retryAfter: EDGE_LIMITS.OAUTH_TOKEN.period });
  assert.deepEqual(keys, ['198.51.100.9', '198.51.100.9', '198.51.100.9']);
  left = 1;
  assert.deepEqual(await allow(env, null), { ok: true });
  assert.equal(keys.at(-1), 'unknown', 'no address is one key, never a free pass per request');
});

test('a binding that fails neither refuses anyone nor lifts the limit', async () => {
  const env = { OAUTH_LOOKUP: { limit: async () => { throw new Error('counter unreachable'); } } };
  const odd = { OAUTH_LOOKUP: { limit: async () => undefined } };
  const allow = makeEdgeLimiter('OAUTH_LOOKUP', { now: () => 5_000 });
  const warn = console.warn;
  console.warn = () => {};
  try {
    const seen = [];
    for (let i = 0; i <= EDGE_LIMITS.OAUTH_LOOKUP.limit; i++) {
      seen.push((await allow(i % 2 ? env : odd, '192.0.2.4')).ok);
    }
    assert.deepEqual(seen, [...Array(EDGE_LIMITS.OAUTH_LOOKUP.limit).fill(true), false]);
  } finally {
    console.warn = warn;
  }
});

// ── The OAuth endpoints ──────────────────────────────────────────────────────

const DB = 'https://db.test';
const ENV = { SUPABASE_URL: DB, SUPABASE_SERVICE_ROLE_KEY: 'svc', SUPABASE_ANON_KEY: 'anon' };
const ORIGIN = 'https://clusters.soleilpictures.com';
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

// The database's RPCs by name; anything else fails the test.
function stubRpc(rpc) {
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(typeof input === 'string' ? input : input.url);
    const fn = url.startsWith(`${DB}/rest/v1/rpc/`) ? url.slice(`${DB}/rest/v1/rpc/`.length) : null;
    if (!fn || !rpc[fn]) throw new Error(`unexpected fetch ${url}`);
    calls.push(fn);
    const out = await rpc[fn](JSON.parse(init.body || '{}'));
    return out instanceof Response ? out : new Response(JSON.stringify(out), { status: 200 });
  };
  return calls;
}

async function post(path, { ip, body, form, env = ENV }) {
  const url = new URL(path, ORIGIN);
  const init = { method: 'POST', headers: { 'cf-connecting-ip': ip } };
  if (body) { init.body = JSON.stringify(body); init.headers['content-type'] = 'application/json'; }
  if (form) { init.body = new URLSearchParams(form).toString(); init.headers['content-type'] = 'application/x-www-form-urlencoded'; }
  const res = await handleOAuthRoute(url, new Request(url, init), env);
  return { status: res.status, body: await res.json(), retryAfter: res.headers.get('retry-after') };
}

const REGISTRATION = { client_name: 'Shot Planner', redirect_uris: ['https://shotplanner.example/cb'] };

test('an address gets a handful of registrations a minute, refused before the database', async () => {
  const calls = stubRpc({
    oauth_client_register: () => [{ client_id: 'soleil_x', client_id_issued_at: 1 }],
  });
  const { limit } = EDGE_LIMITS.OAUTH_REGISTER;
  const ip = '203.0.113.50';
  for (let i = 0; i < limit; i++) {
    assert.notEqual((await post('/oauth/register', { ip, body: REGISTRATION })).status, 429, `registration ${i + 1}`);
  }
  const refused = await post('/oauth/register', { ip, body: REGISTRATION });
  assert.equal(refused.status, 429);
  assert.equal(refused.body.error, 'temporarily_unavailable');
  assert.match(refused.body.error_description, /too many registrations from this address/);
  assert.match(refused.retryAfter, /^[1-9]\d*$/);
  assert.equal(calls.length, limit, 'the refused one never reached the database');
  assert.notEqual((await post('/oauth/register', { ip: '203.0.113.51', body: REGISTRATION })).status, 429);
});

test('the database\'s hourly count answers in its own words, not its envelope', async () => {
  stubRpc({
    oauth_client_register: () => new Response(JSON.stringify({
      code: '54000', details: null, hint: null,
      message: 'too many client registrations from this address — try again later',
    }), { status: 400 }),
  });
  const { status, body } = await post('/oauth/register', { ip: '203.0.113.60', body: REGISTRATION });
  assert.equal(status, 429);
  assert.equal(body.error, 'temporarily_unavailable');
  assert.equal(body.error_description, 'too many new clients from this address — try again later');
});

test('token requests and revocations share one count per address', async () => {
  const calls = stubRpc({ oauth_client_get: () => null });
  const { limit } = EDGE_LIMITS.OAUTH_TOKEN;
  const ip = '203.0.113.70';
  const form = { grant_type: 'refresh_token', refresh_token: 'rt_x', client_id: 'soleil_gone' };
  for (let i = 0; i < limit; i++) {
    const path = i % 2 ? '/oauth/revoke' : '/oauth/token';
    assert.notEqual((await post(path, { ip, form })).status, 429, `${path} ${i + 1}`);
  }
  for (const path of ['/oauth/token', '/oauth/revoke']) {
    const refused = await post(path, { ip, form });
    assert.equal(refused.status, 429, path);
    assert.equal(refused.body.error, 'temporarily_unavailable');
    assert.match(refused.body.error_description, /too many token requests from this address/);
    assert.ok(Number(refused.retryAfter) > 0);
  }
  assert.equal(calls.length, limit, 'refusals never reached the database');
});

test('the binding, when the Worker has it, is what refuses', async () => {
  stubRpc({});
  const env = { ...ENV, OAUTH_TOKEN: { limit: async () => ({ success: false }) } };
  const refused = await post('/oauth/token', { ip: '203.0.113.80', form: { grant_type: 'authorization_code' }, env });
  assert.equal(refused.status, 429);
  assert.equal(refused.retryAfter, String(EDGE_LIMITS.OAUTH_TOKEN.period));
});

// ── The API's token check ────────────────────────────────────────────────────

function tokenRequest(token) {
  return new Request('https://clusters.soleilpictures.com/api/v1/me', { headers: { authorization: `Bearer ${token}` } });
}

function stubResolve(answer) {
  const calls = [];
  globalThis.fetch = async (input) => {
    const url = String(typeof input === 'string' ? input : input.url);
    assert.equal(url, `${DB}/rest/v1/rpc/api_token_resolve`);
    calls.push(url);
    const out = typeof answer === 'function' ? answer() : answer;
    return out instanceof Response ? out : new Response(JSON.stringify(out), { status: 200 });
  };
  return calls;
}

test('a token the database refused as unknown is refused again without asking', async () => {
  const calls = stubResolve([{ user_id: null }]);
  const first = await resolveApiToken(tokenRequest('sk_live_gone_1'), ENV);
  const again = await resolveApiToken(tokenRequest('sk_live_gone_1'), ENV);
  assert.equal(first.status, 401);
  assert.deepEqual(again, first, 'word for word the same answer');
  assert.equal(calls.length, 1);
  await resolveApiToken(tokenRequest('sk_live_gone_2'), ENV);
  assert.equal(calls.length, 2, 'another token is its own question');
});

test('a token past its window is refused until the reset it was given, then asked about again', async () => {
  const reset = new Date(Date.now() + 80).toISOString();
  const calls = stubResolve([{ reason: 'rate_limited', req_limit: 1000, req_count: 1000, req_reset: reset }]);
  const first = await resolveApiToken(tokenRequest('sk_live_busy'), ENV);
  const again = await resolveApiToken(tokenRequest('sk_live_busy'), ENV);
  assert.equal(first.status, 429);
  assert.equal(first.code, 'rate_limited');
  assert.deepEqual(again, first);
  assert.equal(calls.length, 1);
  await new Promise((r) => setTimeout(r, 120));
  await resolveApiToken(tokenRequest('sk_live_busy'), ENV);
  assert.equal(calls.length, 2, 'after the reset the database decides again');
});

test('a good token, or a check that failed, is asked about every time', async () => {
  const good = stubResolve([{ user_id: 'u1', token_id: 't1', scopes: ['read'], req_limit: 1000, req_count: 3 }]);
  assert.equal((await resolveApiToken(tokenRequest('sk_live_ok'), ENV)).ok, true);
  assert.equal((await resolveApiToken(tokenRequest('sk_live_ok'), ENV)).ok, true);
  assert.equal(good.length, 2, 'every request is counted in the hourly window');

  const down = stubResolve(() => new Response('{"message":"upstream"}', { status: 503 }));
  assert.equal((await resolveApiToken(tokenRequest('sk_live_maybe'), ENV)).status, 502);
  assert.equal((await resolveApiToken(tokenRequest('sk_live_maybe'), ENV)).status, 502);
  assert.equal(down.length, 2, 'an outage is never remembered as a refusal');
});
