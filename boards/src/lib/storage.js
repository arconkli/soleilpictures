// One storage layer for Backblaze B2 (S3 API) and Cloudflare R2, plus the
// switch that picks the store per key. Plain ESM: runs in the Worker, the
// party (workerd) and Node 20+.
//
// `s3Bucket` gives B2 the shape of the R2 binding (get/head/put/delete and
// multipart) so code written for `env.IMAGES` runs on either. `routedBucket`
// puts the two behind one binding and follows the `app_config` row 'storage':
//   {"mode":"r2"|"canary"|"b2","workspaces":[uuid…],"fallback":bool}
// While the mode is 'r2' (also when the row is missing or unreadable) the
// router hands every call straight to R2 and changes nothing.

import { AwsClient } from 'aws4fetch';

export const B2 = Object.freeze({
  endpoint: 'https://s3.us-east-005.backblazeb2.com',
  region: 'us-east-005',
  bucket: 'soleil-boards-images',
  host: 's3.us-east-005.backblazeb2.com',
});
// Prefix on an uploadId that lives on B2, so later calls find their store.
export const B2_UPLOAD_TAG = 'b2~';

const MODES = ['r2', 'canary', 'b2'];
const MAX_WORKSPACES = 200;
const defaultConfig = () => ({ mode: 'r2', workspaces: [], fallback: false });

export function parseStorageConfig(value) {
  let v = value;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch (_) { return defaultConfig(); }
  }
  if (!v || typeof v !== 'object' || Array.isArray(v) || !MODES.includes(v.mode)) return defaultConfig();
  const seen = new Set();
  if (Array.isArray(v.workspaces)) {
    for (const w of v.workspaces) {
      if (typeof w !== 'string') continue;
      const s = w.trim().toLowerCase();
      if (s) seen.add(s);
      if (seen.size >= MAX_WORKSPACES) break;
    }
  }
  return { mode: v.mode, workspaces: [...seen], fallback: v.fallback === true };
}

export function backendForKey(key, cfg) {
  if (!cfg) return 'r2';
  if (cfg.mode === 'b2') return 'b2';
  if (cfg.mode === 'canary') {
    const first = String(key).split('/')[0].toLowerCase();
    return (cfg.workspaces || []).includes(first) ? 'b2' : 'r2';
  }
  return 'r2';
}

export function readsFallBack(cfg) {
  return Boolean(cfg) && (cfg.mode !== 'r2' || cfg.fallback === true);
}

export function makeConfigReader({
  load, ttlMs = 30000, failTtlMs = 5000, waitMs = 2000, deadMs = 5000, now = () => Date.now(), override,
  timer = { set: (fn, ms) => setTimeout(fn, ms), clear: (id) => clearTimeout(id) },
} = {}) {
  if (override !== undefined && override !== null) {
    const fixed = parseStorageConfig(override);
    return { get: async () => fixed, peek: () => fixed };
  }
  let cfg = null;
  let at = 0;
  let failAt = null;
  let inflight = null;
  let startedAt = 0;
  let gen = 0;
  // A refresh whose request was cancelled can never settle (workerd), so one
  // older than deadMs no longer counts and the next caller starts another.
  const inflightAlive = () => inflight !== null && now() - startedAt < deadMs;
  const refresh = () => {
    if (inflightAlive()) return inflight;
    const mine = ++gen;
    startedAt = now();
    // Only the latest refresh may write state; an abandoned one settling late changes nothing.
    const p = (async () => {
      await null; // inflight is set before load() can throw or finish
      try {
        const v = parseStorageConfig(await load());
        if (mine === gen) { cfg = v; at = now(); failAt = null; }
      } catch (_) {
        if (mine === gen) failAt = now();
      } finally {
        if (mine === gen) inflight = null;
      }
      return cfg || defaultConfig();
    })();
    inflight = p;
    return p;
  };
  const failedRecently = () => failAt !== null && now() - failAt < failTtlMs;
  // A caller with nothing to fall back on never waits longer than waitMs.
  const bounded = (p) => new Promise((resolve) => {
    const dflt = () => resolve(cfg || defaultConfig());
    const id = timer.set(dflt, waitMs);
    p.then((v) => { timer.clear(id); resolve(v); }, () => { timer.clear(id); dflt(); });
  });
  return {
    async get(waitUntil) {
      const hand = (p) => { if (typeof waitUntil === 'function') waitUntil(p); return p; };
      if (cfg && now() - at < ttlMs) return cfg;
      if (cfg) {
        if (!inflightAlive() && !failedRecently()) hand(refresh());
        return cfg;
      }
      if (inflightAlive()) return bounded(inflight);
      if (failedRecently()) return defaultConfig();
      return bounded(hand(refresh()));
    },
    peek: () => cfg,
  };
}

// ── s3Bucket ───────────────────────────────────────────────────────────────

const encoder = new TextEncoder();
// Same per-segment encoding as party/upload.ts uses for copy sources.
const encodeKey = (key) => String(key).split('/').map(encodeURIComponent).join('/');
const xmlEscape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const xmlCode = (text) => text.match(/<Code>([^<]*)<\/Code>/)?.[1] || '';
const unquote = (etag) => String(etag || '').replace(/^W\//, '').replace(/^"+|"+$/g, '');
const isStream = (v) => typeof ReadableStream !== 'undefined' && v instanceof ReadableStream;
const isHeaders = (v) => typeof Headers !== 'undefined' && v instanceof Headers;
const keyed = (err, key) => { err.key = key; return err; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const HTTP_META = [
  ['contentType', 'content-type'], ['contentLanguage', 'content-language'],
  ['contentDisposition', 'content-disposition'], ['contentEncoding', 'content-encoding'],
  ['cacheControl', 'cache-control'],
];

function httpMetaHeaders(meta, headers) {
  if (!meta) return;
  if (isHeaders(meta)) {
    for (const [, h] of HTTP_META) if (meta.has(h)) headers.set(h, meta.get(h));
    if (meta.has('expires')) headers.set('expires', meta.get('expires'));
    return;
  }
  for (const [prop, h] of HTTP_META) if (meta[prop]) headers.set(h, String(meta[prop]));
  if (meta.cacheExpiry) {
    headers.set('expires', meta.cacheExpiry instanceof Date ? meta.cacheExpiry.toUTCString() : String(meta.cacheExpiry));
  }
}

function customMetaHeaders(meta, headers) {
  if (!meta) return;
  for (const [k, v] of Object.entries(meta)) headers.set(`x-amz-meta-${String(k).toLowerCase()}`, String(v));
}

function parseContentRange(value) {
  const m = /^bytes (\d+)-(\d+)\/(\d+|\*)$/i.exec(value || '');
  return m ? { start: Number(m[1]), end: Number(m[2]), total: m[3] === '*' ? null : Number(m[3]) } : null;
}

function rangeHeader(range) {
  if (!range) return null;
  if (isHeaders(range)) return range.get('range');
  if (range.suffix != null) return `bytes=-${range.suffix}`;
  const offset = range.offset ?? 0;
  return range.length != null ? `bytes=${offset}-${offset + range.length - 1}` : `bytes=${offset}-`;
}

function onlyIfHeaders(onlyIf, headers) {
  if (!onlyIf) return;
  if (isHeaders(onlyIf)) {
    for (const h of ['if-match', 'if-none-match', 'if-modified-since', 'if-unmodified-since']) {
      if (onlyIf.has(h)) headers.set(h, onlyIf.get(h));
    }
    return;
  }
  const q = (e) => `"${unquote(e)}"`;
  if (onlyIf.etagMatches) headers.set('if-match', q(onlyIf.etagMatches));
  if (onlyIf.etagDoesNotMatch) headers.set('if-none-match', q(onlyIf.etagDoesNotMatch));
  if (onlyIf.uploadedBefore) headers.set('if-unmodified-since', new Date(onlyIf.uploadedBefore).toUTCString());
  if (onlyIf.uploadedAfter) headers.set('if-modified-since', new Date(onlyIf.uploadedAfter).toUTCString());
}

function toBytesBody(value) {
  if (value === null || value === undefined) return { body: undefined, size: 0, replay: true };
  if (typeof value === 'string') { const b = encoder.encode(value); return { body: b, size: b.byteLength, replay: true }; }
  if (value instanceof ArrayBuffer) return { body: value, size: value.byteLength, replay: true };
  if (ArrayBuffer.isView(value)) return { body: value, size: value.byteLength, replay: true };
  if (typeof Blob !== 'undefined' && value instanceof Blob) return { body: value, size: value.size, replay: true };
  if (isStream(value)) return { body: value, size: undefined, replay: false };
  throw new TypeError('unsupported body type');
}

export function s3Bucket({
  endpoint, region, bucket, accessKeyId, secretAccessKey,
  fetch: fetchFn = globalThis.fetch, md5, retries = 3, label = 'B2',
}) {
  const client = new AwsClient({ accessKeyId, secretAccessKey, service: 's3', region, retries: 0 });
  const base = String(endpoint).replace(/\/+$/, '');
  const objectUrl = (key) => `${base}/${bucket}/${encodeKey(key)}`;

  // One signed request, retried on network errors, 500, 503 and 429 when the
  // body can be replayed. Every attempt is signed afresh.
  async function send(method, url, { headers, body, replay = true } = {}) {
    const attempts = replay ? retries + 1 : 1;
    let lastErr = null;
    for (let i = 0; i < attempts; i++) {
      try {
        const init = { method, headers: new Headers(headers || {}) };
        if (body !== undefined) init.body = body;
        const signed = await client.sign(url, init);
        const res = await fetchFn(signed);
        if ((res.status === 500 || res.status === 503 || res.status === 429) && i < attempts - 1) {
          await res.arrayBuffer().catch(() => null);
        } else {
          return res;
        }
      } catch (e) {
        if (i >= attempts - 1) throw e;
        lastErr = e;
      }
      await sleep(100 * 2 ** i * (0.5 + Math.random() / 2));
    }
    throw lastErr || new Error(`${label} ${method} retries exhausted`);
  }

  async function fail(method, key, res) {
    const text = await res.text().catch(() => '');
    const code = xmlCode(text);
    // The key rides on err.key, never in the message: callers match messages for '404'.
    const err = new Error(`${label} ${method} ${res.status} ${code}`.trim());
    err.key = key;
    err.status = res.status;
    err.code = code;
    return err;
  }

  function toObject(key, res, { withBody, askedRange }) {
    const h = res.headers;
    const cr = parseContentRange(h.get('content-range'));
    const cl = h.get('content-length');
    const etag = unquote(h.get('etag'));
    const lm = h.get('last-modified');
    const httpMetadata = {};
    const ct = h.get('content-type');
    if (ct) httpMetadata.contentType = ct;
    for (const [prop, name] of HTTP_META.slice(1)) if (h.get(name)) httpMetadata[prop] = h.get(name);
    if (h.get('expires')) {
      const d = new Date(h.get('expires'));
      if (!Number.isNaN(d.getTime())) httpMetadata.cacheExpiry = d;
    }
    const customMetadata = {};
    for (const [k, v] of h.entries()) if (k.startsWith('x-amz-meta-')) customMetadata[k.slice(11)] = v;
    const obj = {
      key,
      version: h.get('x-amz-version-id') || '',
      size: cr?.total ?? (cl != null ? Number(cl) : 0),
      etag,
      httpEtag: `"${etag}"`,
      checksums: {},
      uploaded: lm ? new Date(lm) : new Date(0),
      httpMetadata,
      customMetadata,
      storageClass: 'Standard',
      writeHttpMetadata(headers) {
        const set = (n, v) => { if (v) headers.set(n, v); };
        set('content-type', httpMetadata.contentType);
        set('content-language', httpMetadata.contentLanguage);
        set('content-disposition', httpMetadata.contentDisposition);
        set('content-encoding', httpMetadata.contentEncoding);
        set('cache-control', httpMetadata.cacheControl);
        if (httpMetadata.cacheExpiry) headers.set('expires', httpMetadata.cacheExpiry.toUTCString());
      },
    };
    if (askedRange && cr) obj.range = { offset: cr.start, length: cr.end - cr.start + 1 };
    if (withBody) {
      obj.body = res.body;
      Object.defineProperty(obj, 'bodyUsed', { get: () => res.bodyUsed, enumerable: true });
      obj.arrayBuffer = () => res.arrayBuffer();
      obj.text = () => res.text();
      obj.json = () => res.json();
      obj.blob = () => res.blob();
    }
    return obj;
  }

  async function get(key, options = {}) {
    const headers = new Headers();
    const range = rangeHeader(options.range);
    if (range) headers.set('range', range);
    onlyIfHeaders(options.onlyIf, headers);
    const res = await send('GET', objectUrl(key), { headers });
    if (res.status === 404) { await res.arrayBuffer().catch(() => null); return null; }
    if (res.status === 200 || res.status === 206) return toObject(key, res, { withBody: true, askedRange: Boolean(range) });
    if (res.status === 304 || res.status === 412) {
      await res.arrayBuffer().catch(() => null);
      return toObject(key, res, { withBody: false, askedRange: false });
    }
    // 416 lands here too: worker-keep.js maps any throw from get to 416, as it does for R2.
    throw await fail('GET', key, res);
  }

  async function head(key) {
    const res = await send('HEAD', objectUrl(key));
    if (res.status === 404) return null;
    if (!res.ok) throw await fail('HEAD', key, res);
    return toObject(key, res, { withBody: false, askedRange: false });
  }

  async function put(key, value, options = {}) {
    const { body, size, replay } = toBytesBody(value);
    const headers = new Headers();
    httpMetaHeaders(options.httpMetadata, headers);
    customMetaHeaders(options.customMetadata, headers);
    onlyIfHeaders(options.onlyIf, headers);
    const res = await send('PUT', objectUrl(key), { headers, body, replay });
    if (res.status === 412 && options.onlyIf) { await res.arrayBuffer().catch(() => null); return null; }
    if (!res.ok) throw await fail('PUT', key, res);
    await res.arrayBuffer().catch(() => null);
    const etag = unquote(res.headers.get('etag'));
    const httpMetadata = {};
    const hh = new Headers();
    httpMetaHeaders(options.httpMetadata, hh);
    for (const [prop, name] of HTTP_META) if (hh.get(name)) httpMetadata[prop] = hh.get(name);
    const obj = {
      key,
      version: res.headers.get('x-amz-version-id') || '',
      etag,
      httpEtag: `"${etag}"`,
      checksums: {},
      uploaded: new Date(),
      httpMetadata,
      customMetadata: Object.fromEntries(Object.entries(options.customMetadata || {})
        .map(([k, v]) => [String(k).toLowerCase(), String(v)])),
      storageClass: 'Standard',
      writeHttpMetadata(headers2) { for (const [prop, name] of HTTP_META) if (httpMetadata[prop]) headers2.set(name, httpMetadata[prop]); },
    };
    if (size !== undefined) obj.size = size;
    return obj;
  }

  async function md5Base64(bytes) {
    if (md5) return md5(bytes);
    const digest = new Uint8Array(await crypto.subtle.digest('MD5', bytes));
    let bin = '';
    for (const b of digest) bin += String.fromCharCode(b);
    return btoa(bin);
  }

  async function del(keys) {
    if (typeof keys === 'string') {
      const res = await send('DELETE', objectUrl(keys));
      if (res.ok || res.status === 404) { await res.arrayBuffer().catch(() => null); return; }
      throw await fail('DELETE', keys, res);
    }
    const list = [...keys];
    for (let i = 0; i < list.length; i += 1000) {
      const chunk = list.slice(i, i + 1000);
      const xml = `<Delete><Quiet>true</Quiet>${chunk.map((k) => `<Object><Key>${xmlEscape(k)}</Key></Object>`).join('')}</Delete>`;
      const bytes = encoder.encode(xml);
      const res = await send('POST', `${base}/${bucket}?delete`, {
        headers: { 'content-type': 'application/xml', 'content-md5': await md5Base64(bytes) }, body: bytes,
      });
      if (!res.ok) throw await fail('POST', '?delete', res);
      const text = await res.text();
      const err = text.match(/<Error>([\s\S]*?)<\/Error>/)?.[1];
      if (err) {
        const k = err.match(/<Key>([^<]*)<\/Key>/)?.[1] || '';
        throw keyed(new Error(`${label} DELETE ${xmlCode(err) || 'Error'}`), k);
      }
    }
  }

  function multipart(key, uploadId) {
    const q = `uploadId=${encodeURIComponent(uploadId)}`;
    return {
      key,
      uploadId,
      async uploadPart(partNumber, value) {
        const { body, replay } = toBytesBody(value);
        const res = await send('PUT', `${objectUrl(key)}?partNumber=${Number(partNumber)}&${q}`, { body, replay });
        if (!res.ok) throw await fail('PUT', key, res);
        await res.arrayBuffer().catch(() => null);
        return { partNumber, etag: unquote(res.headers.get('etag')) };
      },
      async abort() {
        const res = await send('DELETE', `${objectUrl(key)}?${q}`);
        if (res.ok || res.status === 404) { await res.arrayBuffer().catch(() => null); return; }
        throw await fail('DELETE', key, res);
      },
      async complete(parts) {
        const sorted = [...parts].sort((a, b) => a.partNumber - b.partNumber);
        const xml = `<CompleteMultipartUpload>${sorted.map((p) => (
          `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>"${unquote(p.etag)}"</ETag></Part>`)).join('')}</CompleteMultipartUpload>`;
        const res = await send('POST', `${objectUrl(key)}?${q}`, {
          headers: { 'content-type': 'application/xml' }, body: encoder.encode(xml),
        });
        if (!res.ok) throw await fail('POST', key, res);
        const text = await res.text();
        if (/<Error>/.test(text)) throw keyed(new Error(`${label} POST 200 ${xmlCode(text) || 'Error'}`), key);
        const done = await head(key);
        if (!done) throw keyed(new Error(`${label} HEAD missing after complete`), key);
        return done;
      },
    };
  }

  async function createMultipartUpload(key, options = {}) {
    const headers = new Headers();
    httpMetaHeaders(options.httpMetadata, headers);
    customMetaHeaders(options.customMetadata, headers);
    const res = await send('POST', `${objectUrl(key)}?uploads`, { headers });
    if (!res.ok) throw await fail('POST', key, res);
    const text = await res.text();
    const uploadId = text.match(/<UploadId>([^<]+)<\/UploadId>/)?.[1];
    if (!uploadId) throw keyed(new Error(`${label} POST ${res.status} no UploadId`), key);
    return multipart(key, uploadId);
  }

  return {
    get,
    head,
    put,
    delete: del,
    createMultipartUpload,
    resumeMultipartUpload: (key, uploadId) => multipart(key, uploadId),
    list() { throw new Error('list is not supported on B2 here'); },
  };
}

// ── routedBucket ───────────────────────────────────────────────────────────

export function routedBucket({ r2, b2, getConfig, report }) {
  if (!b2) return r2;
  const note = (event, detail) => { try { report?.(event, detail); } catch (_) { /* reporting never breaks a call */ } };
  const store = (name) => (name === 'b2' ? b2 : r2);
  const other = (name) => (name === 'b2' ? 'r2' : 'b2');
  const msg = (e) => String(e?.message || e);

  async function read(method, key, args) {
    const cfg = await getConfig();
    if (!readsFallBack(cfg)) return r2[method](key, ...args);
    const first = backendForKey(key, cfg);
    const second = other(first);
    let res;
    try {
      res = await store(first)[method](key, ...args);
    } catch (e) {
      let alt = null;
      try { alt = await store(second)[method](key, ...args); } catch (_) { /* rethrow the primary below */ }
      if (alt) { note('read_fallback_after_error', { method, key, from: first, error: msg(e) }); return alt; }
      throw e;
    }
    if (res !== null && res !== undefined) return res;
    try {
      const alt = await store(second)[method](key, ...args);
      if (alt) note('read_fallback', { method, key, from: first, to: second });
      return alt ?? null;
    } catch (e) {
      note('read_fallback_error', { method, key, store: second, error: msg(e) });
      return null;
    }
  }

  const tagged = (up) => ({
    key: up.key,
    uploadId: B2_UPLOAD_TAG + up.uploadId,
    uploadPart: (n, v) => up.uploadPart(n, v),
    abort: () => up.abort(),
    complete: (parts) => up.complete(parts),
  });

  return {
    get: (key, opts) => read('get', key, opts === undefined ? [] : [opts]),
    head: (key) => read('head', key, []),
    async put(key, value, opts) {
      const cfg = await getConfig();
      const target = readsFallBack(cfg) ? store(backendForKey(key, cfg)) : r2;
      return opts === undefined ? target.put(key, value) : target.put(key, value, opts);
    },
    async delete(keyOrKeys) {
      const cfg = await getConfig();
      if (!readsFallBack(cfg)) return r2.delete(keyOrKeys);
      const keys = Array.isArray(keyOrKeys) ? keyOrKeys : [keyOrKeys];
      const primary = { r2: false, b2: false };
      for (const k of keys) primary[backendForKey(k, cfg)] = true;
      const run = async (name) => {
        try { await store(name).delete(keyOrKeys); } catch (e) {
          if (!primary[name]) note('delete_secondary_error', { store: name, error: msg(e) });
          throw e;
        }
      };
      // Both stores are tried; a failure in either rejects so a sweep keeps its row
      // open (a surviving copy would be orphaned or copied back). The primary's error wins.
      const names = ['r2', 'b2'];
      const results = await Promise.allSettled(names.map(run));
      const bad = results.map((r, i) => ({ r, name: names[i] })).filter((x) => x.r.status === 'rejected');
      if (bad.length) throw (bad.find((x) => primary[x.name]) || bad[0]).r.reason;
    },
    async createMultipartUpload(key, opts) {
      const cfg = await getConfig();
      const args = opts === undefined ? [] : [opts];
      if (readsFallBack(cfg) && backendForKey(key, cfg) === 'b2') return tagged(await b2.createMultipartUpload(key, ...args));
      return r2.createMultipartUpload(key, ...args);
    },
    resumeMultipartUpload(key, uploadId) {
      if (typeof uploadId === 'string' && uploadId.startsWith(B2_UPLOAD_TAG)) {
        return tagged(b2.resumeMultipartUpload(key, uploadId.slice(B2_UPLOAD_TAG.length)));
      }
      return r2.resumeMultipartUpload(key, uploadId);
    },
    list: (...args) => r2.list(...args),
  };
}
