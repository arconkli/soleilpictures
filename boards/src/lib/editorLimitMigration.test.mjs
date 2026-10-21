// 0520/0521: the 10-editor limit on Free and Creator, pinned at the source
// (the latest migration definition). A later rewrite of a door can't quietly
// drop its check, and a door that must NOT check can't quietly gain one: an
// invite claimed after it held its place, or a transfer, which is the freeze.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { latestDefinition, definitionsOf, MIGRATIONS_DIR } from './migrationText.mjs';
import { EDITOR_LIMIT, EDITOR_LIMIT_HINT, EDITOR_LIMIT_ASK_HINT } from './editorLimit.js';

const CORE = '0520_editor_limit_core.sql';
const DOORS = '0521_editor_limit_doors.sql';
const fileText = (f) => readFileSync(join(MIGRATIONS_DIR, f), 'utf8');
const code = (s) => s.replace(/--[^\n]*/g, '');   // comments are not wiring
const def = (fn) => {
  const d = latestDefinition(fn);
  assert.ok(d, `no definition of ${fn}`);
  return d;
};

test('the limit is 10 in the database and in the app', () => {
  const d = def('_editor_limit');
  assert.equal(d.file, CORE);
  assert.match(code(d.body), new RegExp(`select\\s+${EDITOR_LIMIT}\\s*;`));
});

test('it is off until launch, and a malformed switch reads as off', () => {
  const sql = fileText(CORE);
  assert.ok(sql.includes(`values ('editor_limit', '{"enforced": false, "test_owner_ids": []}'::jsonb)`));
  assert.match(sql, /on conflict \(key\) do nothing;/);
  const on = code(def('_editor_limit_on').body);
  assert.match(on, /->>\s*'enforced'\s*=\s*'true'/, 'only a JSON true turns it on');
  assert.match(on, /jsonb_typeof\(c\.value -> 'test_owner_ids'\) = 'array'/);
  assert.match(on, /coalesce\(/, 'no row reads as off');
});

test('a place: the owner, editing members, editor shares on live clusters, waiting editor invites', () => {
  const g = code(def('_account_editor_grants').body);
  for (const s of [
    "m.role in ('owner', 'coowner', 'admin', 'editor')",
    "s.role = 'editor'",
    'b.deleted_at is null',
    "pi.role in ('editor', 'workspace')",
    'pi.claimed_at is null',
    'pi.expires_at > now()',
    'pi.held_at is null',
    'not public._sharer_suspended(pi.invited_by)',
    'not public._user_banned(u.id)',
    'not public._is_service_identity(u.id)',
  ]) assert.ok(g.includes(s), `_account_editor_grants lacks ${s}`);
  assert.doesNotMatch(g, /'viewer'/, 'a viewer never holds a place');
  const s = code(def('_account_editor_slots').body);
  assert.match(s, /distinct on \(g\.user_id\)/, 'an account counts once');
  assert.ok(s.includes('not exists (select 1 from accounts a where a.email = g.email)'),
    'an invite to an address whose account already holds a place is not counted again');
});

test('admission answers before counting when off, locks per account, and one comparison is the rule', () => {
  const a = code(def('_editor_admit').body);
  assert.match(a, /if v_owner is null or not public\._editor_limit_on\(v_owner\) then\s+return 'ok';/);
  assert.ok(a.includes("pg_advisory_xact_lock(hashtext('editor_slots:' || v_owner::text))"));
  assert.ok(a.indexOf('pg_advisory_xact_lock') < a.indexOf('_account_editor_slots'), 'lock, then count');
  assert.match(a, /if v_held then\s+return 'already';/);
  assert.match(a, /if v_used >= public\._editor_limit\(\) then\s+return 'full';/);
});

test('the refusal carries the hint the app reads, worded for who is asking', () => {
  const r = def('_editor_refuse').body;
  assert.ok(r.includes(`hint = '${EDITOR_LIMIT_HINT}'`));
  assert.ok(r.includes(`hint = '${EDITOR_LIMIT_ASK_HINT}'`));
  assert.match(r, /errcode = '42501'/);
  assert.match(r, /'editor limit reached:/);
  assert.doesNotMatch(r, /invite limit reached/, 'the invite budget owns that phrase');
});

test('the owner and co-owners hear, once a day per person and route, and a notice never breaks a door', () => {
  const n = def('_notify_editor_limit').body;
  assert.ok(n.includes("'editors.limit_reached'"));
  assert.match(n, /m\.role = 'coowner'/, 'co-owners manage the people too');
  assert.match(n, /continue when r\.user_id is not distinct from p_actor;/, 'not the person who caused it');
  assert.match(n, /interval '24 hours'/);
  assert.match(n, /exception when others then\s+raise warning/);
  const j = def('_notify_joined_as_viewer').body;
  assert.ok(j.includes("'editors.joined_as_viewer'"));
  assert.match(j, /interval '24 hours'/);
  assert.match(j, /exception when others then\s+raise warning/);
  const f = code(def('_editor_limit_fallback').body);
  assert.ok(f.includes('_notify_editor_limit(') && f.includes('_notify_joined_as_viewer('));
  assert.ok(f.includes("'editor_limit_viewer_fallback'"));
  assert.doesNotMatch(f, /token/i, 'a link token never reaches analytics (0474)');
});

test('the app can read the numbers, never who; only the owner gets the list', () => {
  const c = code(def('get_editor_capacity').body);
  assert.match(def('get_editor_capacity').body, /returns table\s*\(\s*enforced boolean,\s*editor_limit integer,\s*used integer,\s*pending integer,\s*is_full boolean,\s*i_am_account_owner boolean,\s*subject text\s*\)/i);
  assert.ok(c.includes('public.can_write_board(p_board_id)'));
  assert.ok(c.includes('public.can_manage_workspace(v_ws) or public._workspace_member_can_write(v_ws)'));
  assert.doesNotMatch(c, /email/i, 'numbers only');
  const l = code(def('list_my_account_editors').body);
  assert.ok(l.includes('_account_editor_grants(auth.uid())') && l.includes('_account_editor_slots(auth.uid())'),
    'only the caller\'s own account');
  const a = code(def('ask_owner_for_editor_slot').body);
  for (const s of ["return 'owner';", "return 'not_full';", "return 'already_sent';", "return 'sent';"]) assert.ok(a.includes(s));
  assert.ok(a.includes("_notify_editor_limit(v_ws, p_board_id, auth.uid(), 'ask')"));
});

test('0520: helpers are revoked, the three calls are signed-in only, and the file proves it', () => {
  const sql = fileText(CORE);
  for (const h of [
    '_editor_limit()', '_editor_limit_on(uuid)', '_account_editor_grants(uuid)', '_account_editor_slots(uuid)',
    '_account_editor_count(uuid)', '_editor_admit(uuid, uuid, text)', '_editor_refuse(uuid)',
    '_notify_editor_limit(uuid, uuid, uuid, text)', '_notify_joined_as_viewer(uuid, uuid, uuid)',
    '_editor_limit_fallback(uuid, uuid, uuid, text, boolean)',
  ]) assert.ok(sql.includes(`revoke execute on function public.${h} from public, anon, authenticated;`), `${h} is not revoked`);
  for (const f of ['get_editor_capacity(uuid, uuid)', 'ask_owner_for_editor_slot(uuid, uuid)', 'list_my_account_editors()']) {
    assert.ok(sql.includes(`revoke execute on function public.${f} from public, anon;`), `${f}: anon`);
    assert.ok(sql.includes(`grant execute on function public.${f} to authenticated;`), `${f}: authenticated`);
  }
  assert.match(sql, /has_function_privilege\('anon'/);
  assert.match(sql, /has_function_privilege\('authenticated'/);
  assert.match(sql, /commit;\s*$/);
  for (const fn of ['get_editor_capacity', 'ask_owner_for_editor_slot', 'list_my_account_editors', '_editor_admit', '_account_editor_slots'])
    assert.equal(definitionsOf(fn).length, 1, `${fn} is defined once (no overloads)`);
});
