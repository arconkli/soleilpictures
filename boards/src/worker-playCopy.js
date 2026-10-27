// worker-playCopy.js — /api/media/copy/*: the Worker's half of the converter.
//
// A video or audio file a browser can't play gets a copy that every browser
// can (lib/playCopy.js says which files, and what the copies are called), a
// photo some browser can't draw (HEIC, TIFF, JPEG XL, OpenEXR, a raw, a .psd)
// gets a view, a WebP picture of it, and a document (Word, PowerPoint, Excel,
// Keynote, ...) a view of its first page and a PDF of its pages
// (lib/fileView.js). The converter that makes them
// (media/, on Fly) is kept knowing nothing: it holds one secret,
// MEDIA_BOX_SECRET, and no storage or database credentials. This file is
// everything else:
//
//   POST request   (a signed-in member) ask for copies or views of files they
//                  can read
//   POST claim     (the box) take the next job: a 15-minute lease
//   GET  source    (ffmpeg, or the box's download, with a per-job token) the
//                  original, Range-capable, straight from the R2 binding —
//                  only while the job is leased
//   POST upload    (the box) the copy and the poster, or the view, its small
//                  size and a document's PDF, into R2 through the binding (one
//                  PUT, or multipart in 64 MiB parts)
//   POST heartbeat (the box) keep the lease while a long encode runs
//   POST finish    (the box) record what was made
//
// The queues are Postgres (media_copies, 0660; file_views, 0661), driven with
// the service role; a key's own extension says which one its work is in.
// Who may ask is decided as the caller: the original must come back from a
// select made with their own token, so RLS answers "can they read it".
//
// The box is woken with POST {MEDIA_BOX_URL}/wake when a request queues work,
// and by the minute cron (tickPlayCopies) while anything is queued. Fly starts
// the stopped machine on that request; the box exits on its own when idle.
//
// ffmpeg reads the source over https and never sees the box secret: claim
// hands back a source URL whose token is an HMAC of the key and the job's
// attempt, so it opens that one file during that one lease and nothing else.

import { verifyUser } from './lib/workerAuth.js';
import { userSelect } from './lib/apiAuth.js';
import { scoutRpc, scoutSelect, scoutDelete } from './lib/scoutDb.js';
import { copyKeys, copyKeyFor, mediaKindOfKey, extOfKey, isCopyKey } from './lib/playCopy.js';
import { viewKeys, viewKindOfKey, isViewKey, isViewKind } from './lib/fileView.js';
import { makeRateLimiter } from './lib/webImageSave.js';
import { answeredWith, jobFailed } from './lib/workerErrors.js';

// `<workspace uuid>/<path>`: the shape every original's key has, and nothing
// PostgREST's in-list quoting or a URL could trip on.
const KEY_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[A-Za-z0-9_][A-Za-z0-9_.\/-]{0,300}$/i;
const LEASE_SECONDS = 900;
const MAX_REQUEST_KEYS = 20;
const PUT_MAX_BYTES = 100 * 1024 * 1024;
const MAX_PARTS = 10_000;
const PROBE_JSON_MAX = 16 * 1024;
const WAKE_TIMEOUT_MS = 15_000;

const CONTENT_TYPE = { video: 'video/mp4', audio: 'audio/mp4', poster: 'image/webp', view: 'image/webp', pdf: 'application/pdf' };

// The two queues, by what a key's file gets: a playable copy (0660) or a view
// (0661). The functions of each take the same arguments.
const QUEUES = {
  copy: {
    table: 'media_copies', request: '_media_copy_request', claim: '_media_copy_claim',
    heartbeat: '_media_copy_heartbeat', finish: '_media_copy_finish', due: '_media_copy_due',
  },
  view: {
    table: 'file_views', request: '_file_view_request', claim: '_file_view_claim',
    heartbeat: '_file_view_heartbeat', finish: '_file_view_finish', due: '_file_view_due',
  },
};

const DEFAULT_DEPS = {
  verifyUser,
  userSelect,
  svcRpc: scoutRpc,
  svcSelect: scoutSelect,
  svcDelete: scoutDelete,
  fetchImpl: (...args) => fetch(...args),
  now: () => Date.now(),
  allow: makeRateLimiter({ perMinute: 30 }),
};

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});

const validKey = (k) => typeof k === 'string' && KEY_RE.test(k) && !k.includes('..') && !isCopyKey(k) && !isViewKey(k);

// The kind of work an original's file gets ('video' | 'audio' | 'image' |
// 'doc') and the queue it waits in, or null for a file that gets none.
function workOf(key) {
  if (!validKey(key)) return null;
  const media = mediaKindOfKey(key);
  if (media) return { kind: media, queue: QUEUES.copy };
  const view = viewKindOfKey(key);
  return view ? { kind: view, queue: QUEUES.view } : null;
}

// Views: a photo's, a document's first page and PDF, or a design file's picture.
const isView = isViewKind;

// What a job made that must be in the bucket for it to count as done.
const madeKey = (key, kind) => (isView(kind) ? viewKeys(key).view : copyKeyFor(key, kind));

// ── Secrets ────────────────────────────────────────────────────────────────

async function sha256(s) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(s))));
}

// Constant-time, whatever the lengths: compare digests.
async function sameSecret(a, b) {
  const [x, y] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

async function boxAuthorized(request, env) {
  const m = /^Bearer\s+(.+)$/i.exec(request.headers.get('authorization') || '');
  return !!(m && env.MEDIA_BOX_SECRET && await sameSecret(m[1], env.MEDIA_BOX_SECRET));
}

const b64url = (u8) => btoa(String.fromCharCode(...u8)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// The source URL's token: this key, this attempt. A new claim (attempt + 1)
// makes the old token worthless.
export async function sourceToken(secret, key, attempts) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(secret)),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(`source\n${key}\n${attempts}`));
  return b64url(new Uint8Array(mac)).slice(0, 43);
}

// ── Waking the box ─────────────────────────────────────────────────────────

export async function wakeBox(env, d = DEFAULT_DEPS) {
  if (!env.MEDIA_BOX_URL || !env.MEDIA_BOX_SECRET) return false;
  try {
    const res = await d.fetchImpl(`${String(env.MEDIA_BOX_URL).replace(/\/+$/, '')}/wake`, {
      method: 'POST',
      headers: { authorization: `Bearer ${env.MEDIA_BOX_SECRET}` },
      signal: AbortSignal.timeout(WAKE_TIMEOUT_MS),
    });
    return res.ok;
  } catch (_) {
    // A box that is slow to boot still boots: Fly started it on the request.
    return false;
  }
}

// The minute cron: wake the box while anything waits (a lost wake, a lease
// that ran out on a stopped machine). One indexed count a queue when nothing
// does.
export async function tickPlayCopies(env, deps = {}) {
  const d = { ...DEFAULT_DEPS, ...deps };
  if (!env.SUPABASE_SERVICE_ROLE_KEY || !env.MEDIA_BOX_URL) return 0;
  try {
    const counts = await Promise.all([QUEUES.copy, QUEUES.view].map((q) => d.svcRpc(env, q.due, {})));
    const due = counts.reduce((n, c) => n + (Number(c) || 0), 0);
    if (due > 0) await wakeBox(env, d);
    return due;
  } catch (err) {
    console.warn('[play-copy] tick failed', String(err?.message || err).slice(0, 160));
    await jobFailed(env, 'play_copies', err, 'tick');
    return 0;
  }
}

// The R2 sweep reclaimed these originals. It only marks their rows, so
// nothing cascades: delete the copies' and views' rows (their tombstones
// queue the objects for the sweep's second pass) and the records. A key's
// copies and views are derived from it, so nothing but an original's own can
// go.
const FORGET_BATCH = 40;
export async function forgetPlayCopies(env, paths, deps = {}) {
  const d = { ...DEFAULT_DEPS, ...deps };
  const originals = [...new Set(paths || [])].filter((p) => workOf(p));
  const inList = (keys) => encodeURIComponent(`in.(${keys.map((k) => `"${k}"`).join(',')})`);
  for (let i = 0; i < originals.length; i += FORGET_BATCH) {
    const batch = originals.slice(i, i + FORGET_BATCH);
    const made = batch.flatMap((p) => {
      const kind = workOf(p).kind;
      const v = viewKeys(p);
      if (kind === 'image') return [v.view, v.sm];
      if (kind === 'doc') return [v.view, v.sm, v.pdf];
      return kind === 'audio' ? [copyKeys(p).audio] : [copyKeys(p).video, copyKeys(p).poster];
    });
    await d.svcDelete(env, 'images', `storage_path=${inList(made)}`);
    for (const q of [QUEUES.copy, QUEUES.view]) {
      const mine = batch.filter((p) => workOf(p).queue === q);
      if (mine.length) await d.svcDelete(env, q.table, `storage_path=${inList(mine)}`);
    }
  }
  return originals.length;
}

// ── The routes ─────────────────────────────────────────────────────────────

export async function handlePlayCopyRoute(url, request, env, ctx = null, deps = {}) {
  const d = { ...DEFAULT_DEPS, ...deps };
  const route = url.pathname.slice('/api/media/copy/'.length);
  try {
    if (route === 'request') {
      if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
      return await requestCopies(request, env, ctx, d);
    }
    if (!['claim', 'source', 'upload', 'heartbeat', 'finish'].includes(route)) return json({ error: 'not_found' }, 404);
    if (!env.MEDIA_BOX_SECRET || !env.IMAGES || !env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'unavailable' }, 503);
    if (route === 'source') {
      if (request.method !== 'GET' && request.method !== 'HEAD') return json({ error: 'method_not_allowed' }, 405);
      return await serveSource(url, request, env, d);
    }
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    if (!await boxAuthorized(request, env)) return json({ error: 'unauthorized' }, 401);
    if (route === 'claim') return await claim(env, d);
    if (route === 'upload') return await upload(url, request, env, d);
    if (route === 'heartbeat') return await heartbeat(request, env, d);
    return await finish(request, env, d);
  } catch (err) {
    console.warn('[play-copy]', route, String(err?.message || err).slice(0, 200));
    answeredWith(request, err);
    return json({ error: 'failed' }, 500);
  }
}

// A member asks. Each key must be an original they can read whose file gets
// a copy or a view; asking again is free (one row per original) and says how
// it is getting on.
async function requestCopies(request, env, ctx, d) {
  const auth = await d.verifyUser(request, env);
  if (!auth.ok) return json({ error: 'unauthorized' }, auth.status || 401);
  if (!d.allow(auth.userId)) return json({ error: 'rate_limited' }, 429);
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'unavailable' }, 503);
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');

  let body = null;
  try { body = await request.json(); } catch (_) { /* answered below */ }
  const asked = Array.isArray(body?.keys) ? [...new Set(body.keys)] : [];
  if (asked.length === 0 || asked.length > MAX_REQUEST_KEYS) return json({ error: 'bad_request' }, 400);
  const states = {};
  const keys = [];
  for (const k of asked) {
    if (workOf(k)) keys.push(k);
    else states[String(k).slice(0, 300)] = 'unsupported';
  }
  if (keys.length) {
    // As the caller: a file they can't read is a file that isn't there.
    const list = `in.(${keys.map((k) => `"${k}"`).join(',')})`;
    const rows = await d.userSelect(env, token, 'images',
      `storage_path=${encodeURIComponent(list)}&deleted_at=is.null&select=storage_path`);
    const readable = new Set((Array.isArray(rows) ? rows : []).map((r) => r.storage_path));
    for (const k of keys) {
      if (!readable.has(k)) { states[k] = 'not_found'; continue; }
      const { kind, queue } = workOf(k);
      let state = await d.svcRpc(env, queue.request,
        { p_storage_path: k, p_kind: kind, p_requested_by: auth.userId, p_force: false });
      // A copy or view recorded as made whose object is gone (a sweep, a
      // bucket restore) is made again rather than shown as a 404.
      if (state === 'done' && !(await env.IMAGES?.head?.(madeKey(k, kind)))) {
        state = await d.svcRpc(env, queue.request,
          { p_storage_path: k, p_kind: kind, p_requested_by: auth.userId, p_force: true });
      }
      states[k] = state;
    }
  }
  if (Object.values(states).includes('queued')) {
    const wake = wakeBox(env, d);
    if (ctx?.waitUntil) ctx.waitUntil(wake); else await wake;
  }
  return json({ states });
}

// Views first: a photo or a document takes seconds, a film can take an hour,
// and a card showing nothing waits on the view.
async function claim(env, d) {
  let job = null;
  for (const q of [QUEUES.view, QUEUES.copy]) {
    const rows = await d.svcRpc(env, q.claim, { p_lease_seconds: LEASE_SECONDS });
    job = Array.isArray(rows) ? rows[0] : null;
    if (job?.storage_path) break;
  }
  if (!job?.storage_path) return new Response(null, { status: 204 });
  const key = job.storage_path;
  const t = await sourceToken(env.MEDIA_BOX_SECRET, key, job.attempts);
  return json({
    key,
    kind: job.kind,
    ext: extOfKey(key),
    sizeBytes: job.size_bytes ?? null,
    attempts: job.attempts,
    source: `/api/media/copy/source?key=${encodeURIComponent(key)}&t=${t}`,
  });
}

// The job behind a key, if it is running under a live lease.
async function liveJob(env, d, key) {
  const work = workOf(key);
  if (!work) return null;
  const rows = await d.svcSelect(env, work.queue.table,
    `storage_path=eq.${encodeURIComponent(key)}&select=state,kind,attempts,lease_until`);
  const job = Array.isArray(rows) ? rows[0] : null;
  if (!job || job.state !== 'working' || !(Date.parse(job.lease_until) > d.now())) return null;
  return job;
}

// "bytes=a-b" | "bytes=a-" | "bytes=-n" against a size → { offset, length },
// null for no range, false for one that can't be satisfied.
export function parseRange(header, size) {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!m || (m[1] === '' && m[2] === '')) return false;
  let start;
  let end;
  if (m[1] === '') {
    const n = Number(m[2]);
    if (!(n > 0)) return false;
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (!(start >= 0) || start > end || start >= size) return false;
  return { offset: start, length: end - start + 1 };
}

async function serveSource(url, request, env, d) {
  const key = url.searchParams.get('key') || '';
  const t = url.searchParams.get('t') || '';
  const job = await liveJob(env, d, key);
  if (!job || !t || !await sameSecret(t, await sourceToken(env.MEDIA_BOX_SECRET, key, job.attempts))) {
    return json({ error: 'not_found' }, 404);
  }
  const head = await env.IMAGES.head(key);
  if (!head) return json({ error: 'not_found' }, 404);
  const size = head.size;
  const base = { 'accept-ranges': 'bytes', 'content-type': 'application/octet-stream', 'cache-control': 'no-store' };
  const range = parseRange(request.headers.get('range'), size);
  if (range === false) {
    return new Response(null, { status: 416, headers: { ...base, 'content-range': `bytes */${size}` } });
  }
  if (request.method === 'HEAD') {
    return new Response(null, { status: 200, headers: { ...base, 'content-length': String(size) } });
  }
  if (!range) {
    const obj = await env.IMAGES.get(key);
    if (!obj) return json({ error: 'not_found' }, 404);
    return new Response(obj.body, { status: 200, headers: { ...base, 'content-length': String(size) } });
  }
  const obj = await env.IMAGES.get(key, { range });
  if (!obj) return json({ error: 'not_found' }, 404);
  return new Response(obj.body, {
    status: 206,
    headers: {
      ...base,
      'content-length': String(range.length),
      'content-range': `bytes ${range.offset}-${range.offset + range.length - 1}/${size}`,
    },
  });
}

// Where an output goes: always the original's own copy or view key, derived
// here. Only a document has a PDF.
function outputKey(key, out, kind) {
  if (isView(kind)) {
    const v = viewKeys(key);
    return out === 'view' ? v.view : out === 'view_sm' ? v.sm : out === 'pdf' && kind === 'doc' ? v.pdf : null;
  }
  if (out === 'poster') return kind === 'video' ? copyKeys(key).poster : null;
  if (out === 'copy') return copyKeyFor(key, kind);
  return null;
}

async function upload(url, request, env, d) {
  const key = url.searchParams.get('key') || '';
  const out = url.searchParams.get('out') || '';
  const step = url.searchParams.get('step') || '';
  const job = await liveJob(env, d, key);
  if (!job) return json({ error: 'not_leased' }, 409);
  const target = outputKey(key, out, job.kind);
  if (!target) return json({ error: 'bad_request' }, 400);
  const contentType = out === 'copy' ? CONTENT_TYPE[job.kind] : out === 'poster' ? CONTENT_TYPE.poster
    : out === 'pdf' ? CONTENT_TYPE.pdf : CONTENT_TYPE.view;

  if (step === 'put') {
    const len = Number(request.headers.get('content-length'));
    if (!(len > 0) || len > PUT_MAX_BYTES) return json({ error: 'too_large' }, 413);
    const obj = await env.IMAGES.put(target, request.body, { httpMetadata: { contentType } });
    return json({ ok: true, size: obj?.size ?? len });
  }
  if (step === 'create') {
    const up = await env.IMAGES.createMultipartUpload(target, { httpMetadata: { contentType } });
    return json({ uploadId: up.uploadId });
  }
  const uploadId = url.searchParams.get('uploadId') || '';
  if (!uploadId || uploadId.length > 1024) return json({ error: 'bad_request' }, 400);
  const up = env.IMAGES.resumeMultipartUpload(target, uploadId);
  if (step === 'part') {
    const n = Number(url.searchParams.get('n'));
    const len = Number(request.headers.get('content-length'));
    if (!Number.isInteger(n) || n < 1 || n > MAX_PARTS) return json({ error: 'bad_request' }, 400);
    if (!(len > 0) || len > PUT_MAX_BYTES) return json({ error: 'too_large' }, 413);
    const part = await up.uploadPart(n, request.body);
    return json({ partNumber: part.partNumber, etag: part.etag });
  }
  if (step === 'complete') {
    let body = null;
    try { body = await request.json(); } catch (_) { /* answered below */ }
    const parts = Array.isArray(body?.parts) ? body.parts
      .filter((p) => Number.isInteger(p?.partNumber) && typeof p?.etag === 'string')
      .map((p) => ({ partNumber: p.partNumber, etag: p.etag })) : [];
    if (!parts.length || parts.length > MAX_PARTS) return json({ error: 'bad_request' }, 400);
    const obj = await up.complete(parts);
    return json({ ok: true, size: obj?.size ?? null });
  }
  return json({ error: 'bad_request' }, 400);
}

async function heartbeat(request, env, d) {
  const body = await request.json().catch(() => null);
  const key = body?.key;
  const work = workOf(key);
  if (!work) return json({ error: 'bad_request' }, 400);
  const ok = await d.svcRpc(env, work.queue.heartbeat, { p_storage_path: key, p_lease_seconds: LEASE_SECONDS });
  return ok === true ? json({ ok: true }) : json({ error: 'not_leased' }, 409);
}

const int = (v, max = 1e9) => (Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= max ? Math.round(Number(v)) : null);

// What the box says it made, kept to the fields the record has and checked
// against the bucket: a 'done' without its copy in R2 is a failure.
export function cleanResult(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  let probe = r.probe && typeof r.probe === 'object' ? r.probe : null;
  if (probe && JSON.stringify(probe).length > PROBE_JSON_MAX) probe = { format: probe.format || null };
  if (probe && JSON.stringify(probe).length > PROBE_JSON_MAX) probe = null;
  const dims = (o) => (o && typeof o === 'object' && int(o.w, 20000) && int(o.h, 20000) ? { w: int(o.w, 20000), h: int(o.h, 20000) } : null);
  // A copy of sound alone has no picture, so no size: it is still a copy.
  const copy = r.copy && typeof r.copy === 'object'
    ? { ...(dims(r.copy) || { w: null, h: null }), bytes: int(r.copy.bytes, 1e15) } : null;
  const dur = Number(r.durationSec);
  return {
    probe,
    durationSec: Number.isFinite(dur) && dur >= 0 && dur < 1e7 ? Math.round(dur * 1000) / 1000 : null,
    copy,
    poster: dims(r.poster),
    error: typeof r.error === 'string' ? r.error.slice(0, 300) : null,
    reason: typeof r.reason === 'string' && /^[a-z_]{1,40}$/.test(r.reason) ? r.reason : null,
  };
}

// What the box says a view job made: the view, its small size, the
// original's size upright (the browser couldn't read it at upload), and a
// document's PDF, by its number of pages.
export function cleanViewResult(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const dims = (o) => (o && typeof o === 'object' && int(o.w, 100000) && int(o.h, 100000) ? { w: int(o.w, 100000), h: int(o.h, 100000) } : null);
  let probe = r.probe && typeof r.probe === 'object' ? r.probe : null;
  if (probe && JSON.stringify(probe).length > PROBE_JSON_MAX) probe = null;
  return {
    probe,
    view: dims(r.view),
    viewSm: dims(r.viewSm),
    original: dims(r.original),
    pdf: r.pdf && typeof r.pdf === 'object' && int(r.pdf.pages, 100000) ? { pages: int(r.pdf.pages, 100000) } : null,
    error: typeof r.error === 'string' ? r.error.slice(0, 300) : null,
    reason: typeof r.reason === 'string' && /^[a-z_]{1,40}$/.test(r.reason) ? r.reason : null,
  };
}

async function finish(request, env, d) {
  const body = await request.json().catch(() => null);
  const key = body?.key;
  let state = body?.state;
  const work = workOf(key);
  if (!work || !['done', 'skip', 'failed'].includes(state)) return json({ error: 'bad_request' }, 400);
  const job = await liveJob(env, d, key);
  if (!job) return json({ error: 'not_leased' }, 409);
  if (isView(work.kind)) {
    const result = cleanViewResult(body.result);
    if (work.kind !== 'doc') result.pdf = null;
    if (state === 'done') {
      if (!result.view || !(await env.IMAGES.head(viewKeys(key).view))) {
        state = 'failed';
        result.error = 'the view never arrived';
        result.reason = 'error';
      } else {
        if (result.viewSm && !(await env.IMAGES.head(viewKeys(key).sm))) result.viewSm = null;
        if (result.pdf && !(await env.IMAGES.head(viewKeys(key).pdf))) result.pdf = null;
      }
    }
    return json({ state: await d.svcRpc(env, work.queue.finish, { p_storage_path: key, p_state: state, p_result: result }) });
  }
  const result = cleanResult(body.result);
  if (state === 'done') {
    const made = result.copy && await env.IMAGES.head(copyKeyFor(key, job.kind));
    if (!made) {
      state = 'failed';
      result.error = 'the copy never arrived';
      result.reason = 'error';
    } else if (result.poster && !(await env.IMAGES.head(copyKeys(key).poster))) {
      result.poster = null;
    }
  }
  const out = await d.svcRpc(env, work.queue.finish, { p_storage_path: key, p_state: state, p_result: result });
  return json({ state: out });
}
