// 0898: the "quick" picture tier (images.preview_xs_path / _w / _h, a ~256px
// WebP). Static checks on the SQL text: the columns, the insert policy's key
// check, set_image_variant's new signature, every function that has to know the
// new key, the bundles' meta keys, and the grant proof. The migration is applied
// by hand in parts, so each part must stay small and stand on its own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MIGRATIONS_DIR } from './migrationText.mjs';

const F = '0898_quick_picture_tier.sql';
const sql = readFileSync(join(MIGRATIONS_DIR, F), 'utf8');
const code = (s) => s.replace(/--[^\n]*/g, '');   // comments are not wiring
const c = code(sql);

const PART_MARK = /^-- ── part (\d+) ──$/gm;
const parts = sql.split(PART_MARK).slice(1);       // [n, text, n, text, ...]
const partList = [];
for (let i = 0; i < parts.length; i += 2) partList.push({ n: Number(parts[i]), text: parts[i + 1] });

const FUNCTIONS = [
  'set_image_variant',
  '_tg_tombstone_r2_keys',
  'find_orphaned_r2_tombstones',
  'find_history_safe_orphan_images',
  'get_share_bundle',
  'mcp_draft_keep_view',
  'get_public_board_bundle',
];

// One function's text: from its create to the closing $function$;
const fnText = (name) => {
  const m = c.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\$function\\$;`));
  assert.ok(m, `${F} must define ${name}`);
  return m[0];
};

test('0898 is ten numbered parts, in order', () => {
  assert.deepEqual(partList.map((p) => p.n), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

test('every part is under 5 KB', () => {
  for (const p of partList) {
    const bytes = Buffer.byteLength(p.text, 'utf8');
    assert.ok(bytes < 5 * 1024, `part ${p.n} is ${bytes} bytes`);
  }
});

test('the three columns are added to images, idempotently', () => {
  assert.match(c, /alter table public\.images\s+add column if not exists preview_xs_path text,\s+add column if not exists preview_xs_w integer,\s+add column if not exists preview_xs_h integer;/);
  for (const col of ['preview_xs_path', 'preview_xs_w', 'preview_xs_h']) {
    assert.match(c, new RegExp(`comment on column public\\.images\\.${col} is`), `${col} has a comment`);
  }
  assert.match(partList[0].text, /set local lock_timeout = '5s';/);
});

test('the images insert policy gains the preview_xs_path clause and its guard', () => {
  const part2 = code(partList[1].text);
  assert.match(part2, /alter policy "images insert" on public\.images/);
  assert.match(part2, /preview_xs_path is null\s+or preview_xs_path ~ \('\^' \|\| workspace_id::text \|\| '\/\[A-Za-z0-9_-\]\[A-Za-z0-9_\.-\]\*\(\/\[A-Za-z0-9_-\]\[A-Za-z0-9_\.-\]\*\)\*\$'\)/);
  for (const k of ['storage_path', 'preview_path', 'preview_sm_path', 'preview_xs_path']) {
    assert.ok(part2.includes(`${k} ~`), `the policy still constrains ${k}`);
    assert.ok(part2.includes(`v_check not like '%${k} ~%'`), `the guard checks ${k}`);
  }
  assert.match(part2, /can_write_workspace\(workspace_id\)/);
  assert.match(part2, /_board_in_workspace\(board_id, workspace_id\)/);
  assert.match(partList[1].text, /set local lock_timeout = '5s';/);
  assert.match(part2, /raise exception '0898:/);
});

test('the 8-argument set_image_variant is dropped and the new one takes the three xs params', () => {
  assert.match(c, /drop function if exists public\.set_image_variant\(text,text,text,integer,integer,text,integer,integer\);/);
  const f = fnText('set_image_variant');
  assert.match(f, /p_preview_xs_path text default null/);
  assert.match(f, /p_preview_xs_w integer default null/);
  assert.match(f, /p_preview_xs_h integer default null/);
  assert.match(f, /security definer/);
  assert.match(f, /set search_path to 'public'/);
  assert.match(f, /if p_preview_xs_path is not null then[\s\S]*?on conflict \(storage_path\) do nothing;/);
  assert.match(f, /preview_xs_path = coalesce\(p_preview_xs_path, preview_xs_path\)/);
  assert.match(f, /preview_xs_w\s+= coalesce\(p_preview_xs_w,\s+preview_xs_w\)/);
  assert.match(f, /preview_xs_h\s+= coalesce\(p_preview_xs_h,\s+preview_xs_h\)/);
  // the retention rule is the live one, untouched
  assert.match(f, /when coalesce\(p_preview_path, preview_path\) is not null\s+or greatest\(width, height\) <= 1280/);
  assert.match(c, /revoke all on function public\.set_image_variant\(text,text,text,integer,integer,text,integer,integer,text,integer,integer\) from public, anon;/);
  assert.match(c, /grant execute on function public\.set_image_variant\(text,text,text,integer,integer,text,integer,integer,text,integer,integer\) to authenticated, service_role;/);
});

test('each of the seven functions is defined here and mentions preview_xs_path', () => {
  for (const fn of FUNCTIONS) assert.ok(fnText(fn).includes('preview_xs_path'), `${fn} mentions preview_xs_path`);
});

test('the tombstone trigger and the reclaim check cover the new key', () => {
  assert.match(fnText('_tg_tombstone_r2_keys'), /array\[old\.storage_path, old\.preview_path, old\.preview_sm_path, old\.preview_xs_path\]/);
  assert.match(fnText('find_orphaned_r2_tombstones'), /i\.preview_xs_path = c\.storage_path/);
});

test('find_history_safe_orphan_images is dropped and re-created with preview_xs_path after preview_sm_path, grants restored', () => {
  assert.match(c, /drop function public\.find_history_safe_orphan_images\(integer, boolean\);/);
  const f = fnText('find_history_safe_orphan_images');
  assert.match(f, /returns table\(id uuid, storage_path text, preview_path text, preview_sm_path text, preview_xs_path text, workspace_id uuid/);
  assert.match(f, /i\.preview_sm_path, i\.preview_xs_path,/);
  assert.match(f, /cl\.preview_sm_path, cl\.preview_xs_path,/);
  assert.match(c, /revoke all on function public\.find_history_safe_orphan_images\(integer, boolean\) from public, anon, authenticated;/);
  assert.match(c, /grant execute on function public\.find_history_safe_orphan_images\(integer, boolean\) to service_role;/);
});

test('the three bundles hand out the xs key and carry exactly the agreed meta keys', () => {
  const META = ['blur', 'preview', 'preview_w', 'preview_h', 'preview_sm', 'preview_sm_w', 'preview_sm_h',
    'preview_xs', 'preview_xs_w', 'preview_xs_h', 'w', 'h'];
  for (const fn of ['get_share_bundle', 'mcp_draft_keep_view', 'get_public_board_bundle']) {
    const f = fnText(fn);
    const meta = f.match(/jsonb_build_object\(([\s\S]*?)\)\)?,?\s*(?:'\{\}'::jsonb)/);
    assert.ok(meta, `${fn}: image_meta object found`);
    const keys = [...meta[1].matchAll(/'([a-z_]+)'\s*,/g)].map((m) => m[1]);
    assert.deepEqual(keys, META, `${fn}: meta keys`);
    assert.ok(f.includes("'preview_xs_w'"), `${fn} has preview_xs_w`);
    assert.match(f, /'w',\s*(i\.)?width/, `${fn}: 'w' is images.width`);
    assert.match(f, /'h',\s*(i\.)?height/, `${fn}: 'h' is images.height`);
    assert.match(f, /select (i\.)?preview_xs_path( as k)? from (public\.)?images/, `${fn}: xs key unioned in`);
    assert.match(f, /\(blur_hash is not null or preview_path is not null\s+or preview_sm_path is not null or preview_xs_path is not null\)|\(i\.blur_hash is not null or i\.preview_path is not null\s+or i\.preview_sm_path is not null or i\.preview_xs_path is not null\)/,
      `${fn}: the meta filter admits sm / xs rows`);
  }
});

test('the proof block names every function and the old signature', () => {
  const proof = code(partList[9].text);
  assert.match(proof, /^\s*do \$\$/m);
  for (const fn of FUNCTIONS) assert.ok(proof.includes(`public.${fn}(`), `proof names ${fn}`);
  assert.match(proof, /public\.set_image_variant\(text,text,text,integer,integer,text,integer,integer,text,integer,integer\)/);
  assert.match(proof, /has_function_privilege\('anon'/);
  assert.match(proof, /has_function_privilege\('authenticated'/);
  assert.match(proof, /has_function_privilege\('service_role'/);
  assert.match(proof, /raise exception '0898: grants are wrong on %'/);
  assert.match(proof, /to_regprocedure\('public\.set_image_variant\(text,text,text,integer,integer,text,integer,integer\)'\) is not null/);
});

test('the public bundles stay open to signed-out callers and the rest stay closed (in the proof table)', () => {
  const proof = code(partList[9].text);
  const row = (fn) => proof.match(new RegExp(`'public\\.${fn}\\([^']*\\)',\\s*(true|false),\\s*(true|false),\\s*(true|false)`));
  const want = {
    set_image_variant: ['false', 'true', 'true'],
    _tg_tombstone_r2_keys: ['false', 'false', 'true'],
    find_orphaned_r2_tombstones: ['false', 'false', 'true'],
    find_history_safe_orphan_images: ['false', 'false', 'true'],
    get_share_bundle: ['true', 'true', 'true'],
    get_public_board_bundle: ['true', 'true', 'true'],
    mcp_draft_keep_view: ['false', 'false', 'true'],
  };
  for (const [fn, exp] of Object.entries(want)) {
    const m = row(fn);
    assert.ok(m, `proof row for ${fn}`);
    assert.deepEqual(m.slice(1), exp, `${fn} anon/authenticated/service_role`);
  }
});
