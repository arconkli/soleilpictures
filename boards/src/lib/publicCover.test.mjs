// publicCover.test.mjs — a public cluster's link-preview picture: which object
// is served, and what the og:image tags say about it.
//
//   node --test src/lib/publicCover.test.mjs
//
// What this guards:
//   * a cover with a share-sized copy is served as that copy, and described as
//     it (WebP, the copy's own size); without one it is the original, described
//     by its own size; a size nobody knows is not stated;
//   * a preview key outside <the cover's workspace>/previews/….webp is never
//     served (the answer is public; the column is writable by a workspace);
//   * the copy missing from the bucket falls back to the original;
//   * ?v= comes from the board's updated time;
//   * worker.js takes both the tags and the bytes from here, and migration 0890
//     re-emits get_public_board_meta with og_cover and nothing dropped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { publicCover, isCoverPreviewKey, readPublicCover } from './publicCover.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const WS = '11111111-2222-4333-8444-555555555555';
const ORIG = `${WS}/aaaa.jpg`;
const PREV = `${WS}/previews/bbbb-lg.webp`;
const META = {
  board_id: 'b1', og_image_key: ORIG, updated_at: '2026-11-01T10:00:00+00:00',
  og_cover: { w: 2400, h: 3595, preview_key: PREV, preview_w: 854, preview_h: 1280 },
};

test('a cover with a share-sized copy is that copy, described as it is', () => {
  assert.deepEqual(publicCover(META), {
    key: PREV, fallbackKey: ORIG, type: 'image/webp', width: 854, height: 1280,
    version: '2026-11-01T10:00:00+00:00',
  });
});

test('a cover without a copy is the original, with the original\'s size and type', () => {
  const c = publicCover({ ...META, og_cover: { w: 1600, h: 1067, preview_key: null } });
  assert.deepEqual(c, { key: ORIG, fallbackKey: null, type: 'image/jpeg', width: 1600, height: 1067, version: META.updated_at });
  assert.equal(publicCover({ ...META, og_image_key: `${WS}/a.PNG`, og_cover: null }).type, 'image/png');
});

test('before migration 0890 (no og_cover) the original is served and no size is claimed', () => {
  const { og_cover, ...old } = META;
  const c = publicCover(old);
  assert.equal(c.key, ORIG);
  assert.equal(c.fallbackKey, null);
  assert.equal(c.width, null);
  assert.equal(c.height, null);
  assert.equal(c.type, 'image/jpeg');
});

test('an unknown extension claims no type; a nonsense size is no size', () => {
  assert.equal(publicCover({ og_image_key: `${WS}/blob` }).type, null);
  const c = publicCover({ ...META, og_cover: { w: '2400', h: -1 } });
  assert.equal(c.width, null);
  assert.equal(c.height, null);
});

test('an r2: prefix is dropped from both keys', () => {
  const c = publicCover({ ...META, og_image_key: `r2:${ORIG}`, og_cover: { ...META.og_cover, preview_key: `r2:${PREV}` } });
  assert.equal(c.key, PREV);
  assert.equal(c.fallbackKey, ORIG);
});

test('a preview key is served only from the cover\'s own workspace previews folder', () => {
  assert.equal(isCoverPreviewKey(ORIG, PREV), true);
  for (const bad of [
    '99999999-2222-4333-8444-555555555555/previews/x.webp', // another workspace
    `${WS}/private/x.webp`,                                  // not a preview
    `${WS}/previews/x.jpg`,                                  // not the copy's format
    `${WS}/previews/../../other/x.webp`,
    `${WS}/previews//x.webp`,
    `${WS}/previews/x.webp?y`,
    `/previews/x.webp`,
    ORIG, '', null, undefined,
  ]) {
    assert.equal(isCoverPreviewKey(ORIG, bad), false, String(bad));
    const c = publicCover({ ...META, og_cover: { ...META.og_cover, preview_key: bad } });
    assert.equal(c.key, ORIG, String(bad));
    assert.equal(c.width, 2400);
  }
  assert.equal(isCoverPreviewKey('', PREV), false);
});

test('a cluster with only its rendered thumbnail keeps the thumbnail\'s facts', () => {
  const t = { thumb_key: `${WS}/thumbs/b1.webp`, thumb_version: 8, thumb_updated_at: '2026-10-02T00:00:00Z', updated_at: '2026-11-01T00:00:00Z' };
  assert.deepEqual(publicCover(t), {
    key: t.thumb_key, fallbackKey: null, type: 'image/webp', width: 1200, height: 675, version: t.thumb_updated_at,
  });
  const v1 = publicCover({ ...t, thumb_version: 1 });
  assert.equal(v1.width, 800);
  assert.equal(v1.height, 600);
  assert.equal(publicCover({ ...t, thumb_updated_at: null }).version, t.updated_at);
});

test('the cover wins over the thumbnail, and nothing is nothing', () => {
  assert.equal(publicCover({ ...META, thumb_key: `${WS}/thumbs/b1.webp` }).key, PREV);
  assert.equal(publicCover({ board_id: 'b1' }), null);
  assert.equal(publicCover(null), null);
});

function bucket(files, { failOn } = {}) {
  const reads = [];
  return {
    reads,
    get: async (k) => {
      reads.push(k);
      if (k === failOn) throw new Error('R2 down');
      return files.includes(k) ? { key: k } : null;
    },
  };
}

test('the bucket read: the copy first, the original when the copy is not there', async () => {
  const cover = publicCover(META);
  let b = bucket([PREV, ORIG]);
  assert.deepEqual(await readPublicCover(b, cover), { obj: { key: PREV }, key: PREV });
  assert.deepEqual(b.reads, [PREV]); // the heavy original is never touched

  b = bucket([ORIG]);
  assert.deepEqual(await readPublicCover(b, cover), { obj: { key: ORIG }, key: ORIG });
  assert.deepEqual(b.reads, [PREV, ORIG]);

  b = bucket([ORIG], { failOn: PREV });
  assert.equal((await readPublicCover(b, cover)).key, ORIG);

  assert.equal(await readPublicCover(bucket([]), cover), null);
  assert.equal(await readPublicCover(bucket([]), publicCover({ ...META, og_cover: null })), null);
  assert.equal(await readPublicCover(null, cover), null);
  assert.equal(await readPublicCover(bucket([ORIG]), null), null);
});

test('worker.js writes the tags and serves the bytes from the same pick', () => {
  const src = readFileSync(resolve(HERE, '../worker.js'), 'utf8');
  assert.match(src, /import \{ publicCover, readPublicCover \} from '\.\/lib\/publicCover\.js';/);

  const inject = src.slice(src.indexOf('function injectPublicBoard('), src.indexOf('// Crawlable server-rendered content (replaces the homepage SEO fallback)'));
  assert.match(inject, /const cover = publicCover\(meta\);/);
  assert.match(inject, /\?v=\$\{encodeURIComponent\(cover\.version\)\}/);
  assert.match(inject, /og:image:width"\]',\s+sized \? new SetContent\(String\(cover\.width\)\) : new RemoveEl\(\)/);
  assert.match(inject, /og:image:height"\]',\s+sized \? new SetContent\(String\(cover\.height\)\) : new RemoveEl\(\)/);
  assert.match(inject, /og:image:type"\]',\s+cover\.type \? new SetContent\(cover\.type\) : new RemoveEl\(\)/);
  // The old tags stated one size and WebP for every picture.
  assert.doesNotMatch(inject, /SetContent\('image\/webp'\)|isV2/);

  const thumb = src.slice(src.indexOf('async function handlePublicThumb('), src.indexOf('async function handlePublicImg('));
  assert.match(thumb, /readPublicCover\(env\.IMAGES, cover\)/);
  assert.match(thumb, /safeRasterType\(obj\.httpMetadata\?\.contentType, key\)/);
  assert.doesNotMatch(thumb, /meta\?\.og_image_key \|\| meta\?\.thumb_key/);
});

test('migration 0890 adds og_cover to get_public_board_meta and drops nothing', () => {
  const dir = resolve(HERE, '../../../supabase/migrations');
  const fnOf = (sql) => {
    const at = sql.lastIndexOf('function public.get_public_board_meta(');
    return sql.slice(at, sql.indexOf('$$;', at));
  };
  const keysOf = (fn) => [...fn.matchAll(/^\s+'([a-z_]+)',\s/gm)].map((m) => m[1]);
  const mine = fnOf(readFileSync(resolve(dir, '0890_public_cover_preview.sql'), 'utf8'));
  const before = fnOf(readFileSync(resolve(dir, '0860_post_boards_unlisted.sql'), 'utf8'));
  const added = ['og_cover', 'w', 'h', 'preview_key', 'preview_w', 'preview_h'];
  assert.deepEqual(keysOf(mine).filter((k) => !added.includes(k)), keysOf(before));
  assert.ok(keysOf(before).length >= 15);
  for (const k of added) assert.ok(keysOf(mine).includes(k), k);
  assert.match(mine, /security definer set search_path = public/);
  assert.match(mine, /like i\.workspace_id::text \|\| '\/previews\/%\.webp'/);
  assert.match(mine, /i\.deleted_at is null/);
  // It is the newest definition: nothing later re-emits the function without og_cover.
  for (const f of readdirSync(dir).filter((n) => n > '0890_public_cover_preview.sql')) {
    const sql = readFileSync(resolve(dir, f), 'utf8');
    if (/function public\.get_public_board_meta\(/i.test(sql)) assert.match(fnOf(sql), /'og_cover'/, f);
  }
});
