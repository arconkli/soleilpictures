// r2.js — which signed URLs actually loaded ("warm"). A canvas card mounts
// straight on a picture only when its URL is warm, so a key that is merely
// signed (every key on the share viewer) waits for the viewport instead of
// fetching at once. r2.js needs Supabase to load, so this evaluates the
// module's own persistence + warm slice against a stubbed localStorage, the
// same way r2SignFailure.test.mjs runs flush.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const r2 = readFileSync(join(here, 'r2.js'), 'utf8');

const start = r2.indexOf("const LS_KEY = 'soleil.r2urls.v2';");
const end = r2.indexOf('// Hydrate once we know who');
assert.ok(start > 0 && end > start, 'the persistence + warm slice is where expected');
const body = r2.slice(start, end).replace(/export /g, '');

function makeStorage(initial = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    raw: m,
  };
}

function harness(storage = makeStorage()) {
  const cache = new Map();
  let override = null;
  // cachedUrl as r2.js has it, minus the scoped resolvers: the override wins.
  const cachedUrl = (src) => {
    if (typeof src !== 'string' || !src.startsWith('r2:')) return src || null;
    const key = src.slice(3);
    if (override) return override(key) || null;
    const c = cache.get(key);
    return c && c.expiresAt > Date.now() ? c.url : null;
  };
  const make = new Function(
    'cache', 'localStorage', 'cachedUrl', 'parseSigExpiryMs', 'SIG_REFRESH_MARGIN_MS', 'setTimeout', 'clearTimeout',
    `${body}
     return { persist, hydrate, clearPersisted, markLoaded, isWarm, _loaded };`,
  );
  const api = make(cache, storage, cachedUrl, () => null, 60000, () => 1, () => {});
  return { api, cache, storage, setOverride(fn) { override = fn; } };
}

const later = () => Date.now() + 3600_000;

test('a signed URL is not warm until it loads', () => {
  const { api, cache } = harness();
  cache.set('a.webp', { url: 'https://r2/a?sig=1', expiresAt: later() });
  assert.equal(api.isWarm('r2:a.webp'), false);
  api.markLoaded('r2:a.webp', 'https://r2/a?sig=1');
  assert.equal(api.isWarm('r2:a.webp'), true);
  assert.equal(api.isWarm('a.webp'), true, 'a bare key is accepted too');
});

test('a re-signed URL is not warm until it loads again', () => {
  const { api, cache } = harness();
  cache.set('a.webp', { url: 'https://r2/a?sig=1', expiresAt: later() });
  api.markLoaded('a.webp', 'https://r2/a?sig=1');
  cache.set('a.webp', { url: 'https://r2/a?sig=2', expiresAt: later() });
  assert.equal(api.isWarm('r2:a.webp'), false);
  api.markLoaded('r2:a.webp', 'https://r2/a?sig=2');
  assert.equal(api.isWarm('r2:a.webp'), true);
});

test('non-r2 sources are ignored', () => {
  const { api } = harness();
  api.markLoaded('https://example.com/x.jpg', 'https://example.com/x.jpg');
  api.markLoaded('data:image/png;base64,AA', 'data:image/png;base64,AA');
  assert.equal(api._loaded.size, 0);
  assert.equal(api.isWarm('https://example.com/x.jpg'), false);
  assert.equal(api.isWarm(null), false);
});

test('the public viewer override counts once its URL loaded', () => {
  const { api, setOverride } = harness();
  setOverride((k) => (k === 'p.webp' ? 'https://bundle/p' : null));
  assert.equal(api.isWarm('r2:p.webp'), false, 'in the bundle map but never loaded');
  api.markLoaded('r2:p.webp', 'https://bundle/p');
  assert.equal(api.isWarm('r2:p.webp'), true);
});

test('persist writes the warm flag and hydrate restores it', () => {
  const a = harness();
  a.api.hydrate('u1');
  a.cache.set('warm.webp', { url: 'https://r2/w', expiresAt: later() });
  a.cache.set('cold.webp', { url: 'https://r2/c', expiresAt: later() });
  a.api.markLoaded('warm.webp', 'https://r2/w');
  a.api.persist();
  const rows = JSON.parse(a.storage.getItem('soleil.r2urls.v2')).v;
  const byKey = Object.fromEntries(rows.map((r) => [r[0], r]));
  assert.equal(byKey['warm.webp'].length, 4);
  assert.equal(byKey['warm.webp'][3], 1);
  assert.equal(byKey['cold.webp'].length, 3);

  const b = harness(makeStorage({ 'soleil.r2urls.v2': a.storage.getItem('soleil.r2urls.v2') }));
  b.api.hydrate('u1');
  assert.equal(b.api.isWarm('r2:warm.webp'), true);
  assert.equal(b.api.isWarm('r2:cold.webp'), false);
  assert.equal(b.cache.get('cold.webp').url, 'https://r2/c');
});

test('an old 3-element row still loads, not warm', () => {
  const stored = JSON.stringify({ uid: 'u1', v: [['old.webp', 'https://r2/o', later()]] });
  const { api, cache } = harness(makeStorage({ 'soleil.r2urls.v2': stored }));
  api.hydrate('u1');
  assert.equal(cache.get('old.webp').url, 'https://r2/o');
  assert.equal(api.isWarm('r2:old.webp'), false);
});

test("another user's store restores nothing, and sign-out clears the warm map", () => {
  const stored = JSON.stringify({ uid: 'u1', v: [['k.webp', 'https://r2/k', later(), 1]] });
  const other = harness(makeStorage({ 'soleil.r2urls.v2': stored }));
  other.api.hydrate('u2');
  assert.equal(other.api.isWarm('r2:k.webp'), false);
  assert.equal(other.api._loaded.size, 0);

  const same = harness(makeStorage({ 'soleil.r2urls.v2': stored }));
  same.api.hydrate('u1');
  assert.equal(same.api.isWarm('r2:k.webp'), true);
  same.api.clearPersisted();
  assert.equal(same.api._loaded.size, 0);
  assert.equal(same.api.isWarm('r2:k.webp'), false);
});
