// 0899: set_image_variant records only preview keys in the picture's own
// workspace's previews folder. It is SECURITY DEFINER, so the images insert
// policy (0427/0898) never sees its writes; without this check a writer could
// record another workspace's key as a preview of their own picture and the
// share bundles would sign it. Static checks on the SQL text: the body is
// 0898's plus the check, the check covers all three keys and runs before any
// row is written, its pattern accepts every key shape in use and nothing else,
// and the grant proof is there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MIGRATIONS_DIR } from './migrationText.mjs';

const F = '0899_image_variant_paths_own_workspace.sql';
const sql = readFileSync(join(MIGRATIONS_DIR, F), 'utf8');
const prev = readFileSync(join(MIGRATIONS_DIR, '0898_quick_picture_tier.sql'), 'utf8');
const code = (s) => s.replace(/--[^\n]*/g, '');
const squash = (s) => code(s).replace(/\s+/g, ' ').trim();

const fnText = (s) => {
  const m = code(s).match(/create or replace function public\.set_image_variant\([\s\S]*?\$function\$;/);
  assert.ok(m, 'set_image_variant must be defined');
  return m[0];
};
const fn = fnText(sql);

const CHECK = /if exists \(\s*select 1\s+from unnest\(array\[p_preview_path, p_preview_sm_path, p_preview_xs_path\]\) as k[\s\S]*?end if;/;

test('0899 is two numbered parts, in order, each under 5 KB', () => {
  const parts = sql.split(/^-- ── part (\d+) ──$/m).slice(1);
  assert.deepEqual([parts[0], parts[2]], ['1', '2']);
  assert.equal(parts.length, 4);
  for (const text of [parts[1], parts[3]]) assert.ok(Buffer.byteLength(text) < 5000);
  assert.match(parts[1], /create or replace function public\.set_image_variant/);
  assert.match(parts[3], /has_function_privilege/);
});

test('the function is 0898\'s, same signature and body, plus the key check', () => {
  const without = fn.replace(CHECK, '');
  assert.notEqual(without, fn, 'the key check must be in the function');
  assert.equal(squash(without), squash(fnText(prev)));
});

test('the check covers all three keys and runs after the authorization, before any row is written', () => {
  const check = fn.match(CHECK)[0];
  assert.match(check, /v_img\.workspace_id::text \|\| '\/previews\//);
  assert.match(check, /not coalesce\(/);
  assert.match(check, /errcode = 'insufficient_privilege'/);
  const at = fn.indexOf(check);
  assert.ok(fn.indexOf('not authorized for') < at);
  assert.ok(at < fn.indexOf('insert into public.images'));
  assert.ok(at < fn.indexOf('update public.images set'));
});

test('the pattern takes every key shape in use and refuses the rest', () => {
  const pat = fn.match(/'\/previews\/(\[[^\]]+\]\[[^\]]+\]\*\$)'/);
  assert.ok(pat, 'the previews pattern');
  const ws = '0b7d2c1e-9a55-4f0e-8a3b-2f6c1d9e7a10';
  const other = '5e1f7a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b';
  const re = new RegExp(`^${ws}/previews/${pat[1]}`);
  const ok = [
    `${ws}/previews/3f2a9c4e-1b7d-4e8a-9c0f-5d6e7f8a9b0c.webp`,            // the app, the upload route
    `${ws}/previews/3f2a9c4e-1b7d-4e8a-9c0f-5d6e7f8a9b0c-xs.webp`,         // the backfill
    `${ws}/previews/3f2a9c4e-1b7d-4e8a-9c0f-5d6e7f8a9b0c.psd.view_sm.webp`, // the converter
  ];
  const bad = [
    `${other}/previews/3f2a9c4e.webp`,          // another workspace
    `${ws}/3f2a9c4e-1b7d-4e8a-9c0f-5d6e7f8a9b0c.png`, // an original
    `${ws}/thumbs/3f2a9c4e.webp`,               // a cluster thumbnail
    `${ws}/previews/link/3f2a9c4e.jpg`,         // a kept link picture is never a preview
    `${ws}/previews/../${other}/x.webp`,
    `${ws}/previews/.hidden.webp`,
    `${ws}/previews/`,
    `x${ws}/previews/a.webp`,
  ];
  for (const k of ok) assert.ok(re.test(k), k);
  for (const k of bad) assert.ok(!re.test(k), k);
});

test('grants are restated and proved, and only one set_image_variant exists', () => {
  const sig = 'public.set_image_variant(text,text,text,integer,integer,text,integer,integer,text,integer,integer)';
  const c = code(sql);
  assert.ok(c.includes(`revoke all on function ${sig} from public, anon;`));
  assert.ok(c.includes(`grant execute on function ${sig} to authenticated, service_role;`));
  const proof = c.slice(c.indexOf('do $$'));
  assert.ok(proof.includes(`'${sig}'::regprocedure`));
  for (const role of ['anon', 'authenticated', 'service_role']) {
    assert.match(proof, new RegExp(`has_function_privilege\\('${role}', v_fn, 'execute'\\)`));
  }
  assert.match(proof, /raise exception '0899: grants are wrong on set_image_variant'/);
  assert.match(proof, /raise exception '0899: set_image_variant does not check its preview keys'/);
  assert.match(proof, /raise exception '0899: more than one set_image_variant exists'/);
});
