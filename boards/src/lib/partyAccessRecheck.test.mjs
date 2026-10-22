// A live board room re-checks, once a minute, what each connected person may
// still do (0620 + party/board.ts), so a removal, an unshare or a downgrade
// reaches a socket that is already open.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { latestDefinition, latestMatch } from './migrationText.mjs';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

test('party_board_access answers with the app\'s own predicates, as each person, for the service role only', () => {
  const def = latestDefinition('party_board_access').body;
  assert.match(def, /can_read\s+:= coalesce\(public\.can_read_board\(p_board\), false\);/);
  assert.match(def, /can_write := coalesce\(public\.can_write_board\(p_board\), false\);/);
  assert.match(def, /set_config\('request\.jwt\.claims',\s+jsonb_build_object\('sub', v_user, 'role', 'authenticated'\)::text, true\)/);
  assert.match(def, /set_config\('request\.jwt\.claims', coalesce\(v_claims, ''\), true\)/, 'the caller\'s claims are put back');
  assert.ok(latestMatch(/revoke execute on function public\.party_board_access\(uuid, uuid\[\]\) from public, anon, authenticated;/));
  assert.ok(latestMatch(/grant execute on function public\.party_board_access\(uuid, uuid\[\]\) to service_role;/));
});

test('the board room closes a socket that lost read, or lost write while writing', () => {
  const board = read('../../party/board.ts');
  const alarm = board.slice(board.indexOf('async onAlarm()'));
  assert.match(alarm, /accessAmong\(this\.env\.SUPABASE_SERVICE_ROLE_KEY, this\.name, ids\)/);
  assert.match(alarm, /if \(may && \(!may\.canRead \|\| \(stateOf\(c\)\.canWrite === true && !may\.canWrite\)\)\) \{\s+try \{ c\.close\(4401, "access changed"\); \}/);
  const auth = read('../../party/auth.ts');
  assert.match(auth, /\/rest\/v1\/rpc\/party_board_access/);
});
