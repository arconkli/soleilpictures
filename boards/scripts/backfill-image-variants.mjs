// Operator backfill: generate Tier-0/Tier-1 image variants (thumbhash blur +
// 1280px/640px webp previews) for originals that predate progressive image
// loading (shipped 2026-06-02). The client generates these at upload time
// (src/lib/uploads.js generateAndUploadVariants); this script covers the
// existing corpus, which a writer-view-triggered backfill can never reach in a
// multi-tenant product.
//
// Mirrors the set_image_variant RPC (supabase/migrations/0131) exactly:
//   - preview rows are inserted retention-locked (2999-01-01) so the daily R2
//     orphan sweep never collects them (their ref_count stays 0),
//   - the original row is stamped via COALESCE so an existing value never
//     regresses,
//   - R2 PUTs happen strictly BEFORE DB stamps so a crash can't leave a row
//     pointing at a missing object.
// The RPC itself can't be called here: it authorizes via auth.uid(), which is
// NULL for service_role and throws (see 0083_demo_strict_writes.sql).
//
// Two credential modes, chosen per resource by what's in the environment:
//   R2:  R2_ACCOUNT_ID/R2_BUCKET/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY → S3 API
//        (aws4fetch, same lib as the party); otherwise shells out to
//        `npx wrangler r2 object get/put` (needs `wrangler login` done once).
//   DB:  SUPABASE_SERVICE_ROLE_KEY → reads candidates + writes stamps directly;
//        otherwise pass --candidates=<json> (rows from the SQL below) and the
//        stamps are written to --sql-out=<file> for manual application.
//
// Usage (from boards/):
//   node scripts/backfill-image-variants.mjs                 # dry-run, plan only
//   node scripts/backfill-image-variants.mjs --apply         # do it
//   node scripts/backfill-image-variants.mjs --apply --limit=3   # pre-flight
//   node scripts/backfill-image-variants.mjs --pass=2 --apply    # sm variants only
//   node scripts/backfill-image-variants.mjs --pass=xs           # plan the quick tier
//   node scripts/backfill-image-variants.mjs --pass=xs --apply --limit=3
//   node scripts/backfill-image-variants.mjs --pass=png          # count PNG previews (S3 mode)
//   node scripts/backfill-image-variants.mjs --pass=png --apply  # rewrite them as WebP
//   --native-webp   also re-encode ≤1280px sources at native size when the
//                   webp saves ≥20% bytes (floor 320px) — mirrors the client
//                   rule added 2026-06-11 in uploads.js. Without it, ≤1280px
//                   byte-heavy originals (most of the legacy corpus) only get
//                   blur hashes and keep shipping multi-hundred-KB originals.
//   --covers        only the cover pictures of published public clusters
//                   (public_boards.og_image_key). /api/public-thumb/<slug>
//                   serves a cover's preview in place of the original once it
//                   has one (src/lib/publicCover.js, migration 0890), so this
//                   is what makes link previews and the search pages' example
//                   lists light. Safe to run again after new clusters are
//                   published: a cover that already has a preview is skipped.
//                   Without SUPABASE_SERVICE_ROLE_KEY, make --candidates with:
//                     select coalesce(json_agg(c), '[]') from (
//                       select i.id, i.storage_path, i.workspace_id, i.board_id,
//                              i.width, i.height, i.preview_path, i.preview_w,
//                              i.preview_h, i.preview_sm_path
//                         from public_boards pb
//                         join boards b on b.id = pb.board_id
//                         join images i
//                           on i.storage_path = regexp_replace(pb.og_image_key, '^r2:', '')
//                        where pb.published_at is not null and b.deleted_at is null
//                          and i.deleted_at is null) c;
//
//   --pass=xs       the quick tier (migration 0898): a ~256px WebP, the new
//                   smallest rung below sm (640) and lg (1280), for every live
//                   image that has none. Candidates: live images rows, not
//                   animated (.gif), preview_xs_path null, with a preview
//                   (preview_sm_path or preview_path) or a raster original
//                   whose long edge is over 384 and that has no preview.
//                   Source: the smallest existing preview whose long edge is
//                   at least 256 (sm, else lg), else the original. Key is
//                   <workspace>/previews/<id>-xs.webp, so a rerun is
//                   idempotent. Not part of `all` (pass 1/2): run it by name.
//                   Only images something still references (ref_count > 0):
//                   an unreferenced original is headed for the orphan sweep,
//                   and an xs made for it would only be swept after it.
//                   An animated original (a multi-page WebP) is skipped.
//                   Best run once the Worker that knows preview_xs_path is
//                   live (its orphan sweep deletes the xs file with the
//                   original). Before that, a swept picture leaves its xs
//                   file behind (a few KB); only pictures in use are
//                   candidates, so that is rare. Either way, run it again
//                   after that release: pictures uploaded by older clients
//                   in between have no xs yet. Each row is stamped as soon
//                   as its file is up, so a run that stops part way keeps
//                   what it made and a rerun does the rest.
//                   Without SUPABASE_SERVICE_ROLE_KEY, make --candidates with:
//                     select coalesce(json_agg(c), '[]') from (
//                       select i.id, i.storage_path, i.workspace_id, i.board_id,
//                              i.width, i.height, i.preview_path, i.preview_w,
//                              i.preview_h, i.preview_sm_path, i.preview_sm_w,
//                              i.preview_sm_h, i.preview_xs_path, i.ref_count
//                         from images i
//                        where i.deleted_at is null
//                          and i.preview_xs_path is null
//                          and i.ref_count > 0
//                          and i.storage_path !~ '\.gif$'
//                          and i.storage_path not like '%/previews/%'
//                          and i.storage_path not like '%/thumbs/%'
//                          and i.referenced_in_board_ids <> '{}') c;
//   --pass=png      REWRITES LIVE FILES, no DB change. Safari can't encode
//                   WebP, so previews made there were stored as PNG. HEADs each
//                   preview_path / preview_sm_path object, and for every one
//                   whose stored Content-Type is image/png re-encodes it as
//                   WebP (quality 72, same size, alpha kept) and PUTs it back
//                   to the SAME key with Content-Type image/webp, only when
//                   the WebP is smaller. S3 API mode only (wrangler cannot
//                   HEAD). Dry run prints counts by stored type and an
//                   estimate of bytes saved from a sample; needs --apply to
//                   write. Candidates: same shape as --pass=xs
//                   (workspace_id, preview_path, preview_sm_path are what is
//                   read). Only keys of the form
//                   <the row's workspace_id>/previews/<letters, digits, ->.webp
//                   are touched; any other key is logged and skipped.
//
// Candidates JSON shape (array): { id, storage_path, workspace_id, board_id,
//   width, height, preview_path, preview_w, preview_h, preview_sm_path }

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { rgbaToThumbHash } from 'thumbhash';

const execFileP = promisify(execFile);

// Run wrangler from a neutral cwd: boards/wrangler.toml uses v4-only fields
// (assets, observability) that the pinned wrangler v3 refuses to parse, and
// r2 object commands don't need project config at all.
const WRANGLER_BIN = new URL('../node_modules/.bin/wrangler', import.meta.url).pathname;
const wrangler = (cliArgs) => execFileP(WRANGLER_BIN, cliArgs,
  { cwd: tmpdir(), maxBuffer: 64 * 1024 * 1024 });

// Same variant spec as src/lib/uploads.js — keep in lockstep.
const PREVIEW_LONGEST_EDGE = 1280;
const PREVIEW_SM_LONGEST_EDGE = 640;
const PREVIEW_XS_LONGEST_EDGE = 256;
const PREVIEW_XS_QUALITY = 65;     // the quick tier is tiny; a lower quality is invisible at that size
const PREVIEW_QUALITY = 72;        // sharp webp quality 0-100 (client: canvas 0.72)

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ehlhlmbpwwalmeisvmdp.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const R2_BUCKET = process.env.R2_BUCKET || 'soleil-boards-images';
const HAS_S3 = !!(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY);

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  return m ? [m[1], m[2] ?? true] : [a, true];
}));
const APPLY = !!args.apply;
const LIMIT = args.limit ? parseInt(args.limit, 10) : Infinity;
const PASS = String(args.pass || 'all');   // '1' | '2' | 'all' | 'xs' | 'png'
const SQL_OUT = args['sql-out'] || 'backfill-stamps.sql';
const CONCURRENCY = 4;
// --native-webp: keep the rule in lockstep with uploads.js
// (NATIVE_WEBP_MIN_EDGE / NATIVE_WEBP_MAX_RATIO there).
const NATIVE_WEBP = !!args['native-webp'];
const COVERS = !!args.covers;
const NATIVE_WEBP_MIN_EDGE = 320;
const NATIVE_WEBP_MAX_RATIO = 0.8;

// ── R2 access ────────────────────────────────────────────────────────────

let s3;
if (HAS_S3) {
  const { AwsClient } = await import('aws4fetch');
  s3 = {
    client: new AwsClient({
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      service: 's3',
      region: 'auto',
    }),
    base: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_BUCKET}`,
  };
}

async function r2Get(key) {
  if (s3) {
    const res = await s3.client.fetch(`${s3.base}/${key}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`R2 GET ${key}: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
  const tmp = join(workDir, randomUUID());
  try {
    await wrangler(['r2', 'object', 'get', `${R2_BUCKET}/${key}`, `--file=${tmp}`]);
    return await readFile(tmp);
  } catch (err) {
    const out = `${err.stdout || ''}${err.stderr || ''}`;
    if (/does not exist|404|NoSuchKey/i.test(out)) return null;
    throw new Error(`wrangler r2 get ${key} failed: ${out.slice(-500)}`);
  } finally {
    await rm(tmp, { force: true });
  }
}

async function r2Put(key, buf, contentType) {
  if (s3) {
    const res = await s3.client.fetch(`${s3.base}/${key}`, {
      method: 'PUT', body: buf, headers: { 'Content-Type': contentType },
    });
    if (!res.ok) throw new Error(`R2 PUT ${key}: ${res.status}`);
    return;
  }
  const tmp = join(workDir, randomUUID());
  try {
    await writeFile(tmp, buf);
    await wrangler(['r2', 'object', 'put', `${R2_BUCKET}/${key}`,
      `--file=${tmp}`, `--content-type=${contentType}`]);
  } finally {
    await rm(tmp, { force: true });
  }
}

// ── DB access ────────────────────────────────────────────────────────────

let db = null;
if (SERVICE_KEY) {
  const { createClient } = await import('@supabase/supabase-js');
  db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
}

// Raster originals only: the images table also holds wav/mp3/svg rows (it
// doubles as the sign-reads allowlist) and gif is excluded so an animated card
// isn't frozen by a static preview.
const RASTER_RE = /\.(png|jpe?g|webp)$/i;

const CANDIDATE_COLUMNS = 'id, storage_path, workspace_id, board_id, width, height, preview_path, preview_w, preview_h, preview_sm_path, preview_sm_w, preview_sm_h, preview_xs_path';

// --covers: the images rows behind published public clusters' covers. A cover
// is read by its key alone, so it does not have to be referenced by a card.
async function loadCoverCandidates() {
  const { data: pubs, error: pubErr } = await db.from('public_boards')
    .select('og_image_key, boards!inner(deleted_at)')
    .not('published_at', 'is', null)
    .not('og_image_key', 'is', null)
    .is('boards.deleted_at', null);
  if (pubErr) throw new Error(`cover query failed: ${pubErr.message}`);
  const keys = [...new Set(pubs.map((p) => String(p.og_image_key).replace(/^r2:/, '')).filter(Boolean))];
  const out = [];
  for (let i = 0; i < keys.length; i += 50) {
    const { data, error } = await db.from('images')
      .select(CANDIDATE_COLUMNS)
      .is('deleted_at', null)
      .in('storage_path', keys.slice(i, i + 50));
    if (error) throw new Error(`cover images query failed: ${error.message}`);
    out.push(...data);
  }
  const missing = keys.length - out.length;
  if (missing) console.log(`Covers: ${missing} cover key(s) have no images row and are left as they are.`);
  return out;
}

async function loadCandidates() {
  if (args.candidates) {
    return JSON.parse(await readFile(args.candidates, 'utf8'));
  }
  if (!db) {
    console.error('No SUPABASE_SERVICE_ROLE_KEY and no --candidates=<json>. Provide one.');
    process.exit(1);
  }
  if (COVERS) return loadCoverCandidates();
  const { data, error } = await db.from('images')
    .select(CANDIDATE_COLUMNS)
    .is('deleted_at', null)
    .not('referenced_in_board_ids', 'eq', '{}')
    .not('referenced_in_board_ids', 'is', null)
    .not('storage_path', 'like', '%/previews/%')
    .not('storage_path', 'like', '%/thumbs/%');
  if (error) throw new Error(`candidate query failed: ${error.message}`);
  return data;
}

const sqlStmts = [];
const q = (v) => (v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const n = (v) => (v == null ? 'NULL' : String(Math.round(v)));

function stampSql({ row, blur, lg, sm, origW, origH }) {
  const stmts = [];
  for (const v of [lg, sm].filter(Boolean)) {
    stmts.push(
      `INSERT INTO public.images (workspace_id, board_id, storage_path, width, height, uploaded_by, retention_locked_until)\n` +
      `VALUES (${q(row.workspace_id)}, ${q(row.board_id)}, ${q(v.key)}, ${n(v.w)}, ${n(v.h)}, NULL, timestamptz '2999-01-01')\n` +
      `ON CONFLICT (storage_path) DO NOTHING;`
    );
  }
  stmts.push(
    `UPDATE public.images SET\n` +
    `  blur_hash       = coalesce(${q(blur)}, blur_hash),\n` +
    `  preview_path    = coalesce(${q(lg?.key)}, preview_path),\n` +
    `  preview_w       = coalesce(${n(lg?.w)}, preview_w),\n` +
    `  preview_h       = coalesce(${n(lg?.h)}, preview_h),\n` +
    `  preview_sm_path = coalesce(${q(sm?.key)}, preview_sm_path),\n` +
    `  preview_sm_w    = coalesce(${n(sm?.w)}, preview_sm_w),\n` +
    `  preview_sm_h    = coalesce(${n(sm?.h)}, preview_sm_h),\n` +
    `  width           = coalesce(width, ${n(origW)}),\n` +
    `  height          = coalesce(height, ${n(origH)})\n` +
    `WHERE storage_path = ${q(row.storage_path)};`
  );
  return stmts;
}

async function stampDb({ row, blur, lg, sm, origW, origH }) {
  for (const v of [lg, sm].filter(Boolean)) {
    const { error } = await db.from('images').upsert({
      workspace_id: row.workspace_id,
      board_id: row.board_id,
      storage_path: v.key,
      width: v.w,
      height: v.h,
      uploaded_by: null,
      retention_locked_until: '2999-01-01T00:00:00Z',
    }, { onConflict: 'storage_path', ignoreDuplicates: true });
    if (error) throw new Error(`preview row upsert (${v.key}): ${error.message}`);
  }
  const patch = {};
  if (blur != null) patch.blur_hash = blur;
  if (lg) { patch.preview_path = lg.key; patch.preview_w = lg.w; patch.preview_h = lg.h; }
  if (sm) { patch.preview_sm_path = sm.key; patch.preview_sm_w = sm.w; patch.preview_sm_h = sm.h; }
  if (row.width == null && origW != null) { patch.width = origW; patch.height = origH; }
  const { error } = await db.from('images').update(patch).eq('storage_path', row.storage_path);
  if (error) throw new Error(`original stamp (${row.storage_path}): ${error.message}`);
}

// ── Variant generation ───────────────────────────────────────────────────

// Post-EXIF-rotation dimensions (client decodes with imageOrientation:'from-image').
async function orientedDims(buf) {
  const m = await sharp(buf).metadata();
  let w = m.width, h = m.height;
  if ((m.orientation || 1) >= 5) [w, h] = [h, w];
  return { w, h };
}

async function makeBlur(buf) {
  const { data, info } = await sharp(buf).rotate()
    .resize(100, 100, { fit: 'inside', withoutEnlargement: true })
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const hash = rgbaToThumbHash(info.width, info.height, data);
  return Buffer.from(hash).toString('base64');
}

// null when the source is already within maxEdge — mirrors the client's
// downscaleDrawableToWebp (the original then serves as Tier-1 directly).
async function makeWebp(buf, srcLongest, maxEdge) {
  if (srcLongest <= maxEdge) return null;
  const { data, info } = await sharp(buf).rotate()
    .resize(maxEdge, maxEdge, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: PREVIEW_QUALITY })
    .toBuffer({ resolveWithObject: true });
  return { buf: data, w: info.width, h: info.height };
}

// Native-size webp re-encode (no resize) — mirrors drawableToWebpNative in
// uploads.js. Caller applies the byte-savings guard.
async function makeWebpNative(buf) {
  const { data, info } = await sharp(buf).rotate()
    .webp({ quality: PREVIEW_QUALITY })
    .toBuffer({ resolveWithObject: true });
  return { buf: data, w: info.width, h: info.height };
}

// Deterministic preview keys, derived from the original row's id. The client
// upload path mints random UUID keys, but here determinism is what makes a
// rerun idempotent: a crash between the R2 PUTs and the DB stamp re-PUTs the
// SAME keys and re-upserts the SAME rows — random keys would instead orphan
// the first run's retention-locked preview rows forever (the sweep skips
// retention-locked rows by design).
const previewKeyFor = (row, variant) => `${row.workspace_id}/previews/${row.id}-${variant}.webp`;

async function processPass1(row) {
  const buf = await r2Get(row.storage_path);
  if (!buf) return { row, skip: 'missing in R2' };
  let dims;
  try { dims = await orientedDims(buf); } catch (e) { return { row, skip: `undecodable: ${e.message}` }; }
  const longest = Math.max(dims.w, dims.h);

  const blur = await makeBlur(buf);
  let lgOut = await makeWebp(buf, longest, PREVIEW_LONGEST_EDGE);
  // --native-webp: ≤1280px sources still get a preview when the re-encode
  // pays (≥20% byte savings, floor 320px) — without it these images ship the
  // original forever and never get the 640px sm/srcset tier.
  if (!lgOut && NATIVE_WEBP && longest > NATIVE_WEBP_MIN_EDGE) {
    const native = await makeWebpNative(buf);
    if (native && native.buf.length < buf.length * NATIVE_WEBP_MAX_RATIO) lgOut = native;
  }
  let lg = null, sm = null;
  if (lgOut) {
    lg = { key: previewKeyFor(row, 'lg'), w: lgOut.w, h: lgOut.h };
    const smOut = await makeWebp(buf, longest, PREVIEW_SM_LONGEST_EDGE);
    if (smOut) sm = { key: previewKeyFor(row, 'sm'), w: smOut.w, h: smOut.h };
    await r2Put(lg.key, lgOut.buf, 'image/webp');
    if (sm) await r2Put(sm.key, smOut.buf, 'image/webp');
  }
  return { row, blur, lg, sm, origW: dims.w, origH: dims.h, srcBytes: buf.length };
}

// sm sibling for images that got the 1280 preview before sm variants existed.
// Sourced from the (small) preview object, not the original.
async function processPass2(row) {
  if ((row.preview_w || 0) <= PREVIEW_SM_LONGEST_EDGE && (row.preview_h || 0) <= PREVIEW_SM_LONGEST_EDGE) {
    return { row, skip: 'preview already ≤640px' };
  }
  const buf = await r2Get(row.preview_path);
  if (!buf) return { row, skip: 'preview missing in R2' };
  let dims;
  try { dims = await orientedDims(buf); } catch (e) { return { row, skip: `undecodable: ${e.message}` }; }
  const smOut = await makeWebp(buf, Math.max(dims.w, dims.h), PREVIEW_SM_LONGEST_EDGE);
  if (!smOut) return { row, skip: 'preview already ≤640px' };
  const sm = { key: previewKeyFor(row, 'sm'), w: smOut.w, h: smOut.h };
  await r2Put(sm.key, smOut.buf, 'image/webp');
  return { row, blur: null, lg: null, sm, origW: null, origH: null };
}

async function mapLimit(items, limit, fn) {
  const out = [];
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try { out[idx] = await fn(items[idx]); }
      catch (err) { out[idx] = { row: items[idx].r, skip: `ERROR: ${err.message}` }; }
    }
  }));
  return out;
}

// ── Pass xs: the quick tier ──────────────────────────────────────────────

const XS_MIN_ORIGINAL_EDGE = 384;   // below this the original is already near-quick
const XS_COLUMNS = `${CANDIDATE_COLUMNS}, ref_count`;

async function loadXsCandidates() {
  if (args.candidates) return JSON.parse(await readFile(args.candidates, 'utf8'));
  if (!db) {
    console.error('No SUPABASE_SERVICE_ROLE_KEY and no --candidates=<json>. Provide one.');
    process.exit(1);
  }
  const out = [];
  // Paged: a plain select stops at the API's row cap.
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('images')
      .select(XS_COLUMNS)
      .is('deleted_at', null)
      .is('preview_xs_path', null)
      .gt('ref_count', 0)
      .not('referenced_in_board_ids', 'eq', '{}')
      .not('referenced_in_board_ids', 'is', null)
      .not('storage_path', 'like', '%/previews/%')
      .not('storage_path', 'like', '%/thumbs/%')
      .order('id')
      .range(from, from + 999);
    if (error) throw new Error(`xs candidate query failed: ${error.message}`);
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

const edgeOf = (w, h) => Math.max(w || 0, h || 0);

// Which stored object the quick tier is made from, or null when the row is not
// a candidate: the smallest preview that still has 256px to give (sm, else
// lg), else a raster original over 384px with no preview at all.
function xsSource(r) {
  if (r.preview_xs_path != null || /\.gif$/i.test(r.storage_path)) return null;
  // Unreferenced originals are headed for the sweep (a row that carries no
  // ref_count — an older --candidates file — is not judged on it).
  if (r.ref_count != null && !(r.ref_count > 0)) return null;
  const hasPreview = r.preview_sm_path != null || r.preview_path != null;
  if (hasPreview) {
    // Unknown dims (null) are trusted: the preview is what we have.
    const ok = (path, w, h) => path != null && ((w == null && h == null) || edgeOf(w, h) >= PREVIEW_XS_LONGEST_EDGE);
    if (ok(r.preview_sm_path, r.preview_sm_w, r.preview_sm_h)) return { key: r.preview_sm_path, from: 'sm' };
    if (ok(r.preview_path, r.preview_w, r.preview_h)) return { key: r.preview_path, from: 'lg' };
    return null;
  }
  if (RASTER_RE.test(r.storage_path) && edgeOf(r.width, r.height) > XS_MIN_ORIGINAL_EDGE) {
    return { key: r.storage_path, from: 'original' };
  }
  return null;
}

async function processXs(row) {
  const src = xsSource(row);
  if (!src) return { row, skip: 'no source for the quick tier' };
  const buf = await r2Get(src.key);
  if (!buf) return { row, skip: `${src.from} missing in R2` };
  let out;
  try {
    // An animated original (a multi-page WebP) would be frozen to its first
    // frame; its card keeps the blur only, as on upload.
    if (src.from === 'original') {
      const meta = await sharp(buf).metadata();
      if ((meta.pages || 1) > 1) return { row, skip: 'animated source' };
    }
    // rotate() orients an original the way the other passes do; on a preview
    // (already upright) it changes nothing.
    out = await sharp(buf).rotate()
      .resize(PREVIEW_XS_LONGEST_EDGE, PREVIEW_XS_LONGEST_EDGE, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: PREVIEW_XS_QUALITY })
      .toBuffer({ resolveWithObject: true });
  } catch (e) { return { row, skip: `undecodable: ${e.message}` }; }
  const xs = { key: previewKeyFor(row, 'xs'), w: out.info.width, h: out.info.height };
  await r2Put(xs.key, out.data, 'image/webp');   // before the DB stamp
  return { row, xs, from: src.from, bytes: out.data.length };
}

function stampXsSql({ row, xs }) {
  return [
    `INSERT INTO public.images (workspace_id, board_id, storage_path, width, height, uploaded_by, retention_locked_until)\n` +
    `VALUES (${q(row.workspace_id)}, ${q(row.board_id)}, ${q(xs.key)}, ${n(xs.w)}, ${n(xs.h)}, NULL, timestamptz '2999-01-01')\n` +
    `ON CONFLICT (storage_path) DO NOTHING;`,
    `UPDATE public.images SET\n` +
    `  preview_xs_path = coalesce(preview_xs_path, ${q(xs.key)}),\n` +
    `  preview_xs_w    = coalesce(preview_xs_w, ${n(xs.w)}),\n` +
    `  preview_xs_h    = coalesce(preview_xs_h, ${n(xs.h)})\n` +
    `WHERE id = ${q(row.id)};`,
  ];
}

async function stampXsDb({ row, xs }) {
  const { error: insErr } = await db.from('images').upsert({
    workspace_id: row.workspace_id,
    board_id: row.board_id,
    storage_path: xs.key,
    width: xs.w,
    height: xs.h,
    uploaded_by: null,
    retention_locked_until: '2999-01-01T00:00:00Z',
  }, { onConflict: 'storage_path', ignoreDuplicates: true });
  if (insErr) throw new Error(`xs row upsert (${xs.key}): ${insErr.message}`);
  // coalesce(...) semantics: only fill what is still empty, so a rerun or a
  // client that stamped it meanwhile is never overwritten.
  const { error } = await db.from('images')
    .update({ preview_xs_path: xs.key, preview_xs_w: xs.w, preview_xs_h: xs.h })
    .eq('id', row.id).is('preview_xs_path', null);
  if (error) throw new Error(`xs stamp (${row.storage_path}): ${error.message}`);
}

async function runXsPass() {
  const all = await loadXsCandidates();
  const work = all.filter((r) => xsSource(r)).slice(0, LIMIT);
  const bySource = { sm: 0, lg: 0, original: 0 };
  for (const r of work) bySource[xsSource(r).from]++;
  console.log(`Quick tier (xs): ${work.length} of ${all.length} row(s) need one (from sm ${bySource.sm}, lg ${bySource.lg}, original ${bySource.original}).`);
  console.log(`Mode: R2 via ${s3 ? 'S3 API' : 'wrangler'}, DB ${db ? 'direct (service role)' : `→ ${SQL_OUT}`}; ${APPLY ? 'APPLY' : 'DRY-RUN'}${Number.isFinite(LIMIT) ? `, limit ${LIMIT}` : ''}.`);
  if (!APPLY) {
    for (const r of work) console.log(`  [xs] ${r.storage_path}  (from ${xsSource(r).from})`);
    console.log(`Dry-run only — rerun with --apply to generate ${work.length} item(s).`);
    return;
  }
  let ok = 0, skipped = 0, done = 0;
  const t0 = Date.now();
  await mapLimit(work.map((r) => ({ r })), CONCURRENCY, async ({ r }) => {
    let res;
    try {
      res = await processXs(r);
      // Stamped as soon as its file is up (see the --pass=xs note).
      if (!res.skip) {
        if (db) await stampXsDb(res);
        else sqlStmts.push(`-- ${res.row.storage_path}`, ...stampXsSql(res));
      }
    } catch (err) { res = { row: r, skip: `ERROR: ${err.message}` }; }
    done++;
    if (res.skip) { skipped++; console.log(`  SKIP ${res.row.storage_path} — ${res.skip}`); }
    else { ok++; console.log(`  OK   ${res.row.storage_path} → xs ${res.xs.w}×${res.xs.h} (${res.bytes} B, from ${res.from})`); }
    if (done % 500 === 0 || done === work.length) {
      console.log(`  … ${done}/${work.length}: ${ok} made, ${skipped} skipped, ${((Date.now() - t0) / 60000).toFixed(1)} min`);
    }
    return res;
  });
  if (!db && sqlStmts.length) {
    await writeFile(SQL_OUT, sqlStmts.join('\n') + '\n');
    console.log(`\nWrote ${sqlStmts.length} statements to ${SQL_OUT} — apply them (service role / MCP) to finish.`);
  }
  console.log(`\nDone: ${ok} processed, ${skipped} skipped.`);
}

// ── Pass png: previews Safari stored as PNG ──────────────────────────────

const PNG_SAMPLE = 20;   // dry run: how many PNGs to re-encode for the estimate

async function r2Head(key) {
  const res = await s3.client.fetch(`${s3.base}/${key}`, { method: 'HEAD' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`R2 HEAD ${key}: ${res.status}`);
  return {
    type: (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase() || 'unknown',
    bytes: Number(res.headers.get('content-length')) || 0,
  };
}

async function toWebpSmaller(key, storedBytes) {
  const buf = await r2Get(key);
  if (!buf) return { skip: 'missing in R2' };
  const out = await sharp(buf).webp({ quality: PREVIEW_QUALITY }).toBuffer();   // same size, alpha kept
  const before = storedBytes || buf.length;
  return out.length < before ? { webp: out, before, after: out.length } : { skip: 'WebP not smaller', before, after: out.length };
}

// Rows with at least one preview (the png pass reads only the preview keys).
async function loadPngCandidates() {
  if (args.candidates) return JSON.parse(await readFile(args.candidates, 'utf8'));
  if (!db) {
    console.error('No SUPABASE_SERVICE_ROLE_KEY and no --candidates=<json>. Provide one.');
    process.exit(1);
  }
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('images')
      .select('id, workspace_id, preview_path, preview_sm_path')
      .is('deleted_at', null)
      .or('preview_path.not.is.null,preview_sm_path.not.is.null')
      .order('id')
      .range(from, from + 999);
    if (error) throw new Error(`png candidate query failed: ${error.message}`);
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

async function runPngPass() {
  if (!s3) {
    console.error('--pass=png needs the S3 API (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY): wrangler cannot HEAD an object, and the stored Content-Type is the whole question.');
    process.exit(1);
  }
  if (APPLY) {
    console.log('WARNING: --pass=png --apply REWRITES LIVE PREVIEW FILES in place (same key, PNG → WebP, only when smaller). There is no undo.');
  }
  const rows = await loadPngCandidates();
  // Only a preview this product made, under its own workspace: a rewrite in
  // place must never reach another kind of object by a stray key.
  const ownPreviewKey = (row, key) => {
    const ws = row.workspace_id;
    if (typeof ws !== 'string' || !/^[A-Za-z0-9-]+$/.test(ws)) return false;
    const prefix = `${ws}/previews/`;
    return key.startsWith(prefix) && /^[A-Za-z0-9-]+\.webp$/.test(key.slice(prefix.length));
  };
  const found = new Set();
  const refused = new Set();
  for (const r of rows) {
    for (const k of [r.preview_path, r.preview_sm_path]) {
      if (!k) continue;
      if (ownPreviewKey(r, k)) found.add(k);
      else if (!refused.has(k)) { refused.add(k); console.log(`  SKIP ${k} — not <workspace_id>/previews/<id>.webp`); }
    }
  }
  const keys = [...found].slice(0, LIMIT);
  if (refused.size) console.log(`${refused.size} preview key(s) are not of that shape and are left alone.`);
  console.log(`PNG previews: checking ${keys.length} preview object(s).`);
  const heads = await mapLimit(keys.map((k) => ({ r: { storage_path: k }, k })), 8, async ({ k }) => ({ k, head: await r2Head(k) }));
  const byType = {};
  const pngs = [];
  let missing = 0;
  for (const h of heads) {
    if (!h.head) { missing++; continue; }
    byType[h.head.type] = (byType[h.head.type] || 0) + 1;
    if (h.head.type === 'image/png') pngs.push({ key: h.k, bytes: h.head.bytes });
  }
  console.log(`Stored types: ${Object.entries(byType).map(([t, c]) => `${t} ${c}`).join(', ') || 'none'}${missing ? `; ${missing} missing in R2` : ''}.`);
  console.log(`Mode: S3 API; ${APPLY ? 'APPLY' : 'DRY-RUN'}.`);
  if (!APPLY) {
    const sample = pngs.slice(0, PNG_SAMPLE);
    let before = 0, after = 0;
    for (const p of sample) {
      const r = await toWebpSmaller(p.key, p.bytes);
      if (r.before == null) continue;
      before += r.before; after += Math.min(r.after, r.before);
    }
    if (sample.length && before > 0) {
      const ratio = after / before;
      const totalBytes = pngs.reduce((a, p) => a + p.bytes, 0);
      console.log(`Sample of ${sample.length} PNG(s): ${before} B → ${after} B (${Math.round((1 - ratio) * 100)}% smaller).`);
      console.log(`Estimated saving over all ${pngs.length} PNG(s) (${totalBytes} B stored): about ${Math.round(totalBytes * (1 - ratio))} B.`);
    } else {
      console.log('No PNG previews to estimate from.');
    }
    console.log(`Dry-run only — rerun with --apply to rewrite ${pngs.length} file(s).`);
    return;
  }
  const results = await mapLimit(pngs.map((p) => ({ r: { storage_path: p.key }, p })), CONCURRENCY, async ({ p }) => {
    const r = await toWebpSmaller(p.key, p.bytes);
    if (r.webp) await r2Put(p.key, r.webp, 'image/webp');
    return { row: { storage_path: p.key }, ...r };
  });
  let ok = 0, skipped = 0, saved = 0;
  for (const res of results) {
    if (res.webp) { ok++; saved += res.before - res.after; console.log(`  OK   ${res.row.storage_path} ${res.before} B → ${res.after} B`); }
    else { skipped++; console.log(`  SKIP ${res.row.storage_path} — ${res.skip}`); }
  }
  console.log(`\nDone: ${ok} rewritten, ${skipped} skipped, ${saved} B saved.`);
}

// ── Main ─────────────────────────────────────────────────────────────────

const workDir = await mkdtemp(join(tmpdir(), 'soleil-backfill-'));

if (PASS === 'xs' || PASS === 'png') {
  try { await (PASS === 'xs' ? runXsPass() : runPngPass()); }
  finally { await rm(workDir, { recursive: true, force: true }); }
  process.exit(0);
}

const all = await loadCandidates();
const pass1 = all.filter((r) => r.preview_path == null && RASTER_RE.test(r.storage_path));
const pass2 = all.filter((r) => r.preview_path != null && r.preview_sm_path == null);
const work = [
  ...(PASS !== '2' ? pass1.map((r) => ({ r, pass: 1 })) : []),
  ...(PASS !== '1' ? pass2.map((r) => ({ r, pass: 2 })) : []),
].slice(0, LIMIT);

console.log(`Candidates: ${pass1.length} need previews (pass 1), ${pass2.length} need sm variants (pass 2).`);
console.log(`Mode: R2 via ${s3 ? 'S3 API' : 'wrangler'}, DB ${db ? 'direct (service role)' : `→ ${SQL_OUT}`}; ${APPLY ? 'APPLY' : 'DRY-RUN'}${Number.isFinite(LIMIT) ? `, limit ${LIMIT}` : ''}.`);

if (!APPLY) {
  for (const { r, pass } of work) {
    console.log(`  [pass ${pass}] ${r.storage_path}  (${r.width ?? '?'}×${r.height ?? '?'}${pass === 2 ? `, preview ${r.preview_w}×${r.preview_h}` : ''})`);
  }
  console.log(`Dry-run only — rerun with --apply to generate ${work.length} item(s).`);
  await rm(workDir, { recursive: true, force: true });
  process.exit(0);
}

const results = await mapLimit(work, CONCURRENCY, ({ r, pass }) =>
  (pass === 1 ? processPass1(r) : processPass2(r)));

let ok = 0, skipped = 0;
for (const res of results) {
  if (res.skip) {
    skipped++;
    console.log(`  SKIP ${res.row.storage_path} — ${res.skip}`);
    continue;
  }
  ok++;
  console.log(`  OK   ${res.row.storage_path} → ${res.lg ? `lg ${res.lg.w}×${res.lg.h}` : 'no lg (small)'}${res.sm ? `, sm ${res.sm.w}×${res.sm.h}` : ''}${res.blur ? ', blur' : ''}`);
  if (db) await stampDb(res);
  else sqlStmts.push(`-- ${res.row.storage_path}`, ...stampSql(res));
}

if (!db && sqlStmts.length) {
  await writeFile(SQL_OUT, sqlStmts.join('\n') + '\n');
  console.log(`\nWrote ${sqlStmts.length} statements to ${SQL_OUT} — apply them (service role / MCP) to finish.`);
}
console.log(`\nDone: ${ok} processed, ${skipped} skipped.`);
await rm(workDir, { recursive: true, force: true });
