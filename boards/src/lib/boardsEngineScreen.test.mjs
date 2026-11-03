// The boards engine's photo screen (scripts/engine/photos.mjs findPhotos): before the
// first round's expensive AI looks, the engine may unify the downloads side by side, leave
// the misfits out unchecked, or stop at once when that alone dooms the try. Pexels and the
// image host are a stubbed fetch with real small JPEGs; nothing here reaches the network
// or Claude.

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import sharp from 'sharp';
import { findPhotos, dhash, hamming, PHOTO } from '../../scripts/engine/photos.mjs';

const SLOTS = 6;
const PER_SLOT = 5; // candidates a search returns, so a rejected photo has refills
const KEYS = Array.from({ length: SLOTS }, (_, i) => `0.${i}`);
const idOf = (slot, j) => 1000 * (slot + 1) + j; // slot 0's first candidate is pexels:1000
const nameOf = (slot, j) => `pexels:${idOf(slot, j)}`;
const fileOf = (slot, j) => `pexels-${idOf(slot, j)}.jpg`;

const recipe = {
  title: 'Screen test',
  sections: [{ name: 'Look', items: KEYS.map((_, i) => ({ kind: 'picture', search: `screen test ${i}` })) }],
};

// Seeded blocky noise: every photo gets its own difference hash, well past PHOTO.dupBits from the rest.
function noisePhoto(seed) {
  let a = seed >>> 0;
  const rand = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const w = 18;
  const h = 16;
  const raw = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h; i += 1) raw.fill(Math.floor(rand() * 256), i * 3, i * 3 + 3);
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } }).resize(180, 160, { kernel: 'nearest' }).jpeg().toBuffer();
}

const realFetch = globalThis.fetch;
const jpegs = new Map(); // pexels id → bytes
let imageRequests = []; // ids of the photos downloaded
let unsplashCalls = 0;

before(async () => {
  for (let s = 0; s < SLOTS; s += 1) for (let j = 0; j < PER_SLOT; j += 1) jpegs.set(idOf(s, j), await noisePhoto(idOf(s, j) * 7919));
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.hostname === 'api.pexels.com') {
      const slot = Number(url.searchParams.get('query').split(' ').pop());
      const photos = Array.from({ length: PER_SLOT }, (_, j) => ({
        id: idOf(slot, j), width: 3000, height: 2000, alt: `photo ${slot}.${j}`,
        src: { original: `https://images.pexels.com/photos/${idOf(slot, j)}/pexels-photo-${idOf(slot, j)}.jpeg`, medium: `https://images.pexels.com/m/${idOf(slot, j)}.jpeg` },
        photographer: 'Test Photographer', photographer_url: 'https://www.pexels.com/@test', url: `https://www.pexels.com/photo/${idOf(slot, j)}/`,
      }));
      return Response.json({ photos });
    }
    if (url.hostname === 'api.unsplash.com') { unsplashCalls += 1; return Response.json({ results: [] }); }
    if (url.hostname === 'images.pexels.com') {
      const id = Number(url.pathname.match(/photos\/(\d+)\//)?.[1]);
      if (!jpegs.has(id)) return new Response('not found', { status: 404 });
      imageRequests.push(id);
      return new Response(jpegs.get(id), { status: 200, headers: { 'content-type': 'image/jpeg' } });
    }
    return new Response('unexpected', { status: 404 });
  };
});

after(() => { globalThis.fetch = realFetch; });

// One findPhotos run in a fresh directory. check() answers 'real' unless `reject` says otherwise.
async function run({ screen, reject = () => false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'engine-screen-'));
  imageRequests = [];
  unsplashCalls = 0;
  const checks = []; // the names each check() call was handed
  const logs = [];
  const check = async (items) => {
    checks.push(items.map((it) => it.name));
    return items.map((it) => ({ file: it.file, verdict: reject(it.name, checks.length) ? 'ai' : 'real', sha: `sha-${it.name}`, why: [] }));
  };
  try {
    const result = await findPhotos(recipe, { dir, keys: { pexels: 'x', unsplash: 'y' }, check, screen, log: (m) => logs.push(m) });
    return { result, checks, logs };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('the fixture photos are all different photos to the duplicate check', async () => {
  const hashes = await Promise.all([...jpegs.values()].map((b) => dhash(b)));
  for (let i = 0; i < hashes.length; i += 1) {
    for (let k = i + 1; k < hashes.length; k += 1) assert.ok(hamming(hashes[i], hashes[k]) > PHOTO.dupBits, `photo ${i} and ${k} are too alike`);
  }
});

test('no screen: every download is checked and nothing is left out', async () => {
  const { result, checks } = await run();
  assert.deepEqual(checks, [KEYS.map((_, s) => nameOf(s, 0))]);
  assert.equal(result.found.size, SLOTS);
  assert.deepEqual(result.missing, []);
  assert.equal(result.rejected, 0);
  assert.equal(result.screened.size, 0);
  assert.equal(result.seen.size, 0);
  assert.equal(result.stopped, false);
  assert.equal(unsplashCalls, 0);
});

test('a screen leaves its misfits unchecked and never refills them', async () => {
  const seenByScreen = [];
  const screen = async (picked) => {
    seenByScreen.push(picked);
    return { out: new Map([['0.1', 'cooler than the rest'], ['0.4', 'a different era']]), stop: false };
  };
  // The first look turns slot 3's photo down, so a second round runs.
  const { result, checks } = await run({ screen, reject: (name, call) => call === 1 && name === nameOf(3, 0) });

  assert.equal(seenByScreen.length, 1, 'the screen runs once, on the first round');
  assert.deepEqual([...seenByScreen[0].keys()], KEYS);
  assert.deepEqual([...seenByScreen[0].values()].map((v) => basename(v.file)), KEYS.map((_, s) => fileOf(s, 0)));

  assert.equal(checks.length, 2);
  assert.deepEqual(checks[0], [0, 2, 3, 5].map((s) => nameOf(s, 0)), 'the first look gets only the four that were not screened out');
  assert.deepEqual(checks[1], [nameOf(3, 1)], 'the second round retries the rejected slot alone');
  const asked = new Set(imageRequests);
  for (const s of [1, 4]) for (let j = 1; j < PER_SLOT; j += 1) assert.ok(!asked.has(idOf(s, j)), `slot ${s} was refilled with ${nameOf(s, j)}`);

  assert.deepEqual([...result.found.keys()].sort(), ['0.0', '0.2', '0.3', '0.5']);
  assert.equal(result.found.get('0.3').id, nameOf(3, 1));
  assert.deepEqual(result.missing, ['0.1', '0.4']);
  assert.deepEqual([...result.screened], [['0.1', 'cooler than the rest'], ['0.4', 'a different era']]);
  assert.equal(result.rejected, 1);
  assert.equal(result.stopped, false);
  assert.deepEqual([...result.seen].map((f) => basename(f)).sort(), KEYS.map((_, s) => fileOf(s, 0)));
  assert.ok(![...result.seen].some((f) => basename(f) === fileOf(3, 1)), 'the round-2 replacement was never shown to the screen');
});

test('a screen that stops the try spends no looks', async () => {
  const screen = async () => ({ out: new Map([['0.2', 'a different era']]), stop: true });
  const { result, checks } = await run({ screen });
  assert.equal(checks.length, 0);
  assert.equal(result.stopped, true);
  assert.equal(result.found.size, 0);
  assert.deepEqual(result.missing, KEYS);
  assert.deepEqual([...result.screened.keys()], ['0.2']);
  assert.equal(result.seen.size, SLOTS);
});

test('a screen that throws leaves every photo to be checked, and the caller to unify', async () => {
  const screen = async () => { throw new Error('boom'); };
  const { result, checks, logs } = await run({ screen });
  assert.deepEqual(checks, [KEYS.map((_, s) => nameOf(s, 0))]);
  assert.equal(result.found.size, SLOTS);
  assert.equal(result.screened.size, 0);
  assert.equal(result.seen.size, 0, 'nothing counts as seen, so the final unify still runs');
  assert.equal(result.stopped, false);
  assert.ok(logs.some((m) => m.includes('screen failed (boom); checking them all')));
});
