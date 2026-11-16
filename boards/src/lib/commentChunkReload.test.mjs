// commentChunkReload.test.mjs — when a comment chunk that failed may reload the page.
//
//   node --test src/lib/commentChunkReload.test.mjs
//
// The rule is one pure function of three facts. recoverCommentChunk gathers
// them (and only asks the network when its answer decides it), so it is
// driven here with a stand-in for the browser.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldReloadForCommentChunk, recoverCommentChunk, chunkAddress, importAgain, reloadedOnBuild } from './commentChunkReload.js';

test('the one reload is per build: a tab that reloaded onto a newer build may reload for the next deploy', () => {
  assert.equal(reloadedOnBuild('', 'b2'), false, 'never reloaded');
  assert.equal(reloadedOnBuild(null, 'b2'), false);
  assert.equal(reloadedOnBuild('b1', 'b2'), false, 'reloaded from b1, now on b2: the deploy after may reload again');
  assert.equal(reloadedOnBuild('b2', 'b2'), true, 'reloaded and still on the same build: the chunk is broken, not replaced');
  assert.equal(reloadedOnBuild('1', 'b2'), false, 'the flag an older build left');
});

const chunkError = () => new Error('Failed to fetch dynamically imported module: https://clusters.soleilpictures.com/assets/commentParts-abc123.js');

test('a reload needs all three: a stale chunk, a site that answers, and no reload yet in this tab', () => {
  const yes = { stale: true, reachable: true, reloadedBefore: false };
  assert.equal(shouldReloadForCommentChunk(yes), true);
  assert.equal(shouldReloadForCommentChunk({ ...yes, stale: false }), false, 'a bug in the part is not a reason');
  assert.equal(shouldReloadForCommentChunk({ ...yes, reachable: false }), false, 'a dead or captive network');
  assert.equal(shouldReloadForCommentChunk({ ...yes, reloadedBefore: true }), false, 'once per tab');
  assert.equal(shouldReloadForCommentChunk({ stale: false, reachable: false, reloadedBefore: true }), false);
  assert.equal(shouldReloadForCommentChunk({}), false);
});

// A stand-in browser that counts what was asked of it.
function fake({ reachable = true, reloadedBefore = false, recently = false, reloads = true } = {}) {
  const env = {
    probes: 0, marks: 0, reloadCalls: 0,
    reloadedBefore: () => reloadedBefore,
    markReloaded: () => { env.marks += 1; },
    probe: async () => { env.probes += 1; return reachable; },
    recently: () => recently,
    reload: () => { env.reloadCalls += 1; return reloads; },
  };
  return env;
}

// Whether a promise is still unsettled after the microtasks and a timer turn.
async function pending(p) {
  const mark = Symbol('pending');
  const got = await Promise.race([p.then(() => 'settled', () => 'settled'), new Promise((r) => setTimeout(() => r(mark), 20))]);
  return got === mark;
}

test('a stale chunk on a site that answers reloads once, is remembered, and never settles', async () => {
  const env = fake();
  const p = recoverCommentChunk(chunkError(), env);
  assert.equal(await pending(p), true, 'what is showing stays put during the reload');
  assert.deepEqual([env.probes, env.marks, env.reloadCalls], [1, 1, 1]);
});

test('a dead network (navigator.onLine or not): no reload, the error goes on', async () => {
  const env = fake({ reachable: false });
  await assert.rejects(recoverCommentChunk(chunkError(), env), /dynamically imported module/);
  assert.deepEqual([env.probes, env.marks, env.reloadCalls], [1, 0, 0]);
});

test('a tab that already reloaded for a comment chunk: no reload, and the network is not asked', async () => {
  const env = fake({ reloadedBefore: true });
  await assert.rejects(recoverCommentChunk(chunkError(), env), /dynamically imported module/);
  assert.deepEqual([env.probes, env.marks, env.reloadCalls], [0, 0, 0]);
});

test('an error from inside the part is thrown on untouched, and the network is not asked', async () => {
  const env = fake();
  const bug = new TypeError("Cannot read properties of null (reading 'forEach')");
  await assert.rejects(recoverCommentChunk(bug, env), (e) => e === bug);
  assert.deepEqual([env.probes, env.marks, env.reloadCalls], [0, 0, 0]);
});

test("inside the shared ten seconds of another reload: no reload, and this tab's one is not spent", async () => {
  const env = fake({ recently: true });
  await assert.rejects(recoverCommentChunk(chunkError(), env), /dynamically imported module/);
  assert.deepEqual([env.marks, env.reloadCalls], [0, 0]);
});

// ── asking again without a reload ──────────────────────────────────────

test('the address of the chunk is read from the failure that names it, without its query', () => {
  assert.equal(chunkAddress(chunkError()), 'https://clusters.soleilpictures.com/assets/commentParts-abc123.js');
  // Vite's dev server
  assert.equal(chunkAddress(new TypeError('Failed to fetch dynamically imported module: http://127.0.0.1:5292/src/components/comments/CanvasCommentPins.jsx?t=1794749514008')),
    'http://127.0.0.1:5292/src/components/comments/CanvasCommentPins.jsx');
  // Firefox
  assert.equal(chunkAddress(new TypeError('error loading dynamically imported module: https://clusters.soleilpictures.com/assets/CanvasCommentPins-D6xfJR_o.js')),
    'https://clusters.soleilpictures.com/assets/CanvasCommentPins-D6xfJR_o.js');
});

test('a failure that names no address (WebKit, a stylesheet, nothing at all) has none, and is handed back', async () => {
  assert.equal(chunkAddress(new TypeError('Importing a module script failed.')), '');
  assert.equal(chunkAddress(new Error('Unable to preload CSS for /assets/commentParts-6j2P7a3I.css')), '');
  assert.equal(chunkAddress(null), '');
  const err = new TypeError('Importing a module script failed.');
  await assert.rejects(importAgain(err, 1), (e) => e === err);
});

test('with no browser at all (a test, a server render) the error goes on', async () => {
  // the real environment: no sessionStorage, and fetch to a path cannot answer
  await assert.rejects(recoverCommentChunk(chunkError()), /dynamically imported module/);
});
