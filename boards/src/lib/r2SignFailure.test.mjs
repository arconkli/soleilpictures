// Why a picture did not sign: 'network' (no token, a fetch that threw, a
// non-OK answer such as the party's 503) shows "Couldn't load" + Retry;
// 'denied' (a 200 with the key absent) keeps the padlock. r2.js needs
// Supabase to load, so the reason map is run by evaluating the module's own
// source slice (reason map + flush) against a stubbed fetch and session.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const r2 = readFileSync(join(here, 'r2.js'), 'utf8');
const party = readFileSync(join(here, '..', '..', 'party', 'upload.ts'), 'utf8');
const image = readFileSync(join(here, '..', 'components', 'R2Image.jsx'), 'utf8');

const start = r2.indexOf('const signReasons = new Map()');
const end = r2.indexOf('// A one-off signed URL');
assert.ok(start > 0 && end > start, 'the reason map and flush are where expected');
const body = r2.slice(start, end).replace(/export /g, '');

function harness({ token = 'tok', fetchImpl }) {
  const cache = new Map();
  const pending = new Map();
  const got = {};
  let timer = null;
  const make = new Function(
    'supabase', 'fetch', 'cache', 'cacheExpiryFor', 'schedulePersist', 'CACHE_TTL_MS',
    'SIGN_READS_MAX', 'PARTYKIT_PROTOCOL', 'PARTYKIT_HOST', 'state',
    `let pendingResolvers = state.pending; let pendingTimer = null;
     ${body}
     return { signFailure, flush, setPending(m) { pendingResolvers = m; } };`,
  );
  const state = { pending };
  const api = make(
    { auth: { getSession: async () => ({ data: { session: token ? { access_token: token } : null } }) } },
    fetchImpl, cache, (u, t) => Date.now() + t, () => {}, 1000, 200, 'https', 'x.test', state,
  );
  return {
    api, cache, got,
    async sign(keys) {
      const m = new Map();
      for (const k of keys) m.set(k, [(u) => { got[k] = u; }]);
      api.setPending(m);
      await api.flush();
    },
  };
}
const ok = (urls) => async () => ({ ok: true, status: 200, json: async () => ({ urls, ttl: 60 }) });

test('a 200 answer without the key is denied; with it, signed and cleared', async () => {
  let urls = {};
  const h = harness({ fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ urls, ttl: 60 }) }) });
  await h.sign(['a']);
  assert.equal(h.api.signFailure('a'), 'denied');
  assert.equal(h.got.a, null);
  urls = { a: 'https://r2.test/a' };
  await h.sign(['a']);
  assert.equal(h.api.signFailure('a'), null);
  assert.equal(h.got.a, 'https://r2.test/a');
});

test('a 503, a throwing fetch and a missing session are the network, not a lock', async () => {
  const h503 = harness({ fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({ error: 'unavailable' }) }) });
  await h503.sign(['b']);
  assert.equal(h503.api.signFailure('b'), 'network');
  const hThrow = harness({ fetchImpl: async () => { throw new TypeError('offline'); } });
  await hThrow.sign(['c']);
  assert.equal(hThrow.api.signFailure('c'), 'network');
  const hNoTok = harness({ token: '', fetchImpl: ok({}) });
  await hNoTok.sign(['d']);
  assert.equal(hNoTok.api.signFailure('d'), 'network');
});

test('a network failure that later signs is cleared; an unknown key reads null', async () => {
  let up = false;
  const h = harness({ fetchImpl: async () => (up
    ? { ok: true, status: 200, json: async () => ({ urls: { e: 'https://r2.test/e' }, ttl: 60 }) }
    : { ok: false, status: 503, json: async () => ({}) }) });
  await h.sign(['e']);
  assert.equal(h.api.signFailure('e'), 'network');
  up = true;
  await h.sign(['e']);
  assert.equal(h.api.signFailure('e'), null);
  assert.equal(h.api.signFailure('never-asked'), null);
});

test('the party answers 503 when the rows read fails, and keeps its 200-cap', () => {
  const sr = party.slice(party.indexOf('// POST /sign-reads'), party.indexOf('// ── Multipart upload'));
  assert.match(sr, /if \(rows === null\) \{\s+return Response\.json\(\{ error: "unavailable" \}, \{ status: 503/);
  assert.match(sr, /\.slice\(0, 200\)/);
});

test('both R2Image flavours read signFailure and offer Retry on the network kind', () => {
  const basic = image.slice(image.indexOf('function R2ImageBasic'), image.indexOf('function R2ImageProgressive'));
  const prog = image.slice(image.indexOf('function R2ImageProgressive'));
  for (const part of [basic, prog]) {
    assert.match(part, /signFailure\(/);
    assert.match(part, /<CardCouldntLoad rootRef=\{rootRef\} onRetry=\{retry\}/);
    assert.match(part, /<BlockedPlaceholder \{\.\.\.rest\} \/>/);
    assert.match(part, /retryTick\]\);/);
  }
});
