// A shared doc's images (lib/docShareImages.js, party/upload.ts
// POST /share/doc-images): each gate, the reader's resolver, and the route's
// order pinned by source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DOC_IMAGE_KEYS_MAX, DOC_IMAGE_URL_TTL_SECONDS, DOC_IMAGE_CACHE_CONTROL,
  rasterTypeOf, parseDocImageRequest, roomOfAnswer, candidateKeys, alignedUrls, createDocImageResolver,
} from './docShareImages.js';
import { FILE_TOKEN_RE } from './fileShareBundle.js';

const WS = '7dc63db0-7313-43bc-b136-72bacd86344c';
const OTHER = '11111111-2222-4333-8444-555555555555';
const TOKEN = 'e1bdd355-ab8c-4c80-b5f0-7f9a0310dffa';
const SHARE = 'bf59559b-bace-49f5-971c-93cbc348deb9';
const key = (name, ws = WS) => `${ws}/${name}`;

test('only raster names under a workspace are signable, as the type their name says', () => {
  assert.equal(rasterTypeOf(key('a1.png')), 'image/png');
  assert.equal(rasterTypeOf(key('a1.JPG')), 'image/jpeg');
  assert.equal(rasterTypeOf(key('a1.jpeg')), 'image/jpeg');
  assert.equal(rasterTypeOf(key('a1.webp')), 'image/webp');
  assert.equal(rasterTypeOf(key('a1.gif')), 'image/gif');
  assert.equal(rasterTypeOf(key('a1.avif')), 'image/avif');
  for (const bad of ['a1.svg', 'a1.html', 'a1.pdf', 'a1', 'a1.png.svg']) assert.equal(rasterTypeOf(key(bad)), null, bad);
  assert.equal(rasterTypeOf(`thumbs/${WS}/a1.png`), null, 'a derived file is not an original');
  assert.equal(rasterTypeOf(`${WS}/../x.png`), null);
  assert.equal(rasterTypeOf(`${WS}/sub/x.png`), null);
  assert.equal(rasterTypeOf('not-a-uuid/x.png'), null);
  assert.equal(rasterTypeOf(null), null);
});

test('a request is a token and at most a hundred keys, kept in order', () => {
  assert.equal(parseDocImageRequest(null, FILE_TOKEN_RE), null);
  assert.equal(parseDocImageRequest({ token: 'nope', keys: [key('a.png')] }, FILE_TOKEN_RE), null);
  assert.equal(parseDocImageRequest({ token: TOKEN, keys: [] }, FILE_TOKEN_RE), null);
  assert.equal(parseDocImageRequest({ token: TOKEN, keys: 'a' }, FILE_TOKEN_RE), null);
  assert.equal(parseDocImageRequest({ token: TOKEN, keys: Array(DOC_IMAGE_KEYS_MAX + 1).fill(key('a.png')) }, FILE_TOKEN_RE), null);
  const ok = parseDocImageRequest({ token: ` ${TOKEN.toUpperCase()} `, keys: [key('b.png'), 7, key('a.png')] }, FILE_TOKEN_RE);
  assert.deepEqual(ok, { token: TOKEN, keys: [key('b.png'), '', key('a.png')] });
});

test('the room is read from the answer get_file_share gave this caller', () => {
  assert.deepEqual(roomOfAnswer({ room: `${SHARE}.view.bcc7e3849c35` }),
    { name: `${SHARE}.view.bcc7e3849c35`, shareId: SHARE, variant: 'view', gen: 'bcc7e3849c35' });
  assert.equal(roomOfAnswer({ room: `${SHARE}.admin.bcc7e3849c35` }), null);
  assert.equal(roomOfAnswer({ room: `${SHARE}.edit.zz` }), null);
  assert.equal(roomOfAnswer({}), null);
});

test('a key is a candidate only if it is raster, the workspace’s own, and in the room', () => {
  const trusted = new Set([key('in.png'), key('in.svg'), key('x.png', OTHER)]);
  const keys = [key('in.png'), key('in.svg'), key('x.png', OTHER), key('notinroom.png'), ''];
  assert.deepEqual([...candidateKeys(keys, { workspaceId: WS, trusted })], [key('in.png')]);
  assert.equal(candidateKeys(keys, { workspaceId: '', trusted }).size, 0);
  assert.equal(candidateKeys(keys, { workspaceId: WS, trusted: null }).size, 0);
  const upper = key('in.png').toUpperCase();
  assert.equal(candidateKeys([upper], { workspaceId: WS, trusted: new Set([upper]) }).size, 1, 'the workspace prefix is compared without case');
});

test('the answer lines up with the request and never names a key', () => {
  const urls = alignedUrls([key('a.png'), '', key('b.png'), key('a.png')], new Map([[key('a.png'), 'https://u/a']]));
  assert.deepEqual(urls, ['https://u/a', null, null, 'https://u/a']);
});

function fakeFetch(answers) {
  const calls = [];
  const impl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body, auth: init.headers.Authorization || null });
    const next = answers.length > 1 ? answers.shift() : answers[0];
    const out = typeof next === 'function' ? next(body) : next;
    return { ok: true, json: async () => out };
  };
  return { impl, calls };
}

test('the reader asks once for a frame’s worth of keys, and keeps the urls', async () => {
  const { impl, calls } = fakeFetch([(b) => ({ status: 'ok', urls: b.keys.map((k) => `https://signed/${k}`) })]);
  const r = createDocImageResolver({ token: TOKEN, fetchImpl: impl, batchMs: 1, origin: 'https://party' });
  const [a, b] = await Promise.all([r.resolve(key('a.png')), r.resolve(key('b.png'))]);
  assert.equal(a, `https://signed/${key('a.png')}`);
  assert.equal(b, `https://signed/${key('b.png')}`);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://party/parties/upload/share/doc-images');
  assert.deepEqual(calls[0].body, { token: TOKEN, keys: [key('a.png'), key('b.png')] });
  assert.equal(calls[0].auth, null, 'signed out sends no bearer');
  assert.equal(r.cached(key('a.png')), a);
  assert.equal(await r.resolve(key('a.png')), a);
  assert.equal(calls.length, 1, 'a cached url is not asked for again');
  await r.resolve(key('a.png'), { force: true });
  assert.equal(calls.length, 2, 'force asks again');
});

test('the reader drops a url five minutes before it dies, and after it failed', async () => {
  let t = 1_000_000;
  const { impl } = fakeFetch([{ status: 'ok', urls: ['https://signed/1'] }]);
  const r = createDocImageResolver({ token: TOKEN, fetchImpl: impl, batchMs: 1, now: () => t });
  await r.resolve(key('a.png'));
  t += (DOC_IMAGE_URL_TTL_SECONDS - 5 * 60) * 1000 - 1;
  assert.equal(r.cached(key('a.png')), 'https://signed/1');
  t += 2;
  assert.equal(r.cached(key('a.png')), null);
  await r.resolve(key('a.png'));
  r.onAuthError(key('a.png'));
  assert.equal(r.cached(key('a.png')), null);
});

test('an expired session is renewed once; any other refusal answers null', async () => {
  let token = 'old';
  const seen = [];
  const { impl, calls } = fakeFetch([
    { status: 'auth_expired' },
    (b) => ({ status: 'ok', urls: b.keys.map(() => 'https://signed/x') }),
  ]);
  const r = createDocImageResolver({
    token: TOKEN, fetchImpl: impl, batchMs: 1,
    getBearer: async () => token,
    refresh: async () => { seen.push('refresh'); token = 'new'; },
  });
  assert.equal(await r.resolve(key('a.png')), 'https://signed/x');
  assert.deepEqual(seen, ['refresh']);
  assert.deepEqual(calls.map((c) => c.auth), ['Bearer old', 'Bearer new']);

  const refused = createDocImageResolver({ token: TOKEN, fetchImpl: fakeFetch([{ status: 'gone' }]).impl, batchMs: 1 });
  assert.equal(await refused.resolve(key('a.png')), null);
  assert.equal(refused.cached(key('a.png')), null);
  const broken = createDocImageResolver({ token: TOKEN, fetchImpl: async () => { throw new Error('offline'); }, batchMs: 1 });
  assert.equal(await broken.resolve(key('a.png')), null);
});

// ── the route, by source ────────────────────────────────────────────────────

const upload = readFileSync(new URL('../../party/upload.ts', import.meta.url), 'utf8');
const doc = readFileSync(new URL('../../party/doc.ts', import.meta.url), 'utf8');
const r2 = readFileSync(new URL('./r2.js', import.meta.url), 'utf8');

test('the route is anon-callable like /file-share, and asks in the rule’s order', () => {
  const dispatch = upload.indexOf('if (url.pathname.endsWith("/doc-images")) {');
  const authCheck = upload.indexOf('const accessToken = req.headers.get("Authorization")');
  assert.ok(dispatch > 0 && dispatch < authCheck, 'dispatched before the signed-in check');
  const at = upload.indexOf('async handleDocImages(');
  const body = upload.slice(at, upload.indexOf('private async liveImageKeys(', at));
  const order = [
    'parseDocImageRequest(body, FILE_TOKEN_RE)',
    'Authorization: `Bearer ${userBearer || SUPABASE_ANON_KEY}`',
    'if (share?.status !== "ok" || share.file?.kind !== "doc") return reply({ status: "gone" });',
    'this.serviceRpc("_doc_room_target", { p_share: room.shareId })',
    'if (String(target.gen || "").toLowerCase() !== room.gen) return reply({ status: "moved" });',
    'await docRoomKeys(this.room.env, room.name)',
    'candidateKeys(ask.keys, { workspaceId: target.workspace_id, trusted })',
    'await this.liveImageKeys(String(target.workspace_id), [...candidates])',
    'contentType: rasterTypeOf(k)',
    'reply({ status: "ok", urls: alignedUrls(ask.keys, urlByKey), ttl: DOC_IMAGE_URL_TTL_SECONDS })',
  ];
  let last = -1;
  for (const needle of order) {
    const i = body.indexOf(needle);
    assert.ok(i > last, `${needle} comes in order`);
    last = i;
  }
  assert.match(body, /ttl: DOC_IMAGE_URL_TTL_SECONDS, cacheControl: DOC_IMAGE_CACHE_CONTROL, contentType: rasterTypeOf\(k\),/);
  assert.doesNotMatch(body, /keys:\s*\[\.\.\.live\]|urls:\s*Object\.fromEntries/, 'no key in the answer');
  assert.equal(DOC_IMAGE_CACHE_CONTROL, 'private, max-age=3600');
});

test('the live-files read is the share workspace’s own, undeleted rows', () => {
  const at = upload.indexOf('private async liveImageKeys(');
  const body = upload.slice(at, upload.indexOf('// POST /file-thumbs', at));
  assert.match(body, /images\?select=storage_path&workspace_id=eq\.\$\{workspaceId\}&deleted_at=is\.null&storage_path=in\.\(\$\{list\}\)/);
  assert.match(body, /if \(!svc \|\| !UUID_RE\.test\(workspaceId\) \|\| !keys\.length\) return null;/);
});

test('the room is asked by stub with the bridge header, and answers nothing once dead', () => {
  assert.match(upload, /const stub = await getServerByName\(env\.Doc as any, room\);\s+const res = await stub\.fetch\("https:\/\/bridge\/keys", \{\s+method: "POST",\s+headers: await bridgeHeaders\(env as unknown as Env\),/);
  assert.match(doc, /if \(url\.pathname\.endsWith\("\/keys"\)\) \{\s+return Response\.json\(\{ keys: this\.dead \? \[\] : \[\.\.\.this\.trusted\] \}\);/);
  // Signing can force the served type.
  assert.match(upload, /\+ \(opts\.contentType \? `&response-content-type=\$\{encodeURIComponent\(opts\.contentType\)\}` : ""\)/);
});

test('r2.js answers an exact key from its own resolver before any prefix', () => {
  const fn = r2.slice(r2.indexOf('function prefixResolverFor(key) {'), r2.indexOf('// Auth-error escalation'));
  assert.ok(fn.indexOf('_keyResolvers.get(key)') > 0 && fn.indexOf('_keyResolvers.get(key)') < fn.indexOf('_prefixResolvers'));
  assert.match(r2, /export function releaseKeyResolver\(key, resolver\) \{\s+if \(_keyResolvers\.get\(key\) === resolver\) _keyResolvers\.delete\(key\);/);
});
