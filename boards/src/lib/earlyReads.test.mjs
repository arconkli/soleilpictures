// earlyReads.test.mjs — the reads a billing function starts before getUser has
// answered (supabase/functions/_shared/earlyReads.mjs), and the rule that
// nothing they return is used unless getUser names the same user.
//
//   node --test src/lib/earlyReads.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { tokenClaims, claimsMatch, settle, earlyOr, earlyAnswer } from '../../../supabase/functions/_shared/earlyReads.mjs';

const FNS = resolve(dirname(fileURLToPath(import.meta.url)), '../../../supabase/functions');
const read = (rel) => readFileSync(resolve(FNS, rel), 'utf8');

const NOW = Date.parse('2026-10-21T12:00:00Z');
const b64url = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');
const jwt = (payload) => `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}.signature`;
const live = { role: 'authenticated', sub: 'u-1', email: ' Maya@Example.com ', exp: NOW / 1000 + 3600 };

test("a signed-in user's live token gives its id and address", () => {
  assert.deepEqual(tokenClaims(jwt(live), NOW), { sub: 'u-1', email: 'maya@example.com' });
  assert.deepEqual(tokenClaims(jwt({ ...live, email: undefined }), NOW), { sub: 'u-1', email: null }, 'no address: null');
  // base64url without padding, and an address that is not ASCII.
  assert.deepEqual(tokenClaims(jwt({ ...live, email: 'zoë@exämple.com' }), NOW), { sub: 'u-1', email: 'zoë@exämple.com' });
});

test('anything else starts nothing', () => {
  assert.equal(tokenClaims(jwt({ ...live, role: 'anon' }), NOW), null, 'the public anon key is a valid JWT too');
  assert.equal(tokenClaims(jwt({ ...live, role: 'service_role' }), NOW), null);
  assert.equal(tokenClaims(jwt({ ...live, exp: NOW / 1000 - 1 }), NOW), null, 'expired');
  assert.equal(tokenClaims(jwt({ ...live, exp: NOW / 1000 }), NOW), null, 'expiring this instant');
  assert.equal(tokenClaims(jwt({ ...live, exp: undefined }), NOW), null, 'no expiry');
  assert.equal(tokenClaims(jwt({ ...live, exp: String(NOW / 1000 + 3600) }), NOW), null, 'an expiry that is not a number');
  assert.equal(tokenClaims(jwt({ ...live, sub: '' }), NOW), null, 'no subject');
  assert.equal(tokenClaims(jwt({ ...live, sub: 42 }), NOW), null);
  for (const junk of ['', null, undefined, 'abc', 'a.b.c', `x.${b64url('not json')}.y`, `x.${b64url('null')}.y`]) {
    assert.equal(tokenClaims(junk, NOW), null, String(junk));
  }
});

test('reads started on the claims are used only for the same user at the same address', () => {
  const claims = tokenClaims(jwt(live), NOW);
  assert.equal(claimsMatch(claims, { id: 'u-1', email: 'maya@example.com' }), true);
  assert.equal(claimsMatch(claims, { id: 'u-1', email: 'MAYA@example.com ' }), true, 'compared as the function compares them');
  assert.equal(claimsMatch(claims, { id: 'u-2', email: 'maya@example.com' }), false, 'another user');
  assert.equal(claimsMatch(claims, { id: 'u-1', email: 'maya@new.example' }), false, 'an address changed since the token was minted');
  assert.equal(claimsMatch(claims, { id: 'u-1', email: null }), false);
  assert.equal(claimsMatch({ sub: 'u-1', email: null }, { id: 'u-1', email: '' }), true, 'no address on either side');
  assert.equal(claimsMatch(null, { id: 'u-1', email: 'maya@example.com' }), false);
  assert.equal(claimsMatch(claims, null), false);
  assert.equal(claimsMatch(claims, { email: 'maya@example.com' }), false, 'no id');
});

test('an early read never rejects, so dropping it unread leaves nothing unhandled', async () => {
  assert.deepEqual(await settle(Promise.resolve(7)), { ok: true, value: 7 });
  assert.deepEqual(await settle(8), { ok: true, value: 8 }, 'a plain value');
  const boom = new Error('boom');
  assert.deepEqual(await settle(Promise.reject(boom)), { ok: false, error: boom });
  // A supabase-js builder is a thenable, not a promise.
  assert.deepEqual(await settle({ then: (res) => res({ data: 1, error: null }) }), { ok: true, value: { data: 1, error: null } });
});

test('earlyOr: the early answer when it can be used, otherwise the read again', async () => {
  let again = 0;
  const redo = () => { again += 1; return 'again'; };
  assert.equal(await earlyOr(settle(Promise.resolve('early')), redo), 'early');
  assert.equal(again, 0, 'not asked twice');
  assert.equal(await earlyOr(null, redo), 'again', 'not started, or not the same user');
  assert.equal(await earlyOr(undefined, redo), 'again');
  assert.equal(await earlyOr(settle(Promise.reject(new Error('x'))), redo), 'again', 'failed: asked again, as before');
  assert.equal(again, 3);
});

test("earlyAnswer: the answer, or the early read's failure thrown where it is awaited", async () => {
  assert.equal(await earlyAnswer(settle(Promise.resolve('s'))), 's');
  const boom = new Error('stripe down');
  await assert.rejects(earlyAnswer(settle(Promise.reject(boom))), (e) => e === boom);
});

test('create-checkout-session uses nothing it read early until getUser has named the same user', () => {
  const src = read('create-checkout-session/index.ts');
  const getUser = src.indexOf('await userClient.auth.getUser()');
  const mine = src.indexOf('const mine = early && claimsMatch(claims, u.data.user) ? early : null;');
  assert.ok(getUser > 0 && mine > getUser, 'the match is made on getUser\'s answer');
  // Only through `mine`: the early object itself is never read past it.
  const after = src.slice(mine + 1);
  assert.ok(!/\bearly\.(sub|prof|found)\b/.test(after), 'no early read used except through mine');
  for (const k of ['sub', 'prof', 'found']) assert.ok(after.includes(`earlyOr(mine?.${k},`), k);
  // Started only for a signed-in user's token that carries an address.
  assert.match(src, /const claims = tokenClaims\(token\);\s*const early = claims\?\.email \? \{/);
});

test('verify-checkout-session answers the token and the body before it uses the session it read early', () => {
  const src = read('verify-checkout-session/index.ts');
  assert.match(src, /const early = !badBody && sessionId\.startsWith\("cs_"\) && tokenClaims\(token\)/);
  const order = [
    'const u = await userClient.auth.getUser();',
    'return json({ error: "invalid token" }, 401);',
    'if (badBody) return json({ error: "invalid json" }, 400);',
    'return json({ error: "session_id required" }, 400);',
    'await earlyAnswer(early)',
    'if (!ownerId || ownerId !== callerId) {',
  ].map((s) => [s, src.indexOf(s)]);
  for (const [s, at] of order) assert.ok(at > 0, s);
  for (let i = 1; i < order.length; i++) assert.ok(order[i - 1][1] < order[i][1], `${order[i - 1][0]} before ${order[i][0]}`);
});
