// 0900: my_days_back() pinned at the source. Text only, no Postgres.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MIGRATIONS_DIR } from './migrationText.mjs';

const text = readFileSync(join(MIGRATIONS_DIR, '0900_my_days_back.sql'), 'utf8');
const code = text.replace(/--[^\n]*/g, '');

test('my_days_back is a definer that reads only the caller\'s earlier days', () => {
  assert.match(code, /create or replace function public\.my_days_back\(\)/);
  assert.match(code, /security definer/);
  assert.match(code, /set search_path = public, pg_temp/);
  assert.match(code, /user_id = auth\.uid\(\)/);
  assert.match(code, /day < current_date/);
});

test('anon cannot run it, signed-in people can, and the migration proves it', () => {
  assert.match(code, /revoke execute on function public\.my_days_back\(\) from public, anon;/);
  assert.match(code, /grant execute on function public\.my_days_back\(\) to authenticated;/);
  assert.match(code, /has_function_privilege\('anon', v_fn, 'execute'\)/);
  assert.match(code, /not has_function_privilege\('authenticated', v_fn, 'execute'\)/);
  assert.match(code, /not has_function_privilege\('service_role', v_fn, 'execute'\)/);
});
