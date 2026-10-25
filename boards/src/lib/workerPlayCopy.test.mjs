// workerPlayCopy.test.mjs — /api/media/copy/*, with the database, the bucket
// and the box faked, so each line the routes hold is checked by what they do.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  handlePlayCopyRoute, tickPlayCopies, forgetPlayCopies, parseRange, sourceToken, cleanResult,
} from '../worker-playCopy.js';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WS = '0b6e2f0a-6c55-4b8e-9d0a-2a3f1c9e7b11';
const MOV = `${WS}/4f1c2d3e-0000-4000-8000-000000000001.mov`;
const AIFF = `${WS}/4f1c2d3e-0000-4000-8000-000000000002.aiff`;
const SECRET = 'box-secret-for-tests-0123456789abcdef';
const NOW = Date.parse('2026-10-24T20:00:00Z');

function world({ readable = [MOV, AIFF], jobs = {}, objects = {}, requestStates = {}, claimRows = [] } = {}) {
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
      assert.equal(table, 'media_copies');
      const key = decodeURIComponent(query.match(/storage_path=eq\.([^&]+)/)[1]);
      return jobs[key] ? [jobs[key]] : [];
    },
    svcRpc: async (_env, fn, params) => {
      rpcs.push({ fn, params });
      if (fn === '_media_copy_request') return requestStates[params.p_storage_path + (params.p_force ? '#force' : '')] ?? 'queued';
      if (fn === '_media_copy_claim') return claimRows;
      if (fn === '_media_copy_heartbeat') return !!jobs[params.p_storage_path];
      if (fn === '_media_copy_finish') return params.p_state;
      if (fn === '_media_copy_due') return requestStates.due ?? 0;
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

test('what a member cannot read, or is not media, is never queued', async () => {
  const w = world({ readable: [] });
  const res = await w.call('request', { headers: user, body: { keys: [MOV, `${WS}/a.jpg`, `${WS}/previews/x.play.mp4`, '../etc'] } });
  const { states } = await res.json();
  assert.equal(states[MOV], 'not_found');
  assert.equal(states[`${WS}/a.jpg`], 'not_media');
  assert.equal(states[`${WS}/previews/x.play.mp4`], 'not_media', 'a copy is never converted');
  assert.equal(states['../etc'], 'not_media');
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
});

test('a swept original takes its own copies with it, and nothing else', async () => {
  const deletes = [];
  const svcDelete = async (_env, table, query) => { deletes.push([table, decodeURIComponent(query)]); return true; };
  const n = await forgetPlayCopies({}, [MOV, AIFF, MOV, `${WS}/a.jpg`, `${WS}/previews/x.play.mp4`, '../x.mov'], { svcDelete });
  assert.equal(n, 2);
  assert.deepEqual(deletes, [
    ['images', `storage_path=in.("${WS}/previews/4f1c2d3e-0000-4000-8000-000000000001.play.mp4","${WS}/previews/4f1c2d3e-0000-4000-8000-000000000001.poster.webp","${WS}/previews/4f1c2d3e-0000-4000-8000-000000000002.play.m4a")`],
    ['media_copies', `storage_path=in.("${MOV}","${AIFF}")`],
  ]);
  const many = Array.from({ length: 90 }, (_, i) => `${WS}/clip-${i}.mkv`);
  deletes.length = 0;
  assert.equal(await forgetPlayCopies({}, many, { svcDelete }), 90);
  assert.equal(deletes.length, 6, 'in batches, so no URL runs long');
  assert.equal(await forgetPlayCopies({}, [], { svcDelete }), 0);
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
  assert.ok(sweep.indexOf('forgetPlayCopies(') > sweep.indexOf("'mark_image_rows_swept'"), 'after the originals are marked');
});
