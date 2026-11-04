// authFetch.test.mjs — sign-in answers are corrected for a wrong device clock,
// and a refresh turned away for load is retried instead of signing out.
//
//   node --test src/lib/authFetch.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GoTrueClient } from '@supabase/auth-js';
import { fixAuthResponse } from './authFetch.js';

const B = 'https://x.supabase.co';
const NOW = 1_800_000_000_000;
const sess = (over = {}) => ({ access_token: 'a.b.c', token_type: 'bearer', expires_in: 3600, expires_at: NOW / 1000 + 3600, refresh_token: 'r', user: { id: 'u1' }, ...over });
const json = (b, status = 200, extra = {}) => new Response(JSON.stringify(b), { status, statusText: status === 200 ? 'OK' : 'X', headers: { 'content-type': 'application/json', 'content-length': '999', 'x-request-id': 'req1', ...extra } });
const post = { method: 'POST' };

test('clock ahead: expires_at rewritten, rest kept', async () => {
  const res = json(sess({ expires_at: NOW / 1000 }));
  const out = await fixAuthResponse(res, `${B}/auth/v1/verify`, post, NOW);
  assert.notEqual(out, res);
  const b = await out.json();
  assert.equal(b.expires_at, Math.round(NOW / 1000) + 3600);
  assert.equal(b.refresh_token, 'r');
  assert.equal(b.user.id, 'u1');
  assert.equal(out.status, 200);
  assert.equal(out.statusText, 'OK');
  assert.equal(out.headers.get('x-request-id'), 'req1');
  assert.equal(out.headers.get('content-length'), null);
});

test('clock behind: rewritten too', async () => {
  const out = await fixAuthResponse(json(sess({ expires_at: NOW / 1000 + 7200 })), `${B}/auth/v1/verify`, post, NOW);
  assert.equal((await out.json()).expires_at, NOW / 1000 + 3600);
});

test('30 s off: same object, body unchanged', async () => {
  const res = json(sess({ expires_at: NOW / 1000 + 3630 }));
  const out = await fixAuthResponse(res, `${B}/auth/v1/verify`, post, NOW);
  assert.equal(out, res);
  assert.equal((await out.json()).expires_at, NOW / 1000 + 3630);
});

test('bodies that are not sessions are left alone', async () => {
  const cases = [
    sess({ expires_at: undefined }), {}, sess({ expires_in: undefined }), sess({ expires_in: 0 }),
    sess({ access_token: '' }),
  ].map((b) => json(b));
  for (const res of cases) assert.equal(await fixAuthResponse(res, `${B}/auth/v1/verify`, post, NOW), res);
  const wrong = json(sess({ expires_at: 5 }));
  assert.equal(await fixAuthResponse(wrong, `${B}/auth/v1/user`, { method: 'GET' }, NOW), wrong);
  const text = new Response('hello', { status: 200 });
  assert.equal(await fixAuthResponse(text, `${B}/auth/v1/verify`, post, NOW), text);
  const bad = json({ msg: 'no' }, 400);
  assert.equal(await fixAuthResponse(bad, `${B}/auth/v1/verify`, post, NOW), bad);
});

test('other services are not read', async () => {
  for (const u of [`${B}/rest/v1/boards`, `${B}/storage/v1/object/a`]) {
    const res = json(sess({ expires_at: 5 }));
    assert.equal(await fixAuthResponse(res, u, post, NOW), res);
    assert.equal(res.bodyUsed, false);
  }
});

test('refresh turned away for load becomes 503; 400 stays', async () => {
  const url = `${B}/auth/v1/token?grant_type=refresh_token`;
  const body = { code: 429, error_code: 'over_request_rate_limit', msg: 'Request rate limit reached' };
  for (const status of [429, 500]) {
    const out = await fixAuthResponse(json(body, status), url, post, NOW);
    assert.equal(out.status, 503);
    assert.equal(out.headers.get('x-request-id'), 'req1');
    assert.deepEqual(await out.json(), body);
  }
  const gone = json({ error_code: 'refresh_token_not_found' }, 400);
  assert.equal(await fixAuthResponse(gone, url, post, NOW), gone);
});

test('other auth 429s are untouched', async () => {
  for (const u of [`${B}/auth/v1/otp`, `${B}/auth/v1/token?grant_type=pkce`]) {
    const res = json({ msg: 'slow' }, 429);
    const out = await fixAuthResponse(res, u, post, NOW);
    assert.equal(out, res);
    assert.equal(out.status, 429);
  }
});

test('URL and Request inputs', async () => {
  const out = await fixAuthResponse(json(sess({ expires_at: 5 })), new URL(`${B}/auth/v1/verify`), post, NOW);
  assert.equal((await out.json()).expires_at, NOW / 1000 + 3600);
  const req = new Request(`${B}/auth/v1/verify`, { method: 'POST', body: '{}' });
  const out2 = await fixAuthResponse(json(sess({ expires_at: 5 })), req, undefined, NOW);
  assert.equal((await out2.json()).expires_at, NOW / 1000 + 3600);
  const get = new Request(`${B}/auth/v1/verify`);
  const res = json(sess({ expires_at: 5 }));
  assert.equal(await fixAuthResponse(res, get, undefined, NOW), res);
});

test('supabase.js uses it', () => {
  const src = readFileSync(new URL('./supabase.js', import.meta.url), 'utf8');
  assert.ok(src.includes('fixAuthResponse('));
  assert.ok(src.includes("from './authFetch.js'"));
});

// ---- the real auth-js against a fake GoTrue, with the computer clock 1 h ahead ----
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (exp) => `${b64({ alg: 'none' })}.${b64({ exp, sub: 'u1', aud: 'authenticated' })}.x`;
const realNow = Date.now.bind(Date);

function fakeGoTrue({ limit = Infinity, rateLimitOnce = false } = {}) {
  const st = { refreshes: 0, limited: false };
  const session = (n) => {
    const t = Math.floor(realNow() / 1000) + 3600;
    return { access_token: jwt(t), token_type: 'bearer', expires_in: 3600, expires_at: t, refresh_token: `r${n}`, user: { id: 'u1', aud: 'authenticated', email: 'a@b.c' } };
  };
  st.fetch = async (input) => {
    const u = typeof input === 'string' ? input : input.url;
    if (u.includes('/verify')) return json(session(0));
    if (u.includes('/token?grant_type=refresh_token')) {
      st.refreshes++;
      if (st.refreshes > limit || (rateLimitOnce && !st.limited)) {
        st.limited = true;
        return json({ code: 429, error_code: 'over_request_rate_limit', msg: 'Request rate limit reached' }, 429);
      }
      return json(session(st.refreshes));
    }
    return json({ msg: 'not found' }, 404);
  };
  return st;
}

async function scenario({ fix, ...opts }, steps) {
  Date.now = () => realNow() + 3_600_000;
  const mem = new Map();
  const fake = fakeGoTrue(opts);
  const f = fix ? (i, init) => fake.fetch(i, init).then((r) => fixAuthResponse(r, i, init)) : fake.fetch;
  const client = new GoTrueClient({
    url: `${B}/auth/v1`, headers: { apikey: 'k' }, storageKey: 'sb-x-auth-token',
    storage: { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) },
    persistSession: true, autoRefreshToken: false, detectSessionInUrl: false,
    lock: async (_n, _t, fn) => fn(), fetch: f,
  });
  const events = [];
  try {
    await client.initialize();
    const { data: { subscription } } = client.onAuthStateChange((e) => { events.push(e); });
    try {
      await client.verifyOtp({ email: 'a@b.c', token: '123456', type: 'email' });
      await steps(client);
    } finally { subscription.unsubscribe(); }
    const final = (await client.getSession()).data.session;
    return { events, fake, final, localNow: Math.floor(Date.now() / 1000) };
  } finally {
    Date.now = realNow;
  }
}

test('real auth-js, clock ahead, no fix: refresh storm ends signed out', async () => {
  const r = await scenario({ fix: false, limit: 30 }, async (c) => { for (let i = 0; i < 40; i++) await c.getSession(); });
  assert.ok(r.fake.refreshes >= 30, `refreshes ${r.fake.refreshes}`);
  assert.ok(r.events.includes('SIGNED_OUT'), r.events.join());
  assert.equal(r.final, null);
});

test('real auth-js, clock ahead, with fix: no refreshes, stays signed in', async () => {
  const r = await scenario({ fix: true, limit: 30 }, async (c) => { for (let i = 0; i < 40; i++) await c.getSession(); });
  assert.equal(r.fake.refreshes, 0);
  assert.ok(!r.events.includes('SIGNED_OUT'));
  assert.ok(r.final);
  assert.ok(Math.abs(r.final.expires_at - (r.localNow + 3600)) < 5);
});

test('refresh answered 429 once: kept with the fix, signed out without', async () => {
  const run = (fix) => scenario({ fix, rateLimitOnce: true }, async (c) => { await c.refreshSession(); });
  const withFix = await run(true);
  assert.ok(!withFix.events.includes('SIGNED_OUT'), withFix.events.join());
  assert.ok(withFix.events.includes('TOKEN_REFRESHED'));
  assert.equal(withFix.fake.refreshes, 2);
  assert.equal(withFix.final.refresh_token, 'r2');
  const without = await run(false);
  assert.ok(without.events.includes('SIGNED_OUT'));
});
