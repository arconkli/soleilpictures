// webImageClient.test.mjs — the canvas's side of saving a web image: it asks
// once, never throws, and backs off from a route that is missing or failing.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { saveWebImageCopy, _resetWebImageCooldown } from './webImageClient.js';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BOARD = '11111111-2222-4333-8444-555555555555';
const getToken = async () => 'tok';
const jsonRes = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => _resetWebImageCooldown());

test('a landed copy comes back as an r2 source, with what the route said', async () => {
  const calls = [];
  const res = await saveWebImageCopy({
    url: 'https://cdn.example.com/a.png', boardId: BOARD, cardId: 'image-1', getToken,
    fetchImpl: async (path, init) => { calls.push({ path, init }); return jsonRes(200, { src: 'r2:ws/k.png', fileName: 'a.png', reused: false, bytes: 10 }); },
  });
  assert.equal(res.ok, true);
  assert.equal(res.src, 'r2:ws/k.png');
  assert.equal(calls[0].path, '/api/media/save-url');
  assert.equal(calls[0].init.headers.authorization, 'Bearer tok');
  assert.deepEqual(JSON.parse(calls[0].init.body), { url: 'https://cdn.example.com/a.png', boardId: BOARD, cardId: 'image-1' });
});

test('a refusal is a code, never a throw — and only http(s) is ever asked about', async () => {
  const refused = await saveWebImageCopy({ url: 'https://a.example/x', boardId: BOARD, getToken, fetchImpl: async () => jsonRes(415, { error: 'not_an_image' }) });
  assert.deepEqual(refused, { ok: false, code: 'not_an_image' });
  const thrown = await saveWebImageCopy({ url: 'https://a.example/x', boardId: BOARD, getToken, fetchImpl: async () => { throw new TypeError('offline'); } });
  assert.deepEqual(thrown, { ok: false, code: 'network' });
  let asked = 0;
  for (const url of ['data:image/png;base64,AAAA', 'blob:https://x/1', 'r2:ws/k.png', '']) {
    const r = await saveWebImageCopy({ url, boardId: BOARD, getToken, fetchImpl: async () => { asked++; return jsonRes(200, {}); } });
    assert.equal(r.code, 'skipped');
  }
  assert.equal(asked, 0);
  const noToken = await saveWebImageCopy({ url: 'https://a.example/x', boardId: BOARD, fetchImpl: async () => jsonRes(200, {}) });
  assert.equal(noToken.code, 'signed_out');
});

test('a missing route (a page, not JSON) or a struggling Worker is left alone for a minute', async () => {
  let t = 1000;
  let asked = 0;
  const html = async () => { asked++; return new Response('<html>404</html>', { status: 404, headers: { 'content-type': 'text/html' } }); };
  await saveWebImageCopy({ url: 'https://a.example/x', boardId: BOARD, getToken, fetchImpl: html, now: () => t });
  const again = await saveWebImageCopy({ url: 'https://a.example/y', boardId: BOARD, getToken, fetchImpl: html, now: () => t + 1000 });
  assert.equal(again.code, 'cooldown');
  assert.equal(asked, 1);
  t += 61_000;
  await saveWebImageCopy({ url: 'https://a.example/z', boardId: BOARD, getToken, fetchImpl: html, now: () => t });
  assert.equal(asked, 2, 'asked again after the minute');
  // A refusal about THIS image is not a reason to stop asking about the next.
  _resetWebImageCooldown();
  await saveWebImageCopy({ url: 'https://a.example/x', boardId: BOARD, getToken, fetchImpl: async () => jsonRes(415, { error: 'not_an_image' }), now: () => t });
  const next = await saveWebImageCopy({ url: 'https://a.example/y', boardId: BOARD, getToken, fetchImpl: async () => jsonRes(200, { src: 'r2:k' }), now: () => t });
  assert.equal(next.ok, true);
});

test('a response that is not an r2 source is not trusted onto a card', async () => {
  const r = await saveWebImageCopy({ url: 'https://a.example/x', boardId: BOARD, getToken, fetchImpl: async () => jsonRes(200, { src: 'https://evil.example/x.png' }) });
  assert.deepEqual(r, { ok: false, code: 'bad_response' });
});

test('the canvas paints the hotlink first and moves the card only onto a copy, on the same board', () => {
  const canvas = readFileSync(resolve(SRC, 'components/CanvasSurface.jsx'), 'utf8');
  const fn = canvas.slice(canvas.indexOf('const placeRemoteImage = () => {'), canvas.indexOf('const placeLinkCard = () => {'));
  const add = fn.indexOf("kind: 'image', src: url,");
  const ask = fn.indexOf('saveWebImageCopy({');
  assert.ok(add > 0 && ask > add, 'the card exists before the copy is asked for');
  assert.match(fn, /if \(!res\?\.ok \|\| boardIdRef\.current !== dropBoardId\) return;/);
  assert.match(fn, /mutators\.updateCardSilent\?\.\(id, \{\s*src: res\.src, sourceUrl: url/,
    'silent: the swap is not its own undo step, like every upload patch');
  assert.match(fn, /if \(dropBoardId && !useLocalImages\)/);
});
