// The 17 Nov 2026 database crash migrations: static checks on the SQL text.
// Files are found by name suffix so a renumbering does not break the test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { MIGRATIONS_DIR } from './migrationText.mjs';

function sqlEnding(suffix) {
  const names = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(suffix));
  assert.equal(names.length, 1, `exactly one migration ends with ${suffix}`);
  return readFileSync(join(MIGRATIONS_DIR, names[0]), 'utf8');
}
const noComments = (s) => s.replace(/--[^\n]*/g, '');

const REALTIME = '_realtime_drop_unused.sql';
const NOT_FOUND = '_public_board_not_found.sql';
const MEMORY = '_db_memory_watch.sql';

test('the three public-board reads raise PostgREST 404, not P0002 as an errcode', () => {
  const sql = noComments(sqlEnding(NOT_FOUND));
  for (const fn of ['get_public_board_meta', 'get_public_board_content', 'get_public_board_page']) {
    assert.match(sql, new RegExp(`create or replace function public\\.${fn}\\(`), fn);
  }
  const raises = sql.match(/raise sqlstate 'PGRST' using\s+message = '\{"code":"P0002"[^']*',\s+detail = '\{"status":404,"headers":\{\}\}'/g) || [];
  assert.equal(raises.length, 3, 'one PGRST 404 raise per function');
  assert.doesNotMatch(sql, /errcode\s*=\s*'P0002'/);
});

test('realtime drops profiles and pending_clusters from supabase_realtime, each guarded', () => {
  const sql = noComments(sqlEnding(REALTIME));
  assert.match(sql, /alter publication supabase_realtime drop table public\.profiles;/);
  assert.match(sql, /alter publication supabase_realtime drop table public\.pending_clusters;/);
  assert.doesNotMatch(sql, /drop table public\.member_profiles/);
  assert.ok((sql.match(/if exists \(select 1 from pg_publication_tables/g) || []).length >= 2, 'each drop is guarded');
});

test('db_memory_record is service_role only and its table is closed to clients', () => {
  const sql = noComments(sqlEnding(MEMORY));
  assert.match(sql, /revoke execute on function public\.db_memory_record\(jsonb\) from public, anon, authenticated;/);
  assert.match(sql, /grant execute on function public\.db_memory_record\(jsonb\) to service_role;/);
  assert.match(sql, /alter table public\.db_memory_readings enable row level security;/);
  assert.match(sql, /revoke all on table public\.db_memory_readings from public, anon, authenticated;/);
  assert.doesNotMatch(sql, /grant[^;]*on (table )?public\.db_memory_readings/i);
});

test('every crash migration that creates a function proves its grants with has_function_privilege', () => {
  for (const suffix of [NOT_FOUND, MEMORY]) {
    const sql = noComments(sqlEnding(suffix));
    assert.match(sql, /create or replace function/, suffix);
    assert.match(sql, /has_function_privilege\(/, `${suffix}: grant proof`);
    assert.match(sql, /raise exception/, `${suffix}: the proof fails loudly`);
  }
});
