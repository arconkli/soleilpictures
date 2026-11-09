// storageUploadXhr.test.mjs — the XHR upload for message attachments sends the
// request @supabase/storage-js itself sends. storage-js's real `upload` runs
// against a stubbed fetch and its request is captured; the builder is given the
// same inputs and must produce the same URL, method, headers and body fields.
// If a storage-js upgrade moves the request, this goes red: re-read
// StorageFileApi.uploadOrUpdate and mirror it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StorageClient } from '@supabase/storage-js';
import { buildStorageUpload, sendStorageUpload, retype } from './storageUploadXhr.js';
import { readFileSync } from 'node:fs';

const STORAGE_URL = 'https://proj.supabase.co/storage/v1';
const KEY = 'sb_publishable_test';
const TOKEN = 'eyJ.access.token';
const PATH = 'ws-1/user-1/3f2c9a7e-0000-4000-8000-000000000001.png';

// What storage-js sends, captured: the client is given the headers supabase-js's
// fetch would end up with (its own + apikey + Authorization).
async function captured(file, { upsert = false, contentType = 'image/png' } = {}) {
  const calls = [];
  const fetchStub = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ Id: 'obj-id-1', Key: `message-attachments/${PATH}` }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const client = new StorageClient(STORAGE_URL, { 'X-Client-Info': 'supabase-js-web/test', apikey: KEY, Authorization: `Bearer ${TOKEN}` }, fetchStub);
  const out = await client.from('message-attachments').upload(PATH, file, { contentType, upsert });
  assert.equal(calls.length, 1);
  return { call: calls[0], out };
}

const lower = (h) => Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toLowerCase(), String(v)]));
const formEntries = (form) => [...form.entries()];

test('the XHR builder makes the request storage-js makes', async () => {
  const file = new File([new Uint8Array([1, 2, 3, 4])], 'shot.png', { type: 'image/png' });
  const { call, out } = await captured(file);
  const req = buildStorageUpload({
    storageUrl: STORAGE_URL, bucket: 'message-attachments', path: PATH, file,
    headers: { 'X-Client-Info': 'supabase-js-web/test' }, apikey: KEY, token: TOKEN,
  });
  assert.equal(req.url, call.url);
  assert.equal(req.method, call.init.method);
  assert.deepEqual(req.headers, lower(call.init.headers));
  // The body: FormData, cacheControl first, then the file under the empty name.
  assert.ok(call.init.body instanceof FormData);
  const real = formEntries(call.init.body);
  assert.deepEqual(req.fields.map(([k]) => k), real.map(([k]) => k));
  assert.equal(req.fields[0][1], real[0][1]);
  assert.equal(req.fields[1][1], file);
  assert.equal(real[1][1].name, file.name);
  assert.equal(real[1][1].type, file.type);
  assert.equal(real[1][1].size, file.size);
  // No content-type header on a form body, from either side.
  assert.equal('content-type' in req.headers, false);
  // And the answer's shape: what storage-js returns for it.
  assert.deepEqual(out.data, { path: PATH, id: 'obj-id-1', fullPath: `message-attachments/${PATH}` });
});

test('upsert and a path with stray slashes come out the same as storage-js\'s', async () => {
  const file = new File(['x'], 'a.pdf', { type: 'application/pdf' });
  const messy = `/${PATH.replace('/', '//')}`;
  const calls = [];
  const client = new StorageClient(STORAGE_URL, { 'X-Client-Info': 'supabase-js-web/test', apikey: KEY, Authorization: `Bearer ${TOKEN}` }, async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response('{}', { status: 200 });
  });
  await client.from('message-attachments').upload(messy, file, { upsert: true });
  const req = buildStorageUpload({ storageUrl: STORAGE_URL, bucket: 'message-attachments', path: messy, file, headers: { 'X-Client-Info': 'supabase-js-web/test' }, apikey: KEY, token: TOKEN, upsert: true });
  assert.equal(req.url, calls[0].url);
  assert.equal(req.headers['x-upsert'], 'true');
  assert.deepEqual(req.headers, lower(calls[0].init.headers));
  assert.equal(req.cleanPath, PATH);
});

test('a signed-out request falls back to the anon key as the bearer, as supabase-js does', () => {
  const req = buildStorageUpload({ storageUrl: STORAGE_URL, bucket: 'b', path: 'a/b.png', file: new Blob(['x']), apikey: KEY, token: null });
  assert.equal(req.headers.authorization, `Bearer ${KEY}`);
  assert.equal(req.headers.apikey, KEY);
});

// A stand-in XMLHttpRequest: records what is set and sent, then answers.
function fakeXhr(answer) {
  return class FakeXhr {
    constructor() { this.headers = {}; this.upload = {}; FakeXhr.last = this; }
    open(method, url) { this.method = method; this.url = url; }
    setRequestHeader(k, v) { this.headers[k] = v; }
    send(body) { this.body = body; queueMicrotask(() => answer(this)); }
  };
}

test('sendStorageUpload sends that request by XHR, reports real progress, and answers in storage-js\'s shape', async () => {
  const file = new File(['hello'], 'a.txt', { type: 'text/plain' });
  const req = buildStorageUpload({ storageUrl: STORAGE_URL, bucket: 'message-attachments', path: 'w/u/a.txt', file, apikey: KEY, token: TOKEN });
  const seen = [];
  const XHR = fakeXhr((x) => {
    x.upload.onprogress({ lengthComputable: true, loaded: 25, total: 100 });
    x.upload.onprogress({ lengthComputable: false, loaded: 1, total: 0 });
    x.upload.onprogress({ lengthComputable: true, loaded: 100, total: 100 });
    x.status = 200; x.responseText = JSON.stringify({ Id: 'i1', Key: 'message-attachments/w/u/a.txt' });
    x.onload();
  });
  const res = await sendStorageUpload(req, { onProgress: (f) => seen.push(f), XHR });
  const x = XHR.last;
  assert.equal(x.method, 'POST');
  assert.equal(x.url, req.url);
  assert.deepEqual(x.headers, req.headers);
  assert.deepEqual(formEntries(x.body).map(([k]) => k), ['cacheControl', '']);
  assert.deepEqual(seen, [0.25, 1]);
  assert.deepEqual(res, { data: { path: 'w/u/a.txt', id: 'i1', fullPath: 'message-attachments/w/u/a.txt' }, error: null });
});

test('sendStorageUpload: a refusal and a dropped connection are errors, not throws', async () => {
  const req = buildStorageUpload({ storageUrl: STORAGE_URL, bucket: 'b', path: 'a/b.png', file: new Blob(['x']), apikey: KEY, token: TOKEN });
  const refused = await sendStorageUpload(req, { XHR: fakeXhr((x) => { x.status = 403; x.responseText = JSON.stringify({ message: 'new row violates row-level security policy' }); x.onload(); }) });
  assert.equal(refused.data, null);
  assert.equal(refused.error.status, 403);
  assert.match(refused.error.message, /row-level security/);
  const dropped = await sendStorageUpload(req, { XHR: fakeXhr((x) => x.onerror()) });
  assert.equal(dropped.data, null);
  assert.equal(dropped.error.message, 'Network error');
  const none = await sendStorageUpload(req, { XHR: null });
  assert.equal(none.data, null);
});

test('retype: a File that declares the new type, same name and bytes; same type is returned as is', async () => {
  const html = new File(['<p>x</p>'], 'a.html', { type: 'text/html' });
  const out = retype(html, 'application/octet-stream');
  assert.equal(out.type, 'application/octet-stream');
  assert.equal(out.name, 'a.html');
  assert.equal(out.size, html.size);
  assert.equal(await out.text(), '<p>x</p>');
  assert.equal(retype(html, 'text/html'), html);
  assert.equal(retype(html, ''), html);
  assert.equal(retype(null, 'x/y'), null);
});

test('a retyped file goes through storage-js and the builder with the served type on the file part', async () => {
  const html = new File(['<p>x</p>'], 'a.html', { type: 'text/html' });
  const body = retype(html, 'application/octet-stream');
  const { call } = await captured(body, { contentType: 'application/octet-stream' });
  const real = call.init.body.get('');
  assert.equal(real.type, 'application/octet-stream');
  // storage-js ignores contentType for a File: the original would have gone as text/html.
  const plain = await captured(html, { contentType: 'application/octet-stream' });
  assert.equal(plain.call.init.body.get('').type, 'text/html');
  const req = buildStorageUpload({
    storageUrl: STORAGE_URL, bucket: 'message-attachments', path: PATH, file: body,
    headers: { 'X-Client-Info': 'supabase-js-web/test' }, apikey: KEY, token: TOKEN,
  });
  assert.equal(req.fields[1][1].type, real.type);
  assert.equal(req.fields[1][1].name, real.name);
});

test('uploadMessageFile uploads the file retyped to the served type', () => {
  const src = readFileSync(new URL('./messageAttachments.js', import.meta.url), 'utf8');
  assert.match(src, /putMessageFile\(path, retype\(file, served\), served, onProgress\)/);
});
