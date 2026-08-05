// Unit tests for Scout's instant-session token (worker-scout.js).
//
// This token is the thing that turns a link texted to a phone into a signed-in
// browser session. If it can be forged or replayed after expiry, it is
// "sign in as any user you can name" — so those two properties get asserted
// directly rather than inferred from the implementation.
//
// The app_config secret fetch is stubbed; everything else is the real code path
// including WebCrypto HMAC.

import { expect, test } from '@playwright/test';
import { mintScoutSessionToken, verifyScoutSessionToken } from '../src/worker-scout.js';

const USER = '11111111-2222-3333-4444-555555555555';

// The module caches the secret for 5 minutes in module scope, so every test in
// this file shares one secret. That's fine — they all use the same `env`.
const env = {
  SUPABASE_URL: 'https://stub.invalid',
  SUPABASE_SERVICE_ROLE_KEY: 'stub-service-key',
};

const realFetch = globalThis.fetch;
test.beforeAll(() => {
  globalThis.fetch = async (url) => {
    if (String(url).includes('app_config')) {
      return new Response(JSON.stringify([{ value: { secret: 'a'.repeat(64) } }]), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`unexpected fetch in test: ${url}`);
  };
});
test.afterAll(() => { globalThis.fetch = realFetch; });

test('a freshly minted token round-trips to its user', async () => {
  const token = await mintScoutSessionToken(env, USER);
  expect(await verifyScoutSessionToken(env, token)).toBe(USER);
});

test('a tampered payload is rejected', async () => {
  const token = await mintScoutSessionToken(env, USER);
  const [, sig] = token.split('.');
  // Re-encode a payload naming a DIFFERENT user, keeping the original signature.
  const forged = btoa(JSON.stringify({ u: '99999999-9999-9999-9999-999999999999', e: Date.now() + 60_000 }))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  expect(await verifyScoutSessionToken(env, `${forged}.${sig}`)).toBe(null);
});

test('a tampered signature is rejected', async () => {
  const token = await mintScoutSessionToken(env, USER);
  const [payload, sig] = token.split('.');
  const flipped = (sig[0] === 'a' ? 'b' : 'a') + sig.slice(1);
  expect(await verifyScoutSessionToken(env, `${payload}.${flipped}`)).toBe(null);
});

test('an expired token is rejected even though its signature is valid', async () => {
  // Negative TTL — genuinely signed, genuinely stale. This is the replay case:
  // the link sits in a chat thread forever, so expiry is the only thing
  // stopping someone picking up an old phone and getting a session.
  const token = await mintScoutSessionToken(env, USER, -1000);
  expect(await verifyScoutSessionToken(env, token)).toBe(null);
});

test('malformed tokens are rejected without throwing', async () => {
  for (const bad of ['', 'nodot', 'a.b', '.', '..', 'x'.repeat(500), 'YWJj.zzzz']) {
    expect(await verifyScoutSessionToken(env, bad)).toBe(null);
  }
  expect(await verifyScoutSessionToken(env, undefined)).toBe(null);
  expect(await verifyScoutSessionToken(env, null)).toBe(null);
});

test('a token for one user never verifies as another', async () => {
  const a = await mintScoutSessionToken(env, USER);
  const other = '00000000-0000-0000-0000-000000000000';
  const b = await mintScoutSessionToken(env, other);
  expect(await verifyScoutSessionToken(env, a)).toBe(USER);
  expect(await verifyScoutSessionToken(env, b)).toBe(other);
  expect(a).not.toBe(b);
});

test('signatures are not truncated to something guessable', async () => {
  const token = await mintScoutSessionToken(env, USER);
  const [, sig] = token.split('.');
  // 32 hex chars = 128 bits. Shorter would be brute-forceable given the route
  // can be retried freely.
  expect(sig).toMatch(/^[0-9a-f]{32}$/);
});
