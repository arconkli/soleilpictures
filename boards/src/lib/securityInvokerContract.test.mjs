// securityInvokerContract.test.mjs — keeps RLS switched on for every view.
//
//   node --test src/lib/securityInvokerContract.test.mjs
//
// A Postgres view runs with the OWNER's permissions unless it is created
// `with (security_invoker = on)`. Every view here is owned by `postgres`, which
// also owns boards/card_index/group_index/tags, and a table owner bypasses RLS
// unless FORCE ROW LEVEL SECURITY is set (it is not). So a view without that
// option hands every caller the owner's view of the whole database.
//
// THE INCIDENT THIS IS BUILT FROM (2026-08-15 -> 2026-09-07)
// ---------------------------------------------------------
// 0084_lock_down_views.sql created entity_search `with (security_invoker = on)`
// precisely to close that hole. 0240_tags_soft_delete.sql later needed one more
// predicate on the tag branch, and added it by re-emitting the view body from
// `pg_get_viewdef` output -- which prints the SELECT and nothing else -- through
// `create or replace view`. That statement RESETS any reloption it does not
// restate, so security_invoker silently vanished and the bypass came back.
//
// For three weeks any signed-in user could read board names, card titles and
// card bodies across every workspace in the product with one request, while the
// same query against `boards` correctly returned zero rows. Nothing failed. No
// test covered it. 0302 restored the option; this test is what stops the next
// `create or replace view` from doing it again.
//
// IF THIS GOES RED: a migration created or replaced a view without
// `with (security_invoker = on)`. Add it to that statement. Do not add the view
// to an exemption list to make the test pass -- that reinstates the bypass.
//
// The check is a faithful simulation of what Postgres ends up storing in
// pg_class.reloptions, replaying every statement in migration order:
//   create [or replace] view X ... with (security_invoker = on)  -> on
//   create [or replace] view X ...        (option not restated)  -> OFF
//   alter view X set (security_invoker = on)                     -> on
//   alter view X reset (security_invoker)                        -> OFF
//   drop view X                                                  -> gone
// Asserting the final state (rather than every historical statement) is what
// lets the early pre-0084 migrations stay untouched while still guaranteeing
// the schema a fresh rebuild lands on is safe.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = resolve(HERE, '../../../supabase/migrations');

// Strip SQL comments first. Several migration headers describe view work in
// prose ("Recreate all three views with (security_invoker = on)"), and matching
// those would let a real regression hide behind a reassuring comment.
function stripComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ');
}

const CREATE_VIEW = /\bcreate\s+(?:or\s+replace\s+)?view\s+(?:public\.)?("?)([a-z_][a-z0-9_]*)\1([\s\S]{0,400}?)\bas\b/gi;
const ALTER_SET = /\balter\s+view\s+(?:public\.)?("?)([a-z_][a-z0-9_]*)\1\s+set\s*\(([^)]*)\)/gi;
const ALTER_RESET = /\balter\s+view\s+(?:public\.)?("?)([a-z_][a-z0-9_]*)\1\s+reset\s*\(([^)]*)\)/gi;
const DROP_VIEW = /\bdrop\s+view\s+(?:if\s+exists\s+)?(?:public\.)?("?)([a-z_][a-z0-9_]*)\1/gi;

const hasInvokerOn = (s) => /security_invoker\s*=\s*(on|true)/i.test(s);
const mentionsInvoker = (s) => /security_invoker/i.test(s);

// Replay every migration in filename order and return the final reloption state.
function finalViewState() {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
  const state = new Map(); // view name -> { invoker: boolean, file: string }

  for (const file of files) {
    const sql = stripComments(readFileSync(resolve(MIGRATIONS, file), 'utf8'));

    for (const m of sql.matchAll(DROP_VIEW)) state.delete(m[2]);

    // create-or-replace resets unstated reloptions — the whole bug.
    for (const m of sql.matchAll(CREATE_VIEW)) {
      state.set(m[2], { invoker: hasInvokerOn(m[3]), file });
    }

    for (const m of sql.matchAll(ALTER_SET)) {
      if (mentionsInvoker(m[3])) {
        const prev = state.get(m[2]);
        state.set(m[2], { invoker: hasInvokerOn(m[3]), file });
        if (!prev) state.get(m[2]).file = file;
      }
    }
    for (const m of sql.matchAll(ALTER_RESET)) {
      if (mentionsInvoker(m[3])) state.set(m[2], { invoker: false, file });
    }
  }
  return state;
}

test('every view ends up with security_invoker = on', () => {
  const state = finalViewState();
  assert.ok(state.size > 0, 'no views parsed out of supabase/migrations — parser is broken');

  const leaky = [...state.entries()]
    .filter(([, v]) => !v.invoker)
    .map(([name, v]) => `  ${name}  (last set by ${v.file})`);

  assert.deepEqual(
    leaky,
    [],
    'These views run as their OWNER, bypassing RLS on every table they read.\n' +
      'Add `with (security_invoker = on)` to the create statement:\n' +
      leaky.join('\n') + '\n',
  );
});

test('entity_search specifically is invoker-enforced', () => {
  // Named explicitly because this is the one that regressed, and it reads
  // boards, card_index, group_index and tags across every workspace.
  const entry = finalViewState().get('entity_search');
  assert.ok(entry, 'entity_search view not found in migrations');
  assert.equal(
    entry.invoker,
    true,
    'entity_search must be security_invoker — without it any signed-in user ' +
      'can read every other workspace\'s board names and card bodies (see 0302).',
  );
});

test('the parser actually detects a missing option', () => {
  // Guards the guard: if the regex silently stopped matching, both tests above
  // would pass vacuously on an empty result set.
  assert.equal(hasInvokerOn('with (security_invoker = on) '), true);
  assert.equal(hasInvokerOn('with (security_invoker = true) '), true);
  assert.equal(hasInvokerOn(' '), false);
  assert.equal(hasInvokerOn('with (security_barrier = on) '), false);

  const sample = stripComments(
    '-- create view public.decoy as select 1;\ncreate view public.real_one as select 1;',
  );
  const names = [...sample.matchAll(CREATE_VIEW)].map((m) => m[2]);
  assert.deepEqual(names, ['real_one'], 'commented-out DDL must not be parsed');
});
