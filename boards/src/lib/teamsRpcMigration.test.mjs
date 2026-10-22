// 0532/0533: the team RPCs and the reads the Team page renders, pinned at
// the source (the latest migration definition). Who may call what, where the
// seat lock sits, what a member can never read, and the security audit's
// additions (the link table, inbox proof, offboarding, token-checked domain
// verification). teamsMigration.test.mjs pins 0522–0531.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { latestDefinition, definitionsOf, MIGRATIONS_DIR } from './migrationText.mjs';

const RPCS = '0532_teams_rpcs.sql';
const READ = '0533_teams_read.sql';
const fileText = (f) => readFileSync(join(MIGRATIONS_DIR, f), 'utf8');
const code = (s) => s.replace(/--[^\n]*/g, '');   // comments are not wiring
const def = (fn) => {
  const d = latestDefinition(fn);
  assert.ok(d, `no definition of ${fn}`);
  return d;
};
const body = (fn) => code(def(fn).body);

// Client RPCs and their exact grant signatures.
const CLIENT = {
  create_team: 'text, text, uuid[], integer',
  rename_team: 'uuid, text, text',
  create_team_workspace: 'uuid, text, text, boolean',
  preview_move_into_team: 'uuid, uuid',
  move_workspace_into_team: 'uuid, uuid, boolean',
  move_workspace_out_of_team: 'uuid, uuid',
  set_team_workspace_private: 'uuid, boolean',
  invite_to_team: 'uuid, text[], text, boolean',
  revoke_team_invite: 'uuid',
  accept_team_invite: 'uuid',
  claim_my_team_invites: '',
  set_team_role: 'uuid, uuid, text, boolean',
  remove_from_team: 'uuid, uuid',
  leave_team: 'uuid',
  add_team_seats: 'uuid, integer',
  remove_team_seat: 'uuid',
  set_team_when_full: 'uuid, text, integer',
  set_team_seat_perk: 'uuid, boolean',
  set_team_link: 'uuid, boolean, text',
  reset_team_link: 'uuid',
  peek_team_link: 'uuid',
  claim_team_link: 'uuid',
  add_team_domain: 'uuid, text',
  set_team_domain_on: 'uuid, text, boolean',
  remove_team_domain: 'uuid, text',
  my_team_offers: '',
  answer_team_offer: 'uuid, boolean',
  ask_team_for_edit: 'uuid, uuid',
  approve_team_request: 'uuid, boolean',
  keep_team_request_viewer: 'uuid',
  close_team: 'uuid',
};
const READS = { get_team: 'uuid', list_my_teams: '', list_my_team_workspaces: '' };
const INTERNAL = {
  _team_person_name: 'uuid, boolean',
  _team_notify: 'uuid, text, uuid, uuid, uuid, text, text',
  _team_event: 'uuid, text, jsonb',
  _team_seat_for: 'uuid, uuid, boolean, text, text',
  _team_norm_domain: 'text',
  _workspace_set_owner: 'uuid, uuid',
  _org_move_in: 'uuid, uuid, uuid, boolean',
  _org_remove_person: 'uuid, uuid, boolean',
  _team_link_live: 'uuid',
  _team_link_make: 'uuid, text',
  _tg_workspace_member_email: '',
};
// Admin-gated client RPCs (owner or admin of the team).
const ADMIN_GATED = [
  'rename_team', 'move_workspace_out_of_team', 'set_team_workspace_private', 'invite_to_team',
  'revoke_team_invite', 'set_team_role', 'remove_from_team', 'add_team_seats', 'remove_team_seat',
  'set_team_when_full', 'set_team_seat_perk', 'set_team_link', 'reset_team_link', 'add_team_domain',
  'set_team_domain_on', 'remove_team_domain', 'approve_team_request', 'keep_team_request_viewer',
];

test('both files are written, not applied, and end in one transaction with a grant proof', () => {
  for (const f of [RPCS, READ]) {
    const sql = fileText(f);
    assert.match(sql, /STATUS: written 2026-10-22\. NOT APPLIED until the owner says go\./, `${f}: header`);
    assert.match(sql, /^begin;$/m, `${f}: begin`);
    assert.match(sql, /commit;\s*$/, `${f}: commit`);
    assert.match(sql, /has_function_privilege\('anon'/, `${f}: proves anon`);
    assert.match(sql, /has_function_privilege\('authenticated'/, `${f}: proves authenticated`);
    assert.match(sql, /having count\(\*\) > 1/, `${f}: proves no overloads`);
    assert.doesNotMatch(code(sql), /\bdrop\s+function\b/i, `${f}: no DROP`);
  }
});

test('every function lives in its file, once (no overloads, PGRST203)', () => {
  for (const fn of Object.keys({ ...CLIENT, ...INTERNAL })) {
    assert.equal(def(fn).file, RPCS, `${fn}'s latest definition must be 0532`);
    assert.equal(definitionsOf(fn).filter((d) => d.file >= '0522').length, 1, `${fn} is defined once in 0522+`);
  }
  for (const fn of Object.keys(READS)) {
    assert.equal(def(fn).file, READ, `${fn}'s latest definition must be 0533`);
    assert.equal(definitionsOf(fn).length, 1, `${fn} is defined once`);
  }
});

test('client RPCs: signed-in only; the link preview also signed out; helpers and the Worker call are not client-callable', () => {
  const rpcs = fileText(RPCS);
  for (const [fn, sig] of Object.entries(CLIENT)) {
    assert.ok(rpcs.includes(`revoke execute on function public.${fn}(${sig}) from public, anon;`), `${fn}: revoke`);
    assert.ok(rpcs.includes(`grant execute on function public.${fn}(${sig}) to authenticated;`), `${fn}: grant`);
  }
  assert.ok(rpcs.includes('grant execute on function public.peek_team_link(uuid) to anon;'));
  for (const fn of Object.keys(CLIENT)) {
    if (fn === 'peek_team_link') continue;
    assert.ok(!rpcs.includes(`function public.${fn}(${CLIENT[fn]}) to anon`), `${fn} must not reach anon`);
  }
  for (const [fn, sig] of Object.entries(INTERNAL))
    assert.ok(rpcs.includes(`revoke execute on function public.${fn}(${sig}) from public, anon, authenticated;`), `${fn}: revoke`);
  assert.ok(rpcs.includes('revoke execute on function public.team_domain_mark_verified(uuid, text, boolean, text) from public, anon, authenticated;'));
  assert.ok(rpcs.includes("'public.team_domain_mark_verified(uuid,text,boolean,text)'"), 'the proof covers the Worker call');
  assert.match(rpcs, /has_function_privilege\('service_role', 'public\.team_domain_mark_verified/);
  const read = fileText(READ);
  for (const [fn, sig] of Object.entries(READS)) {
    assert.ok(read.includes(`revoke execute on function public.${fn}(${sig}) from public, anon;`), `${fn}: revoke`);
    assert.ok(read.includes(`grant execute on function public.${fn}(${sig}) to authenticated;`), `${fn}: grant`);
  }
});

test('every client RPC checks the caller is signed in and active, and the right team role', () => {
  for (const fn of [...Object.keys(CLIENT), ...Object.keys(READS)]) {
    if (fn === 'peek_team_link') continue;   // signed out by design; reads only the link
    assert.match(body(fn), /(?:auth\.uid\(\)|v_uid) is null or not public\._actor_active\(\)/, `${fn}: signed in and active`);
  }
  for (const fn of ADMIN_GATED) {
    const b = body(fn);
    assert.ok(b.includes('public._org_is_admin('), `${fn}: owner or admin`);
    assert.ok(b.includes("'team_not_admin'") && b.includes("'team_not_member'"), `${fn}: the hints say why`);
  }
  const close = body('close_team');
  assert.match(close, /if v_owner is null or v_owner <> v_uid then/, 'close_team: the owner alone');
  assert.ok(close.includes("'team_not_owner'"));
  for (const fn of ['create_team_workspace', 'move_workspace_into_team', 'preview_move_into_team'])
    assert.ok(body(fn).includes("'team_seats_ask_admin'"), `${fn}: a viewer is told to ask for a seat`);
  assert.ok(body('invite_to_team').includes("p_role = 'admin' and public._org_role(p_org_id, v_uid) <> 'owner'"),
    'only the owner invites admins');
  assert.match(body('set_team_role'), /\(v_target = 'admin' or p_role = 'admin'\) and v_me <> 'owner'/,
    'only the owner makes or unmakes admins');
});

const LOCK = "pg_advisory_xact_lock(hashtext('team_seats:' ||";
const rpcNames = () => [...code(fileText(RPCS)).matchAll(/create or replace function public\.(\w+)\(/g)].map((m) => m[1]);

test('locks: the team lock comes before every row lock, and what was read before it is read again', () => {
  // A team action that locked a row and then waited for the team lock could
  // hold what another, holding the team lock, waits for (amendment G).
  for (const fn of rpcNames()) {
    const b = body(fn);
    const row = b.search(/\bfor update\b/);
    if (row < 0) continue;
    if (fn === '_workspace_set_owner') continue;   // its callers hold the lock, pinned below
    const lock = b.indexOf(LOCK);
    assert.ok(lock >= 0 && lock < row, `${fn}: the team lock before its first row lock`);
  }
  for (const fn of ['_org_move_in', 'move_workspace_out_of_team', 'close_team']) {
    const b = body(fn);
    assert.ok(b.indexOf(LOCK) >= 0 && b.indexOf(LOCK) < b.indexOf('public._workspace_set_owner('), `${fn}: lock, then owner`);
  }
  const answer = body('answer_team_offer');
  assert.ok(answer.indexOf(LOCK) < answer.indexOf('insert into public.org_domain_answers'), 'answer_team_offer: lock, then write');
  assert.equal((answer.match(/from public\.my_team_offers\(\) x where x\.org_id = p_org_id/g) || []).length, 2,
    'answer_team_offer: the offer, and the offer again under the lock');
  const preview = body('preview_move_into_team');
  assert.ok(preview.indexOf(LOCK) < preview.indexOf('select o.seats into v_before'), 'preview: the count before is read under the lock');
  // Read unlocked, then locked and read again.
  assert.match(body('accept_team_invite'), /select oi\.org_id, oi\.email into v_org, v_for from public\.org_invites oi where oi\.token = p_token;/);
  assert.match(body('claim_team_link'), /select l\.org_id into v_org from public\.org_invite_links l where l\.token = p_token;/);
  assert.match(body('approve_team_request'), /select r\.org_id into v_org from public\.org_join_requests r where r\.id = p_request_id;/);
  assert.match(body('move_workspace_out_of_team'), /where w\.id = p_workspace_id and w\.org_id = v_org for update;/);
  assert.match(body('set_team_workspace_private'), /where w\.id = p_workspace_id and w\.org_id = v_org for update;/);
  assert.match(body('close_team'), /perform 1 from public\.organizations o where o\.id = p_org_id and o\.closed_at is null for update;/);
  assert.match(body('claim_my_team_invites'),
    /where oi\.id = r\.id and oi\.claimed_at is null and oi\.revoked_at is null and oi\.expires_at > now\(\)\s+for update;/);
  assert.doesNotMatch(body('claim_my_team_invites'), /for update of oi/, 'no invite is locked before its team');
});

test('seats: the team lock comes before any seat arithmetic, and the ceiling is the row\'s, never a literal', () => {
  for (const fn of ['_org_move_in', 'invite_to_team', 'add_team_seats', 'remove_team_seat', 'set_team_role',
                    'approve_team_request', 'remove_from_team', 'leave_team', 'close_team', 'create_team_workspace',
                    'move_workspace_out_of_team', 'set_team_workspace_private', 'accept_team_invite',
                    'claim_my_team_invites', 'claim_team_link', 'answer_team_offer', 'preview_move_into_team']) {
    const b = body(fn);
    const lock = b.indexOf(LOCK);
    assert.ok(lock > 0, `${fn}: takes the team seat lock`);
    for (const call of ['_org_add_seats(', '_team_seat_for(', '_team_seats_used(', '_team_seat_slots(', '_org_remove_person(']) {
      const at = b.indexOf(call);
      if (at >= 0) assert.ok(lock < at, `${fn}: lock before ${call}`);
    }
  }
  for (const f of [RPCS, READ]) assert.doesNotMatch(code(fileText(f)), /\b100\b/, `${f}: no literal 100 (amendment B)`);
  const add = body('add_team_seats');
  assert.match(add, /if v_seats \+ p_n > v_ceiling then/);
  assert.ok(add.includes("hint = 'team_seats_ceiling'"));
  const create = body('create_team');
  assert.match(create, /returning id, seat_ceiling into v_org, v_ceiling;/);
  assert.match(create, /if p_seats > v_ceiling then/);
  assert.equal((create.match(/insert into public\.org_seat_changes/g) || []).length, 1, 'create_team: the one create row');
  assert.ok(create.includes("'create', v_uid)"));
  assert.doesNotMatch(create, /update public\.organizations/, 'create_team: no other seat write');
  assert.ok(create.includes("hint = 'team_exists'"));
  assert.ok(create.includes("pg_advisory_xact_lock(hashtext('team_create:'"), 'one open team per owner, even with two tabs');
  assert.ok(body('remove_team_seat').includes('greatest(3, v_used)'), 'never below 3 or below what is used');
  const seatFor = body('_team_seat_for');
  assert.doesNotMatch(seatFor, /when_full|_team_admit/, "an admin's action never consults the when-full rule");
});

test('S2a sends no email: invites are stored, and team member rows are quiet', () => {
  for (const f of [RPCS, READ]) assert.doesNotMatch(code(fileText(f)).replace(/create or replace function public\._tg_workspace_member_email[\s\S]*?\$\$;/, ''), /_notify_email\(/, `${f}: no email`);
  const t = def('_tg_workspace_member_email');
  assert.equal(t.file, RPCS);
  for (const s of ["new.role = 'service'", "current_setting('soleil.ws_link_join', true) = '1'",
                   "current_setting('soleil.quiet_member_email', true) = '1'"])
    assert.ok(t.body.includes(s), `the member email trigger keeps ${s}`);
  for (const fn of ['_workspace_set_owner', 'create_team_workspace', 'approve_team_request', 'close_team']) {
    const b = body(fn);
    const quiet = b.indexOf("set_config('soleil.quiet_member_email', '1', true)");
    const insert = b.indexOf('insert into public.workspace_members');
    assert.ok(quiet >= 0 && (insert < 0 || quiet < insert), `${fn}: quiet before a member row`);
  }
});

test('workspaces: a team workspace is born with one root, and nothing else writes parent_board_id', () => {
  const c = body('create_team_workspace');
  assert.match(c, /insert into public\.boards \(workspace_id, parent_board_id, name, view, created_by\)\s+values \(v_ws, null,/);
  assert.ok(c.indexOf('insert into public.board_state') > c.indexOf('insert into public.boards'));
  assert.match(c, /values \(coalesce\(nullif\(btrim\(p_name\), ''\), 'Workspace'\), v_owner, p_org_id,/, 'created_by is the team owner');
  // 0522–0531 are pinned by teamsMigration.test.mjs (0530's personal-workspace
  // re-emit makes a root of its own).
  for (const f of [RPCS, READ]) {
    const sql = code(fileText(f));
    assert.doesNotMatch(sql, /\bset\s+parent_board_id\b/i, `${f}: no parent_board_id update`);
    const inserts = sql.match(/insert into (?:public\.)?boards \([^)]*parent_board_id/gi) || [];
    assert.equal(inserts.length, f === RPCS ? 1 : 0, `${f}: only create_team_workspace's root insert`);
  }
  assert.ok(body('_org_move_in').includes('public._ensure_workspace_root(p_ws, p_actor)'));
  assert.ok(body('move_workspace_out_of_team').includes('public._ensure_workspace_root(p_workspace_id, v_to)'));
  // The storage move is transfer_workspace_ownership's (0412:144).
  const owner = body('_workspace_set_owner');
  assert.ok(owner.includes('public._image_counts(i.deleted_at, i.storage_path, i.ref_count, i.live_board_ids, i.first_referenced_at)'));
  assert.ok(owner.includes('public._storage_usage_apply(v_old, -v_bytes, -v_objects)'));
  assert.ok(owner.includes('public._storage_usage_apply(p_new_owner, v_bytes, v_objects)'));
});

test('the preview runs the real move and always undoes it', () => {
  const p = body('preview_move_into_team');
  assert.ok(p.includes('public._org_move_in(p_workspace_id, p_org_id, v_uid, true)'));
  assert.match(p, /raise exception 'preview only' using errcode = 'SLPV0';\s+exception when sqlstate 'SLPV0' then/);
  assert.ok(body('move_workspace_into_team').includes('coalesce(p_add_seats, false) and public._org_is_admin(p_org_id, v_uid)'),
    'only an owner or admin may add seats on a move');
});

test('closing keeps everyone\'s access as explicit rows and never lowers one', () => {
  const c = body('close_team');
  assert.match(c, /on conflict \(workspace_id, user_id\) do update\s+set role = excluded\.role\s+where public\._ws_role_rank\(excluded\.role\) > public\._ws_role_rank\(workspace_members\.role\)\s+and workspace_members\.role not in \('owner', 'service'\);/);
  const write = c.indexOf('public._org_ws_role_for(w.id, m.user_id)');
  assert.ok(write > 0 && write < c.indexOf('update public.organizations o set closed_at = now()'),
    'roles are read while the team is still open');
  assert.ok(write < c.indexOf('delete from public.org_members'));
});

test('requests: one core from 0531, and asking never grants', () => {
  for (const f of [RPCS, READ]) {
    assert.doesNotMatch(code(fileText(f)), /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?_team_request\s*\(/i,
      `${f} must not define _team_request (amendment D)`);
  }
  assert.ok(body('claim_team_link').includes("public._team_request(v_link.org_id, v_uid, 'member', 'team_link', null, null)"));
  assert.ok(body('answer_team_offer').includes("public._team_request(p_org_id, v_uid, 'member', 'domain', null, null)"));
  const ask = body('ask_team_for_edit');
  for (const s of ["return 'not_in_team';", "return 'can_edit';", "'already_sent'", "'sent'", "'ask', p_workspace_id, p_board_id)"])
    assert.ok(ask.includes(s), `ask_team_for_edit: ${s}`);
  assert.ok(ask.includes('public.can_write_board(p_board_id)') && ask.includes('public._workspace_member_can_write(p_workspace_id)'));
  assert.doesNotMatch(ask, /insert into public\.(workspace_members|board_shares|org_members)|update public\.(workspace_members|board_shares|org_members)/,
    'asking never grants, even with a seat free (decision 10)');
  const approve = body('approve_team_request');
  assert.ok(approve.indexOf("public._team_seat_for(") < approve.indexOf("if v_r.wanted = 'member' then"), 'a seat before the grant');
  assert.ok(approve.includes("'approve', 'team_seats_full')"));
});

test('the team link: its own table, live like a workspace link, every join counted', () => {
  for (const f of [RPCS, READ]) assert.doesNotMatch(code(fileText(f)), /\blink_(token|on|role)\b/, `${f}: the old organizations columns are gone`);
  const live = body('_team_link_live');
  for (const s of ['l.revoked_at is null', 'l.expires_at > now()',
                   '(select count(*) from public.org_invite_link_joins j where j.token = l.token) < l.max_uses',
                   'not public._sharer_suspended(l.created_by)', 'p.send_hold_at is not null',
                   'o.closed_at is null', 'not public._user_banned(o.owner_id)', "m.role in ('owner', 'admin')"])
    assert.ok(live.includes(s), `_team_link_live lacks ${s}`);
  // The numbers are create_workspace_invite_link's (0450).
  const ws = code(def('create_workspace_invite_link').body);
  const make = body('_team_link_make');
  for (const c of ['c_uses', 'c_new_uses', 'c_days', 'c_new_days']) {
    const n = ws.match(new RegExp(`${c}\\s+constant integer := (\\d+);`));
    assert.ok(n, `create_workspace_invite_link has ${c}`);
    assert.match(make, new RegExp(`${c}\\s+constant integer := ${n[1]};`), `_team_link_make: ${c} = ${n[1]}`);
  }
  assert.ok(make.includes('public._account_is_new()') && make.includes('public._actor_can_send()'));
  for (const fn of ['peek_team_link', 'claim_team_link']) assert.ok(body(fn).includes('public._team_link_live(p_token)'), `${fn}: live`);
  const claim = body('claim_team_link');
  assert.match(claim, /from public\.org_invite_links l where l\.token = p_token for update;/, 'one join at a time');
  assert.ok(claim.includes('insert into public.org_invite_link_joins (token, user_id)'));
  for (const fn of Object.keys(CLIENT)) {
    for (const m of body(fn).matchAll(/_team_event\([^;]*;/g))
      assert.doesNotMatch(m[0], /token/i, `${fn}: a link token never reaches analytics (0474)`);
  }
  const set = body('set_team_link');
  assert.ok(set.includes('public._team_link_make(p_org_id, p_role)'));
  assert.match(set, /if p_on is false then\s+update public\.org_invite_links l set revoked_at = now\(\)/);
  const reset = body('reset_team_link');
  assert.ok(reset.indexOf('set revoked_at = now()') < reset.indexOf('_team_link_make('), 'revoke, then make');
  assert.ok(body('close_team').includes('update public.org_invite_links l set revoked_at = now()'), 'closing turns the link off');
});

test('domains: normalised, never free mail, and verified only with the row\'s current token', () => {
  const add = body('add_team_domain');
  for (const h of ['team_domain_invalid', 'team_domain_freemail', 'team_domain_taken']) assert.ok(add.includes(`hint = '${h}'`), `add_team_domain: ${h}`);
  assert.ok(add.includes('public._freemail_domain(v_domain)'));
  assert.ok(add.includes("'soleil-verification=' || v_row.verify_token"), 'TXT value (decision 13)');
  const d = def('team_domain_mark_verified');
  assert.match(d.body, /team_domain_mark_verified\(p_org_id uuid, p_domain text, p_ok boolean default true,\s+p_token text default null\)/);
  const v = code(d.body);
  const off = v.slice(v.indexOf('if not coalesce(p_ok, true) then'), v.indexOf('return false;'));
  assert.match(off, /set verified_at = null/, 'a failed re-check clears verified_at');
  assert.doesNotMatch(off, /p_token|verify_token/, '... whatever the token');
  const on = v.slice(v.indexOf('return false;'));
  assert.ok(on.includes('and p_token is not null and d.verify_token = p_token'), 'verified only with the current token');
  assert.ok(on.includes("hint = 'team_domain_taken'"));
});

test('inbox proof before any invite or domain offer is taken', () => {
  for (const fn of ['accept_team_invite', 'claim_my_team_invites', 'my_team_offers', 'answer_team_offer']) {
    const b = body(fn);
    const proof = b.indexOf('if not public._session_proves_inbox() then');
    assert.ok(proof > 0, `${fn}: proves the inbox`);
    for (const w of ['insert into', 'update public.org_invites', 'return query']) {
      const at = b.indexOf(w);
      if (at >= 0) assert.ok(proof < at, `${fn}: proof before ${w}`);
    }
  }
  // A deliberate click says why; the boot calls take nothing and say nothing.
  for (const fn of ['accept_team_invite', 'answer_team_offer'])
    assert.ok(body(fn).includes("hint = 'team_inbox_unproven'"), `${fn}: says why`);
  assert.match(body('claim_my_team_invites'), /if not public\._session_proves_inbox\(\) then\s+return 0;/);
  assert.match(body('my_team_offers'), /if not public\._session_proves_inbox\(\) then\s+return;/);
  // A users row proves only that someone typed the address (security session, 2026-10-22).
  for (const f of [RPCS, READ])
    assert.doesNotMatch(code(fileText(f)), /email_confirmed_at|last_sign_in_at/, `${f}: the inbox proof is the only gate`);
  for (const f of [RPCS, READ]) {
    for (const h of ['_session_proves_inbox', '_offboard_member'])
      assert.doesNotMatch(code(fileText(f)), new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+(?:public\\.)?${h}\\s*\\(`, 'i'),
        `${f} must not define ${h} (the security session's)`);
  }
  // Both are live before 0532 applies, or it doesn't.
  const rpcs = fileText(RPCS);
  assert.ok(rpcs.includes("to_regprocedure('public._session_proves_inbox()') is null"));
  assert.ok(rpcs.includes("to_regprocedure('public._offboard_member(uuid,uuid)') is null"));
  // The domain answers stay with the person: only the offer and its answer
  // read them; leaving or being removed writes 'declined' and reads nothing.
  for (const [f, allowed] of [[RPCS, ['my_team_offers', 'answer_team_offer', '_org_remove_person']], [READ, []]]) {
    const sql = code(fileText(f));
    const fns = [...sql.matchAll(/create or replace function public\.(\w+)\(/g)].map((m) => m[1]);
    for (const fn of fns) {
      if (allowed.includes(fn)) continue;
      assert.doesNotMatch(body(fn), /org_domain_answers/, `${fn} must not read org_domain_answers`);
    }
  }
  assert.doesNotMatch(body('_org_remove_person'), /from public\.org_domain_answers/, '_org_remove_person only writes the answer');
});

test('invite_to_team: every address gets an invite, and nothing says whether an account has it', () => {
  const b = body('invite_to_team');
  assert.doesNotMatch(b, /insert into public\.org_members/, 'never a place without the invite');
  assert.doesNotMatch(b, /_team_notify\(/, 'an invite tells no account anything');
  assert.doesNotMatch(b, /'added'|'unavailable'|'add'/, 'no answer that depends on an account');
  assert.doesNotMatch(b, /_user_banned|_is_service_identity/, 'no account is looked at');
  assert.equal((b.match(/auth\.users/g) || []).length, 1, 'auth.users is read once: the roster match');
  assert.ok(b.includes('from public.org_members m join auth.users u on u.id = m.user_id'));
  assert.ok(b.includes('insert into public.org_invites (org_id, email, role, invited_by)'));
  assert.ok(b.includes("jsonb_build_object('invited', v_invited, 'already', v_already, 'skipped', v_skipped)"));
  assert.ok(b.includes('public._actor_can_send()'), 'an invite waits on the send hold, as a link does');
  assert.match(b, /if v_need > 0 and v_used \+ v_need > v_seats then/, 'a viewer invite never needs a seat');
  assert.doesNotMatch(code(fileText(RPCS)), /'added'/, "no member row says 'added'");
});

test('a removal sticks: invites end, no offer, and the link refuses until an admin invites again', () => {
  const r = body('_org_remove_person');
  assert.match(def('_org_remove_person').body, /_org_remove_person\(p_org uuid, p_user uuid, p_removed boolean\)/);
  assert.match(r, /update public\.org_invites oi\s+set revoked_at = now\(\)\s+where oi\.org_id = p_org and oi\.email = v_email/);
  assert.match(r, /delete from public\.pending_invites pi\s+using public\.workspaces w\s+where w\.id = pi\.workspace_id and w\.org_id = p_org/);
  assert.match(r, /insert into public\.org_domain_answers \(org_id, user_id, answer\)\s+values \(p_org, p_user, 'declined'\)/);
  assert.match(r, /if p_removed then\s+insert into public\.org_removals/);
  assert.ok(r.indexOf('if p_removed then') < r.indexOf("'team.removed'"), 'only a removal is told');
  const claim = body('claim_team_link');
  const removed = claim.indexOf('from public.org_removals x where x.org_id = v_link.org_id and x.user_id = v_uid');
  assert.ok(removed > 0 && removed < claim.indexOf('public._team_admit('), 'the link checks the removal before admitting');
  assert.ok(claim.includes("'removed'::text"));
  assert.ok(body('my_team_offers').includes('from public.org_removals x where x.org_id = o.id and x.user_id = u.id'));
  for (const fn of ['accept_team_invite', 'claim_my_team_invites'])
    assert.ok(body(fn).includes('delete from public.org_removals x where x.org_id = v_inv.org_id and x.user_id = v_uid'),
      `${fn}: an admin's invite brings them back`);
  for (const fn of rpcNames()) {
    if (['_org_remove_person', 'accept_team_invite', 'claim_my_team_invites'].includes(fn)) continue;
    assert.doesNotMatch(body(fn), /(insert into|delete from|update) public\.org_removals/, `${fn} must not write org_removals`);
  }
});

test('the team link: an address match alone takes no seat without the inbox', () => {
  const claim = body('claim_team_link');
  assert.match(claim, /if v_admit = 'already' and not public\._session_proves_inbox\(\)\s+and not exists \(select 1 from public\._team_seat_slots\(v_link\.org_id\) s where s\.user_id = v_uid\) then\s+v_admit := 'full';/);
});

test('private, moving out, creating: who keeps what', () => {
  const p = body('set_team_workspace_private');
  const flip = p.indexOf("if coalesce(p_private, false) and v_was = 'team' then");
  assert.ok(flip > 0, 'only a flip to private offboards');
  const loop = p.slice(flip);
  assert.ok(loop.includes("m.role in ('member', 'viewer')"), 'owner and admins keep every workspace');
  assert.match(loop, /not exists \(select 1 from public\.workspace_members wm\s+where wm\.workspace_id = p_workspace_id and wm\.user_id = m\.user_id\)/,
    'a row of their own keeps it');
  assert.ok(loop.includes('public._offboard_member(p_workspace_id, v_p)'));
  const out = body('move_workspace_out_of_team');
  assert.match(out, /if v_to <> v_owner and v_uid <> v_owner then\s+raise exception[^;]*hint = 'team_not_owner';/,
    'only the owner gives a team workspace to anyone but the owner');
  // A new account: create_workspace_with_root's number (0375), team workspaces counted.
  const c = body('create_team_workspace');
  const n = code(def('create_workspace_with_root').body).match(/c_new_account_workspaces constant integer := (\d+);/);
  assert.ok(n, 'create_workspace_with_root has the new-account number');
  assert.match(c, new RegExp(`c_new_account_workspaces constant integer := ${n[1]};`));
  assert.ok(c.includes('public._account_is_new()'));
  assert.match(c, /where w\.org_id is not null and b\.parent_board_id is null and b\.created_by = v_uid/);
  assert.match(c, /errcode = '54000', hint = 'new_account'/);
  for (const fn of ['create_team_workspace', '_org_move_in']) {
    assert.match(body(fn), /if v_status <> 'active' then\s+raise exception[^;]*hint = 'team_view_only';/, `${fn}: a view-only team gains none`);
  }
  const approve = body('approve_team_request');
  assert.match(approve, /if public\._user_banned\(v_r\.user_id\) then[\s\S]*?return 'cancelled';/, 'the cancel is returned, not raised away');
});

test('notices: one a day per person, kind, team and workspace', () => {
  const n = body('_team_notify');
  for (const s of ['n.user_id = p_user', 'n.kind = p_kind', "n.data ->> 'org_id' = p_org::text",
                   'n.workspace_id is not distinct from p_workspace', "n.created_at > now() - interval '24 hours'"])
    assert.ok(n.includes(s), `_team_notify dedupes on ${s}`);
  assert.ok(n.indexOf("interval '24 hours'") < n.indexOf('insert into public.notifications'));
});

test('offboarding runs before a seat frees, and for everyone a move-out cuts off', () => {
  const r = body('_org_remove_person');
  const off = r.indexOf('public._offboard_member(v_ws, p_user)');
  assert.ok(off > 0, '_org_remove_person offboards');
  assert.match(r, /for v_ws in select w\.id from public\.workspaces w where w\.org_id = p_org loop/, 'in every team workspace');
  for (const d of ['delete from public.org_members', 'delete from public.workspace_members', 'delete from public.board_shares'])
    assert.ok(off < r.indexOf(d), `offboard before ${d}`);
  const m = body('move_workspace_out_of_team');
  const lost = m.indexOf('public._org_ws_role_for(p_workspace_id, m.user_id) is not null');
  const clear = m.indexOf('set org_id = null, org_visibility = null');
  const call = m.indexOf('public._offboard_member(p_workspace_id, v_p)');
  assert.ok(lost > 0 && lost < clear && clear < call, 'who loses access is read before, offboarded after the org is cleared');
  assert.match(m, /continue when exists \(select 1 from public\.workspace_members wm\s+where wm\.workspace_id = p_workspace_id and wm\.user_id = v_p\);/,
    'an explicit row keeps its access');
  assert.ok(body('remove_from_team').includes('public._org_remove_person(p_org_id, p_user_id, true)'));
  assert.ok(body('leave_team').includes('public._org_remove_person(p_org_id, auth.uid(), false)'));
  // An admin made a member or a viewer stops reaching the private workspaces.
  const s = body('set_team_role');
  const demote = s.indexOf("if v_target = 'admin' then");
  const leave = s.indexOf('public._offboard_member(v_ws, p_user_id)');
  assert.ok(demote > 0 && demote < leave, 'set_team_role offboards a demoted admin');
  assert.match(s.slice(demote, leave),
    /w\.org_id = p_org_id and w\.org_visibility = 'private'\s+and not exists \(select 1 from public\.workspace_members wm\s+where wm\.workspace_id = w\.id and wm\.user_id = p_user_id\)/,
    'from each private team workspace they hold no row in');
  assert.ok(leave < s.indexOf('update public.org_members m set role = p_role'), 'before the role changes');
});

test('get_team: role first, addresses only for admins, the admin parts null for everyone else', () => {
  const d = def('get_team');
  const b = code(d.body);
  const role = b.indexOf('v_role := public._org_role(p_org_id, v_uid);');
  assert.ok(role > 0 && role < b.indexOf('jsonb_agg'), 'the caller\'s role is checked first');
  assert.ok(b.includes("hint = 'team_not_member'"));
  assert.ok(b.includes("v_admin := v_role in ('owner', 'admin');"));
  for (const m of b.matchAll(/u\.email/g)) {
    const before = b.slice(Math.max(0, m.index - 40), m.index);
    assert.match(before, /case when v_admin then (lower\()?$/, 'every u.email sits inside case when v_admin');
  }
  for (const k of ['requests', 'seats', 'whenFull', 'joining'])
    assert.ok(b.includes(`'${k}', case when v_admin then`), `${k} is null for a member or viewer`);
  assert.match(b, /if v_admin then\s+-- Invites|if v_admin then/, 'invites only for admins');
  assert.ok(b.includes("'online', case when v_admin then") && b.includes("'lastSeenAt', case when v_admin then"),
    'presence only for admins');
  assert.ok(b.includes('public._team_person_name(e.user_id, v_admin)'), 'names fall back to an address only for admins');
  for (const k of ["'on'", "'token'", "'role'", "'expiresAt'", "'usesLeft'"]) assert.ok(b.includes(k), `joining.link has ${k}`);
  for (const k of ["'txtName'", "'txtValue'", "'ceiling'", "'bought'", "'used'", "'pending'"]) assert.ok(b.includes(k), `snapshot has ${k}`);
  assert.match(b, /v_admin or w\.org_visibility = 'team'/, 'a member never sees a private workspace they have no row in');
  // People are counted over what the caller sees: no outsider who works only
  // in a private workspace, and no `everywhere` that gives one away.
  const people = b.slice(b.indexOf('with tw as ('), b.indexOf('into v_people, v_listed'));
  assert.doesNotMatch(people, /join tw on/, 'the people part never joins every team workspace');
  assert.equal((people.match(/from public\.workspace_members wm join seen on seen\.id = wm\.workspace_id/g) || []).length, 2,
    'grants and opens: workspace rows in seen workspaces');
  assert.ok(people.includes('join seen on seen.id = b.workspace_id'), 'shares in seen workspaces');
  assert.ok(people.includes("from ins join seen on ins.role in ('owner', 'admin') or seen.org_visibility = 'team'"));
  assert.match(people, /select count\(\*\)::integer as n from seen/, '"everywhere" is every workspace the caller sees');
  const name = code(def('_team_person_name').body);
  assert.match(name, /case when p_with_email then \(select u\.email/, 'an address only when asked for');
});

test('the reads: open teams only, team workspaces without a row, no address anywhere', () => {
  const t = body('list_my_teams');
  assert.ok(t.includes('o.closed_at is null') && t.includes('m.seat'));
  const w = body('list_my_team_workspaces');
  assert.ok(w.includes('unnest(public._my_org_workspace_ids())'), 'unnest, not = any (hardening round 3)');
  assert.ok(w.includes('public._org_ws_role_for(w.id, auth.uid())'));
  assert.match(w, /not exists \(select 1 from public\.workspace_members m\s+where m\.workspace_id = w\.id and m\.user_id = auth\.uid\(\)\)/);
  for (const fn of ['list_my_teams', 'list_my_team_workspaces', 'peek_team_link'])
    assert.doesNotMatch(body(fn), /email/i, `${fn}: no address`);
  // The offers read only the caller's own address, and return none.
  assert.match(def('my_team_offers').body, /returns table \(org_id uuid, name text, letter text, color text, mode text\)/);
  assert.ok(body('my_team_offers').includes('where u.id = auth.uid()'));
});

test('every hint the app reads appears in the SQL', () => {
  const sql = code(fileText(RPCS) + fileText(READ));
  for (const h of ['teams_closed', 'team_exists', 'team_seats_full', 'team_seats_ceiling', 'team_seats_ask_admin',
                   'team_seats_needed', 'team_workspace', 'team_owner', 'team_domain_freemail', 'team_domain_taken',
                   'team_domain_invalid', 'team_not_member', 'team_not_admin', 'team_not_owner', 'team_inbox_unproven',
                   'team_view_only', 'new_account']) {
    if (h === 'teams_closed') continue;   // raised by 0522's gate trigger
    assert.ok(sql.includes(`'${h}'`), `no SQL raises ${h}`);
  }
  assert.ok(body('invite_to_team').includes('detail = v_short::text'),
    'team_seats_needed carries the shortfall in detail');
});
