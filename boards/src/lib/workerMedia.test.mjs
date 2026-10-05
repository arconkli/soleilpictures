// workerMedia.test.mjs — POST /api/media/save-url, with the database, the
// bucket and the outside web all faked, so every line the route holds is
// checked by what it actually stores.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleMediaRoute } from '../worker-media.js';
import {
  WEB_IMAGE, webImageUrlProblem, nameFromImageUrl, readCapped, makeRateLimiter,
} from './webImageSave.js';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BOARD = '11111111-2222-4333-8444-555555555555';

// A real 2×3 PNG header (signature + IHDR), padded.
const PNG = (() => {
  const b = new Uint8Array(64);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 2, 0, 0, 0, 3]);
  return b;
})();
const HTML = new TextEncoder().encode('<!doctype html><html><script>alert(1)</script></html>');
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

function world({
  canWrite = true, quota = { allow: true, reason: 'ok' }, prior = [], insertFails = false,
  serve = () => new Response(PNG, { headers: { 'content-type': 'image/png' } }),
} = {}) {
  const bucket = new Map();
  const inserted = [];
  const fetched = [];
  const env = {
    IMAGES: {
      put: async (k, v, o) => { bucket.set(k, { v, o }); },
      head: async (k) => (bucket.has(k) ? { key: k } : null),
      delete: async (k) => { bucket.delete(k); },
    },
  };
  const deps = {
    verifyUser: async (req) => (req.headers.get('authorization') === 'Bearer good'
      ? { ok: true, userId: 'user-1' } : { ok: false, status: 401 }),
    userSelect: async (_env, token, table, query) => {
      assert.equal(token, 'good', 'every read is made as the caller');
      if (table === 'boards') return query.startsWith(`id=eq.${BOARD}&`) ? [{ workspace_id: 'ws-1' }] : [];
      if (table === 'images') return prior;
      throw new Error(`unexpected select ${table}`);
    },
    userRpc: async (_env, token, fn) => {
      assert.equal(token, 'good');
      if (fn === 'can_write_board') return canWrite;
      if (fn === 'authorize_image_upload') return [quota];
      throw new Error(`unexpected rpc ${fn}`);
    },
    userInsert: async (_env, token, table, rows) => {
      assert.equal(token, 'good', 'the row is written as the caller, under RLS');
      if (insertFails) throw new Error('rls');
      inserted.push(...rows.map((r) => ({ table, ...r })));
      return null;
    },
    fetchImpl: async (url, init) => {
      fetched.push(url);
      assert.equal(init.redirect, 'manual', 'redirects are followed by hand');
      return serve(url);
    },
    uuid: () => 'fixed-uuid',
    allow: () => true,
  };
  return { env, deps, bucket, inserted, fetched };
}

const call = (w, body, { token = 'good', method = 'POST', path = '/api/media/save-url' } = {}) => {
  const req = new Request(`https://clusters.example${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: method === 'POST' ? JSON.stringify(body) : undefined,
  });
  return handleMediaRoute(new URL(req.url), req, w.env, w.deps);
};

test('a web picture is stored in the board\'s workspace and recorded under the caller', async () => {
  const w = world();
  const res = await call(w, { url: 'https://cdn.example.com/refs/ext_dusk_04.png?w=1200', boardId: BOARD, cardId: 'image-1', workspaceId: 'ws-evil' });
  assert.equal(res.status, 200);
  const out = await res.json();
  assert.equal(out.src, 'r2:ws-1/fixed-uuid.png', 'the workspace comes from the board, never the request');
  assert.deepEqual([out.width, out.height], [2, 3]);
  assert.equal(out.fileName, 'ext_dusk_04.png');
  assert.equal(w.bucket.get('ws-1/fixed-uuid.png').o.httpMetadata.contentType, 'image/png');
  assert.equal(w.inserted.length, 1);
  const row = w.inserted[0];
  assert.equal(row.table, 'images');
  assert.equal(row.workspace_id, 'ws-1');
  assert.equal(row.board_id, BOARD);
  assert.equal(row.card_id, 'image-1');
  assert.equal(row.uploaded_by, 'user-1');
  assert.equal(row.size_bytes, PNG.length);
  assert.equal(row.source_url, 'https://cdn.example.com/refs/ext_dusk_04.png?w=1200');
});

test('the bytes decide: a page or an SVG labelled image/png is refused and nothing is stored', async () => {
  for (const bytes of [HTML, SVG]) {
    const w = world({ serve: () => new Response(bytes, { headers: { 'content-type': 'image/png' } }) });
    const res = await call(w, { url: 'https://evil.example/pic.png', boardId: BOARD });
    assert.equal(res.status, 415);
    assert.equal((await res.json()).error, 'not_an_image');
    assert.equal(w.bucket.size, 0);
    assert.equal(w.inserted.length, 0);
  }
  // And a response that SAYS it is a page is not read at all.
  const w = world({ serve: () => new Response(PNG, { headers: { 'content-type': 'text/html' } }) });
  assert.equal((await call(w, { url: 'https://a.example/x', boardId: BOARD })).status, 415);
});

test('a reader who cannot write the board is refused before anything is fetched', async () => {
  const w = world({ canWrite: false });
  const res = await call(w, { url: 'https://cdn.example.com/a.png', boardId: BOARD });
  assert.equal(res.status, 403);
  assert.deepEqual(w.fetched, []);
  // An RPC that errors is not a yes either.
  const w2 = world();
  w2.deps.userRpc = async (_e, _t, fn) => { if (fn === 'can_write_board') throw new Error('down'); return [{ allow: true }]; };
  assert.equal((await call(w2, { url: 'https://cdn.example.com/a.png', boardId: BOARD })).status, 403);
});

test('a board the caller cannot see is a 404', async () => {
  const w = world();
  const res = await call(w, { url: 'https://cdn.example.com/a.png', boardId: '99999999-2222-4333-8444-555555555555' });
  assert.equal(res.status, 404);
});

test('over the owner\'s storage, nothing is kept — and the refusal says so', async () => {
  const w = world({ quota: { allow: false, reason: 'over_quota' } });
  const res = await call(w, { url: 'https://cdn.example.com/a.png', boardId: BOARD });
  assert.equal(res.status, 402);
  assert.equal(w.bucket.size, 0);
});

test('a row that cannot be written takes its object back with it', async () => {
  const w = world({ insertFails: true });
  const res = await call(w, { url: 'https://cdn.example.com/a.png', boardId: BOARD });
  assert.equal(res.status, 500);
  assert.equal(w.bucket.size, 0, 'no unreadable, unswept object is left behind');
});

test('every save stores its own copy — an address is not a picture', async () => {
  // A re-exported frame_012.png at the same link is a new frame; reusing the
  // first copy would quietly swap it back. And the lookup would have put a
  // signed link into a query string the database gateway logs.
  const w = world();
  w.deps.userSelect = async (_e, _t, table, query) => {
    assert.notEqual(table, 'images', 'no lookup by address');
    assert.ok(!query.includes('source_url'), 'no address in a query string');
    return [{ workspace_id: 'ws-1' }];
  };
  const a = await (await call(w, { url: 'https://cdn.example.com/a.png', boardId: BOARD })).json();
  w.deps.uuid = () => 'second-uuid';
  const b = await (await call(w, { url: 'https://cdn.example.com/a.png', boardId: BOARD })).json();
  assert.notEqual(a.src, b.src);
  assert.equal(w.fetched.length, 2);
  assert.equal(a.reused, undefined);
});

test('the isolate\'s memory budget: a save that does not fit is "busy", and the budget comes back', async () => {
  const { makeByteBudget, reservationFor } = await import('./webImageSave.js');
  const budget = makeByteBudget(30 * 1024 * 1024);
  const sized = (n) => () => new Response(PNG, { headers: { 'content-length': String(PNG.length) } });
  // Undeclared length reserves twice the ceiling — more than this budget holds.
  const w = world({ serve: () => new Response(new ReadableStream({ start(c) { c.enqueue(PNG); c.close(); } })) });
  w.deps.budget = budget;
  const res = await call(w, { url: 'https://cdn.example.com/a.png', boardId: BOARD });
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error, 'busy');
  assert.equal(w.bucket.size, 0);
  assert.equal(budget.used, 0, 'a refused save holds nothing');
  // A declared length reserves just that, and gives it back however it ends.
  const ok = world({ serve: sized() });
  ok.deps.budget = budget;
  assert.equal((await call(ok, { url: 'https://cdn.example.com/a.png', boardId: BOARD })).status, 200);
  const failing = world({ serve: sized(), insertFails: true });
  failing.deps.budget = budget;
  assert.equal((await call(failing, { url: 'https://cdn.example.com/a.png', boardId: BOARD })).status, 500);
  assert.equal(budget.used, 0, 'released on success and on failure');
  assert.equal(reservationFor(1000), 1000);
  assert.equal(reservationFor(null), 2 * WEB_IMAGE.maxBytes);
});

test('internal addresses are refused up front, and so is a redirect to one', async () => {
  for (const url of ['http://169.254.169.254/latest/meta-data', 'https://localhost/a.png', 'https://user:pw@cdn.example.com/a.png', 'ftp://cdn.example.com/a.png', 'https://cdn.example.com:8443/a.png']) {
    const w = world();
    const res = await call(w, { url, boardId: BOARD });
    assert.equal(res.status, 422, url);
    assert.deepEqual(w.fetched, [], `${url} is never fetched`);
  }
  const w = world({
    serve: (u) => (u.startsWith('https://cdn.example.com/')
      ? new Response(null, { status: 302, headers: { location: 'http://10.0.0.7/admin.png' } })
      : new Response(PNG)),
  });
  const res = await call(w, { url: 'https://cdn.example.com/a.png', boardId: BOARD });
  assert.equal(res.status, 422);
  assert.deepEqual(w.fetched, ['https://cdn.example.com/a.png'], 'the internal hop is never requested');
});

test('too large is refused — declared, or counted as it streams', async () => {
  const declared = world({ serve: () => new Response(PNG, { headers: { 'content-length': String(WEB_IMAGE.maxBytes + 1) } }) });
  assert.equal((await call(declared, { url: 'https://cdn.example.com/a.png', boardId: BOARD })).status, 413);
  const big = new Uint8Array(WEB_IMAGE.maxBytes + 10);
  big.set(PNG);
  const streamed = world({ serve: () => new Response(new ReadableStream({
    start(c) { for (let o = 0; o < big.length; o += 1 << 20) c.enqueue(big.subarray(o, o + (1 << 20))); c.close(); },
  })) });
  assert.equal((await call(streamed, { url: 'https://cdn.example.com/a.png', boardId: BOARD })).status, 413);
  assert.equal(streamed.bucket.size, 0);
});

test('a dead source is a 502, a missing token a 401, a bad body a 400', async () => {
  const dead = world({ serve: () => new Response('gone', { status: 404 }) });
  assert.equal((await call(dead, { url: 'https://cdn.example.com/a.png', boardId: BOARD })).status, 502);
  assert.equal((await call(world(), { url: 'https://cdn.example.com/a.png', boardId: BOARD }, { token: 'bad' })).status, 401);
  assert.equal((await call(world(), { url: 'https://cdn.example.com/a.png', boardId: 'not-a-uuid' })).status, 400);
  assert.equal((await call(world(), {}, { method: 'GET' })).status, 405);
});

test('the rate limit bounds a loop, per person, per minute', () => {
  let t = 0;
  const allow = makeRateLimiter({ perMinute: 3, now: () => t });
  assert.deepEqual([allow('a'), allow('a'), allow('a'), allow('a'), allow('b')], [true, true, true, false, true]);
  t = 60_000;
  assert.equal(allow('a'), true, 'a new minute, a new allowance');
});

test('names come from addresses that have one, and only those', () => {
  assert.equal(nameFromImageUrl('https://x.example/a/b/ext_dusk_04.jpg?w=1'), 'ext_dusk_04.jpg');
  assert.equal(nameFromImageUrl('https://x.example/a/diner%20night.webp'), 'diner night.webp');
  assert.equal(nameFromImageUrl('https://encrypted-tbn0.gstatic.com/images?q=tbn:abc'), null);
  assert.equal(nameFromImageUrl('https://x.example/p/C8xYz/'), null);
  assert.equal(nameFromImageUrl('https://x.example/image.png'), null, 'a clipboard-style name is no name');
  assert.equal(webImageUrlProblem('https://x.example/' + 'a'.repeat(WEB_IMAGE.urlMax)), 'address too long');
});

test('readCapped returns exactly the bytes under the ceiling, into one buffer when the length is declared', async () => {
  assert.deepEqual(await readCapped(new Response(PNG), 1000), PNG);
  const declared = await readCapped(new Response(PNG, { headers: { 'content-length': String(PNG.length) } }), 1000);
  assert.deepEqual(declared, PNG);
  assert.equal(declared.buffer.byteLength, PNG.length, 'sized from the declared length — never held twice');
  // A body longer than it declared is not the body it described.
  const liar = new Response(new ReadableStream({ start(c) { c.enqueue(PNG); c.enqueue(PNG); c.close(); } }),
    { headers: { 'content-length': String(PNG.length) } });
  await assert.rejects(readCapped(liar, 1000), (e) => e.code === 'too_large');
});

test('the Worker routes /api/media/* to it', () => {
  const worker = readFileSync(resolve(SRC, 'worker.js'), 'utf8');
  assert.match(worker, /if \(url\.pathname\.startsWith\('\/api\/media\/'\)\) return await handleMediaRoute\(url, request, env\);/);
});
