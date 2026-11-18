// The upload party's stores (lib/partyStorage.js, party/upload.ts): R2 as it
// always was, B2 beside it, the 'b2~' tag that keeps an upload in the store it
// began in, /sign-reads' recheck, and "Save a copy" inside the source's store.
//
//   node --test src/lib/partyStorage.test.mjs
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  RECHECK_MAX, b2Target, clientUploadId, findObject, partyConfigReader, r2Target, recheckKeys,
  storageOverride, targetFor, uploadTarget,
} from './partyStorage.js';

const R2ENV = { accountId: 'acct', bucket: 'soleil-boards-images', accessKeyId: 'AK', secretAccessKey: 'SK' };
const B2ENV = { B2_KEY_ID: ' kid\n', B2_APP_KEY: ' appkey\n' };
const WS = '11111111-2222-4333-8444-555555555555';
const OTHER = '99999999-2222-4333-8444-555555555555';
const R2_ONLY = { mode: 'r2', workspaces: [], fallback: false };
const CANARY = { mode: 'canary', workspaces: [WS], fallback: false };
const targets = () => ({ r2: r2Target(R2ENV), b2: b2Target(B2ENV) });

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
// Answers a HEAD by host: { r2: status, b2: status }, recording each call.
function fakeHeads(byHost) {
  const calls = [];
  globalThis.fetch = async (req) => {
    const url = new URL(req.url);
    const store = url.host.endsWith('backblazeb2.com') ? 'b2' : 'r2';
    calls.push({ store, method: req.method, path: url.pathname, auth: req.headers.get('authorization') || '' });
    const status = byHost[store] ?? 404;
    return new Response(null, { status, headers: status === 200 ? { 'content-length': '1234', 'content-type': 'video/mp4' } : {} });
  };
  return calls;
}

const party = readFileSync(new URL('../../party/upload.ts', import.meta.url), 'utf8');
const between = (from, to) => party.slice(party.indexOf(from), party.indexOf(to, party.indexOf(from)));

// ── the targets ─────────────────────────────────────────────────────────────

test('R2 is addressed exactly as the party always did; B2 path-style in its own region', async () => {
  const t = targets();
  assert.equal(t.r2.kind, 'r2');
  assert.equal(t.r2.url(`${WS}/a.png`), `https://acct.r2.cloudflarestorage.com/soleil-boards-images/${WS}/a.png`);
  assert.equal(t.b2.kind, 'b2');
  assert.equal(t.b2.bucket, 'soleil-boards-images');
  assert.equal(t.b2.url(`${WS}/a.png`), `https://s3.us-east-005.backblazeb2.com/soleil-boards-images/${WS}/a.png`);
  const r2Signed = await t.r2.aws.sign(new Request(t.r2.url('k'), { method: 'GET' }), { aws: { signQuery: true } });
  assert.match(r2Signed.url, /X-Amz-Credential=AK%2F\d{8}%2Fauto%2Fs3%2Faws4_request/);
  const b2Signed = await t.b2.aws.sign(new Request(t.b2.url('k'), { method: 'GET' }), { aws: { signQuery: true } });
  assert.match(b2Signed.url, /X-Amz-Credential=kid%2F\d{8}%2Fus-east-005%2Fs3%2Faws4_request/, 'trimmed key, the real region');
});

test('B2 is off unless both its values are set; its settings can be overridden', () => {
  assert.equal(b2Target({}), null);
  assert.equal(b2Target({ B2_KEY_ID: 'k' }), null);
  assert.equal(b2Target({ B2_KEY_ID: 'k', B2_APP_KEY: '  ' }), null);
  const t = b2Target({ ...B2ENV, B2_S3_ENDPOINT: 'https://s3.example.test/', B2_BUCKET: 'other' });
  assert.equal(t.url('a/b c.png'), 'https://s3.example.test/other/a/b%20c.png');
});

test('r2Env still requires the R2 values and never the B2 ones', () => {
  const fn = party.slice(party.indexOf('  r2Env(): R2Env | string {'));
  assert.ok(fn.length > 0, 'r2Env is there');
  for (const k of ['R2_ACCOUNT_ID', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']) {
    assert.ok(fn.includes(`missing.push("${k}")`), `${k} is required`);
  }
  assert.doesNotMatch(fn, /B2_/, 'B2 values are optional');
  assert.match(fn, /return `R2 not configured\. Missing env: \$\{missing\.join\(", "\)\}`;/);
  // B2 missing is simply no B2 target, never an error.
  assert.doesNotThrow(() => b2Target({}));
});

test('targetFor follows the switch, and falls to R2 (said once) when B2 is not configured', () => {
  const t = targets();
  assert.equal(targetFor(t, R2_ONLY, `${WS}/a.png`).kind, 'r2');
  assert.equal(targetFor(t, CANARY, `${WS}/a.png`).kind, 'b2');
  assert.equal(targetFor(t, CANARY, `${OTHER}/a.png`).kind, 'r2');
  assert.equal(targetFor(t, { mode: 'b2', workspaces: [], fallback: false }, `${OTHER}/a.png`).kind, 'b2');
  let said = 0;
  assert.equal(targetFor({ r2: t.r2, b2: null }, CANARY, `${WS}/a.png`, () => { said++; }).kind, 'r2');
  assert.equal(said, 1);
});

// ── presign PUT ─────────────────────────────────────────────────────────────

test('a B2 upload URL signs its length exactly as R2 does', async () => {
  const t = targets();
  const key = `${WS}/0f0e0d0c-0000-4000-8000-000000000001.png`;
  for (const store of [t.r2, t.b2]) {
    // The very call handlePresignPut makes.
    const r2Url = `${store.url(key)}?X-Amz-Expires=300`;
    const signed = await store.aws.sign(
      new Request(r2Url, { method: 'PUT', headers: { 'Content-Length': String(4096) } }),
      { aws: { signQuery: true, allHeaders: true } },
    );
    const u = new URL(signed.url);
    assert.match(u.searchParams.get('X-Amz-SignedHeaders'), /content-length/, `${store.kind} signs the length`);
    assert.doesNotMatch(u.searchParams.get('X-Amz-SignedHeaders'), /content-type/, `${store.kind} leaves the type free`);
    assert.equal(u.searchParams.get('X-Amz-Expires'), '300');
    assert.ok(u.pathname.endsWith(`/soleil-boards-images/${key}`));
  }
  const presign = between('async handlePresignPut', '// POST /sign-reads');
  assert.match(presign, /const r2 = await this\.storeFor\(env, key\);/, 'signed for the key\'s store');
  assert.match(presign, /const r2Url = `\$\{r2\.url\(key\)\}\?X-Amz-Expires=300`;/);
  assert.match(presign, /const signed = await r2\.aws\.sign\(\s+new Request\(r2Url, \{ method: "PUT", headers: \{ "Content-Length": String\(declared\) \} \}\),\s+\{ aws: \{ signQuery: true, allHeaders: true \} \}/);
  assert.match(presign, /if \(!\/X-Amz-SignedHeaders=\[\^&\]\*content-length\/i\.test\(signed\.url\)\)/);
  // The key is chosen (and scoped) before the store is: the store never widens it.
  assert.ok(presign.indexOf('const key =') < presign.indexOf('this.storeFor(env, key)'));
});

// ── multipart: the tag ──────────────────────────────────────────────────────

test('an upload opened on B2 carries b2~ and every later call finds B2 with the raw id', () => {
  const t = targets();
  const id = clientUploadId(t.b2, '4_z123abc_f2xyz');
  assert.equal(id, 'b2~4_z123abc_f2xyz');
  const back = uploadTarget(t, id);
  assert.equal(back.target, t.b2);
  assert.equal(back.raw, '4_z123abc_f2xyz');
  // R2's ids are untouched both ways.
  assert.equal(clientUploadId(t.r2, 'AbC~r2'), 'AbC~r2');
  const r = uploadTarget(t, 'AbC~r2');
  assert.equal(r.target, t.r2);
  assert.equal(r.raw, 'AbC~r2');
  // Tagged with no B2 here: nothing, never R2.
  assert.equal(uploadTarget({ r2: t.r2, b2: null }, id), null);
  // The tag survives the client's JSON (localStorage soleil.mpu.*) unchanged.
  assert.equal(JSON.parse(JSON.stringify({ uploadId: id })).uploadId, id);
});

test('the mpu routes use the tag: create hands it out, the rest parse it', () => {
  const create = between('async handleMpuCreate(', '// POST /mpu/sign-parts');
  assert.match(create, /const r2 = await this\.storeFor\(env, key\);/);
  assert.match(create, /await this\.abortMultipart\(r2, env, key, uploadId\);/, 'a refused intent aborts the raw id in its store');
  assert.match(create, /uploadId: clientUploadId\(r2, uploadId\)/);
  for (const [from, to] of [['async handleMpuSignParts(', '// POST /mpu/complete'],
    ['async handleMpuComplete(', '// POST /mpu/abort'], ['async handleMpuAbort(', '  r2Env(): R2Env']]) {
    const body = between(from, to);
    assert.match(body, /const at = this\.uploadStore\(env, uploadId, origin\);\s+if \(at instanceof Response\) return at;/, from);
    assert.ok(body.indexOf('isValidUploadKey(key, workspaceId)') < body.indexOf('this.uploadStore('), `${from} checks the key first`);
    assert.ok(body.indexOf('can_write_board') < body.indexOf('this.uploadStore('), `${from} checks the writer first`);
    assert.match(body, /at\.raw/, `${from} sends the store its own id`);
  }
  const complete = between('async handleMpuComplete(', '// POST /mpu/abort');
  assert.match(complete, /try \{ await r2\.aws\.fetch\(r2\.url\(key\), \{ method: "DELETE" \}\); \}/, 'cleanup in the same store');
  const helpers = between('async completeMultipart(', '// S3 AbortMultipartUpload');
  assert.match(helpers, /const head = await r2\.aws\.fetch\(r2\.url\(key\), \{ method: "HEAD" \}\);/, 'the size is read in the same store');
  assert.match(party, /uploadStore\(env: R2Env, uploadId: string, origin: string \| null\)[\s\S]{0,400}status: 500/, 'tagged with no B2: a clear 500');
});

// ── sign-reads recheck ─────────────────────────────────────────────────────

test('recheck keeps only requested keys, once each, at most 50', () => {
  const requested = Array.from({ length: 80 }, (_, i) => `${WS}/${i}.png`);
  assert.deepEqual([...recheckKeys(undefined, requested)], []);
  assert.deepEqual([...recheckKeys('x', requested)], []);
  assert.deepEqual([...recheckKeys([`${WS}/1.png`, `${WS}/1.png`, 'not/asked.png', 7, `${WS}/2.png`], requested)],
    [`${WS}/1.png`, `${WS}/2.png`]);
  assert.equal(recheckKeys([...requested, ...requested], requested).size, RECHECK_MAX);
  assert.equal(RECHECK_MAX, 50);
});

test('a rechecked key missing from its store is signed for the other store', async () => {
  const t = targets();
  const calls = fakeHeads({ b2: 404, r2: 200 });
  const found = await findObject(t, CANARY, `${WS}/a.png`);
  assert.equal(found.target, t.r2);
  assert.deepEqual(calls.map((c) => `${c.store} ${c.method}`), ['b2 HEAD', 'r2 HEAD']);
  assert.match(calls[0].auth, /Credential=kid\/\d{8}\/us-east-005\/s3\//);
  // And the other way: an R2 key found only on B2 (a rollback with fallback on).
  fakeHeads({ r2: 404, b2: 200 });
  assert.equal((await findObject(t, { mode: 'r2', workspaces: [], fallback: true }, `${OTHER}/a.png`)).target, t.b2);
});

test('found nowhere, or not falling back, the key is signed for its own store after one HEAD', async () => {
  const t = targets();
  let calls = fakeHeads({ b2: 404, r2: 404 });
  const none = await findObject(t, CANARY, `${WS}/a.png`);
  assert.equal(none.target, t.b2);
  assert.equal(none.head, null);
  assert.equal(calls.length, 2);
  // Mode 'r2': one HEAD in R2, as before the switch existed.
  calls = fakeHeads({ r2: 404, b2: 200 });
  const r2only = await findObject(t, R2_ONLY, `${WS}/a.png`);
  assert.equal(r2only.target, t.r2);
  assert.equal(r2only.head, null);
  assert.deepEqual(calls.map((c) => c.store), ['r2']);
  // A store that errors (not 404) is not second-guessed.
  calls = fakeHeads({ b2: 503, r2: 200 });
  const busy = await findObject({ r2: t.r2, b2: { ...t.b2, aws: { fetch: async () => new Response(null, { status: 503 }) } } }, CANARY, `${WS}/a.png`);
  assert.equal(busy.target.kind, 'b2');
  assert.equal(busy.head, null);
});

test('/sign-reads signs every key for its store and rechecks only the asked, allowed keys', () => {
  const sr = between('// POST /sign-reads', '// ── Multipart upload');
  assert.match(sr, /\.slice\(0, 200\)/);
  assert.match(sr, /const recheck = readsFallBack\(cfg\) \? recheckKeys\(body\.recheck, requested\) : new Set<string>\(\);/);
  const loop = sr.slice(sr.indexOf('await Promise.all(requested.map('));
  assert.ok(loop.indexOf('if (!allowedKeys.has(key)) return;') < loop.indexOf('findObject('), 'nothing is looked for before access is decided');
  assert.match(loop, /: await this\.storeFor\(env, key\);/);
  assert.match(sr, /wanted \? \{ urls: out, downloads, ttl: READ_URL_TTL_SECONDS \} : \{ urls: out, ttl: READ_URL_TTL_SECONDS \}/, 'same answer');
});

// ── Save a copy ─────────────────────────────────────────────────────────────

test('a save copies inside the store that holds the source', async () => {
  const t = targets();
  fakeHeads({ b2: 404, r2: 200 });
  const src = await findObject(t, CANARY, `${WS}/src.mov`);
  assert.equal(src.target, t.r2, 'a canary key not yet on B2 is copied in R2');
  assert.equal(src.head.headers.get('content-length'), '1234');
  const save = party.slice(party.indexOf('async handleFileSave('), party.indexOf('\n  }\n', party.indexOf('async handleFileSave(')));
  assert.match(save, /const src = await findObject\(this\.stores\(env\), cfg, srcKey, b2Missing\);\s+const r2 = src\.target as Store;/);
  assert.match(save, /this\.copyObject\(r2, env, srcKey, dstKey, plan, contentType\)/);
  assert.match(save, /this\.copyObject\(posterStore, env, posterSrc, dstPoster, pplan, "image\/jpeg"\)/, 'the poster in its own store');
  const cp = party.slice(party.indexOf('async copyObject('), party.indexOf('// POST /public-bundle'));
  assert.match(cp, /const source = `\/\$\{r2\.bucket\}\//, 'the copy source is that store\'s bucket');
  assert.match(cp, /r2\.aws\.fetch\(r2\.url\(dstKey\)/, 'and the copy lands in that store');
  assert.doesNotMatch(cp, /env\.bucket|env\.accountId/);
});

// ── every party path routes ────────────────────────────────────────────────

test('no party path reaches storage except through a store', () => {
  assert.doesNotMatch(party, /new AwsClient\(/);
  assert.doesNotMatch(party, /r2\.cloudflarestorage\.com/);
  assert.doesNotMatch(party, /mkR2Client|r2ObjectUrl/);
  for (const f of ['bridge.ts', 'board.ts', 'doc.ts', 'workspace.ts', 'universe.ts', 'together.ts', 'auth.ts', 'index.ts']) {
    const src = readFileSync(new URL(`../../party/${f}`, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /AwsClient|cloudflarestorage|R2_ACC|aws\.fetch/, `${f} touches no stored file`);
  }
  const index = readFileSync(new URL('../../party/index.ts', import.meta.url), 'utf8');
  assert.match(index, /holdUploadRequest\(request, ctx\);/, 'uploads get their request\'s waitUntil');
});

// ── the switch ─────────────────────────────────────────────────────────────

test('the party reads the switch as the service role, and an override replaces it', async () => {
  const seen = [];
  const reader = partyConfigReader({ SUPABASE_SERVICE_ROLE_KEY: 'svc' }, {
    supabaseUrl: 'https://db.test',
    fetch: async (url, init) => { seen.push({ url, init }); return Response.json([{ value: { mode: 'canary', workspaces: [WS] } }]); },
  });
  assert.deepEqual(await reader.get(), { mode: 'canary', workspaces: [WS], fallback: false });
  assert.equal(seen[0].url, 'https://db.test/rest/v1/app_config?key=eq.storage&select=value');
  assert.equal(seen[0].init.headers.apikey, 'svc');
  assert.equal(seen[0].init.headers.Authorization, 'Bearer svc');
  assert.ok(seen[0].init.signal, 'bounded in time');

  const failing = partyConfigReader({ SUPABASE_SERVICE_ROLE_KEY: 'svc' }, {
    supabaseUrl: 'https://db.test', fetch: async () => new Response('no', { status: 503 }),
  });
  assert.deepEqual(await failing.get(), { mode: 'r2', workspaces: [], fallback: false });

  const noKey = partyConfigReader({}, { supabaseUrl: 'https://db.test', fetch: async () => { throw new Error('never asked'); } });
  assert.deepEqual(await noKey.get(), { mode: 'r2', workspaces: [], fallback: false });

  assert.equal(storageOverride({}), undefined);
  const over = partyConfigReader({ STORAGE_MODE: 'canary', STORAGE_WORKSPACES: ` ${WS.toUpperCase()} ,` }, {
    supabaseUrl: 'https://db.test', fetch: async () => { throw new Error('never asked'); },
  });
  assert.deepEqual(await over.get(), { mode: 'canary', workspaces: [WS], fallback: false });
});
