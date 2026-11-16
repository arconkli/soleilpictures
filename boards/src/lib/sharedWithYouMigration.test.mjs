// 0901: Shared with you. Text only, no Postgres.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MIGRATIONS_DIR } from './migrationText.mjs';

const FILE = '0901_shared_with_you.sql';
const code = (s) => s.replace(/--[^\n]*/g, '');   // comments are not wiring
const sql = () => code(readFileSync(join(MIGRATIONS_DIR, FILE), 'utf8'));
const FNS = [
  ['list_shared_board_meta', ''],
  ['mark_shared_board_opened', 'uuid'],
  ['hide_shared_board', 'uuid, boolean'],
  ['list_my_board_shares', ''],
];
// The create statement of one function, up to the end of its dollar quote.
const body = (name) => {
  const m = sql().match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\$\\$;`));
  assert.ok(m, `no definition of ${name}`);
  return m[0];
};
const esc = (s) => s.replace(/[().]/g, '\\$&');

test('board_share_seen: RLS on, nothing granted to the app', () => {
  const s = sql();
  assert.match(s, /create table if not exists public\.board_share_seen/);
  assert.match(s, /alter table public\.board_share_seen enable row level security/);
  assert.match(s, /revoke all on table public\.board_share_seen from public, anon, authenticated/);
  assert.doesNotMatch(s, /grant\s+[a-z, ]+\s+on\s+(table\s+)?public\.board_share_seen/i);
});

test('every function is security definer with a pinned search_path', () => {
  for (const [name] of FNS) {
    const b = body(name);
    const head = b.slice(0, b.indexOf('$$'));
    assert.match(head, /security definer/, name);
    assert.match(head, /set search_path = public/, name);
  }
});

test('every function is revoked from public and anon, granted to authenticated', () => {
  const s = sql();
  for (const [name, args] of FNS) {
    const sig = esc(`public.${name}(${args})`);
    assert.match(s, new RegExp(`revoke all on function ${sig} from public, anon`), `revoke ${name}`);
    assert.match(s, new RegExp(`grant execute on function ${sig} to authenticated`), `grant ${name}`);
    assert.doesNotMatch(s, new RegExp(`grant execute on function ${sig} to (anon|public)`), name);
  }
});

test('the proof block names all four functions and the table', () => {
  const s = sql();
  const proof = s.slice(s.lastIndexOf('do $$'));
  for (const [name, args] of FNS) assert.ok(proof.includes(`public.${name}(${args})`), name);
  assert.match(proof, /has_function_privilege\('anon'/);
  assert.match(proof, /has_function_privilege\('authenticated'/);
  assert.match(proof, /has_table_privilege\([^)]*public\.board_share_seen/);
});

test('nothing existing is dropped', () => {
  assert.doesNotMatch(sql(), /\bdrop\s+(function|table|policy|column|trigger|index)\b/i);
});

test('list_my_board_shares never reads an email', () => {
  assert.doesNotMatch(body('list_my_board_shares'), /email/i);
});

test('a seen row counts only for the share it came after', () => {
  const b = body('list_shared_board_meta');
  assert.match(b, /v\.opened_at >= s\.created_at/);
  assert.match(b, /v\.hidden_at >= s\.created_at/);
});

test('list_shared_board_meta lists the same roots as list_shared_boards', () => {
  const b = body('list_shared_board_meta');
  assert.match(b, /b\.deleted_at is null/);
  assert.match(b, /not is_workspace_member\(b\.workspace_id\)/);
  assert.match(b, /s\.user_id = auth\.uid\(\)/);
});
