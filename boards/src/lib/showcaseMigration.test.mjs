// showcaseMigration.test.mjs — 0820 gives the boards engine its library.
//
//   node --test src/lib/showcaseMigration.test.mjs
//
// What this guards:
//   * the 0311 habit: showcase_library and showcase_decide are admin-gated,
//     closed to PUBLIC and anon, open to authenticated and service_role; the
//     signature helper is closed to all three; the file proves it;
//   * both tables are RLS-on, policy-free and closed to every client role;
//   * the status check, the cascade and the slug rule;
//   * the signature derivation mirrors worker-showcase.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MIGRATIONS_DIR, latestDefinition, duplicatePrefixes } from './migrationText.mjs';

const FILE = '0820_showcase_library.sql';
const PATH = join(MIGRATIONS_DIR, FILE);
const src = existsSync(PATH) ? readFileSync(PATH, 'utf8') : '';
const code = src.replace(/--.*$/gm, '');
// 0821 restates showcase_library (each board's cluster) and adds the badge's count.
const NEXT = '0821_showcase_library_cluster.sql';
const nextSrc = existsSync(join(MIGRATIONS_DIR, NEXT)) ? readFileSync(join(MIGRATIONS_DIR, NEXT), 'utf8') : '';
const nextCode = nextSrc.replace(/--.*$/gm, '');
const worker = readFileSync(new URL('../worker-showcase.js', import.meta.url), 'utf8');

const fnBody = (name) => {
  const m = code.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?as (\\$[a-z]*\\$)([\\s\\S]*?)\\1;`));
  assert.ok(m, `${FILE} defines ${name}`);
  return m[2];
};

test('0820 exists, runs in one transaction and is the latest word on its functions', () => {
  assert.ok(src, `${FILE} is in supabase/migrations`);
  assert.match(code, /^\s*begin;/m);
  assert.match(code, /set local lock_timeout = '3s';/);
  assert.match(code, /notify pgrst, 'reload schema';\s*commit;\s*$/);
  assert.equal(latestDefinition('showcase_library')?.file, NEXT);
  assert.equal(latestDefinition('showcase_decide')?.file, FILE);
  assert.equal(latestDefinition('showcase_waiting')?.file, NEXT);
  assert.ok(!duplicatePrefixes().some((d) => String(d).includes('0820')), 'another migration is numbered 0820');
});

test('both tables are RLS-on, policy-free and closed to every client role', () => {
  assert.doesNotMatch(code, /create\s+policy/i);
  for (const t of ['showcase_boards', 'showcase_runs']) {
    assert.match(code, new RegExp(`alter table public\\.${t} enable row level security;`));
    assert.ok(code.includes(`revoke all on table public.${t} from public, anon, authenticated;`), `${t} is revoked`);
  }
});

test('showcase_boards: status, cascade and slug rules', () => {
  const t = code.match(/create table if not exists public\.showcase_boards \(([\s\S]*?)\n\);/);
  assert.ok(t, 'showcase_boards is created');
  assert.match(t[1], /status\s+text not null default 'new' check \(status in \('new', 'ok', 'skipped'\)\)/);
  assert.match(t[1], /board_id\s+uuid primary key references public\.boards\(id\) on delete cascade/);
  assert.match(t[1], /slug\s+text not null unique\s+check \(slug ~ '\^\[a-z0-9\]\+\(-\[a-z0-9\]\+\)\*\$'/);
});

test('the two RPCs are admin-gated definers pinned to public, closed to anon', () => {
  for (const [name, sig] of [['showcase_library', 'showcase_library()'], ['showcase_decide', 'showcase_decide(uuid, text)']]) {
    const def = code.match(new RegExp(`create or replace function public\\.${name}\\([^)]*\\)[\\s\\S]*?as \\$fn\\$`));
    assert.ok(def, `${name} is defined`);
    assert.match(def[0], /security definer/);
    assert.match(def[0], /set search_path = 'public'/);
    assert.match(fnBody(name), /^\s*declare[\s\S]*?begin\s*perform public\._require_admin\(\);/, `${name}: the gate comes first`);
    assert.ok(code.includes(`revoke execute on function public.${sig} from public, anon;`), `${sig} revoked`);
    assert.ok(code.includes(`grant execute on function public.${sig} to authenticated, service_role;`), `${sig} granted`);
  }
});

test('the signature helper is closed to every client role and mirrors the Worker', () => {
  assert.ok(code.includes('revoke execute on function public._showcase_shot_sig(text) from public, anon, authenticated;'));
  const body = fnBody('_showcase_shot_sig');
  assert.match(body, /from public\.app_config where key = 'email_thumb_hmac'/);
  assert.match(body, /'showcase-shot:' \|\|/);
  assert.match(body, /':email-thumb-v1'/);
  assert.match(body, /'sha256'/);
  assert.ok(worker.includes('showcase-shot:${boardId}/${file}'), 'the Worker signs the same message');
  assert.ok(worker.includes(':email-thumb-v1'), 'the Worker derives the key the same way');
});

test('showcase_decide takes only ok, skipped or new, and new clears the decision', () => {
  const body = fnBody('showcase_decide').replace(/\s+/g, ' ');
  assert.match(body, /p_status not in \('ok', 'skipped', 'new'\)/);
  assert.match(body, /decided_at = case when p_status = 'new' then null else now\(\) end/);
  assert.match(body, /decided_by = case when p_status = 'new' then null else auth\.uid\(\) end/);
});

test('the file proves its own grants and table lockdown', () => {
  const proof = code.match(/do \$\$([\s\S]*?)\$\$;/);
  assert.ok(proof, 'the file proves its grants');
  const p = proof[1];
  for (const f of ['public.showcase_library()', 'public.showcase_decide(uuid, text)']) {
    assert.ok(p.includes(`'${f}'`), `the proof checks ${f}`);
  }
  assert.match(p, /has_function_privilege\('anon', f, 'execute'\)/);
  assert.match(p, /has_function_privilege\('authenticated', f, 'execute'\)/);
  assert.match(p, /has_function_privilege\('service_role', f, 'execute'\)/);
  assert.match(p, /has_function_privilege\('anon', 'public\._showcase_shot_sig\(text\)', 'execute'\)/);
  assert.match(p, /has_function_privilege\('authenticated', 'public\._showcase_shot_sig\(text\)', 'execute'\)/);
  assert.ok(p.includes("'public.showcase_boards'") && p.includes("'public.showcase_runs'"));
  assert.match(p, /has_table_privilege\('anon', t, 'select'\)/);
  assert.match(p, /relrowsecurity from pg_class/);
});

test('0821: the library names each board\'s cluster, and the badge count is admin only', () => {
  assert.ok(nextSrc, `${NEXT} is in supabase/migrations`);
  assert.match(nextCode, /^\s*begin;/m);
  assert.match(nextCode, /notify pgrst, 'reload schema';\s*commit;\s*$/);
  assert.match(nextCode, /'cluster', pb\.name/);
  assert.match(nextCode, /left join public\.boards pb on pb\.id = b\.parent_board_id/);
  for (const [name, sig] of [['showcase_library', 'showcase_library()'], ['showcase_waiting', 'showcase_waiting()']]) {
    const def = nextCode.match(new RegExp(`create or replace function public\\.${name}\\(\\)[\\s\\S]*?as \\$fn\\$([\\s\\S]*?)\\$fn\\$;`));
    assert.ok(def, `${name} is defined`);
    assert.match(def[0], /security definer/);
    assert.match(def[0], /set search_path = 'public'/);
    assert.match(def[1], /^\s*(declare[\s\S]*?)?begin\s*perform public\._require_admin\(\);/, `${name}: the gate comes first`);
    assert.ok(nextCode.includes(`revoke execute on function public.${sig} from public, anon;`), `${sig} revoked`);
    assert.ok(nextCode.includes(`grant execute on function public.${sig} to authenticated, service_role;`), `${sig} granted`);
    assert.match(nextCode, new RegExp(`has_function_privilege\\('anon', f, 'execute'\\)`));
    assert.ok(nextCode.includes(`'public.${sig}'`), `the proof block names ${sig}`);
  }
  // 0820's signed links carry through unchanged.
  assert.match(nextCode, /public\._showcase_shot_sig\(s\.board_id \|\| '\/' \|\| \(shot->>'file'\)\)/);
});
