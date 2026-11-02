// workerAdminPosts.test.mjs — /api/admin/posts/…, the admin phone panel's Posts
// tab, with the RPC and the upstream fetch faked.
//
//   node --test src/lib/workerAdminPosts.test.mjs
//
// What this guards:
//   * only days.json, posted and <date>/<plain image> can be addressed;
//   * the order of refusals: 404 path, 405 method, 401 no token, then the
//     admin RPC (403 refused, 502 check failed, 404 not set up);
//   * the right upstream URLs are fetched and the right headers go out;
//   * the page address and the push topic never appear in any response, body
//     or header, including when the upstream fetch throws with the address in
//     its message;
//   * worker.js routes the prefix here with userRpc.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { adminPostsTarget, handleAdminPosts, ADMIN_POSTS_PREFIX } from '../worker-admin-posts.js';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = { base: 'https://secret-host.example/SECRETTOKEN/', topic: 'secrettopic' };
const SECRETS = ['SECRETTOKEN', 'secret-host', 'secrettopic'];

function setup({ src = SOURCE, rpcError = null, fetchImpl = null } = {}) {
  const calls = { rpc: [], fetch: [] };
  const deps = {
    rpc: async (fn, params, token) => {
      calls.rpc.push({ fn, params, token });
      if (rpcError) throw rpcError;
      return src;
    },
    fetch: async (url, init) => {
      calls.fetch.push({ url, init });
      if (fetchImpl) return fetchImpl(url, init);
      return new Response('ok', { status: 200 });
    },
  };
  return { calls, deps };
}

const req = (method = 'GET', { auth = 'Bearer tok', body } = {}) => new Request('https://x.test/api/admin/posts/x', {
  method,
  headers: auth ? { authorization: auth } : {},
  body,
});

// Runs the handler and proves no secret is in the body text or any header.
async function run(request, rest, deps) {
  const res = await handleAdminPosts(request, rest, deps);
  const text = await res.clone().text();
  for (const s of SECRETS) {
    assert.ok(!text.includes(s), `body leaks ${s}`);
    for (const [k, v] of res.headers) assert.ok(!k.includes(s) && !v.includes(s), `header ${k} leaks ${s}`);
  }
  return { res, text };
}

test('adminPostsTarget addresses only days.json, posted and dated plain images', () => {
  assert.equal(adminPostsTarget('days.json'), 'days');
  assert.equal(adminPostsTarget('posted'), 'posted');
  assert.deepEqual(adminPostsTarget('2026-11-01/a-1.jpg'), { file: '2026-11-01/a-1.jpg', type: 'image/jpeg' });
  assert.deepEqual(adminPostsTarget('2026-11-01/a.png'), { file: '2026-11-01/a.png', type: 'image/png' });
  assert.deepEqual(adminPostsTarget('2026-11-01/a.webp'), { file: '2026-11-01/a.webp', type: 'image/webp' });
  for (const bad of ['../x.jpg', '2026-11-01/../../x.jpg', '2026-11-01/x.gif', 'x.jpg', '2026-11-01/sub/x.jpg', '']) {
    assert.equal(adminPostsTarget(bad), null, JSON.stringify(bad));
  }
});

test('an unknown path is 404 before the RPC is called', async () => {
  const { calls, deps } = setup();
  const { res } = await run(req(), 'nope', deps);
  assert.equal(res.status, 404);
  assert.equal(calls.rpc.length, 0);
  assert.equal(calls.fetch.length, 0);
});

test('wrong methods are 405, with an allow header', async () => {
  const { calls, deps } = setup();
  const a = await run(req('POST', { body: '{}' }), 'days.json', deps);
  assert.equal(a.res.status, 405);
  assert.equal(a.res.headers.get('allow'), 'GET');
  const b = await run(req('DELETE'), 'posted', deps);
  assert.equal(b.res.status, 405);
  assert.equal(b.res.headers.get('allow'), 'GET, POST');
  assert.equal(calls.rpc.length, 0);
});

test('no Authorization header is 401 and the RPC is not called', async () => {
  const { calls, deps } = setup();
  const { res } = await run(req('GET', { auth: null }), 'days.json', deps);
  assert.equal(res.status, 401);
  assert.equal(calls.rpc.length, 0);
});

test('the RPC runs as the caller with their token', async () => {
  const { calls, deps } = setup();
  await run(req('GET', { auth: 'Bearer abc.def' }), 'days.json', deps);
  assert.deepEqual(calls.rpc, [{ fn: 'admin_posts_source', params: {}, token: 'abc.def' }]);
});

test('an RPC failure maps to 403 (refused) or 502 (check failed)', async () => {
  const cases = [
    ['rpc admin_posts_source 403: {"code":"42501"}', 403],
    ['rpc admin_posts_source 401: x', 403],
    ['rpc admin_posts_source 500: boom', 502],
    ['timeout', 502],
  ];
  for (const [msg, status] of cases) {
    const { calls, deps } = setup({ rpcError: new Error(msg) });
    const { res } = await run(req(), 'days.json', deps);
    assert.equal(res.status, status, msg);
    assert.equal(calls.fetch.length, 0, msg);
  }
});

test('a missing source row is 404', async () => {
  const { calls, deps } = setup({ src: null });
  const { res } = await run(req(), 'days.json', deps);
  assert.equal(res.status, 404);
  assert.equal(calls.fetch.length, 0);
});

test('days.json is fetched from the base and passed through, private', async () => {
  const { calls, deps } = setup({ fetchImpl: () => new Response('{"days":[1]}', { status: 200 }) });
  const { res, text } = await run(req(), 'days.json', deps);
  assert.equal(calls.fetch[0].url, SOURCE.base + 'days.json');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /application\/json/);
  assert.equal(res.headers.get('cache-control'), 'private, no-store');
  assert.equal(text, '{"days":[1]}');
});

test('a slide is fetched from the base with its image type, private and nosniff', async () => {
  const { calls, deps } = setup({ fetchImpl: () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }) });
  const { res } = await run(req(), '2026-11-01/a-1.jpg', deps);
  assert.equal(calls.fetch[0].url, SOURCE.base + '2026-11-01/a-1.jpg');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/jpeg');
  assert.match(res.headers.get('cache-control'), /private/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await res.arrayBuffer()).byteLength, 3);
});

test('upstream failures: 404 stays 404, 500 is 502, a throw is 502 without the address', async () => {
  const a = setup({ fetchImpl: () => new Response('no', { status: 404 }) });
  assert.equal((await run(req(), 'days.json', a.deps)).res.status, 404);
  const b = setup({ fetchImpl: () => new Response('err', { status: 500 }) });
  assert.equal((await run(req(), 'days.json', b.deps)).res.status, 502);
  const c = setup({ fetchImpl: () => { throw new Error(`connect failed ${SOURCE.base}days.json`); } });
  assert.equal((await run(req(), 'days.json', c.deps)).res.status, 502);
  const d = setup({ fetchImpl: () => { throw new Error(`connect failed https://ntfy.sh/${SOURCE.topic}-posted`); } });
  assert.equal((await run(req(), 'posted', d.deps)).res.status, 502);
});

test('GET posted lists the post numbers from the last 24 hours', async () => {
  const lines = [
    JSON.stringify({ event: 'open', topic: 'x' }),
    JSON.stringify({ event: 'message', message: 'posted #14' }),
    JSON.stringify({ event: 'message', message: 'posted #14' }),
    JSON.stringify({ event: 'message', message: 'posted #15' }),
    'not json at all {',
  ].join('\n');
  const { calls, deps } = setup({ fetchImpl: () => new Response(lines, { status: 200 }) });
  const { res, text } = await run(req(), 'posted', deps);
  assert.equal(calls.fetch[0].url, 'https://ntfy.sh/secrettopic-posted/json?poll=1&since=24h');
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(text), { posted: [14, 15] });
});

test('POST posted sends "posted #n" to the topic', async () => {
  const { calls, deps } = setup();
  const { res, text } = await run(req('POST', { body: '{"n":14}' }), 'posted', deps);
  assert.equal(calls.fetch.length, 1);
  assert.equal(calls.fetch[0].url, 'https://ntfy.sh/secrettopic-posted');
  assert.equal(calls.fetch[0].init.method, 'POST');
  assert.equal(calls.fetch[0].init.body, 'posted #14');
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(text), { ok: true });
});

test('POST posted with a bad body is 400 and nothing is sent', async () => {
  for (const body of ['{"n":"14"}', '{"n":0}', '{"n":1.5}', '{not json']) {
    const { calls, deps } = setup();
    const { res } = await run(req('POST', { body }), 'posted', deps);
    assert.equal(res.status, 400, body);
    assert.equal(calls.fetch.length, 0, body);
  }
});

test('worker.js routes the prefix to handleAdminPosts with userRpc', () => {
  const worker = readFileSync(resolve(SRC, 'worker.js'), 'utf8');
  assert.equal(ADMIN_POSTS_PREFIX, '/api/admin/posts/');
  assert.match(worker, /import \{[^}]*\bhandleAdminPosts\b[^}]*\} from '\.\/worker-admin-posts\.js'/);
  assert.match(worker, /startsWith\(ADMIN_POSTS_PREFIX\)/);
  assert.match(worker, /handleAdminPosts\(request,[\s\S]{0,120}userRpc\(env,/);
  assert.match(worker, /handleAdminPosts\(request,[\s\S]{0,200}posts: env\.POSTS/);
});

test('with a POSTS binding the page files go through it, ntfy still by fetch', async () => {
  const { calls, deps } = setup({ fetchImpl: () => new Response('', { status: 200 }) });
  const via = [];
  deps.posts = { fetch: async (url) => { via.push(String(url)); return new Response('[]', { status: 200 }); } };
  const { res } = await run(req(), 'days.json', deps);
  assert.equal(res.status, 200);
  assert.deepEqual(via, [SOURCE.base + 'days.json']);
  assert.equal(calls.fetch.length, 0);
  await run(req(), 'posted', deps);
  assert.equal(calls.fetch.length, 1);
  assert.equal(via.length, 1);
});

test('wrangler.toml binds POSTS to the posts page Worker', () => {
  const toml = readFileSync(resolve(SRC, '..', 'wrangler.toml'), 'utf8');
  assert.match(toml, /\[\[services\]\]\s*\nbinding = "POSTS"\s*\nservice = "soleil-posts"/);
});
