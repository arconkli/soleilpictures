// adminPostsMigration.test.mjs — 0840 keeps where the admin Posts tab reads
// from (a private page address and a push topic) out of every client's reach.
//
//   node --test src/lib/adminPostsMigration.test.mjs
//
// What this guards:
//   * the table is a single row, RLS on, every grant revoked, no policy and no
//     grant: nothing reads it but the definer function;
//   * admin_posts_source() is security definer with a pinned search_path and
//     checks _require_admin() before it selects;
//   * the 0311 habit: execute closed to public and anon, open to authenticated
//     and service_role, and the file proves it;
//   * the address must be https with a trailing slash, the topic a plain
//     restricted charset;
//   * the 0840 prefix is used once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { MIGRATIONS_DIR } from './migrationText.mjs';

const FILE = '0840_admin_posts_source.sql';
const sql = readFileSync(join(MIGRATIONS_DIR, FILE), 'utf8');
const code = sql.replace(/--[^\n]*/g, '');

const fnBody = () => {
  const at = code.indexOf('function public.admin_posts_source(');
  assert.ok(at >= 0, 'admin_posts_source is defined');
  const open = code.indexOf('$$', at);
  return code.slice(open + 2, code.indexOf('$$', open + 2));
};

test('the table is locked down: RLS on, all grants revoked, no policy, no grant', () => {
  assert.match(code, /alter table public\.admin_posts_source enable row level security;/);
  assert.match(code, /revoke all on table public\.admin_posts_source from public, anon, authenticated;/);
  assert.ok(!/create\s+policy/i.test(code), 'no policy');
  assert.ok(!/\bgrant\b[^;]*\bon\s+(table\s+)?public\.admin_posts_source\b/i.test(code), 'no grant on the table');
});

test('the table holds one row', () => {
  assert.match(code, /id boolean primary key default true check \(id\)/);
});

test('the address must be https with a trailing slash, the topic a restricted charset', () => {
  assert.match(code, /base text not null check \(base ~ '\^https:\/\/\[\^\\s\]\+\/\$'\)/);
  assert.match(code, /topic text not null check \(topic ~ '\^\[A-Za-z0-9_-\]\{1,64\}\$'\)/);
});

test('admin_posts_source() is a definer with a pinned search_path that checks admin first', () => {
  const head = code.slice(code.indexOf('function public.admin_posts_source('), code.indexOf('$$'));
  assert.match(head, /security definer/);
  assert.match(head, /set search_path\s*=/);
  const body = fnBody();
  const admin = body.indexOf('public._require_admin()');
  const select = body.search(/\bselect\b/);
  assert.ok(admin >= 0, 'calls _require_admin');
  assert.ok(select >= 0 && admin < select, '_require_admin comes before the select');
});

test('execute is closed to public and anon, open to authenticated and service_role', () => {
  assert.ok(code.includes('revoke execute on function public.admin_posts_source() from public, anon;'));
  assert.ok(code.includes('grant execute on function public.admin_posts_source() to authenticated, service_role;'));
});

test('the file proves its grants', () => {
  const tail = code.slice(code.lastIndexOf('do $$'));
  assert.match(tail, /has_function_privilege\('anon', 'public\.admin_posts_source\(\)', 'execute'\)/);
  assert.match(tail, /has_function_privilege\('authenticated', 'public\.admin_posts_source\(\)', 'execute'\)/);
  assert.match(tail, /has_function_privilege\('service_role', 'public\.admin_posts_source\(\)', 'execute'\)/);
  assert.match(tail, /has_table_privilege\('anon', 'public\.admin_posts_source', 'select'\)/);
  assert.match(tail, /has_table_privilege\('authenticated', 'public\.admin_posts_source', 'select'\)/);
});

test('no other migration uses the 0840 prefix', () => {
  const same = readdirSync(MIGRATIONS_DIR).filter((f) => f.startsWith('0840_'));
  assert.deepEqual(same, [FILE]);
});
