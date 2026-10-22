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
  assert.match(def, /can_read\s+:= coalesce\(array\[p_board\] && public\.my_readable_board_ids\(\), false\);/,
    'read is the door\'s own rule (the boards read policy), so the recheck never refuses someone the door let in');
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
  assert.match(alarm, /if \(may && !may\.canRead\) \{\s+try \{ c\.close\(4401, "access ended"\); \}/, 'no read: 4401, and the client stops');
  assert.match(alarm, /if \(may && stateOf\(c\)\.canWrite === true && !may\.canWrite\) \{\s+try \{ c\.close\(4409, "role changed"\); \}/, 'lost write: 4409, and the client reconnects read-only');
  const auth = read('../../party/auth.ts');
  assert.match(auth, /\/rest\/v1\/rpc\/party_board_access/);
});

test('the workspace room re-asks its own door\'s question once a minute', () => {
  const def = latestDefinition('party_workspace_access').body;
  assert.match(def, /can_open := coalesce\(public\._actor_active\(\) and public\.is_workspace_member\(p_workspace\), false\);/);
  assert.ok(latestMatch(/revoke execute on function public\.party_workspace_access\(uuid, uuid\[\]\) from public, anon, authenticated;/));
  const index = read('../../party/index.ts');
  const door = index.slice(index.indexOf('lobby.className === "Workspace"'));
  assert.match(door, /bannedAmong\(env\.SUPABASE_SERVICE_ROLE_KEY, \[auth\.userId \?\? ""\]\)/, 'the door refuses a suspended account, as the recheck does');
  const room = read('../../party/workspace.ts');
  assert.match(room, /workspaceAccessAmong\(this\.env\.SUPABASE_SERVICE_ROLE_KEY, this\.name, ids\)/);
  assert.match(room, /if \(uid && access\.get\(uid\) === false\) \{\s+try \{ c\.close\(4401, "access ended"\); \}/);
  assert.match(room, /const ACCESS_CHECK_MS = 60_000;/);
});

test('a board client stops reconnecting once the room says its access ended', () => {
  const client = read('./yPartyKit.js');
  assert.match(client, /if \(event && \(event\.code === 4401 \|\| event\.code === 4403\)\) \{\s+accessEnded = true;\s+provider\.shouldConnect = false;/);
  assert.match(client, /if \(destroyed \|\| accessEnded \|\| parking\.isParked\(\)\) return;/, 'a token refresh does not reopen it');
  assert.match(client, /if \(!parkedFor\.delete\(why\) \|\| parkedFor\.size > 0 \|\| destroyed \|\| accessEnded\) return;/, 'neither does unparking');
});

test('the workspace presence client stops reconnecting once the room says its access ended', () => {
  const client = read('./workspacePartyKit.js');
  assert.match(client, /if \(event && \(event\.code === 4401 \|\| event\.code === 4403\)\) \{\s+accessEnded = true;\s+try \{ socket\.close\(\); \}/);
  assert.match(client, /if \(destroyed \|\| accessEnded\) return;/, 'unparking does not reopen it');
  assert.match(client, /event === 'SIGNED_IN' && !accessEnded/, 'neither does a sign-in event');
});
