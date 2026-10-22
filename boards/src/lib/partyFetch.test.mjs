// partyFetch.test.mjs — the Worker reaches the party by its service binding,
// never by a workers.dev URL Cloudflare refuses from the preview (error 1042).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { partyFetch } from './partyFetch.js';
import { DEFAULT_PARTY_HOST, OLD_PARTY_HOST } from './partyDefaults.js';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

const recorder = () => {
  const calls = [];
  const fn = (url, init) => { calls.push({ url, init }); return Promise.resolve({ ok: true }); };
  return { calls, fn };
};

test('a call to the party Worker goes through the binding', async () => {
  const binding = recorder();
  const plain = recorder();
  const url = `https://${DEFAULT_PARTY_HOST}/parties/main/b1/reset`;
  const init = { method: 'POST' };
  await partyFetch({ PARTY: { fetch: binding.fn } }, url, init, { fetchImpl: plain.fn });
  assert.equal(binding.calls.length, 1);
  assert.equal(binding.calls[0].url, url);
  assert.equal(binding.calls[0].init, init);
  assert.equal(plain.calls.length, 0);
});

test('no binding, another host, or a URL that will not parse: an ordinary fetch', async () => {
  const binding = recorder();
  const plain = recorder();
  const env = { PARTY: { fetch: binding.fn } };
  await partyFetch({}, `https://${DEFAULT_PARTY_HOST}/parties/main/b1/reset`, {}, { fetchImpl: plain.fn });
  await partyFetch(null, `https://${DEFAULT_PARTY_HOST}/parties/main/b1/reset`, {}, { fetchImpl: plain.fn });
  await partyFetch(env, `https://${OLD_PARTY_HOST}/parties/main/b1/reset`, {}, { fetchImpl: plain.fn });
  await partyFetch(env, 'http://localhost:1999/parties/main/b1/reset', {}, { fetchImpl: plain.fn });
  await partyFetch(env, 'not a url', {}, { fetchImpl: plain.fn });
  assert.equal(plain.calls.length, 5);
  assert.equal(binding.calls.length, 0);
});

test('the Worker declares the binding, and both of its party calls use it', () => {
  const toml = read('../../wrangler.toml');
  assert.match(toml, /\[\[services\]\]\s*\nbinding\s*=\s*"PARTY"\s*\nservice\s*=\s*"soleil-boards-party"/);
  // The party Worker's own name, so the binding reaches the host it stands for.
  assert.match(read('../../party/wrangler.jsonc'), /"name":\s*"soleil-boards-party"/);
  assert.equal(DEFAULT_PARTY_HOST.split('.')[0], 'soleil-boards-party');

  const worker = read('../worker.js');
  const reset = worker.slice(worker.indexOf('async function handleBoardReset('), worker.indexOf('// SSRF guard for /api/og.'));
  assert.match(reset, /await partyFetch\(env, target, \{/);
  assert.match(worker, /if \(resetMatch\) return await handleBoardReset\(resetMatch\[1\], request, ctx, env\);/);

  const api = read('../worker-api.js');
  const mpu = api.slice(api.indexOf('async function partyMpu('), api.indexOf('// The workspace a board belongs to'));
  assert.match(mpu, /await partyFetch\(env, `https:\/\/\$\{host\}\/parties\/upload\//);
  assert.doesNotMatch(mpu, /await fetch\(/);
});
