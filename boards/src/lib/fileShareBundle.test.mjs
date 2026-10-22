import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FILE_SHARE_URL_TTL_SECONDS, FILE_SHARE_CACHE_CONTROL, FILE_TOKEN_RE, downloadName, fileShareResponse,
} from './fileShareBundle.js';

const sign = async (key, disp) => `https://r2.test/${key}${disp ? `?d=${disp}` : ''}`;
const disp = (name) => `attachment; filename="${name}"`;
const ok = (over = {}) => ({
  status: 'ok', access: 'view', allow_download: true,
  file: { kind: 'video', name: 'Cut v3', ext: 'mov', risky: false },
  keys: { src: 'ws/a.mov', poster: 'ws/a.webp' },
  shared_by: { name: 'Sam' },
  ...over,
});

test('constants', () => {
  assert.equal(FILE_SHARE_URL_TTL_SECONDS, 21600);
  assert.equal(FILE_SHARE_CACHE_CONTROL, 'private, max-age=21600');
  assert.ok(FILE_TOKEN_RE.test('00000000-0000-4000-8000-000000000000'));
  assert.ok(!FILE_TOKEN_RE.test('nope'));
});

test('ok video: src, poster and download signed; keys never leave', async () => {
  const out = await fileShareResponse(ok(), sign, disp);
  assert.equal(out.status, 'ok');
  assert.equal(out.urls.src, 'https://r2.test/ws/a.mov');
  assert.equal(out.urls.poster, 'https://r2.test/ws/a.webp');
  assert.equal(out.urls.download, 'https://r2.test/ws/a.mov?d=attachment; filename="Cut v3.mov"');
  assert.equal(out.ttl, FILE_SHARE_URL_TTL_SECONDS);
  assert.equal('keys' in out, false);
  assert.equal(out.shared_by.name, 'Sam');
});

test('risky file: no inline src, download only when allowed', async () => {
  const risky = { kind: 'file', name: 'setup.exe', ext: 'exe', risky: true };
  const a = await fileShareResponse(ok({ file: risky, keys: { src: 'ws/s.exe' } }), sign, disp);
  assert.equal(a.urls.src, undefined);
  assert.ok(a.urls.download);
  const b = await fileShareResponse(ok({ file: risky, keys: { src: 'ws/s.exe' }, allow_download: false }), sign, disp);
  assert.deepEqual(b.urls, {});
});

test('a plain file kind gets no inline src either', async () => {
  const out = await fileShareResponse(ok({ file: { kind: 'file', name: 'a.zip', ext: 'zip', risky: false }, keys: { src: 'k' } }), sign, disp);
  assert.equal(out.urls.src, undefined);
  assert.ok(out.urls.download);
});

test('allow_download false: no download url', async () => {
  const out = await fileShareResponse(ok({ allow_download: false }), sign, disp);
  assert.equal(out.urls.download, undefined);
  assert.ok(out.urls.src);
});

test('sign_in and no_access pass through; email only for no_access', async () => {
  assert.deepEqual(await fileShareResponse({ status: 'sign_in', email: 'x@y.co' }, sign, disp), { status: 'sign_in' });
  assert.deepEqual(await fileShareResponse({ status: 'no_access', email: 'x@y.co' }, sign, disp), { status: 'no_access', email: 'x@y.co' });
});

test('garbage and unknown statuses become gone', async () => {
  for (const g of [null, undefined, 'x', 7, {}, { status: 'weird' }, { status: 'gone' }, { status: 'ok' }]) {
    assert.deepEqual(await fileShareResponse(g, sign, disp), { status: 'gone' });
  }
});

test('a sign that throws drops only that url', async () => {
  const flaky = async (key, d) => { if (key.endsWith('.webp')) throw new Error('boom'); return sign(key, d); };
  const out = await fileShareResponse(ok(), flaky, disp);
  assert.equal(out.status, 'ok');
  assert.equal(out.urls.poster, undefined);
  assert.ok(out.urls.src && out.urls.download);
});

test('downloadName', () => {
  assert.equal(downloadName({ name: 'Cut', ext: 'mov' }), 'Cut.mov');
  assert.equal(downloadName({ name: 'a.pdf', ext: 'pdf' }), 'a.pdf');
  assert.equal(downloadName({ name: 'Cut', ext: null }), 'Cut');
});
