// 0896: list_shared_boards says who shared each cluster. Text only, no Postgres.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { latestDefinition, MIGRATIONS_DIR } from './migrationText.mjs';

const FILE = '0896_shared_boards_shared_by.sql';
const OLD = '0247_board_day_details.sql';
const code = (s) => s.replace(/--[^\n]*/g, '');   // comments are not wiring
const fileText = () => code(readFileSync(join(MIGRATIONS_DIR, FILE), 'utf8'));
const def = () => {
  const d = latestDefinition('list_shared_boards');
  assert.ok(d, 'no definition of list_shared_boards');
  return d;
};

// "name type" pairs of the returns table, comments dropped.
function columns(definition) {
  const m = code(definition).match(/returns\s+table\s*\(([\s\S]*?)\)\s*language/i);
  assert.ok(m, 'no returns table');
  return m[1].split(',').map((c) => c.trim().replace(/\s+/g, ' ')).filter(Boolean);
}

test('the latest list_shared_boards lives in 0896', () => {
  assert.equal(def().file, FILE);
});

test('same 22 columns as 0247, then the three new ones', () => {
  const sql = readFileSync(join(MIGRATIONS_DIR, OLD), 'utf8');
  const start = sql.search(/create\s+or\s+replace\s+function\s+public\.list_shared_boards\s*\(/i);
  assert.ok(start > -1, '0247 has no list_shared_boards');
  const before = columns(sql.slice(start));
  assert.equal(before.length, 22);
  assert.deepEqual(columns(def().body), [...before, 'shared_by uuid', 'shared_by_name text', 'shared_by_color text']);
});

test('security definer, pinned search_path, stable', () => {
  const b = code(def().body);
  const head = b.slice(0, b.indexOf('$$'));
  assert.match(head, /\bstable\b/);
  assert.match(head, /security definer/);
  assert.match(head, /set search_path = public/);
});

test('the sharer is read off the root share and carried down the tree', () => {
  const b = code(def().body);
  assert.match(b, /select b\.id, s\.role, s\.created_at, s\.invited_by/);
  assert.match(b, /select c\.id, t\.role, t\.share_created_at, t\.invited_by/);
  assert.match(b, /left join profiles p on p\.user_id = d\.invited_by/);
});

test('the colour only passes as #rrggbb', () => {
  assert.match(code(def().body), /case when p\.color ~ '\^#\[0-9A-Fa-f\]\{6\}\$' then p\.color end/);
});

test('signed-out callers cannot run it, signed-in can, and the file proves both', () => {
  const t = fileText();
  assert.match(t, /revoke all on function public\.list_shared_boards\(\) from public, anon;/);
  assert.match(t, /grant execute on function public\.list_shared_boards\(\) to authenticated;/);
  assert.match(t, /if has_function_privilege\('anon', 'public\.list_shared_boards\(\)', 'execute'\) then\s+raise exception/);
  assert.match(t, /if not has_function_privilege\('authenticated', 'public\.list_shared_boards\(\)', 'execute'\) then\s+raise exception/);
});
