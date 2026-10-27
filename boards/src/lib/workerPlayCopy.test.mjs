// workerPlayCopy.test.mjs — /api/media/copy/*, with the database, the bucket
// and the box faked, so each line the routes hold is checked by what they do.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  handlePlayCopyRoute, tickPlayCopies, forgetPlayCopies, parseRange, sourceToken, cleanResult, cleanViewResult,
} from '../worker-playCopy.js';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WS = '0b6e2f0a-6c55-4b8e-9d0a-2a3f1c9e7b11';
const MOV = `${WS}/4f1c2d3e-0000-4000-8000-000000000001.mov`;
const AIFF = `${WS}/4f1c2d3e-0000-4000-8000-000000000002.aiff`;
const HEIC = `${WS}/4f1c2d3e-0000-4000-8000-000000000003.heic`;
const VIEW = `${WS}/previews/4f1c2d3e-0000-4000-8000-000000000003.heic.view.webp`;
const VIEW_SM = `${WS}/previews/4f1c2d3e-0000-4000-8000-000000000003.heic.view_sm.webp`;
const DECK = `${WS}/4f1c2d3e-0000-4000-8000-000000000004.pptx`;
const DECK_VIEW = `${WS}/previews/4f1c2d3e-0000-4000-8000-000000000004.pptx.view.webp`;
const DECK_SM = `${WS}/previews/4f1c2d3e-0000-4000-8000-000000000004.pptx.view_sm.webp`;
const DECK_PDF = `${WS}/previews/4f1c2d3e-0000-4000-8000-000000000004.pptx.view.pdf`;
const SECRET = 'box-secret-for-tests-0123456789abcdef';
const NOW = Date.parse('2026-10-24T20:00:00Z');

function world({ readable = [MOV, AIFF, HEIC, DECK], jobs = {}, objects = {}, requestStates = {}, claimRows = [], viewClaimRows = [] } = {}) {
  const bucket = new Map(Object.entries(objects).map(([k, v]) => [k, typeof v === 'string' ? new TextEncoder().encode(v) : v]));
  const rpcs = [];
  const woke = [];
  const multipart = new Map();
  const env = {
    MEDIA_BOX_SECRET: SECRET,
    MEDIA_BOX_URL: 'https://box.example',
    SUPABASE_SERVICE_ROLE_KEY: 'svc',
    IMAGES: {
      head: async (k) => (bucket.has(k) ? { key: k, size: bucket.get(k).byteLength } : null),
      get: async (k, o = {}) => {
        if (!bucket.has(k)) return null;
        const b = bucket.get(k);
        const slice = o.range ? b.subarray(o.range.offset, o.range.offset + o.range.length) : b;
        return { body: slice, size: b.byteLength };
      },
      put: async (k, body, o) => {
        const bytes = new Uint8Array(await new Response(body).arrayBuffer());
        bucket.set(k, bytes);
        bucket.set(`${k}#type`, new TextEncoder().encode(o?.httpMetadata?.contentType || ''));
        return { size: bytes.byteLength };
      },
      createMultipartUpload: async (k) => { multipart.set('u1', { k, parts: new Map() }); return { uploadId: 'u1' }; },
      resumeMultipartUpload: (k, id) => ({
        uploadPart: async (n, body) => {
          multipart.get(id).parts.set(n, new Uint8Array(await new Response(body).arrayBuffer()));
          return { partNumber: n, etag: `e${n}` };
        },
        complete: async (parts) => {
          const m = multipart.get(id);
          const all = parts.map((p) => m.parts.get(p.partNumber));
          const out = new Uint8Array(all.reduce((s, a) => s + a.byteLength, 0));
          let o = 0;
          for (const a of all) { out.set(a, o); o += a.byteLength; }
          bucket.set(k, out);
          return { size: out.byteLength };
        },
      }),
    },
  };
  const deps = {
    now: () => NOW,
    allow: () => true,
    verifyUser: async (req) => (req.headers.get('authorization') === 'Bearer user-token'
      ? { ok: true, userId: 'user-1' } : { ok: false, status: 401 }),
    userSelect: async (_env, token, table, query) => {
      assert.equal(token, 'user-token', 'the original is looked up as the caller');
      assert.equal(table, 'images');
      return readable.filter((k) => decodeURIComponent(query).includes(`"${k}"`)).map((k) => ({ storage_path: k }));
    },
    svcSelect: async (_env, table, query) => {
      const key = decodeURIComponent(query.match(/storage_path=eq\.([^&]+)/)[1]);
      assert.equal(table, /\.(heic|pptx|procreat)$/.test(key) ? 'file_views' : 'media_copies', 'each key\'s job is read from its own queue');
      return jobs[key] ? [jobs[key]] : [];
    },
    svcRpc: async (_env, fn, params) => {
      rpcs.push({ fn, params });
      if (fn === '_media_copy_request' || fn === '_file_view_request') {
        return requestStates[params.p_storage_path + (params.p_force ? '#force' : '')] ?? 'queued';
      }
      if (fn === '_media_copy_claim') return claimRows;
      if (fn === '_file_view_claim') return viewClaimRows;
      if (fn === '_media_copy_heartbeat' || fn === '_file_view_heartbeat') return !!jobs[params.p_storage_path];
      if (fn === '_media_copy_finish' || fn === '_file_view_finish') return params.p_state;
      if (fn === '_media_copy_due') return requestStates.due ?? 0;
      if (fn === '_file_view_due') return requestStates.viewDue ?? 0;
      throw new Error(`unexpected rpc ${fn}`);
    },
    fetchImpl: async (url, init) => { woke.push({ url, auth: init.headers.authorization }); return new Response(null, { status: 202 }); },
  };
  const call = (path, { method = 'POST', headers = {}, body } = {}) => {
    const url = new URL(`https://app.example/api/media/copy/${path}`);
    const init = { method, headers };
    if (body !== undefined) init.body = typeof body === 'string' || body instanceof Uint8Array ? body : JSON.stringify(body);
    return handlePlayCopyRoute(url, new Request(url, init), env, null, deps);
  };
  return { env, deps, bucket, rpcs, woke, call };
}

const box = { authorization: `Bearer ${SECRET}` };
const user = { authorization: 'Bearer user-token' };
const leased = (o = {}) => ({ state: 'working', kind: 'video', attempts: 1, lease_until: new Date(NOW + 600_000).toISOString(), ...o });

test('a member asks for copies of files they can read, and the box is woken', async () => {
  const w = world();
  const res = await w.call('request', { headers: user, body: { keys: [MOV, AIFF] } });
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).states, { [MOV]: 'queued', [AIFF]: 'queued' });
  assert.deepEqual(w.rpcs.map((r) => [r.params.p_storage_path, r.params.p_kind, r.params.p_requested_by]),
    [[MOV, 'video', 'user-1'], [AIFF, 'audio', 'user-1']]);
  assert.deepEqual(w.woke, [{ url: 'https://box.example/wake', auth: `Bearer ${SECRET}` }]);
});

test('what a member cannot read, or gets no copy or view, is never queued', async () => {
  const w = world({ readable: [] });
  const res = await w.call('request', { headers: user, body: { keys: [MOV, HEIC, `${WS}/a.jpg`, `${WS}/previews/x.play.mp4`, VIEW, '../etc'] } });
  const { states } = await res.json();
  assert.equal(states[MOV], 'not_found');
  assert.equal(states[HEIC], 'not_found');
  assert.equal(states[`${WS}/a.jpg`], 'unsupported', 'every browser draws a JPEG');
  assert.equal(states[`${WS}/previews/x.play.mp4`], 'unsupported', 'a copy is never converted');
  assert.equal(states[VIEW], 'unsupported', 'nor a view');
  assert.equal(states['../etc'], 'unsupported');
  assert.equal(w.rpcs.length, 0);
  assert.equal(w.woke.length, 0);
  assert.equal((await w.call('request', { body: { keys: [MOV] } })).status, 401, 'signed out');
  assert.equal((await w.call('request', { headers: user, body: { keys: [] } })).status, 400);
});

test('a copy recorded as made but missing from the bucket is made again', async () => {
  const w = world({ requestStates: { [MOV]: 'done', [`${MOV}#force`]: 'queued' } });
  const { states } = await (await w.call('request', { headers: user, body: { keys: [MOV] } })).json();
  assert.equal(states[MOV], 'queued');
  assert.deepEqual(w.rpcs.map((r) => r.params.p_force), [false, true]);
  // …and one that is there is left alone.
  const w2 = world({ requestStates: { [MOV]: 'done' }, objects: { [`${WS}/previews/4f1c2d3e-0000-4000-8000-000000000001.play.mp4`]: 'x' } });
  const s2 = (await (await w2.call('request', { headers: user, body: { keys: [MOV] } })).json()).states;
  assert.equal(s2[MOV], 'done');
  assert.equal(w2.woke.length, 0, 'nothing queued, nothing woken');
});

test('a photo a browser can\'t draw is queued for a view, and a missing one is made again', async () => {
  const w = world();
  const { states } = await (await w.call('request', { headers: user, body: { keys: [HEIC, MOV] } })).json();
  assert.deepEqual(states, { [HEIC]: 'queued', [MOV]: 'queued' });
  assert.deepEqual(w.rpcs.map((r) => [r.fn, r.params.p_storage_path, r.params.p_kind]),
    [['_file_view_request', HEIC, 'image'], ['_media_copy_request', MOV, 'video']]);
  assert.equal(w.woke.length, 1);
  const gone = world({ requestStates: { [HEIC]: 'done', [`${HEIC}#force`]: 'queued' } });
  const s2 = (await (await gone.call('request', { headers: user, body: { keys: [HEIC] } })).json()).states;
  assert.equal(s2[HEIC], 'queued');
  assert.deepEqual(gone.rpcs.map((r) => r.params.p_force), [false, true]);
  const there = world({ requestStates: { [HEIC]: 'done' }, objects: { [VIEW]: 'x' } });
  assert.equal((await (await there.call('request', { headers: user, body: { keys: [HEIC] } })).json()).states[HEIC], 'done');
  const browser = world({ requestStates: { [HEIC]: 'has_preview' } });
  assert.equal((await (await browser.call('request', { headers: user, body: { keys: [HEIC] } })).json()).states[HEIC], 'has_preview');
  assert.equal(browser.woke.length, 0, 'a file a browser made a preview of wakes nothing');
});

test('a document is queued for its first page and its PDF, in the views\' queue', async () => {
  const w = world();
  const { states } = await (await w.call('request', { headers: user, body: { keys: [DECK] } })).json();
  assert.deepEqual(states, { [DECK]: 'queued' });
  assert.deepEqual(w.rpcs.map((r) => [r.fn, r.params.p_storage_path, r.params.p_kind]), [['_file_view_request', DECK, 'doc']]);
  assert.equal(w.woke.length, 1);
  // Made, but its first page is gone: made again. Its PDF isn't what decides.
  const gone = world({ requestStates: { [DECK]: 'done', [`${DECK}#force`]: 'queued' }, objects: { [DECK_PDF]: 'x' } });
  assert.equal((await (await gone.call('request', { headers: user, body: { keys: [DECK] } })).json()).states[DECK], 'queued');
  const there = world({ requestStates: { [DECK]: 'done' }, objects: { [DECK_VIEW]: 'x' } });
  assert.equal((await (await there.call('request', { headers: user, body: { keys: [DECK] } })).json()).states[DECK], 'done');
  // A document's PDF is never an original.
  const pdf = world();
  assert.equal((await (await pdf.call('request', { headers: user, body: { keys: [DECK_PDF] } })).json()).states[DECK_PDF], 'unsupported');
  assert.equal(pdf.rpcs.length, 0);
});

test('the box routes want the box secret; none configured is unavailable', async () => {
  const w = world();
  for (const r of ['claim', 'upload', 'heartbeat', 'finish']) {
    assert.equal((await w.call(r, { headers: user })).status, 401, r);
  }
  delete w.env.MEDIA_BOX_SECRET;
  assert.equal((await w.call('claim', { headers: box })).status, 503);
});

test('a claim hands over a source URL that opens that file during that lease only', async () => {
  const bytes = new Uint8Array(1000).map((_, i) => i % 251);
  const w = world({ claimRows: [{ storage_path: MOV, kind: 'video', size_bytes: 1000, attempts: 2 }],
    jobs: { [MOV]: leased({ attempts: 2 }) }, objects: { [MOV]: bytes } });
  const res = await w.call('claim', { headers: box });
  const job = await res.json();
  assert.equal(job.key, MOV);
  assert.equal(job.ext, 'mov');
  assert.equal(job.kind, 'video');
  const src = new URL(`https://app.example${job.source}`);
  assert.equal(src.searchParams.get('t'), await sourceToken(SECRET, MOV, 2));
  // Range reads, as ffmpeg makes them. No box secret needed: the token is it.
  const get = (range, t = src.searchParams.get('t')) => w.call(`source?key=${encodeURIComponent(MOV)}&t=${t}`, {
    method: 'GET', headers: range ? { range } : {},
  });
  const part = await get('bytes=10-19');
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('content-range'), 'bytes 10-19/1000');
  assert.deepEqual([...new Uint8Array(await part.arrayBuffer())], [...bytes.subarray(10, 20)]);
  const tail = await get('bytes=-5');
  assert.equal(tail.headers.get('content-range'), 'bytes 995-999/1000');
  assert.equal((await get('bytes=2000-')).status, 416);
  assert.equal((await get(null)).status, 200);
  // The last attempt's token, or none, opens nothing.
  assert.equal((await get('bytes=0-1', await sourceToken(SECRET, MOV, 1))).status, 404);
  assert.equal((await get('bytes=0-1', '')).status, 404);
});

test('a claim hands over views before copies, and a view\'s source opens like a copy\'s', async () => {
  const w = world({ viewClaimRows: [{ storage_path: HEIC, kind: 'image', size_bytes: 3, attempts: 1 }],
    claimRows: [{ storage_path: MOV, kind: 'video', size_bytes: 1, attempts: 1 }],
    jobs: { [HEIC]: leased({ kind: 'image' }) }, objects: { [HEIC]: 'abc' } });
  const job = await (await w.call('claim', { headers: box })).json();
  assert.deepEqual([job.key, job.kind, job.ext, job.sizeBytes], [HEIC, 'image', 'heic', 3]);
  assert.deepEqual(w.rpcs.map((r) => r.fn), ['_file_view_claim'], 'the copy queue is not touched while a view waits');
  const res = await w.call(job.source.replace('/api/media/copy/', ''), { method: 'GET' });
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'abc');
  const empty = world({ claimRows: [{ storage_path: MOV, kind: 'video', size_bytes: 1, attempts: 1 }] });
  assert.equal((await (await empty.call('claim', { headers: box })).json()).key, MOV);
  assert.deepEqual(empty.rpcs.map((r) => r.fn), ['_file_view_claim', '_media_copy_claim']);
  assert.equal((await world().call('claim', { headers: box })).status, 204);
});

test('a design file\'s claim names its extension as it is stored, and its source tells its size to a HEAD', async () => {
  // The uploader keeps eight letters of an extension: a .procreate is stored as .procreat.
  const procreate = `${WS}/4f1c2d3e-0000-4000-8000-000000000005.procreat`;
  const w = world({ viewClaimRows: [{ storage_path: procreate, kind: 'design', size_bytes: null, attempts: 1 }],
    jobs: { [procreate]: leased({ kind: 'design' }) }, objects: { [procreate]: 'abcdef' } });
  const job = await (await w.call('claim', { headers: box })).json();
  assert.deepEqual([job.key, job.kind, job.ext, job.sizeBytes], [procreate, 'design', 'procreat', null]);
  const head = await w.call(job.source.replace('/api/media/copy/', ''), { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-length'), '6');
  const tail = await w.call(job.source.replace('/api/media/copy/', ''), { method: 'GET', headers: { range: 'bytes=4-5' } });
  assert.equal(tail.status, 206);
  assert.equal(await tail.text(), 'ef');
});

test('the source closes when the lease does', async () => {
  const w = world({ jobs: { [MOV]: leased({ lease_until: new Date(NOW - 1).toISOString() }) }, objects: { [MOV]: 'abc' } });
  const t = await sourceToken(SECRET, MOV, 1);
  assert.equal((await w.call(`source?key=${encodeURIComponent(MOV)}&t=${t}`, { method: 'GET' })).status, 404);
  const done = world({ jobs: { [MOV]: leased({ state: 'done' }) }, objects: { [MOV]: 'abc' } });
  assert.equal((await done.call(`source?key=${encodeURIComponent(MOV)}&t=${t}`, { method: 'GET' })).status, 404);
});

test('outputs only ever land on the original\'s own copy keys', async () => {
  const w = world({ jobs: { [MOV]: leased(), [AIFF]: leased({ kind: 'audio' }) } });
  const put = (key, out, body) => w.call(`upload?key=${encodeURIComponent(key)}&out=${out}&step=put`, {
    headers: { ...box, 'content-length': String(body.length) }, body,
  });
  assert.equal((await put(MOV, 'copy', 'mp4-bytes')).status, 200);
  assert.equal(new TextDecoder().decode(w.bucket.get(`${WS}/previews/4f1c2d3e-0000-4000-8000-000000000001.play.mp4`)), 'mp4-bytes');
  assert.equal(new TextDecoder().decode(w.bucket.get(`${WS}/previews/4f1c2d3e-0000-4000-8000-000000000001.play.mp4#type`)), 'video/mp4');
  assert.equal((await put(MOV, 'poster', 'webp')).status, 200);
  assert.ok(w.bucket.has(`${WS}/previews/4f1c2d3e-0000-4000-8000-000000000001.poster.webp`));
  assert.equal((await put(AIFF, 'copy', 'm4a')).status, 200);
  assert.ok(w.bucket.has(`${WS}/previews/4f1c2d3e-0000-4000-8000-000000000002.play.m4a`));
  assert.equal((await put(AIFF, 'poster', 'x')).status, 400, 'no poster for sound');
  assert.equal((await put(MOV, '../../x', 'x')).status, 400);
  const other = `${WS}/4f1c2d3e-0000-4000-8000-000000000009.mov`;
  assert.equal((await put(other, 'copy', 'x')).status, 409, 'a job that is not leased takes nothing');
});

test('a view job\'s outputs land on its own view keys only, as WebP', async () => {
  const w = world({ jobs: { [HEIC]: leased({ kind: 'image' }) } });
  const put = (out, body) => w.call(`upload?key=${encodeURIComponent(HEIC)}&out=${out}&step=put`, {
    headers: { ...box, 'content-length': String(body.length) }, body,
  });
  assert.equal((await put('view', 'webp')).status, 200);
  assert.equal(new TextDecoder().decode(w.bucket.get(`${VIEW}#type`)), 'image/webp');
  assert.equal((await put('view_sm', 'sm')).status, 200);
  assert.equal(new TextDecoder().decode(w.bucket.get(VIEW_SM)), 'sm');
  assert.equal((await put('copy', 'x')).status, 400, 'a photo has no copy');
  assert.equal((await put('poster', 'x')).status, 400);
  const mov = world({ jobs: { [MOV]: leased() } });
  const r = await mov.call(`upload?key=${encodeURIComponent(MOV)}&out=view&step=put`, { headers: { ...box, 'content-length': '1' }, body: 'x' });
  assert.equal(r.status, 400, 'a video has no view');
});

test('a document job\'s outputs are its first page, its small size and its PDF, and only a document has a PDF', async () => {
  const w = world({ jobs: { [DECK]: leased({ kind: 'doc' }), [HEIC]: leased({ kind: 'image' }) } });
  const put = (key, out, body) => w.call(`upload?key=${encodeURIComponent(key)}&out=${out}&step=put`, {
    headers: { ...box, 'content-length': String(body.length) }, body,
  });
  assert.equal((await put(DECK, 'view', 'webp')).status, 200);
  assert.equal(new TextDecoder().decode(w.bucket.get(`${DECK_VIEW}#type`)), 'image/webp');
  assert.equal((await put(DECK, 'view_sm', 'sm')).status, 200);
  assert.ok(w.bucket.has(DECK_SM));
  assert.equal((await put(DECK, 'pdf', '%PDF-1.7')).status, 200);
  assert.equal(new TextDecoder().decode(w.bucket.get(DECK_PDF)), '%PDF-1.7');
  assert.equal(new TextDecoder().decode(w.bucket.get(`${DECK_PDF}#type`)), 'application/pdf');
  assert.equal((await put(DECK, 'copy', 'x')).status, 400, 'a document has no copy');
  assert.equal((await put(DECK, 'poster', 'x')).status, 400);
  assert.equal((await put(HEIC, 'pdf', 'x')).status, 400, 'a photo has no PDF');
});

test('a big copy goes up in parts', async () => {
  const w = world({ jobs: { [MOV]: leased() } });
  const q = (s) => `upload?key=${encodeURIComponent(MOV)}&out=copy&${s}`;
  const { uploadId } = await (await w.call(q('step=create'), { headers: box })).json();
  const p1 = await (await w.call(q(`step=part&uploadId=${uploadId}&n=1`), { headers: { ...box, 'content-length': '3' }, body: 'abc' })).json();
  const p2 = await (await w.call(q(`step=part&uploadId=${uploadId}&n=2`), { headers: { ...box, 'content-length': '2' }, body: 'de' })).json();
  const done = await w.call(q(`step=complete&uploadId=${uploadId}`), { headers: box, body: { parts: [p1, p2] } });
  assert.equal((await done.json()).size, 5);
  assert.equal(new TextDecoder().decode(w.bucket.get(`${WS}/previews/4f1c2d3e-0000-4000-8000-000000000001.play.mp4`)), 'abcde');
  assert.equal((await w.call(q(`step=part&uploadId=${uploadId}&n=0`), { headers: { ...box, 'content-length': '1' }, body: 'x' })).status, 400);
});

test('a finish is recorded only for a running job, and a "done" must have its copy', async () => {
  const copy = `${WS}/previews/4f1c2d3e-0000-4000-8000-000000000001.play.mp4`;
  const result = { durationSec: 12.3456, copy: { w: 1920, h: 1080, bytes: 5 }, poster: { w: 1024, h: 576 }, probe: { format: {} } };
  const missing = world({ jobs: { [MOV]: leased() } });
  const r1 = await (await missing.call('finish', { headers: box, body: { key: MOV, state: 'done', result } })).json();
  assert.equal(r1.state, 'failed', 'no copy in the bucket: failed, not done');
  assert.equal(missing.rpcs[0].params.p_result.error, 'the copy never arrived');

  const ok = world({ jobs: { [MOV]: leased() }, objects: { [copy]: 'x' } });
  const r2 = await (await ok.call('finish', { headers: box, body: { key: MOV, state: 'done', result } })).json();
  assert.equal(r2.state, 'done');
  const sent = ok.rpcs[0].params.p_result;
  assert.equal(sent.durationSec, 12.346);
  assert.deepEqual(sent.copy, { w: 1920, h: 1080, bytes: 5 });
  assert.equal(sent.poster, null, 'a poster that never arrived is not recorded');

  // Sound alone: a copy with no picture is still done.
  const m4a = `${WS}/previews/4f1c2d3e-0000-4000-8000-000000000002.play.m4a`;
  const sound = world({ jobs: { [AIFF]: leased({ kind: 'audio' }) }, objects: { [m4a]: 'x' } });
  const r3 = await (await sound.call('finish', { headers: box, body: { key: AIFF, state: 'done', result: { durationSec: 4, copy: { w: 0, h: 0, bytes: 9 }, poster: null } } })).json();
  assert.equal(r3.state, 'done');
  assert.deepEqual(sound.rpcs[0].params.p_result.copy, { w: null, h: null, bytes: 9 });

  assert.equal((await ok.call('finish', { headers: box, body: { key: MOV, state: 'bogus' } })).status, 400);
  const idle = world();
  assert.equal((await idle.call('finish', { headers: box, body: { key: MOV, state: 'skip', result: {} } })).status, 409);
});

test('a view is done only with its view in the bucket; a small one that never came is dropped', async () => {
  const result = { view: { w: 2048, h: 1536 }, viewSm: { w: 640, h: 480 }, original: { w: 4032, h: 3024 }, probe: { loader: 'heifload' } };
  const missing = world({ jobs: { [HEIC]: leased({ kind: 'image' }) } });
  const r1 = await (await missing.call('finish', { headers: box, body: { key: HEIC, state: 'done', result } })).json();
  assert.equal(r1.state, 'failed');
  assert.equal(missing.rpcs[0].fn, '_file_view_finish');
  assert.equal(missing.rpcs[0].params.p_result.error, 'the view never arrived');
  const half = world({ jobs: { [HEIC]: leased({ kind: 'image' }) }, objects: { [VIEW]: 'x' } });
  const r2 = await (await half.call('finish', { headers: box, body: { key: HEIC, state: 'done', result } })).json();
  assert.equal(r2.state, 'done');
  assert.deepEqual(half.rpcs[0].params.p_result.original, { w: 4032, h: 3024 });
  assert.equal(half.rpcs[0].params.p_result.viewSm, null);
  const beat = await half.call('heartbeat', { headers: box, body: { key: HEIC } });
  assert.equal(beat.status, 200);
  assert.equal(half.rpcs[1].fn, '_file_view_heartbeat');
  const v = cleanViewResult({ view: { w: '2048', h: 0 }, original: { w: 1e9, h: 5 }, reason: 'too_large', probe: { a: 'x'.repeat(20000) } });
  assert.equal(v.view, null);
  assert.equal(v.original, null);
  assert.equal(v.reason, 'too_large');
  assert.equal(v.probe, null);
});

test('a document is done with its first page; a PDF that never came is dropped, and a photo never records one', async () => {
  const result = { view: { w: 2048, h: 1152 }, viewSm: { w: 640, h: 360 }, pdf: { pages: 12 }, probe: { loader: 'pngload', via: 'libreoffice' } };
  const none = world({ jobs: { [DECK]: leased({ kind: 'doc' }) } });
  assert.equal((await (await none.call('finish', { headers: box, body: { key: DECK, state: 'done', result } })).json()).state, 'failed');
  assert.equal(none.rpcs[0].params.p_result.error, 'the view never arrived');
  const all = world({ jobs: { [DECK]: leased({ kind: 'doc' }) }, objects: { [DECK_VIEW]: 'x', [DECK_SM]: 'x', [DECK_PDF]: 'x' } });
  assert.equal((await (await all.call('finish', { headers: box, body: { key: DECK, state: 'done', result } })).json()).state, 'done');
  assert.equal(all.rpcs[0].fn, '_file_view_finish');
  assert.deepEqual(all.rpcs[0].params.p_result.pdf, { pages: 12 });
  assert.deepEqual(all.rpcs[0].params.p_result.viewSm, { w: 640, h: 360 });
  const noPdf = world({ jobs: { [DECK]: leased({ kind: 'doc' }) }, objects: { [DECK_VIEW]: 'x' } });
  assert.equal((await (await noPdf.call('finish', { headers: box, body: { key: DECK, state: 'done', result } })).json()).state, 'done');
  assert.equal(noPdf.rpcs[0].params.p_result.pdf, null, 'no PDF in the bucket: none recorded, the first page still shows');
  assert.equal(noPdf.rpcs[0].params.p_result.viewSm, null);
  const photo = world({ jobs: { [HEIC]: leased({ kind: 'image' }) }, objects: { [VIEW]: 'x', [`${WS}/previews/4f1c2d3e-0000-4000-8000-000000000003.heic.view.pdf`]: 'x' } });
  await photo.call('finish', { headers: box, body: { key: HEIC, state: 'done', result } });
  assert.equal(photo.rpcs[0].params.p_result.pdf, null, 'a photo has no PDF');
  assert.deepEqual(cleanViewResult({ pdf: { pages: '7' } }).pdf, { pages: 7 });
  for (const pdf of [{ pages: 0 }, { pages: -1 }, { pages: 1e6 }, { pages: 'x' }, 'x', null]) {
    assert.equal(cleanViewResult({ pdf }).pdf, null, JSON.stringify(pdf));
  }
});

test('the result is kept to what the record holds', () => {
  const r = cleanResult({ copy: { w: '1920', h: 1080.4, bytes: -1 }, poster: { w: 0, h: 5 }, reason: 'Too Long!', error: 'x'.repeat(400),
    durationSec: 'NaN', probe: { format: { a: 'x'.repeat(20000) }, streams: [] } });
  assert.deepEqual(r.copy, { w: 1920, h: 1080, bytes: null });
  assert.equal(r.poster, null);
  assert.equal(r.reason, null);
  assert.equal(r.error.length, 300);
  assert.equal(r.durationSec, null);
  assert.equal(r.probe, null, 'a probe too big even as its format is dropped');
  const many = cleanResult({ probe: { format: { format_name: 'matroska,webm' }, streams: Array.from({ length: 800 }, (_, i) => ({ index: i, codec_name: 'subrip' })) } });
  assert.deepEqual(many.probe, { format: { format_name: 'matroska,webm' } }, 'too many streams: the format is kept');
});

test('ranges', () => {
  assert.equal(parseRange(null, 10), null);
  assert.deepEqual(parseRange('bytes=0-', 10), { offset: 0, length: 10 });
  assert.deepEqual(parseRange('bytes=2-4', 10), { offset: 2, length: 3 });
  assert.deepEqual(parseRange('bytes=8-100', 10), { offset: 8, length: 2 });
  assert.deepEqual(parseRange('bytes=-3', 10), { offset: 7, length: 3 });
  assert.equal(parseRange('bytes=10-', 10), false);
  assert.equal(parseRange('bytes=5-2', 10), false);
  assert.equal(parseRange('bytes=-', 10), false);
  assert.equal(parseRange('items=0-1', 10), false);
});

test('the minute cron wakes the box only while work waits', async () => {
  const idle = world();
  assert.equal(await tickPlayCopies(idle.env, idle.deps), 0);
  assert.equal(idle.woke.length, 0);
  const busy = world({ requestStates: { due: 3 } });
  assert.equal(await tickPlayCopies(busy.env, busy.deps), 3);
  assert.equal(busy.woke.length, 1);
  const photos = world({ requestStates: { due: 1, viewDue: 2 } });
  assert.equal(await tickPlayCopies(photos.env, photos.deps), 3, 'both queues count');
  assert.equal(photos.woke.length, 1);
});

test('a swept original takes its own copies and views with it, and nothing else', async () => {
  const deletes = [];
  const svcDelete = async (_env, table, query) => { deletes.push([table, decodeURIComponent(query)]); return true; };
  const n = await forgetPlayCopies({}, [MOV, AIFF, MOV, HEIC, DECK, `${WS}/a.jpg`, `${WS}/previews/x.play.mp4`, VIEW, DECK_PDF, '../x.mov'], { svcDelete });
  assert.equal(n, 4);
  assert.deepEqual(deletes, [
    ['images', `storage_path=in.("${WS}/previews/4f1c2d3e-0000-4000-8000-000000000001.play.mp4","${WS}/previews/4f1c2d3e-0000-4000-8000-000000000001.poster.webp","${WS}/previews/4f1c2d3e-0000-4000-8000-000000000002.play.m4a","${VIEW}","${VIEW_SM}","${DECK_VIEW}","${DECK_SM}","${DECK_PDF}")`],
    ['media_copies', `storage_path=in.("${MOV}","${AIFF}")`],
    ['file_views', `storage_path=in.("${HEIC}","${DECK}")`],
  ]);
  const many = Array.from({ length: 90 }, (_, i) => `${WS}/clip-${i}.mkv`);
  deletes.length = 0;
  assert.equal(await forgetPlayCopies({}, many, { svcDelete }), 90);
  assert.equal(deletes.length, 6, 'in batches, so no URL runs long');
  assert.equal(await forgetPlayCopies({}, [], { svcDelete }), 0);
});

test('a swept design file takes its picture with it', async () => {
  const deletes = [];
  const svcDelete = async (_env, table, query) => { deletes.push([table, decodeURIComponent(query)]); return true; };
  const sketch = `${WS}/4f1c2d3e-0000-4000-8000-000000000006.sketch`;
  assert.equal(await forgetPlayCopies({}, [sketch], { svcDelete }), 1);
  assert.deepEqual(deletes, [
    ['images', `storage_path=in.("${WS}/previews/4f1c2d3e-0000-4000-8000-000000000006.sketch.view.webp","${WS}/previews/4f1c2d3e-0000-4000-8000-000000000006.sketch.view_sm.webp")`],
    ['file_views', `storage_path=in.("${sketch}")`],
  ]);
});

test('the Worker routes copies here and ticks the queue every minute', () => {
  const w = readFileSync(resolve(SRC, 'worker.js'), 'utf8');
  const copyAt = w.indexOf("url.pathname.startsWith('/api/media/copy/')");
  assert.ok(copyAt > 0 && copyAt < w.indexOf("url.pathname.startsWith('/api/media/')"), 'before the save-url branch');
  assert.match(w.slice(copyAt, copyAt + 200), /handlePlayCopyRoute\(url, request, env, ctx\)/);
  const minute = w.slice(w.indexOf("which === '* * * * *'"), w.indexOf("which === '15 * * * *'"));
  assert.match(minute, /tickPlayCopies\(env\)/);
  const sweep = w.slice(w.indexOf('async function runR2Sweep'), w.indexOf('async function runR2TombstoneSweep'));
  assert.match(sweep, /forgetPlayCopies\(env, sweptMedia\)/, 'the sweep forgets what it swept');
  assert.equal((sweep.match(/if \(mediaKindOfKey\(row\.storage_path\) \|\| viewKindOfKey\(row\.storage_path\)\) sweptMedia\.push/g) || []).length, 2,
    'photos with views are forgotten too');
  assert.ok(sweep.indexOf('forgetPlayCopies(') > sweep.indexOf("'mark_image_rows_swept'"), 'after the originals are marked');
});
