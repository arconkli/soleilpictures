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
//   --native-webp   also re-encode ≤1280px sources at native size when the
//                   webp saves ≥20% bytes (floor 320px) — mirrors the client
//                   rule added 2026-06-11 in uploads.js. Without it, ≤1280px
//                   byte-heavy originals (most of the legacy corpus) only get
//                   blur hashes and keep shipping multi-hundred-KB originals.
//
// Candidates JSON shape (array): { id, storage_path, workspace_id, board_id,
//   width, height, preview_path, preview_w, preview_h }

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
const PASS = String(args.pass || 'all');   // '1' | '2' | 'all'
const SQL_OUT = args['sql-out'] || 'backfill-stamps.sql';
const CONCURRENCY = 4;
// --native-webp: keep the rule in lockstep with uploads.js
// (NATIVE_WEBP_MIN_EDGE / NATIVE_WEBP_MAX_RATIO there).
const NATIVE_WEBP = !!args['native-webp'];
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

async function loadCandidates() {
  if (args.candidates) {
    return JSON.parse(await readFile(args.candidates, 'utf8'));
  }
  if (!db) {
    console.error('No SUPABASE_SERVICE_ROLE_KEY and no --candidates=<json>. Provide one.');
    process.exit(1);
  }
  const { data, error } = await db.from('images')
    .select('id, storage_path, workspace_id, board_id, width, height, preview_path, preview_w, preview_h, preview_sm_path')
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

// ── Main ─────────────────────────────────────────────────────────────────

const workDir = await mkdtemp(join(tmpdir(), 'soleil-backfill-'));

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
