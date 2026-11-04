// 0856: at most 10 workspaces of your own outside Team, pinned at the source
// (the latest migration definition). Text only, no Postgres.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { latestDefinition, MIGRATIONS_DIR } from './migrationText.mjs';
import { WORKSPACE_LIMIT, WORKSPACE_LIMIT_HINT } from './workspaceLimit.js';

const FILE = '0856_workspace_limit.sql';
const fileText = () => readFileSync(join(MIGRATIONS_DIR, FILE), 'utf8');
const code = (s) => s.replace(/--[^\n]*/g, '');   // comments are not wiring
const def = (fn) => {
  const d = latestDefinition(fn);
  assert.ok(d, `no definition of ${fn}`);
  return d;
};

test('the latest create_workspace_with_root lives in 0856 and keeps the old checks', () => {
  const d = def('create_workspace_with_root');
  assert.equal(d.file, FILE);
  const b = code(d.body);
  assert.match(b, /uid := auth\.uid\(\);\s+if uid is null then\s+raise exception 'must be authenticated';/);
  assert.match(b, /if not public\._actor_active\(\) then\s+raise exception 'this account is suspended' using errcode = '42501';/);
  assert.match(b, /c_new_account_workspaces constant integer := 4;/);
  assert.match(b, /errcode = '54000', hint = 'new_account'/);
});

test('lock, then the new-account check, then the limit check', () => {
  const b = code(def('create_workspace_with_root').body);
  const lock = b.indexOf("pg_advisory_xact_lock(hashtext('workspace_count:' || uid::text))");
  const fresh = b.indexOf('public._account_is_new()');
  const limit = b.indexOf('public._workspace_limit()');
  const insert = b.indexOf('insert into workspaces');
  assert.ok(lock > -1 && fresh > -1 && limit > -1 && insert > -1);
  assert.ok(lock < fresh, 'the lock comes before the new-account check');
  assert.ok(fresh < limit, 'the new-account check comes before the limit check');
  assert.ok(limit < insert, 'the limit is checked before anything is made');
  assert.match(b, /v_personal := public\._account_personal_workspaces\(uid\);\s+if v_personal >= public\._workspace_limit\(\) then/);
});

test('keep_mcp_draft is the second door: its latest definition is in 0856, lock before the count', () => {
  const d = def('keep_mcp_draft');
  assert.equal(d.file, FILE);
  const b = code(d.body);
  const lock = b.indexOf("pg_advisory_xact_lock(hashtext('workspace_count:' || v_me::text))");
  const count = b.indexOf('v_personal := public._account_personal_workspaces(v_me);');
  const limit = b.indexOf('v_personal >= public._workspace_limit()');
  const own = b.indexOf('v_has_own :=');
  const hand = b.indexOf('_mcp_draft_hand_over');
  assert.ok(lock > -1 && count > -1 && limit > -1 && own > -1 && hand > -1);
  assert.ok(lock < count && count < limit, 'lock, then count, then the check');
  assert.ok(limit < own && limit < hand, 'refused before the draft is handed over');
  assert.ok(b.indexOf("hint = 'draft_expired'") < lock, 'after the existing refusals');
  assert.match(d.body, /'workspace limit reached: you have % workspaces of your own, the most outside Team', v_personal\s+using errcode = '42501', hint = 'workspace_limit'/);
});

test('the refusal is 42501 with the hint the app reads', () => {
  const b = def('create_workspace_with_root').body;
  assert.match(b, /'workspace limit reached: you have % workspaces of your own, the most outside Team', v_personal/);
  assert.match(b, /errcode = '42501',\s*hint = 'workspace_limit'/);
  assert.equal(WORKSPACE_LIMIT_HINT, 'workspace_limit');
});

test('a workspace counts when the account created it and no team owns it', () => {
  const h = def('_account_personal_workspaces');
  assert.equal(h.file, FILE);
  const b = code(h.body);
  assert.match(b, /count\(\*\)/);
  assert.match(b, /w\.created_by = p_owner/);
  assert.match(b, /w\.org_id is null/);
  assert.match(b, /security definer/);
});

test('the limit is the app constant', () => {
  const d = def('_workspace_limit');
  assert.equal(d.file, FILE);
  assert.match(code(d.body), new RegExp(`select\\s+${WORKSPACE_LIMIT}\\s*;`));
  assert.match(d.body, /\bimmutable\b/);
});

test('helpers are closed to clients; the door is open to signed-in callers only', () => {
  const s = code(fileText());
  assert.match(s, /revoke execute on function public\._workspace_limit\(\) from public, anon, authenticated;/);
  assert.match(s, /revoke execute on function public\._account_personal_workspaces\(uuid\) from public, anon, authenticated;/);
  assert.match(s, /revoke execute on function public\.create_workspace_with_root\(text, text\) from public, anon;/);
  assert.match(s, /grant execute on function public\.create_workspace_with_root\(text, text\) to authenticated;/);
  assert.match(s, /revoke execute on function public\.keep_mcp_draft\(text\) from public, anon;/);
  assert.match(s, /grant execute on function public\.keep_mcp_draft\(text\) to authenticated;/);
});

test('the file ends with a proof block that runs has_function_privilege', () => {
  const s = code(fileText());
  const tail = s.slice(s.lastIndexOf('do $$'));
  assert.ok(tail.includes("has_function_privilege('anon', v_fn, 'execute')"));
  assert.ok(tail.includes("has_function_privilege('authenticated', v_fn, 'execute')"));
  assert.ok(tail.includes("has_function_privilege('anon', 'public.create_workspace_with_root(text,text)', 'execute')"));
  assert.match(tail, /not has_function_privilege\('authenticated', 'public\.create_workspace_with_root\(text,text\)', 'execute'\)/);
  assert.ok(tail.includes("has_function_privilege('anon', 'public.keep_mcp_draft(text)', 'execute')"));
  assert.match(tail, /not has_function_privilege\('authenticated', 'public\.keep_mcp_draft\(text\)', 'execute'\)/);
  assert.match(tail.trimEnd(), /end \$\$;\s*commit;$/);
});
