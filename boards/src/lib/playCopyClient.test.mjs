// playCopyClient.test.mjs — asking the Worker for copies, and finding them.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  requestPlayCopies, findPlayCopy, copyKeyOf, _resetPlayCopyCooldown, REQUEST_MAX_KEYS,
} from './playCopyClient.js';

const here = dirname(fileURLToPath(import.meta.url));
const WS = '0b6e2f0a-6c55-4b8e-9d0a-2a3f1c9e7b11';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => _resetPlayCopyCooldown());

test('asks for the media files only, as the signed-in member', async () => {
  const sent = [];
  const fetchImpl = async (url, init) => { sent.push({ url, init }); return json({ states: { [`${WS}/a.mov`]: 'queued' } }); };
  const states = await requestPlayCopies([`${WS}/a.mov`, `${WS}/b.jpg`, `${WS}/a.mov`], { getToken: async () => 'tok', fetchImpl });
  assert.deepEqual(states, { [`${WS}/a.mov`]: 'queued' });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, '/api/media/copy/request');
  assert.equal(sent[0].init.headers.authorization, 'Bearer tok');
  assert.deepEqual(JSON.parse(sent[0].init.body), { keys: [`${WS}/a.mov`] });
  const many = Array.from({ length: 30 }, (_, i) => `${WS}/c${i}.mkv`);
  await requestPlayCopies(many, { getToken: async () => 'tok', fetchImpl });
  assert.equal(JSON.parse(sent[1].init.body).keys.length, REQUEST_MAX_KEYS);
});

test('signed out, nothing to ask, or a failure: an empty answer, never a throw', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; throw new Error('offline'); };
  assert.deepEqual(await requestPlayCopies([`${WS}/a.mov`], { getToken: async () => null, fetchImpl }), {});
  assert.deepEqual(await requestPlayCopies([`${WS}/a.jpg`], { getToken: async () => 'tok', fetchImpl }), {});
  assert.equal(calls, 0);
  assert.deepEqual(await requestPlayCopies([`${WS}/a.mov`], { getToken: async () => 'tok', fetchImpl }), {});
  assert.equal(calls, 1);
});

test('a route that is not there is left alone for a minute', async () => {
  let t = 1000;
  let calls = 0;
  const html = async () => { calls += 1; return new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } }); };
  const opts = { getToken: async () => 'tok', fetchImpl: html, now: () => t };
  assert.deepEqual(await requestPlayCopies([`${WS}/a.mov`], opts), {});
  await requestPlayCopies([`${WS}/a.mov`], opts);
  assert.equal(calls, 1, 'cooling down');
  t += 61_000;
  await requestPlayCopies([`${WS}/a.mov`], opts);
  assert.equal(calls, 2);
});

test('a copy is found by its derived key, if this viewer can be handed it', async () => {
  assert.equal(copyKeyOf(`${WS}/a.mov`), `${WS}/previews/a.play.mp4`);
  assert.equal(copyKeyOf(`${WS}/s.flac`), `${WS}/previews/s.play.m4a`);
  assert.equal(copyKeyOf(`${WS}/a.png`), null);
  const asked = [];
  const sign = async (k, o) => { asked.push([k, o.force]); return k.endsWith('a.play.mp4') ? 'https://signed' : null; };
  assert.equal(await findPlayCopy(`${WS}/a.mov`, { sign }), `r2:${WS}/previews/a.play.mp4`);
  assert.equal(await findPlayCopy(`${WS}/b.mov`, { sign, force: true }), null);
  assert.deepEqual(asked, [[`${WS}/previews/a.play.mp4`, false], [`${WS}/previews/b.play.mp4`, true]]);
  assert.equal(await findPlayCopy(`${WS}/a.mov`, { sign: async () => { throw new Error('x'); } }), null);
  assert.equal(await findPlayCopy(`${WS}/a.jpg`, { sign }), null);
});

// The hooks need React to run; these pin the lines that make them right.
test('the player hands a failure to the copy before showing it', () => {
  const hook = readFileSync(join(here, '..', 'hooks', 'usePlayCopy.js'), 'utf8');
  assert.match(hook, /knownCopy\(src, playSrc\)/, 'a stale playSrc is never played');
  assert.match(hook, /COPY_REASONS = new Set\(\['decode', 'no_picture', 'stalled'\]\)/);
  assert.doesNotMatch(hook, /\.rpc\([^)]*\)\s*\.catch/, 'no .catch() on a supabase builder');
  const player = readFileSync(join(here, '..', 'components', 'film', 'FilmPlayer.jsx'), 'utf8');
  assert.match(player, /usePlayCopy\(\{ src, playSrc/);
  assert.match(player, /useResolvedMedia\(pc\.source, retryNonce\)/, 'the player loads what the hook says');
  assert.match(player, /failure && !pc\.handles\(failure\.reason\)/, 'a failure the copy can fix is not shown');
  const cards = readFileSync(join(here, '..', 'components', 'cards.jsx'), 'utf8');
  assert.match(cards, /playSrc=\{playSrc\}/, 'the video card passes its copy to the player');
  const canvas = readFileSync(join(here, '..', 'components', 'CanvasSurface.jsx'), 'utf8');
  assert.equal((canvas.match(/playSrc=\{c\.playSrc\}/g) || []).length, 2, 'video and audio cards get theirs');
});
