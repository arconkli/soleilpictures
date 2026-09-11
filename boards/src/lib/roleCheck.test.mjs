// boards/src/lib/roleCheck.test.mjs
//
// Phase 0 of the enterprise work closes holes the organization layer would
// inherit. Each assertion here names the hole and the migration that closes
// it, and reads the LATEST migration text so a later rewrite that reopens one
// fails loudly instead of silently.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MIGRATIONS_DIR, migrationFiles, latestDefinition, latestPolicy, latestMatch, duplicatePrefixes } from './migrationText.mjs';

const fileNamed = (prefix) => migrationFiles().find(f => f.startsWith(prefix));
const textOf = (prefix) => readFileSync(join(MIGRATIONS_DIR, fileNamed(prefix)), 'utf8');

test('0317: workspaces UPDATE is column-scoped and never includes created_by', () => {
  const sql = textOf('0317');
  assert.match(sql, /revoke update on public\.workspaces from anon, authenticated;/);
  const grant = /grant update \(([^)]*)\) on public\.workspaces to authenticated;/i.exec(sql);
  assert.ok(grant, '0317 must grant an explicit column list on workspaces');
  const cols = grant[1].split(',').map(s => s.trim());
  assert.deepEqual(cols.sort(), ['name', 'settings']);
});

test('0317: boards column grant drops id, workspace_id and created_by, keeps day_types', () => {
  const sql = textOf('0317');
  const grant = /grant update \(([^)]*)\) on public\.boards to authenticated, anon;/i.exec(sql);
  assert.ok(grant, '0317 must re-issue the boards column grant to authenticated, anon');
  const cols = grant[1].split(',').map(s => s.trim());
  for (const banned of ['id', 'workspace_id', 'created_by']) assert.ok(!cols.includes(banned), `boards grant must not include ${banned}`);
  assert.ok(cols.includes('day_types'), 'boards grant must keep day_types (0247)');
  assert.ok(cols.includes('parent_board_id'), 'parent_board_id stays granted; the 0118 policy governs it');
});

test('no migration after 0316 grants id/workspace_id/created_by on boards or created_by/org_id on workspaces', () => {
  for (const f of migrationFiles().filter(f => Number(f.slice(0, 4)) >= 317)) {
    const sql = readFileSync(join(MIGRATIONS_DIR, f), 'utf8');
    for (const m of sql.matchAll(/grant update \(([^)]*)\) on public\.(boards|workspaces)/gi)) {
      const cols = m[1].split(',').map(s => s.trim());
      const banned = m[2] === 'boards' ? ['id', 'workspace_id', 'created_by'] : ['created_by', 'org_id', 'id'];
      for (const b of banned) assert.ok(!cols.includes(b), `${f} grants ${b} on ${m[2]}`);
    }
  }
});

test('0317: public_share_links is read-only to client roles', () => {
  const sql = textOf('0317');
  assert.match(sql, /revoke insert, update, delete on public\.public_share_links from anon, authenticated;/);
  assert.match(sql, /drop policy if exists "public_links manage by owner" on public\.public_share_links;/);
  const p = latestPolicy('public_links read by owner');
  assert.ok(p && p.file.startsWith('0317'), 'select-only owner policy must be in 0317');
  assert.match(p.body, /for select/i);
});

test('0317: formalises the drifted ai_tagger_enabled column without changing it', () => {
  assert.match(textOf('0317'), /alter table public\.workspaces\s+add column if not exists ai_tagger_enabled boolean;/);
});

test('no duplicate migration prefixes from 0317 on', () => {
  const dupes = duplicatePrefixes().filter(p => Number(p) >= 317);
  assert.deepEqual(dupes, [], `duplicated prefixes: ${dupes.join(', ')}`);
});

test('0318: workspace_members.role is constrained and the CHECK includes service', () => {
  const sql = textOf('0318');
  const m = /check \(role in \(([^)]*)\)\)/i.exec(sql);
  assert.ok(m, '0318 must add a role CHECK');
  const vals = m[1].split(',').map(s => s.trim().replace(/'/g, ''));
  assert.deepEqual(vals.sort(), ['admin', 'editor', 'owner', 'service', 'viewer']);
  assert.match(sql, /where role not in \(/i, '0318 must pre-assert live values before adding the CHECK');
});

test('0318: the allowed writer set is stated once and both write predicates use it', () => {
  const canWrite = latestDefinition('_workspace_member_can_write');
  assert.ok(canWrite && canWrite.file.startsWith('0318'));
  assert.match(canWrite.body, /in \('owner',\s*'admin',\s*'editor',\s*'service'\)/);
  for (const fn of ['can_write_workspace', 'can_write_board']) {
    const def = latestDefinition(fn);
    assert.ok(def.file >= '0318', `${fn} latest definition must be 0318 or later, got ${def.file}`);
    assert.match(def.body, /_workspace_member_can_write\(/, `${fn} must route membership writes through _workspace_member_can_write`);
    assert.doesNotMatch(def.body, /\bis_workspace_member\(/, `${fn} must not use the role-blind is_workspace_member`);
    assert.match(def.body, /_actor_active\(\)/, `${fn} must carry the suspend gate`);
  }
});

test('0318: authorize_upload no longer ORs is_workspace_member back in', () => {
  const def = latestDefinition('authorize_upload');
  assert.ok(def.file >= '0318');
  assert.doesNotMatch(def.body, /or public\.is_workspace_member\(/);
  assert.match(def.body, /if not public\.can_write_workspace\(p_workspace_id\) then/);
});

test('0318: removing or leaving a workspace also removes that user\'s board shares there', () => {
  for (const fn of ['remove_workspace_member', 'leave_workspace']) {
    const def = latestDefinition(fn);
    assert.ok(def.file >= '0318', `${fn} must be re-emitted in 0318`);
    assert.match(def.body, /delete from board_shares[\s\S]*board_id in \(\s*select id from boards where workspace_id = p_workspace_id\s*\)/i,
      `${fn} must cascade to board_shares in that workspace`);
  }
});

test('0318: set_workspace_member_role exists, is owner-gated and only allows editor|viewer', () => {
  const def = latestDefinition('set_workspace_member_role');
  assert.ok(def && def.file.startsWith('0318'));
  assert.match(def.body, /p_role not in \('editor',\s*'viewer'\)/);
  assert.match(def.body, /created_by/);
  assert.match(textOf('0318'), /grant execute on function public\.set_workspace_member_role\(uuid, uuid, text\) to authenticated;/);
});

test('0318: invite_workspace_member keeps a viewer invite a viewer', () => {
  const def = latestDefinition('invite_workspace_member');
  assert.ok(def.file >= '0318');
  assert.match(def.body, /case when p_role = 'viewer' then 'viewer' else 'workspace' end/);
});

test('0318: comments insert goes through can_comment_board, which is at least can_read_board', () => {
  const p = latestPolicy('comments insert');
  assert.ok(p.file >= '0318');
  assert.match(p.body, /can_comment_board\(board_id\)/);
  const def = latestDefinition('can_comment_board');
  assert.match(def.body, /can_read_board\(p_board_id\)/);
});

test('0318: every _-prefixed helper is revoked from anon and authenticated', () => {
  const sql = textOf('0318');
  for (const fn of ['_actor_active()', '_workspace_member_role(uuid)', '_workspace_member_can_write(uuid)']) {
    assert.match(sql, new RegExp(`revoke all on function public\\.${fn.replace(/[()]/g, m => '\\' + m)} from public, anon, authenticated;`));
  }
});

test('0318: the pre-flight counts every population that loses access', () => {
  const sql = textOf('0318');
  assert.match(sql, /where role = 'viewer'/);
  assert.match(sql, /p\.banned_at is not null/);
  assert.match(sql, /p\.tier = 'waitlist'/);
});

test('0319: every read predicate carries the suspend gate', () => {
  for (const fn of ['can_read_board', 'my_readable_board_ids', 'my_workspace_ids']) {
    const def = latestDefinition(fn);
    assert.ok(def.file >= '0319', `${fn} must be re-emitted in 0319 or later, got ${def.file}`);
    assert.match(def.body, /_actor_active\(\)/, `${fn} lacks _actor_active()`);
  }
});

test('0319: the read predicates keep their anon grants (RLS evaluates them for anon SELECTs)', () => {
  const sql = textOf('0319');
  assert.match(sql, /grant execute on function public\.can_read_board\(uuid\) to anon, authenticated, service_role;/);
  assert.match(sql, /grant execute on function public\.my_readable_board_ids\(\) to anon, authenticated, service_role;/);
  assert.match(sql, /grant execute on function public\.my_workspace_ids\(\) to anon, authenticated, service_role;/);
});

test('0320: api_request_log rows outlive their token and user', () => {
  const sql = textOf('0320');
  assert.match(sql, /alter column token_id drop not null/i);
  assert.match(sql, /alter column user_id drop not null/i);
  assert.match(sql, /references public\.api_tokens\(id\) on delete set null not valid/i);
  assert.match(sql, /references auth\.users\(id\)\s+on delete set null not valid/i);
  assert.match(sql, /validate constraint api_request_log_token_id_fkey/i);
  assert.match(sql, /validate constraint api_request_log_user_id_fkey/i);
  assert.match(sql, /add column if not exists actor_label text/);
  assert.match(sql, /add column if not exists ip inet/);
  assert.match(sql, /add column if not exists user_agent text/);
});

test('0320: api_log_request is a single 10-argument function, service-role only', () => {
  const sql = textOf('0320');
  assert.match(sql, /drop function if exists public\.api_log_request\(uuid, uuid, text, text, integer, integer, uuid, text\);/);
  const def = latestDefinition('api_log_request');
  assert.ok(def.file.startsWith('0320'));
  assert.match(def.body, /p_ip\s+inet default null/);
  assert.match(def.body, /p_ua\s+text default null/);
  assert.match(def.body, /actor_label/);
  assert.match(sql, /revoke all on function public\.api_log_request\(uuid, uuid, text, text, integer, integer, uuid, text, inet, text\)\s+from public, anon, authenticated;/);
});

test('worker passes the client IP and user agent to api_log_request', () => {
  const src = readFileSync(new URL('../worker-api.js', import.meta.url), 'utf8');
  const call = src.slice(src.indexOf("scoutRpc(env, 'api_log_request'"), src.indexOf("scoutRpc(env, 'api_log_request'") + 600);
  assert.match(call, /p_ip: request\.headers\.get\('cf-connecting-ip'\) \|\| null/);
  assert.match(call, /p_ua: \(request\.headers\.get\('user-agent'\) \|\| ''\)\.slice\(0, 200\) \|\| null/);
});

test('0318: both write predicates are re-granted explicitly, so the post-condition proves what the file did', () => {
  const sql = textOf('0318');
  for (const fn of ['can_write_board', 'can_write_workspace']) {
    assert.match(sql, new RegExp(`revoke all on function public\\.${fn}\\(uuid\\) from public;`),
      `${fn} must be revoked from public before the explicit re-grant`);
    assert.match(sql, new RegExp(`grant execute on function public\\.${fn}\\(uuid\\) to anon, authenticated, service_role;`),
      `${fn} must be granted to anon, authenticated, service_role in the migration text`);
  }
});

const ANCILLARY_WRITE_POLICIES = [
  ['doc backlinks write', 'doc_backlinks', 'source_workspace_id'],
  ['doc_page_index write', 'doc_page_index', 'workspace_id'],
  ['entity_aliases write', 'entity_aliases', 'workspace_id'],
  ['entity_ignore_terms write', 'entity_ignore_terms', 'workspace_id'],
  ['grid_layouts insert', 'grid_layouts', 'workspace_id'],
];

test('0321: exists exactly once', () => {
  const f = fileNamed('0321');
  assert.ok(f, 'a 0321 migration must exist');
  assert.equal(f, '0321_ancillary_write_policies.sql');
  assert.ok(!duplicatePrefixes().includes('0321'), 'the 0321 prefix is duplicated');
});

test('0321: the five ancillary write policies gate on can_write_workspace, reads and boards untouched', () => {
  const sql = textOf('0321');
  for (const [name, table, col] of ANCILLARY_WRITE_POLICIES) {
    const p = latestPolicy(name);
    assert.ok(p && p.file.startsWith('0321'), `${name} must be (re)defined in 0321, latest is ${p && p.file}`);
    assert.match(p.body, new RegExp(`on public\\.${table}\\b`), `${name} must be on public.${table}`);
    assert.match(p.body, new RegExp(`public\\.can_write_workspace\\(${col}\\)`), `${name} must gate on can_write_workspace(${col})`);
    assert.doesNotMatch(p.body, /\bis_workspace_member\(/, `${name} must not gate on the role-blind is_workspace_member`);
    assert.match(sql, new RegExp(`drop policy if exists "${name}" on public\\.${table};`), `${name} must be dropped before re-creation`);
  }
  for (const name of ['doc backlinks write', 'doc_page_index write', 'entity_aliases write', 'entity_ignore_terms write']) {
    assert.match(latestPolicy(name).body, /for all/i, `${name} keeps FOR ALL so the separate read policy still admits viewers`);
  }
  assert.match(latestPolicy('grid_layouts insert').body, /for insert to authenticated/i);
  assert.match(latestPolicy('grid_layouts insert').body, /created_by = auth\.uid\(\)\s+and \(\s+scope = 'user'/);
  // the boards INSERT policy already gates on can_write_workspace (live, verified);
  // 0321 must not restate it or touch any boards policy
  assert.doesNotMatch(sql, /\bon (public\.)?boards\b/i, '0321 must not touch a boards policy');
  assert.doesNotMatch(sql, /create (or replace )?function/i, '0321 must not change any function');
  // the read policies are what keeps a viewer reading once the FOR ALL policies
  // narrow; 0321 may name them in a comment but must neither drop nor re-create
  // one, so their latest definition stays in the migration that wrote it
  for (const [name, origin] of [
    ['doc backlinks read', '0004'],
    ['doc_page_index read', '0022'],
    ['entity_aliases read', '0022'],
    ['entity_ignore_terms read', '0022'],
    ['grid_layouts select', '0265'],
    ['grid_layouts update', '0265'],
  ]) {
    assert.doesNotMatch(sql, new RegExp(`(create|drop)\\s+policy[^\\n]*"${name}"`, 'i'),
      `0321 must not drop or re-create the ${name} policy`);
    assert.ok(latestPolicy(name).file.startsWith(origin),
      `${name} must still be defined by ${origin}, latest is ${latestPolicy(name).file}`);
  }
});

test('0321: latestPolicy resolves doc_page_index write to the 0321 file', () => {
  const p = latestPolicy('doc_page_index write');
  assert.ok(p, 'policy not found in any migration');
  assert.equal(p.file, '0321_ancillary_write_policies.sql');
});
