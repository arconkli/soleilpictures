// invitedEditorsMigration.test.mjs — 0870, 0871 and 0872 are what let someone
// invited to edit ONE shared cluster (an editor share, not a workspace member)
// work on it: write its search index (card_index / group_index), make
// sub-clusters that land in the owner's workspace, and rename it.
//
//   node --test src/lib/invitedEditorsMigration.test.mjs
//
// The trap this guards: the widening is easy to undo by accident. A later
// migration that restates one of these policies from an older copy drops the
// editor branch (editors get 42501 on every save again), and one that drops the
// `_board_in_workspace(board_id, workspace_id)` half lets a writer of board A
// stamp index rows into someone else's workspace. The 0871 trigger must also
// fire before boards_parent_must_be_live, and the helper must stay internal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MIGRATIONS_DIR, migrationFiles, latestDefinition } from './migrationText.mjs';

const F0870 = '0870_index_writes_for_board_editors.sql';
const F0871 = '0871_subcluster_takes_parent_workspace.sql';
const F0872 = '0872_rename_board.sql';
const read = f => readFileSync(join(MIGRATIONS_DIR, f), 'utf8');
// SQL with `--` comment lines removed, so prose in the headers cannot satisfy
// (or trip) a statement-level check.
const code = f => read(f).split('\n').filter(l => !/^\s*--/.test(l)).join('\n');

const sql0870 = code(F0870);
const policies = sql0870.match(/create\s+policy[^;]*;/gi) ?? [];
const policy = name => {
  const p = policies.find(s => s.toLowerCase().includes(`"${name}"`));
  assert.ok(p, `0870 creates policy "${name}"`);
  return p;
};
const withCheck = p => p.match(/with\s+check\s*\(([\s\S]*)\)\s*;$/i)?.[1] ?? '';
const usingOf = p => p.match(/using\s*\(([\s\S]*?)\)\s*(?:with\s+check|;)/i)?.[1] ?? '';

const CAN_WRITE = /can_write_board\(board_id\)/i;
const IN_WS = /_board_in_workspace\(board_id,\s*workspace_id\)/i;
const CAN_WRITE_AND_IN_WS = /can_write_board\(board_id\)\s+and\s+_board_in_workspace\(board_id,\s*workspace_id\)/i;

test('0870: every card_index / group_index insert and update WITH CHECK lets editors through AND keeps the workspace check', () => {
  for (const name of ['card_index insert', 'card_index update', 'group_index insert', 'group_index update']) {
    const wc = withCheck(policy(name));
    assert.match(wc, CAN_WRITE, `${name}: with check has can_write_board(board_id)`);
    assert.match(wc, IN_WS, `${name}: with check has _board_in_workspace(board_id, workspace_id)`);
  }
});

test('0870: card_index / group_index update and delete USING pair can_write_board with the workspace check', () => {
  for (const name of ['card_index update', 'card_index delete', 'group_index update', 'group_index delete']) {
    assert.match(usingOf(policy(name)), CAN_WRITE_AND_IN_WS, `${name}: using`);
  }
});

test('0870: group_index gets a select policy on my_readable_board_ids()', () => {
  const p = policy('group_index read');
  assert.match(p, /for\s+select/i);
  assert.match(p, /my_readable_board_ids\(\)/i);
});

test('0870: the old group_index FOR ALL policy is dropped and nothing creates a FOR ALL policy', () => {
  assert.match(sql0870, /drop\s+policy\s+if\s+exists\s+"group_index write"/i);
  for (const p of policies) assert.doesNotMatch(p, /for\s+all/i);
});

test('0870: lock_timeout is set before the first drop policy, and a proof block precedes the commit', () => {
  const lock = sql0870.search(/set\s+local\s+lock_timeout/i);
  const drop = sql0870.search(/drop\s+policy/i);
  assert.ok(lock >= 0 && drop >= 0 && lock < drop, 'set local lock_timeout comes before drop policy');
  assert.match(sql0870, /do\s+\$\$[\s\S]*end\s+\$\$;\s*commit;\s*$/i);
});

// A later migration that must change these policies should restate the editor
// branch (can_write_board AND _board_in_workspace) and then update this test —
// the same idea as RESTATED in retentionVisitsMigration.test.mjs, but no map is
// needed while nothing later touches them.
test('no migration after 0870 creates, drops or alters a card_index / group_index policy', () => {
  const later = migrationFiles().filter(f => Number(f.slice(0, 4)) > 870);
  const touch = /(?:create|drop|alter)\s+policy\s+(?:if\s+exists\s+)?"?[^;]*?\bon\s+(?:public\.)?(?:card_index|group_index)\b/i;
  for (const f of later) assert.doesNotMatch(code(f), touch, `${f} changes a card_index / group_index policy`);
});

const sql0871 = code(F0871);

test('0871: _boards_take_parent_workspace is security definer, pinned search_path, revoked from every client role', () => {
  const def = latestDefinition('_boards_take_parent_workspace');
  assert.match(def.body, /security\s+definer/i);
  assert.match(def.body, /set\s+search_path\s*=\s*public/i);
  assert.match(sql0871, /revoke\s+execute\s+on\s+function\s+public\._boards_take_parent_workspace\(\)\s+from\s+public,\s*anon,\s*authenticated/i);
});

test('0871: the trigger is a before-insert row trigger made with create or replace, never dropped', () => {
  assert.match(sql0871, /create\s+or\s+replace\s+trigger\s+boards_a_parent_workspace\s+before\s+insert\s+on\s+public\.boards\s+for\s+each\s+row/i);
  assert.doesNotMatch(sql0871, /drop\s+trigger/i);
});

test('0871: the trigger name sorts before boards_parent_must_be_live', () => {
  // Postgres fires same-kind triggers in name order; the parent-is-live check
  // must see the row after its workspace was corrected.
  assert.ok('boards_a_parent_workspace' < 'boards_parent_must_be_live');
});

test('0871: lock_timeout is set before the temp table, and 0871 holds the latest definition', () => {
  const lock = sql0871.search(/set\s+local\s+lock_timeout/i);
  const temp = sql0871.search(/create\s+temp\s+table/i);
  assert.ok(lock >= 0 && temp >= 0 && lock < temp, 'set local lock_timeout comes before create temp table');
  assert.equal(latestDefinition('_boards_take_parent_workspace').file, F0871);
});

const sql0872 = code(F0872);

test('0872: rename_board is last defined in 0872', () => {
  assert.equal(latestDefinition('rename_board').file, F0872);
});

test('0872: rename_board is security definer, refuses an unsigned caller, and checks can_write_board', () => {
  const { body } = latestDefinition('rename_board');
  assert.match(body, /security\s+definer/i);
  assert.match(body, /set\s+search_path/i);
  assert.match(body, /auth\.uid\(\)/i);
  assert.match(body, /v_uid\s+is\s+null/i);
  assert.match(body, /can_write_board\(p_board_id\)/i);
});

test('0872: grants are revoked from public and anon, given to authenticated, and the proof block checks anon', () => {
  assert.match(sql0872, /revoke\s+execute\s+on\s+function\s+public\.rename_board\(uuid,\s*text\)\s+from\s+public,\s*anon/i);
  assert.match(sql0872, /grant\s+execute\s+on\s+function\s+public\.rename_board\(uuid,\s*text\)\s+to\s+authenticated/i);
  assert.match(sql0872, /has_function_privilege\('anon',\s*'public\.rename_board\(uuid,\s*text\)'/i);
});
