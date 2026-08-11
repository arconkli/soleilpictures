// Guard the ON CONFLICT arbiters on pending_invites.
//
// share_board's pending branch — the ONLY path that reaches someone who does
// not already have an account — raised 42P10 on every call from the day it
// shipped until 0227:
//
//   ERROR: there is no unique or exclusion constraint matching the
//          ON CONFLICT specification
//
// The arbiter index (0086) is partial on BOTH claimed_at and board_id:
//   ON (lower(email), board_id) WHERE claimed_at IS NULL AND board_id IS NOT NULL
// but the statement inferred with only `where claimed_at is null`. Postgres
// requires the statement's predicate to imply the index's, and a weaker one
// can't, so no arbiter matched and the insert died before writing. Not one
// board-scoped email invite was ever created; the sole pending_invites row in
// production came from invite_workspace_member, whose predicate is correct.
//
// This is a silent, total failure that no type checker or unit test on the
// client could see — the RPC just threw. The cheapest durable guard is to
// require every ON CONFLICT against pending_invites to constrain board_id,
// since which partial index applies is decided entirely by that column.
//
// If a future migration rewrites either function (share_board has been through
// 0013 → 0016 → 0065 → 0086 → 0147 → 0188 → 0227), this fails rather than
// letting inviting-a-stranger silently break again.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS = new URL('../../../supabase/migrations/', import.meta.url).pathname;

// The latest definition of a function wins — that's what's live in Postgres.
// Migrations are inconsistent about both the schema prefix and the dollar-quote
// tag ($$ by hand, $function$ when a body was round-tripped through
// pg_get_functiondef), so accept either rather than silently matching nothing:
// a guard that finds no definition would pass by vacuum, which is the exact
// failure mode this file exists to prevent.
function latestDefinition(fnName) {
  const files = readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql')).sort();
  let found = null;
  for (const f of files) {
    const sql = readFileSync(join(MIGRATIONS, f), 'utf8');
    const re = new RegExp(
      `create or replace function (?:public\\.)?${fnName}\\s*\\(` +
      `[\\s\\S]*?as\\s*(\\$[a-z_]*\\$)[\\s\\S]*?\\1\\s*;`,
      'i',
    );
    const m = sql.match(re);
    if (m) found = { file: f, body: m[0] };
  }
  return found;
}

function pendingInviteUpsert(body) {
  const m = body.match(/insert into pending_invites[\s\S]*?on conflict[^\n]*(?:\n[^\n]*)?/i);
  return m ? m[0] : null;
}

test('share_board pending-invite upsert names an arbiter Postgres can actually infer', () => {
  const def = latestDefinition('share_board');
  assert.ok(def, 'no share_board definition found in supabase/migrations');

  const upsert = pendingInviteUpsert(def.body);
  assert.ok(upsert, `share_board (${def.file}) no longer upserts pending_invites — re-check this guard`);

  const onConflict = upsert.slice(upsert.toLowerCase().indexOf('on conflict'));
  assert.match(onConflict, /claimed_at is null/i,
    `share_board (${def.file}): arbiter must constrain claimed_at`);
  // The bug, precisely: this clause was missing, so the partial index
  // ... WHERE claimed_at IS NULL AND board_id IS NOT NULL could not be inferred.
  assert.match(onConflict, /board_id is not null/i,
    `share_board (${def.file}): ON CONFLICT must include "board_id is not null" to match `
    + 'pending_invites_board_unclaimed_uniq, or every invite to a non-user raises 42P10');
});

test('invite_workspace_member targets the workspace-scoped arbiter, not the board one', () => {
  const def = latestDefinition('invite_workspace_member');
  assert.ok(def, 'no invite_workspace_member definition found in supabase/migrations');

  const upsert = pendingInviteUpsert(def.body);
  assert.ok(upsert, `invite_workspace_member (${def.file}) no longer upserts pending_invites`);

  const onConflict = upsert.slice(upsert.toLowerCase().indexOf('on conflict'));
  // Its index is ... (lower(email), workspace_id) WHERE claimed_at IS NULL AND board_id IS NULL.
  assert.match(onConflict, /claimed_at is null/i);
  assert.match(onConflict, /board_id is null/i,
    `invite_workspace_member (${def.file}): must constrain board_id IS NULL to match `
    + 'pending_invites_workspace_unclaimed_uniq');
});

// The other way an invite claim silently dies: plpgsql's OUT parameters are in
// scope for the whole body, so a function declared
//     returns table(workspace_id uuid, board_id uuid)
// cannot use those names unqualified — `on conflict (board_id, user_id)` is
// ambiguous between the OUT parameter and the column, and Postgres refuses to
// guess (42702). It raises at RUNTIME, not at CREATE, so the migration applies
// clean and the feature is simply dead.
//
// This has now bitten twice in the same chain: claim_collab_link (fixed by
// 0199, after every invite-link join had failed for a month) and
// claim_pending_invite (fixed by 0228, which had never once succeeded). Both
// fixes are the same one-line pragma. Guard the shape, not the instance.
const CLAIM_FNS = ['claim_collab_link', 'claim_pending_invite'];

for (const fn of CLAIM_FNS) {
  test(`${fn} resolves unqualified column names to columns, not OUT params`, () => {
    const def = latestDefinition(fn);
    assert.ok(def, `no ${fn} definition found in supabase/migrations`);

    const returnsTable = /returns\s+table\s*\(([^)]*)\)/i.exec(def.body);
    assert.ok(returnsTable, `${fn} (${def.file}): expected a RETURNS TABLE signature`);

    // Names the OUT params claim, that are also real column names it writes to.
    const outNames = returnsTable[1]
      .split(',')
      .map(s => s.trim().split(/\s+/)[0].toLowerCase())
      .filter(Boolean);
    const risky = outNames.filter(n => /^(board_id|workspace_id|user_id|role|status|token)$/.test(n));
    assert.ok(risky.length > 0,
      `${fn} (${def.file}): signature no longer exposes a colliding name — re-check this guard`);

    assert.match(def.body, /#variable_conflict\s+use_column/i,
      `${fn} (${def.file}): declares OUT param(s) [${risky.join(', ')}] that shadow columns it `
      + 'writes to, so it MUST set "#variable_conflict use_column" or every call raises 42702 '
      + 'at runtime (this is the 0199 / 0228 bug)');
  });
}

test('the two invite paths never share an arbiter', () => {
  // They write the same table through different partial indexes. If both ever
  // infer the same one, one of them is silently writing against the wrong
  // uniqueness rule — the class of bug 0227 fixed.
  const a = pendingInviteUpsert(latestDefinition('share_board').body);
  const b = pendingInviteUpsert(latestDefinition('invite_workspace_member').body);
  const arb = (s) => s.slice(s.toLowerCase().indexOf('on conflict')).replace(/\s+/g, ' ').trim();
  assert.notEqual(arb(a), arb(b), 'board and workspace invites must use different arbiters');
});
