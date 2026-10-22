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
const SEATS = '0531_teams_seats.sql';   // re-emits _editor_admit, _editor_refuse, _editor_limit_fallback,
                                        // get_editor_capacity, ask_owner_for_editor_slot, _account_editor_grants
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
    '_editor_limit()', '_editor_limit_on(uuid)', '_editor_limit_owner_first_name(uuid)',
    '_account_editor_grants(uuid)', '_account_editor_slots(uuid)',
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
  // 0531 (teams) re-emits three of them with a team branch, same signature.
  const RE_EMITTED = { get_editor_capacity: SEATS, ask_owner_for_editor_slot: SEATS, _editor_admit: SEATS };
  for (const fn of ['get_editor_capacity', 'ask_owner_for_editor_slot', 'list_my_account_editors', '_editor_admit', '_account_editor_slots'])
    assert.deepEqual(definitionsOf(fn).map((d) => d.file), [CORE, RE_EMITTED[fn]].filter(Boolean),
      `${fn} is defined in 0520${RE_EMITTED[fn] ? ' and re-emitted in 0531' : ' only'} (no overloads)`);
});

test('the notices are worded as the owner picked (B): whose plan, curly quotes, names', () => {
  const n = def('_notify_editor_limit').body;
  assert.ok(n.includes("'%s has %s people who can edit, the most it allows.'"));
  assert.ok(n.includes("'%s already has %s people who can edit.'"));
  assert.ok(n.includes("'Your plan'"), 'the owner hears "Your plan"');
  assert.ok(n.includes("'’s plan'") && n.includes("'The owner’s plan'"), 'a co-owner hears whose plan');
  assert.ok(n.includes("'“' || coalesce(v_board, v_ws) || '”'"), 'the place sits in curly quotes');
  const j = def('_notify_joined_as_viewer').body;
  assert.ok(j.includes("'%s already has %s people who can edit, so you can view for now. We told %s.'"));
  assert.ok(j.includes("'Its owner’s plan'") && j.includes("'the owner'"));
  for (const b of [n, j]) assert.doesNotMatch(code(b), /'"' \|\|/, 'no straight quotes round a name');
  assert.match(code(def('_editor_limit_owner_first_name').body), /not like '%@%'/, 'an address is never a name');
});

test('the owner\'s list says where each place is, so the app can free it', () => {
  assert.match(def('_account_editor_grants').body,
    /returns table\s*\(\s*user_id uuid,\s*email text,\s*source text,\s*workspace_id uuid,\s*board_id uuid,\s*role text,\s*invite_id uuid,\s*sent_at timestamptz\s*\)/i);
  const d = def('list_my_account_editors');
  assert.match(d.body,
    /returns table\s*\(\s*slot_key text,\s*user_id uuid,\s*email text,\s*display_name text,\s*source text,\s*grants jsonb\s*\)/i);
  const l = code(d.body);
  for (const k of ["'source'", "'role'", "'workspace_id'", "'workspace_name'", "'board_id'", "'board_name'", "'invite_id'", "'sent_at'"])
    assert.ok(l.includes(k), `a grant lacks ${k}`);
  assert.match(l, /with g as materialized \(/, 'the grants are read once, not once per row');
});

const REFUSING = ['share_board', 'invite_workspace_member', 'set_workspace_member_role', 'restore_board_share'];
const CLAIMS = ['claim_collab_link', 'claim_workspace_invite_link'];

test('every door an editor comes in through checks the limit, and 0188\'s brake is gone', () => {
  for (const fn of [...REFUSING, ...CLAIMS]) {
    const d = latestDefinition(fn);
    if (!d || d.file !== DOORS) continue;   // Task 4 adds the claims
    assert.match(code(d.body), /public\._editor_admit\(/, `${fn} must check the limit`);
    assert.doesNotMatch(code(d.body), /_collab_editor_cap/, `${fn} still calls 0188's brake`);
  }
  for (const fn of REFUSING) assert.equal(def(fn).file, DOORS, `${fn}'s latest definition must be 0521`);
});

test('the doors that must not check: a claimed invite held its place when sent; a transfer is the freeze', () => {
  for (const fn of ['claim_pending_invite', '_claim_pending_invites_for_user', 'transfer_workspace_ownership',
                    'prepare_account_deletion', 'service_account_register', 'create_collab_link',
                    'create_workspace_invite_link']) {
    const d = latestDefinition(fn);
    assert.ok(d, `no definition of ${fn}`);
    assert.doesNotMatch(code(d.body), /_editor_admit\(/, `${fn} must not check the limit`);
  }
});

test('a refusing door checks only for an editor, and before it spends an invite or writes the row that emails', () => {
  for (const fn of ['share_board', 'invite_workspace_member']) {
    const b = code(def(fn).body);
    const pending = b.slice(b.indexOf('if v_user is null then'));
    assert.ok(pending.indexOf('_editor_admit(') > 0
      && pending.indexOf('_editor_admit(') < pending.indexOf('_invite_budget_take()'), `${fn}: a waiting invite checks first`);
    const last = b.lastIndexOf('_editor_admit(');
    assert.ok(last < b.lastIndexOf('_invite_budget_take()'), `${fn}: an account checks before the budget`);
    for (const m of b.matchAll(/_editor_admit\(/g)) {
      const before = b.slice(Math.max(0, m.index - 120), m.index);
      assert.match(before, /if p_role = 'editor' then\s+if public\.$/, `${fn}: only an editor grant is checked`);
    }
  }
  const share = code(def('share_board').body);
  const found = share.slice(share.indexOf('if FOUND then'));
  assert.ok(found.indexOf('you can only change the access of people you invited') < found.indexOf('_editor_admit('),
    'share_board: the "people you invited" rule still answers first');
  assert.ok(found.indexOf('_editor_admit(') < found.indexOf('update board_shares'), 'share_board: a viewer → editor change checks');
  const inv = code(def('invite_workspace_member').body);
  assert.ok(inv.indexOf("return 'already_member';") < inv.lastIndexOf('_editor_admit('),
    'invite_workspace_member: an existing member is "already a member", never "full"');
  const role = code(def('set_workspace_member_role').body);
  assert.match(role, /if p_role in \('coowner', 'editor'\)\s+and exists \(select 1 from workspace_members m[\s\S]*?m\.role = 'viewer'\) then\s+if public\._editor_admit\(p_workspace_id, p_user_id, null\) = 'full' then/,
    'set_workspace_member_role: only a viewer made an editor or co-owner is checked');
  const restore = code(def('restore_board_share').body);
  assert.match(restore, /if r\.role = 'editor' then\s+if public\._editor_admit\(v_workspace, r\.user_id, null\) = 'full' then/);
  for (const fn of REFUSING) assert.match(code(def(fn).body), /perform public\._editor_refuse\(/, `${fn} refuses`);
});

test('an edit link opened when full lets them in as a viewer, tells them and the owner, and never refuses', () => {
  for (const [fn, via] of [['claim_collab_link', 'collab_link'], ['claim_workspace_invite_link', 'workspace_link']]) {
    const d = def(fn);
    assert.equal(d.file, DOORS, `${fn}'s latest definition must be 0521`);
    const b = code(d.body);
    assert.match(b, /if v_link\.role = 'editor' then\s+if public\._editor_admit\(/, `${fn}: only an edit link is checked`);
    assert.match(b, /v_role := 'viewer';\s+v_fallback := true;/, `${fn}: falls back to viewer`);
    assert.ok(b.includes(`'${via}', false)`), `${fn}: notices and event on a fresh join`);
    assert.doesNotMatch(b, /_editor_refuse\(/, `${fn}: a link never refuses`);
    assert.doesNotMatch(b, /_collab_editor_cap/, `${fn}: 0188's brake is gone`);
    assert.doesNotMatch(b, /v_link\.role, auth\.uid\(\)/, `${fn}: the role granted is v_role, not the link's`);
  }
  const c = code(def('claim_collab_link').body);
  const up = c.slice(c.indexOf("if v_existing.role = 'viewer' and v_link.role = 'editor' then"));
  assert.ok(up.indexOf('_editor_admit(') < up.indexOf("set role = 'editor'"), 'the upgrade checks before it upgrades');
  assert.ok(up.includes("'collab_link', true)"), 'a blocked upgrade is logged as one');
});

test('the claims keep their shape and words (AuthGate, check_instrumentation 0472 and the link tests read them)', () => {
  assert.match(def('claim_collab_link').body,
    /returns table\s*\(\s*workspace_id uuid,\s*board_id uuid,\s*role text,\s*status text\s*\)/i);
  assert.match(def('claim_workspace_invite_link').body,
    /returns table\s*\(\s*workspace_id uuid,\s*role text,\s*status text\s*\)/i);
  const c = def('claim_collab_link').body;
  for (const s of ["'noop'::text", "'upgraded'::text", "'already'::text", "v_status       text := 'joined'"]) assert.ok(c.includes(s), `claim_collab_link lost ${s}`);
  const w = def('claim_workspace_invite_link').body;
  for (const s of ["'dead'::text", "'member'::text", "'joined'::text", "'status', 'joined'"]) assert.ok(w.includes(s), `claim_workspace_invite_link lost ${s}`);
});

test('0521: the doors keep their grants, have no overloads, and the file proves it', () => {
  const sql = fileText(DOORS);
  for (const sig of ['share_board(uuid,text,text)', 'invite_workspace_member(uuid,text,text)',
                     'set_workspace_member_role(uuid,uuid,text)', 'restore_board_share(uuid,uuid)',
                     'claim_collab_link(uuid)', 'claim_workspace_invite_link(uuid)'])
    assert.ok(sql.includes(`'public.${sig}'`), `0521 must prove ${sig}`);
  assert.match(sql, /having count\(\*\) > 1/);
  assert.match(sql, /commit;\s*$/);
  assert.doesNotMatch(code(sql), /\bdrop\s+function\b/i, 'no DROP: create or replace keeps each ACL');
});
