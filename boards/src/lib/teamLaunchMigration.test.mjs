// 0543 (the launch switch) and 0544 (0188's brake goes), pinned at the source.
// Neither is applied before the launch; both are one transaction that proves
// what it did.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MIGRATIONS_DIR } from './migrationText.mjs';

const read = (f) => readFileSync(join(MIGRATIONS_DIR, f), 'utf8');
const code = (s) => s.replace(/--[^\n]*/g, '');   // comments are not wiring

test('0543 turns the limit on and opens teams for everyone, keeps the testers, and proves it', () => {
  const sql = read('0543_team_launch_switch.sql');
  assert.match(sql, /STATUS: written 2026-10-27\. NOT applied\./);
  // What has to be live first is written where whoever applies it will read it.
  for (const pre of ['launch release is live', 'STRIPE_PRICE_TEAM_MONTHLY', '0541 applied']) {
    assert.ok(sql.includes(pre), pre);
  }
  const c = code(sql);
  assert.match(c, /^begin;$/m);
  assert.match(c, /set value = jsonb_set\(value, '\{enforced\}', 'true'::jsonb\)\s+where key = 'editor_limit';/);
  assert.match(c, /set value = jsonb_set\(value, '\{open\}', 'true'::jsonb\)\s+where key = 'teams_open';/);
  // Only those two values move: the testers stay listed, nothing is defined.
  assert.doesNotMatch(c, /test_owner_ids|\bcreate\b|\bdrop\b|\bgrant\b|\brevoke\b/i);
  assert.match(c, /if not public\._editor_limit_on\(v_nobody\) then/);
  assert.match(c, /if not public\._teams_open_for\(v_nobody\) then/);
  assert.match(c, /commit;\s*$/);
});

test('0544 drops only 0188\'s brake, and only once nothing calls it', () => {
  const sql = read('0544_drop_free_editor_brake.sql');
  assert.match(sql, /STATUS: written 2026-10-27\. NOT applied\./);
  const c = code(sql);
  assert.match(c, /^begin;$/m);
  const drops = c.match(/drop function[^;]*;/gi) || [];
  assert.deepEqual(drops, [
    'drop function if exists public._collab_editor_cap();',
    'drop function if exists public.admin_set_collab_editor_cap(integer);',
  ]);
  assert.match(c, /delete from public\.app_config where key = 'collab_free_editor_cap';/);
  // The guard runs before the drops.
  assert.ok(c.indexOf("prosrc ilike '%collab_editor_cap%'") < c.indexOf('drop function'));
  assert.match(c, /to_regprocedure\('public\._collab_editor_cap\(\)'\) is not null/);
  assert.match(c, /commit;\s*$/);
});
