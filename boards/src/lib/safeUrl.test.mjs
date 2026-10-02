// safeUrl.test.mjs — what the server may fetch, at every hop.
//
// Two copies of this rule existed until 2026-10-02 and the one the importer and
// webhooks used had drifted permissive. These run in CI (the /api/og coverage
// before this lived only in a Playwright spec, and Playwright is not in CI).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  isBlockedHost, publicHttpsUrlProblem, ogTargetProblem, fetchFollowingSafely, UnsafeFetchError,
} from './safeUrl.js';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Every one of these passed publicHttpsUrlProblem before the two rules merged.
const FORMERLY_ALLOWED = [
  'https://[::ffff:169.254.169.254]/latest/meta-data/',   // canonicalises to [::ffff:a9fe:a9fe]
  'https://[::ffff:127.0.0.1]/x',
  'https://[::]/x',
  'https://100.64.0.1/x',          // CGNAT
  'https://224.0.0.1/x',           // multicast
  'https://255.255.255.255/x',     // broadcast
  'https://printer.lan/x',
  'https://router.home.arpa/x',
];

test('the importer and webhook rule refuses the shapes it used to let through', () => {
  for (const u of FORMERLY_ALLOWED) {
    assert.equal(publicHttpsUrlProblem(u), 'must be a public host', u);
  }
});

test('the importer and webhook rule keeps its contract', () => {
  assert.equal(publicHttpsUrlProblem('https://cdn.example.com/a.jpg'), null);
  assert.equal(publicHttpsUrlProblem('https://cdn.example.com:443/a.jpg'), null);
  assert.equal(publicHttpsUrlProblem('http://cdn.example.com/a.jpg'), 'must use https');
  assert.equal(publicHttpsUrlProblem('https://cdn.example.com:8443/a.jpg'), 'must use the default port');
  assert.equal(publicHttpsUrlProblem('not a url'), 'must be an absolute https URL');
  for (const u of ['https://169.254.169.254/', 'https://localhost/', 'https://10.0.0.5/', 'https://192.168.1.1/',
    'https://172.16.0.1/', 'https://metadata.google.internal/', 'https://build.internal/', 'https://[::1]/',
    'https://[fd00::1]/', 'https://[fe80::1]/']) {
    assert.equal(publicHttpsUrlProblem(u), 'must be a public host', u);
  }
  // 172.x outside the private block is public.
  assert.equal(publicHttpsUrlProblem('https://172.15.0.1/'), null);
  assert.equal(publicHttpsUrlProblem('https://172.32.0.1/'), null);
});

test('the /api/og rule: http or https, default ports, public host', () => {
  const og = (s) => ogTargetProblem(new URL(s));
  assert.equal(og('https://example.com/'), null);
  assert.equal(og('http://example.com/'), null);
  assert.equal(og('ftp://example.com/'), 'scheme not allowed');
  assert.equal(og('file:///etc/passwd'), 'scheme not allowed');
  assert.equal(og('http://example.com:8080/'), 'port not allowed');
  for (const u of FORMERLY_ALLOWED.map((s) => s.replace('https:', 'http:'))) {
    assert.equal(og(u), 'host not allowed', u);
  }
});

// ── every hop ───────────────────────────────────────────────────────────────

function fakeFetch(routes) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    const r = routes[url];
    if (!r) throw new Error(`unexpected fetch ${url}`);
    return { status: r.status, ok: r.status >= 200 && r.status < 300,
      headers: { get: (h) => (h.toLowerCase() === 'location' ? r.location ?? null : null) } };
  };
  return { impl, calls };
}
const importCheck = (u) => publicHttpsUrlProblem(u.href);

test('a redirect to an internal address is refused before the second request', async () => {
  const { impl, calls } = fakeFetch({
    'https://cdn.example.com/a.jpg': { status: 302, location: 'https://169.254.169.254/latest/meta-data/' },
  });
  await assert.rejects(
    fetchFollowingSafely('https://cdn.example.com/a.jpg', {}, { check: importCheck, fetchImpl: impl }),
    (e) => e instanceof UnsafeFetchError && e.code === 'blocked_hop' && /redirect/.test(e.message));
  assert.equal(calls.length, 1, 'the internal address must never be requested');
  assert.equal(calls[0].init.redirect, 'manual', 'fetch must not follow on its own');
});

test('the v4-mapped spelling of the metadata address is refused mid-chain too', async () => {
  const { impl, calls } = fakeFetch({
    'https://cdn.example.com/a.jpg': { status: 301, location: 'https://[::ffff:169.254.169.254]/' },
  });
  await assert.rejects(fetchFollowingSafely('https://cdn.example.com/a.jpg', {}, { check: importCheck, fetchImpl: impl }),
    (e) => e.code === 'blocked_hop');
  assert.equal(calls.length, 1);
});

test('public-to-public redirects are followed, relative ones resolved', async () => {
  const { impl, calls } = fakeFetch({
    'https://a.example.com/x': { status: 302, location: '/y' },
    'https://a.example.com/y': { status: 307, location: 'https://b.example.com/z.jpg' },
    'https://b.example.com/z.jpg': { status: 200 },
  });
  const { res, url } = await fetchFollowingSafely('https://a.example.com/x', { headers: { a: 1 } },
    { check: importCheck, fetchImpl: impl });
  assert.equal(res.status, 200);
  assert.equal(url, 'https://b.example.com/z.jpg');
  assert.equal(calls.length, 3);
  assert.ok(calls.every((c) => c.init.redirect === 'manual' && c.init.headers.a === 1));
});

test('a downgrade to http mid-chain is refused by the importer rule', async () => {
  const { impl } = fakeFetch({ 'https://a.example.com/x': { status: 302, location: 'http://a.example.com/x' } });
  await assert.rejects(fetchFollowingSafely('https://a.example.com/x', {}, { check: importCheck, fetchImpl: impl }),
    (e) => e.code === 'blocked_hop' && /https/.test(e.message));
});

test('a redirect loop stops', async () => {
  const { impl, calls } = fakeFetch({ 'https://a.example.com/x': { status: 302, location: 'https://a.example.com/x' } });
  await assert.rejects(
    fetchFollowingSafely('https://a.example.com/x', {}, { check: importCheck, fetchImpl: impl, maxHops: 3 }),
    (e) => e.code === 'too_many_redirects');
  assert.equal(calls.length, 4, 'the first request plus three hops, then stop');
});

test('the first URL is checked too, and a 3xx without Location is the answer', async () => {
  await assert.rejects(fetchFollowingSafely('https://localhost/x', {}, { check: importCheck, fetchImpl: async () => {
    throw new Error('must not be called');
  } }), (e) => e.code === 'blocked_hop');
  const { impl } = fakeFetch({ 'https://a.example.com/x': { status: 304 } });
  const { res } = await fetchFollowingSafely('https://a.example.com/x', {}, { check: importCheck, fetchImpl: impl });
  assert.equal(res.status, 304);
});

test('isBlockedHost refuses an empty host', () => {
  assert.equal(isBlockedHost({ hostname: '' }), true);
});

// ── wiring: every server-side fetcher uses the one rule ─────────────────────

test('the importer fetches through fetchFollowingSafely, never redirect:follow', () => {
  const api = readFileSync(resolve(SRC, 'worker-api.js'), 'utf8');
  const route = api.slice(api.indexOf("if (sub === 'import' && method === 'POST')"));
  // Comment lines out: the rationale above the call quotes the old option.
  const body = route.slice(0, route.indexOf('const usable = fetched.filter'))
    .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.match(body, /fetchFollowingSafely\(item\.url/, 'the import must re-check every hop');
  assert.doesNotMatch(body, /redirect:\s*'follow'/);
});

test('/api/og uses the shared rule — no second copy in worker.js', () => {
  const worker = readFileSync(resolve(SRC, 'worker.js'), 'utf8');
  assert.match(worker, /function ogTargetIsAllowed\(u\) \{\s*return ogTargetProblem\(u\);/);
  assert.doesNotMatch(worker, /OG_BLOCKED_HOSTS/, 'a second host list is how the two rules drifted');
});
