// 0854: ensure_workspace_root refuses a sign-in that doesn't count as the
// person (0600) with 42501 and the hint 'sign_in_again', and the app turns that
// hint into "Sign in again to open your clusters" instead of a dead end. These
// hold the guard to _actor_active's own test of the session, the rest of the
// function to 0275's body, and the app to the same hint.
//
//   node --test src/lib/signInAgainMigration.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { definitionsOf, latestDefinition, bodyText, MIGRATIONS_DIR } from './migrationText.mjs';

const FILE = '0854_sign_in_again_on_root_repair.sql';
const SESSION_TEST = "jsonb_typeof(auth.jwt() -> 'amr') = 'array' and not public._session_proves_inbox()";
const GUARD = `if auth.uid() is not null and ${SESSION_TEST} then raise exception 'this sign-in does not count as you: sign in with the code we email you' using errcode = '42501', hint = 'sign_in_again'; end if;`;

test('ensure_workspace_root refuses a sign-in that does not count, first, and is otherwise 0275', () => {
  const [before, live] = definitionsOf('ensure_workspace_root').slice(-2);
  assert.equal(live.file, FILE, `the live ensure_workspace_root is ${FILE}`);
  assert.equal(before.file, '0275_workspace_root_heal.sql');
  const body = bodyText(live.body);
  assert.ok(body.startsWith(`begin ${GUARD} `), 'the session is checked before anything else');
  assert.equal(body.replace(`${GUARD} `, ''), bodyText(before.body), `${FILE} is 0275's body plus the guard`);
});

test('the guard asks what _actor_active asks of a session', () => {
  const actor = latestDefinition('_actor_active');
  assert.ok(actor, '_actor_active is defined');
  assert.ok(bodyText(actor.body).includes(`when ${SESSION_TEST} then false`), '_actor_active still tests the session this way');
});

test('the app reads the same hint, on both workspace screens', () => {
  const app = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8');
  assert.ok(app.includes("e?.code === '42501' && e?.hint === 'sign_in_again'"));
  assert.ok(app.includes('refused={signInAgain(wsError)}'));
  assert.ok(app.includes('refused={signInAgain(activeRootError)}'));
});

test('the migration keeps 0275\'s grants and proves each caller', () => {
  const sql = readFileSync(MIGRATIONS_DIR + FILE, 'utf8');
  assert.match(sql, /revoke all on function public\.ensure_workspace_root\(uuid\) from anon;/);
  assert.match(sql, /grant execute on function public\.ensure_workspace_root\(uuid\) to authenticated;/);
  assert.ok(sql.includes("has_function_privilege('anon', 'public.ensure_workspace_root(uuid)', 'execute')"));
  // A password session is refused with the hint; an inbox one reaches the
  // membership check.
  assert.match(sql, /'method', 'password'[\s\S]*?pg_exception_hint;\s*if v_hint is distinct from 'sign_in_again'/);
  assert.match(sql, /'method', 'otp'[\s\S]*?v_msg <> 'you are not a member of this workspace'/);
});
