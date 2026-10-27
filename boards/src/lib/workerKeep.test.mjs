// workerKeep.test.mjs — the Worker's half of a draft's keep page
// (worker-keep.js): the bundle the page reads, and the pictures it shows by
// signed address (P3b).
//
//   node --test src/lib/workerKeep.test.mjs
//
// Nothing leaves the machine: fetch stands in for PostgREST, and R2 is a map.
import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { handleKeepBundle, handleSignedImage } from '../worker-keep.js';
import { sha256Hex, DRAFT_LIFETIME_DAYS } from './mcpDrafts.js';
import { imageSecret, signImageKey, verifySignedImage, SIGNED_IMAGE_TTL_S } from './signedImage.js';

const ENV = { SUPABASE_URL: 'https://db.test', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'svc' };
const PREVIEW = 'https://main-soleil-boards.arconkli.workers.dev';
const PRODUCTION = 'https://clusters.soleilpictures.com';
const TOKEN = '0a1b2c3d-0000-4000-8000-00000000aaaa';
const BOARD = '5a4b3c2d-1e0f-4a9b-8c7d-6e5f4a3b2c1d';
const ctx = { waitUntil() {} };

let rpc;      // function name → (params) => body | { status, body }
let calls;
let ip = 0;   // a fresh address per request, so the per-isolate limit never counts across tests
const realFetch = globalThis.fetch;

beforeEach(() => {
  rpc = {};
  calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ path: url.pathname, body });
    const fn = url.pathname.match(/^\/rest\/v1\/rpc\/(\w+)$/)?.[1];
    if (fn && rpc[fn]) {
      const out = await rpc[fn](body);
      const status = out?.status ?? 200;
      return new Response(JSON.stringify(out?.status ? out.body : out), { status });
    }
    return new Response('null', { status: 201 });   // error reports and the like
  };
});
afterEach(() => { globalThis.fetch = realFetch; });

const keepCalls = () => calls.filter((c) => c.path === '/rest/v1/rpc/mcp_draft_keep_view');
function bundle(origin, body, { env = ENV, method = 'POST', headers = {} } = {}) {
  const req = new Request(`${origin}/api/keep/bundle`, {
    method,
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': `203.0.113.${(ip += 1)}`, ...headers },
    ...(method === 'POST' ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
  });
  return handleKeepBundle(new URL(req.url), req, env, ctx);
}

const LIVE = {
  state: 'live', host: 'chatgpt', expires_at: '2026-11-26T00:00:00+00:00', card_count: 32, card_limit: 50,
  bundle: {
    board: { id: BOARD, name: 'Tokyo noir, 1974', view: 'canvas', cover: null, bg_color: null },
    snapshot: 'AAA=',
    image_keys: ['u/ws/one.jpg', 'u/ws/one-pv.webp', 'u/ws/clip.mp4'],
    image_meta: { 'u/ws/one.jpg': { blur: 'LKO2', preview: 'u/ws/one-pv.webp' } },
    role: 'viewer', root_id: BOARD, include_subboards: true,
    nav_boards: [{ id: BOARD, name: 'Tokyo noir, 1974' }], join: null,
  },
};

test('the bundle answers POST only', async () => {
  const res = await bundle(PREVIEW, null, { method: 'GET' });
  assert.equal(res.status, 405);
  assert.equal(res.headers.get('allow'), 'POST');
});

test('where drafts are held there is no draft, and the database is never asked', async () => {
  rpc.mcp_draft_keep_view = () => LIVE;
  const res = await bundle(PRODUCTION, { token: TOKEN });
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { state: 'unknown', lifetime_days: DRAFT_LIFETIME_DAYS });
  assert.equal(keepCalls().length, 0);
});

test('only a keep token reaches the database, and only as its hash', async () => {
  rpc.mcp_draft_keep_view = () => ({ state: 'unknown' });
  for (const body of [{}, { token: 'nope' }, { token: `${TOKEN}x` }, { token: 7 }, 'not json']) {
    const res = await bundle(PREVIEW, body);
    assert.equal(res.status, 404, JSON.stringify(body));
  }
  assert.equal(keepCalls().length, 0);
  await bundle(PREVIEW, { token: TOKEN.toUpperCase(), board_id: 'not-a-board' });
  await bundle(PREVIEW, { token: TOKEN, board_id: BOARD });
  const [a, b] = keepCalls();
  assert.deepEqual(a.body, { p_keep_hash: await sha256Hex(TOKEN), p_board_id: null });
  assert.deepEqual(b.body, { p_keep_hash: await sha256Hex(TOKEN), p_board_id: BOARD });
  assert.ok(!JSON.stringify(calls).includes(TOKEN), 'the token itself never leaves');
});

test("a live draft: the share viewer's bundle, with every picture signed for an hour on this origin", async () => {
  rpc.mcp_draft_keep_view = () => LIVE;
  const before = Math.floor(Date.now() / 1000);
  const res = await bundle(PREVIEW, { token: TOKEN });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('x-robots-tag'), 'noindex');
  const out = await res.json();
  assert.deepEqual(
    { ...out, image_urls: Object.keys(out.image_urls) },
    {
      state: 'live', host: 'chatgpt', expires_at: LIVE.expires_at, lifetime_days: DRAFT_LIFETIME_DAYS,
      card_count: 32, card_limit: 50, board: LIVE.bundle.board, snapshot: 'AAA=',
      image_urls: LIVE.bundle.image_keys, image_meta: LIVE.bundle.image_meta, role: 'viewer', root_id: BOARD,
      include_subboards: true, nav_boards: LIVE.bundle.nav_boards,
    });
  const secret = await imageSecret(ENV.SUPABASE_SERVICE_ROLE_KEY);
  for (const key of LIVE.bundle.image_keys) {
    const url = out.image_urls[key];
    assert.ok(url.startsWith(`${PREVIEW}/api/img/`), url);
    const ok = await verifySignedImage(secret, url.slice(`${PREVIEW}/api/img/`.length));
    assert.equal(ok.key, key);
    assert.ok(ok.expiresAt >= before + SIGNED_IMAGE_TTL_S && ok.expiresAt <= before + SIGNED_IMAGE_TTL_S + 5);
  }
});

test('kept, expired and unknown answer their state alone', async () => {
  rpc.mcp_draft_keep_view = () => ({ state: 'kept', host: 'claude' });
  let res = await bundle(PREVIEW, { token: TOKEN });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { state: 'kept', host: 'claude', lifetime_days: DRAFT_LIFETIME_DAYS });
  rpc.mcp_draft_keep_view = () => ({ state: 'expired', host: 'chatgpt' });
  res = await bundle(PREVIEW, { token: TOKEN });
  assert.deepEqual(await res.json(), { state: 'expired', host: 'chatgpt', lifetime_days: DRAFT_LIFETIME_DAYS });
  rpc.mcp_draft_keep_view = () => ({ state: 'unknown' });
  res = await bundle(PREVIEW, { token: TOKEN });
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { state: 'unknown', host: null, lifetime_days: DRAFT_LIFETIME_DAYS });
  // A live answer without its bundle is not shown as live.
  rpc.mcp_draft_keep_view = () => ({ state: 'live', host: 'claude' });
  res = await bundle(PREVIEW, { token: TOKEN });
  assert.equal((await res.json()).state, 'unknown');
});

test('a database that fails is a retry, not a missing draft', async () => {
  rpc.mcp_draft_keep_view = () => ({ status: 500, body: { message: 'boom' } });
  const res = await bundle(PREVIEW, { token: TOKEN });
  assert.equal(res.status, 503);
  assert.equal(res.headers.get('retry-after'), '5');
  assert.equal((await res.json()).code, 'temporarily_unavailable');
});

test('too many reads from one address are refused before the database', async () => {
  rpc.mcp_draft_keep_view = () => LIVE;
  const env = { ...ENV, KEEP_BUNDLE: { limit: async () => ({ success: false }) } };
  const res = await bundle(PREVIEW, { token: TOKEN }, { env });
  assert.equal(res.status, 429);
  assert.equal(res.headers.get('retry-after'), '60');
  assert.equal(keepCalls().length, 0);
});

// ── /api/img/ ────────────────────────────────────────────────────────────────

const BYTES = new TextEncoder().encode('0123456789');
function r2(objects, { throws = false, asked = [] } = {}) {
  return {
    asked,
    async get(key, opts) {
      asked.push(key);
      if (throws) throw new Error('InvalidRange');
      const o = objects[key];
      if (!o) return null;
      const range = opts?.range instanceof Headers ? opts.range.get('range') : null;
      const ifNone = opts?.onlyIf instanceof Headers ? opts.onlyIf.get('if-none-match') : null;
      const meta = { size: BYTES.length, httpEtag: '"e1"', httpMetadata: { contentType: o.type } };
      if (ifNone === '"e1"') return meta;                       // R2: an object without a body
      if (range) {
        const m = range.match(/^bytes=(\d*)-(\d*)$/);
        if (m[1] === '') {
          const suffix = Number(m[2]);
          return { ...meta, range: { suffix }, body: BYTES.slice(BYTES.length - suffix) };
        }
        const offset = Number(m[1]);
        const length = m[2] === '' ? BYTES.length - offset : Number(m[2]) - offset + 1;
        return { ...meta, range: { offset, length }, body: BYTES.slice(offset, offset + length) };
      }
      return { ...meta, body: BYTES };
    },
  };
}
async function img(key, { method = 'GET', headers = {}, images, expiresIn = 600, signed } = {}) {
  const secret = await imageSecret(ENV.SUPABASE_SERVICE_ROLE_KEY);
  const path = signed ?? await signImageKey(secret, key, Math.floor(Date.now() / 1000) + expiresIn);
  const req = new Request(`${PREVIEW}/api/img/${path}`, {
    method, headers: { 'cf-connecting-ip': `198.51.100.${(ip += 1) % 250}`, ...headers },
  });
  return handleSignedImage(new URL(req.url), req, { ...ENV, IMAGES: images });
}

test('a signed address serves its picture, as a picture and nothing more', async () => {
  const images = r2({ 'u/ws/one.jpg': { type: 'image/jpeg' } });
  const res = await img('u/ws/one.jpg', { images });
  assert.equal(res.status, 200);
  assert.deepEqual(new Uint8Array(await res.arrayBuffer()), BYTES);
  assert.equal(res.headers.get('content-type'), 'image/jpeg');
  assert.equal(res.headers.get('content-disposition'), 'inline');
  assert.match(res.headers.get('cache-control'), /^private, max-age=(59\d|600)$/);
  assert.equal(res.headers.get('cross-origin-resource-policy'), 'cross-origin');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.match(res.headers.get('content-security-policy'), /default-src 'none'.*; sandbox$/);
  assert.equal(res.headers.get('etag'), '"e1"');
});

test('anything else stored goes out as a download', async () => {
  const images = r2({ 'u/ws/page.html': { type: 'text/html' } });
  const res = await img('u/ws/page.html', { images });
  assert.equal(res.headers.get('content-type'), 'application/octet-stream');
  assert.equal(res.headers.get('content-disposition'), 'attachment');
});

test('an unsigned, forged or expired address opens nothing, and R2 is never asked', async () => {
  const images = r2({ 'u/ws/one.jpg': { type: 'image/jpeg' } });
  const secret = await imageSecret('another-service-key');
  for (const signed of ['', 'nothing', await signImageKey(secret, 'u/ws/one.jpg', Math.floor(Date.now() / 1000) + 600)]) {
    const res = await img('u/ws/one.jpg', { images, signed });
    assert.equal(res.status, 403, signed);
    assert.equal(res.headers.get('cache-control'), 'no-store');
  }
  const expired = await img('u/ws/one.jpg', { images, expiresIn: -1 });
  assert.equal(expired.status, 403);
  assert.deepEqual(images.asked, []);
});

test('a range is answered as a range, from either end', async () => {
  const images = r2({ 'u/ws/clip.mp4': { type: 'video/mp4' } });
  let res = await img('u/ws/clip.mp4', { images, headers: { range: 'bytes=2-5' } });
  assert.equal(res.status, 206);
  assert.equal(res.headers.get('content-range'), 'bytes 2-5/10');
  assert.equal(new TextDecoder().decode(await res.arrayBuffer()), '2345');
  res = await img('u/ws/clip.mp4', { images, headers: { range: 'bytes=-3' } });
  assert.equal(res.headers.get('content-range'), 'bytes 7-9/10');
  assert.equal(new TextDecoder().decode(await res.arrayBuffer()), '789');
  res = await img('u/ws/clip.mp4', { images, headers: { range: 'bytes=8-' } });
  assert.equal(res.headers.get('content-range'), 'bytes 8-9/10');
});

test('not modified, missing, past the end, HEAD and other methods', async () => {
  const images = r2({ 'u/ws/one.jpg': { type: 'image/jpeg' } });
  assert.equal((await img('u/ws/one.jpg', { images, headers: { 'if-none-match': '"e1"' } })).status, 304);
  assert.equal((await img('u/ws/gone.jpg', { images })).status, 404);
  assert.equal((await img('u/ws/one.jpg', { images: r2({}, { throws: true }), headers: { range: 'bytes=50-60' } })).status, 416);
  const head = await img('u/ws/one.jpg', { images, method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.body, null);
  const post = await img('u/ws/one.jpg', { images, method: 'POST' });
  assert.equal(post.status, 405);
});

test('too many pictures from one address are refused', async () => {
  const images = r2({ 'u/ws/one.jpg': { type: 'image/jpeg' } });
  const secret = await imageSecret(ENV.SUPABASE_SERVICE_ROLE_KEY);
  const path = await signImageKey(secret, 'u/ws/one.jpg', Math.floor(Date.now() / 1000) + 600);
  const req = new Request(`${PREVIEW}/api/img/${path}`, { headers: { 'cf-connecting-ip': '192.0.2.1' } });
  const res = await handleSignedImage(new URL(req.url), req,
    { ...ENV, IMAGES: images, SIGNED_IMAGE: { limit: async () => ({ success: false }) } });
  assert.equal(res.status, 429);
  assert.deepEqual(images.asked, []);
});
