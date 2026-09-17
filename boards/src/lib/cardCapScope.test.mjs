// cardCapScope — what the card cap actually charges you for, and the one
// definition that decides it.
//
// The cap was wrong in six places at once because the counting expression was
// copy-pasted six times: get_my_tier, enforce_demo_card_cap_trg,
// get_board_capacity, scout_board_capacity, admin_paid_reach and
// _live_card_counts each carried their own. None filtered soft-deleted boards,
// so deleting a whole cluster did not give you your cap back until the 30-day
// purge — a user who pruned to make room was refused anyway and told they were
// "limited to N cards" while holding far fewer.
//
// Owner decision 2026-09-17: a deleted cluster stops counting, and a restore
// may not carry you past the ceiling. 0333 made _owner_card_count() the single
// definition and gave restore_board a cap check.
//
// These tests read the LATEST migration text, which is what is live in
// Postgres, via the shared reader. They exist because the failure mode is
// silent in both directions: a missing filter over-charges people, and a
// missing restore check hands back cards the cap is supposed to meter.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { latestDefinition, migrationFiles, MIGRATIONS_DIR } from './migrationText.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CLIENT = new URL('.', import.meta.url).pathname;
const readSrc = (rel) => readFileSync(join(CLIENT, '..', rel), 'utf8');

// Every function that decides, reports or enforces "how many cards does this
// account hold". If a seventh appears, it belongs on this list.
const COUNTERS = [
  'enforce_demo_card_cap_trg',
  'get_my_tier',
  'get_board_capacity',
  'scout_board_capacity',
  'admin_paid_reach',
  '_live_card_counts',
];

test('there is ONE definition of cards-held, and it excludes deleted clusters', () => {
  const def = latestDefinition('_owner_card_count');
  assert.ok(def, '_owner_card_count must exist in a migration');
  assert.match(def.body, /b\.deleted_at is null/,
    'the one definition must exclude soft-deleted clusters — that is the whole point of 0333');
  assert.match(def.body, /w\.created_by = p_owner/,
    'cards are charged to the WORKSPACE OWNER, as migration 0187 decided');
  assert.match(def.body, /sum\(ci\.weight\)/,
    'weights, not row counts — a grid weighs more than one card');
  // Internal helper: the 0311 habit.
  const file = readFileSync(join(MIGRATIONS_DIR, def.file), 'utf8');
  assert.match(file, /revoke execute on function public\._owner_card_count\(uuid\) from public, anon, authenticated/,
    'an internal helper must not be reachable by a non-definer caller');
});

test('every counter defers to it rather than carrying its own copy', () => {
  for (const fn of COUNTERS) {
    const def = latestDefinition(fn);
    assert.ok(def, `${fn} must exist in a migration`);
    if (fn === 'admin_paid_reach') {
      // Whole-population read, so it defers through the set-returning twin
      // rather than the scalar. Either is fine; carrying its own copy is not.
      assert.match(def.body, /_live_card_counts\(\)|_owner_card_count\(/,
        'admin_paid_reach must defer to the shared definition');
      assert.doesNotMatch(def.body, /sum\(c\.weight\)[\s\S]*?join public\.workspaces/,
        'admin_paid_reach still carries its own counting expression');
      continue;
    }
    if (fn === '_live_card_counts') {
      // The population-scan twin cannot call the scalar per row without turning
      // one query into one aggregate per profile, so it repeats the rule — and
      // 0333's proof block asserts at apply time that the two agree for every
      // owner. What it must NOT do is quietly omit the filter.
      assert.match(def.body, /b\.deleted_at is null/,
        '_live_card_counts must apply the same deleted-cluster rule');
      continue;
    }
    assert.match(def.body, /_owner_card_count\(/,
      `${fn} must call _owner_card_count — a local copy of the expression is how this broke in six places`);
    assert.doesNotMatch(def.body, /sum\(ci\.weight\)[\s\S]*?join public\.workspaces/,
      `${fn} still carries its own counting expression`);
  }
});

test('restoring a cluster asks the cap before it un-deletes', () => {
  const def = latestDefinition('restore_board');
  assert.ok(def, 'restore_board must exist in a migration');
  // Authorization first, always.
  assert.match(def.body, /can_write_board\(p_board_id\)/,
    'restore must still check write access');
  // The cap check, and the refusal.
  assert.match(def.body, /_owner_card_count\(v_owner\)/,
    'the restore check must use the shared definition, not its own count');
  assert.match(def.body, /past your limit of/,
    'the refusal must name the limit — and apiAuth keys 402 limit_reached off this phrase');
  assert.match(def.body, /errcode = '42501'/,
    'the same code the card trigger raises, so existing client paths surface our sentence');
  // The check must precede the write. A cap test after the update is not a cap test.
  const checkAt = def.body.indexOf('past your limit of');
  const updateAt = def.body.indexOf('update boards set deleted_at = null');
  assert.ok(checkAt > 0 && updateAt > 0 && checkAt < updateAt,
    'the refusal must be raised BEFORE deleted_at is cleared');
  // Only the capped tier is checked, exactly as the trigger decides it.
  assert.match(def.body, /v_tier is not distinct from 'demo'/,
    'only demo accounts are capped');

  // 0334. The cap arithmetic assumes the board's cards are NOT currently
  // counted against the owner, which is true only while it is soft-deleted.
  // Without this guard, restoring an already-live board counts its cards twice
  // and refuses with a number the account is not at — reachable by any retry,
  // and retries are routine on the API and from an agent.
  assert.match(def.body, /deleted_at is not null\) into v_deleted/,
    'the cap check must be guarded on the board actually being soft-deleted');
  const guardAt = def.body.indexOf('into v_deleted');
  const countAt = def.body.indexOf('_owner_card_count(v_owner)');
  assert.ok(guardAt > 0 && countAt > 0 && guardAt < countAt,
    'the soft-delete guard must precede the cap arithmetic');
});

test('the client cannot route around a refused restore', () => {
  // restoreBoard used to fall back to a direct
  // `update boards set deleted_at = null` whenever the RPC errored, and the RLS
  // UPDATE policy on boards permits exactly that for any workspace member — so
  // the fallback could complete a restore the server had just refused. This is
  // the same shape as every other bug in this repo where a rule was enforced
  // and then silently overridden by the caller's error handling.
  const api = readSrc('lib/boardsApi.js');
  const fn = api.slice(api.indexOf('export async function restoreBoard'));
  const body = fn.slice(0, fn.indexOf('\n}') + 2);
  assert.match(body, /if \(error\) throw error;/, 'a refusal must propagate');
  assert.doesNotMatch(body, /deleted_at: null/,
    'restoreBoard must not write deleted_at directly — that bypasses the cap check');
});

test('a refused restore is visible, not swallowed into the console', () => {
  // Both undo paths used to catch and console.error. After 0333 a restore can
  // legitimately fail, and a silent failure leaves the Y.Doc holding a board
  // card with no live board behind it and the person with no idea why.
  const app = readSrc('App.jsx');
  assert.match(app, /async function restoreBoardsAnnouncing\(ids, feedback\)/,
    'the shared announcing helper must exist');
  assert.doesNotMatch(app, /catch \(e\) \{ console\.error\('\[undo\] restoreBoard failed', id, e\); \} \}/,
    'no undo path may swallow a restore failure');
  const helper = app.slice(app.indexOf('async function restoreBoardsAnnouncing'));
  assert.match(helper.slice(0, 1400), /past your limit/,
    'the helper must recognise a cap refusal and show the server sentence');

  // And the Trash UI, which is the path someone takes deliberately.
  const trash = readSrc('components/TrashModal.jsx');
  assert.match(trash, /past your limit/, 'the Trash restore must surface a cap refusal');
});

test('a cap refusal is a 402, not a 403, wherever it comes from', () => {
  // 42501 is both "RLS said no" and "the cap said no". The API mapper keys the
  // difference off the message, so restore_board's wording has to be in the
  // alternation or a limit reads as a permissions problem.
  const auth = readSrc('lib/apiAuth.js');
  assert.match(auth, /limited to \\d\+ cards\|past your limit/,
    'apiAuth must classify the restore refusal as limit_reached');
});

test('the migration proves its own grants and its own arithmetic', () => {
  const file = migrationFiles().find((f) => f.startsWith('0333'));
  assert.ok(file, '0333 must exist');
  const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
  // The 0311 habit: a REVOKE reporting success proves nothing.
  assert.match(sql, /has_function_privilege/, 'the migration must prove its grants');
  // …and the thing it exists for.
  assert.match(sql, /still counts deleted boards for/,
    'the migration must assert that no owner is charged for a deleted cluster');
  assert.match(sql, /_owner_card_count and _live_card_counts disagree/,
    'the scalar and the population scan must be proved equal at apply time');
});
