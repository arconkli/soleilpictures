// 0522–0531: Teams (S2a), pinned at the source (the latest migration
// definition). The hold keeps every organization row from existing; the
// tables are RPC-only; every access path routes the team through ONE helper
// (_org_ws_role_for); and the seat count is the team's analog of the editor
// limit, branching inside S1's helpers so no door had to change.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { latestDefinition, definitionsOf, MIGRATIONS_DIR } from './migrationText.mjs';

const TABLES = '0522_teams_tables.sql';
const ACCESS = '0530_teams_access.sql';
const SEATS = '0531_teams_seats.sql';
const EDITOR_CORE = '0520_editor_limit_core.sql';
const fileText = (f) => readFileSync(join(MIGRATIONS_DIR, f), 'utf8');
const code = (s) => s.replace(/--[^\n]*/g, '');   // comments are not wiring
const flat = (s) => s.replace(/\s+/g, ' ').trim();
const def = (fn) => {
  const d = latestDefinition(fn);
  assert.ok(d, `no definition of ${fn}`);
  return d;
};
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const TEAM_TABLES = ['organizations', 'org_members', 'org_invites', 'org_invite_links', 'org_invite_link_joins',
  'org_domains', 'org_domain_answers', 'org_removals', 'org_join_requests', 'org_seat_changes'];

// ── 0522: the hold and the tables ───────────────────────────────────────────

test('0522: teams are closed until launch, and a malformed switch reads as closed', () => {
  const sql = fileText(TABLES);
  assert.ok(sql.includes(`values ('teams_open', '{"open": false, "test_owner_ids": []}'::jsonb)`));
  assert.match(sql, /on conflict \(key\) do nothing;/);
  const d = def('_teams_open_for');
  assert.equal(d.file, TABLES);
  const b = code(d.body);
  assert.match(b, /->>\s*'open'\s*=\s*'true'/, 'only a JSON true opens it');
  assert.match(b, /jsonb_typeof\(c\.value -> 'test_owner_ids'\) = 'array'/);
  assert.match(b, /coalesce\(\(/, 'no row reads as closed');
  assert.match(b, /\),\s*false\);\s*\$\$;\s*$/, 'the coalesce falls back to false');
});

test('0522: the hold sits where a row is born', () => {
  const sql = code(fileText(TABLES));
  assert.match(sql, /create trigger organizations_insert_gate\s+before insert on public\.organizations/);
  const g = code(def('_org_insert_gate').body);
  assert.match(g, /if new\.owner_id is null or not public\._teams_open_for\(new\.owner_id\) then/);
  assert.match(g, /hint = 'teams_closed'/);
});

test('0522: every team table is RPC-only (RLS on, no client grant, no policy)', () => {
  const sql = fileText(TABLES);
  const c = code(sql);
  for (const t of TEAM_TABLES) {
    assert.match(c, new RegExp(`alter table public\\.${t}\\s+enable row level security;`), `${t}: RLS`);
    assert.match(c, new RegExp(`create table public\\.${t} \\(`), `${t}: created`);
  }
  const revoke = c.match(/revoke all on table ([^;]+?)\s+from public, anon, authenticated;/);
  assert.ok(revoke, 'one revoke covers the tables');
  for (const t of TEAM_TABLES) assert.match(revoke[1], new RegExp(`public\\.${t}\\b`), `${t}: revoked`);
  assert.ok(c.includes('revoke all on sequence public.org_seat_changes_id_seq from public, anon, authenticated;'));
  assert.doesNotMatch(c, /create policy/i);
  assert.doesNotMatch(c, /\bgrant\s/i, '0522 grants nothing to anyone');
  const proof = sql.slice(sql.lastIndexOf('do $$'));
  assert.match(proof, /has_table_privilege\('anon'/);
  assert.match(proof, /has_table_privilege\('authenticated'/);
  assert.match(proof, /from pg_policies/);
  assert.match(proof, /pg_publication_tables[\s\S]*pubname = 'supabase_realtime'/, 'no team table is published to realtime');
  const loop = proof.match(/foreach t in array array\[([\s\S]*?)\] loop/);
  assert.ok(loop, 'one proof loop covers the tables');
  const listed = [...loop[1].matchAll(/'(\w+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(listed, [...TEAM_TABLES].sort(), 'the proof loop covers every team table');
});

test('0522: an address never becomes a place by itself, and a removal is kept (amendment G)', () => {
  const c = code(fileText(TABLES));
  assert.match(c, /joined_via text not null check \(joined_via in \('create', 'invite', 'link', 'domain', 'request'\)\)/,
    "no 'added': every address gets an invite");
  const removals = c.slice(c.indexOf('create table public.org_removals ('), c.indexOf('create table public.org_join_requests'));
  assert.match(removals, /org_id\s+uuid not null references public\.organizations\(id\) on delete cascade/);
  assert.match(removals, /user_id\s+uuid not null references auth\.users\(id\) on delete cascade/);
  assert.match(removals, /primary key \(org_id, user_id\)/);
});

test('0522: the team link mirrors 0450 (one live link per team, joins counted), and organizations carries no link', () => {
  const c = code(fileText(TABLES));
  const orgs = c.slice(c.indexOf('create table public.organizations ('), c.indexOf('create index organizations_owner_open_idx'));
  assert.doesNotMatch(orgs, /link_token|link_on|link_role/, 'the link lives in its own table');
  const links = c.slice(c.indexOf('create table public.org_invite_links ('), c.indexOf('create table public.org_invite_link_joins'));
  for (const s of [
    /token\s+uuid primary key default gen_random_uuid\(\)/,
    /org_id\s+uuid not null references public\.organizations\(id\) on delete cascade/,
    /role\s+text not null default 'member' check \(role in \('member', 'viewer'\)\)/,
    /created_by uuid references auth\.users\(id\) on delete set null/,
    /expires_at timestamptz not null/,
    /max_uses\s+integer not null check \(max_uses between 1 and 100\)/,
    /revoked_at timestamptz/,
  ]) assert.match(links, s);
  assert.match(c, /create unique index \w+ on public\.org_invite_links \(org_id\) where revoked_at is null;/);
  const joins = c.slice(c.indexOf('create table public.org_invite_link_joins ('));
  assert.match(joins, /token\s+uuid references public\.org_invite_links\(token\) on delete cascade/);
  assert.match(joins, /user_id\s+uuid references auth\.users\(id\) on delete cascade/);
  assert.match(joins, /primary key \(token, user_id\)/);
});

test('0522: workspaces gain exactly org_id and org_visibility, paired, and no client can set them', () => {
  const c = code(fileText(TABLES));
  const added = [...c.matchAll(/add column (\w+)/g)].map((m) => m[1]);
  assert.deepEqual(added.sort(), ['org_id', 'org_visibility']);
  assert.match(c, /add column org_id uuid references public\.organizations\(id\) on delete restrict/);
  assert.match(c, /add column org_visibility text check \(org_visibility in \('team', 'private'\)\)/);
  assert.match(c, /check \(\(org_id is null\) = \(org_visibility is null\)\)/);
  assert.doesNotMatch(c, /grant[^;]*on (table )?public\.workspaces/i);
  assert.match(fileText(TABLES), /has_column_privilege\('authenticated', 'public\.workspaces', 'org_id', 'update'\)/);
});

test('0522: an open team always has its owner; amendments A, B and C are in', () => {
  const c = code(fileText(TABLES));
  assert.match(c, /owner_id\s+uuid references auth\.users\(id\) on delete set null/);
  assert.match(c, /check \(closed_at is not null or owner_id is not null\)/);
  assert.match(c, /set local lock_timeout = '3s';/, 'A: fail fast on the workspaces lock');
  assert.ok(c.indexOf('set local lock_timeout') < c.indexOf('alter table public.workspaces'));
  assert.match(c, /seat_ceiling\s+integer not null default 100 check \(seat_ceiling between 3 and 10000\)/, 'B');
  assert.match(c, /via\s+text not null check \(via in \('team_link', 'domain', 'workspace_link', 'collab_link', 'ask'\)\)/, 'C');
  assert.match(c, /seat\s+boolean generated always as \(role <> 'viewer'\) stored/, 'a viewer never holds a seat');
});

test('0522: helpers are revoked, and the file proves it and ends committed', () => {
  const sql = fileText(TABLES);
  for (const h of ['_teams_open_for(uuid)', '_org_insert_gate()', '_freemail_domain(text)'])
    assert.ok(sql.includes(`revoke execute on function public.${h} from public, anon, authenticated;`), `${h} is not revoked`);
  // The proof walks every helper for both client roles, and the identity sequence.
  assert.match(sql, /foreach t in array array\['public\._teams_open_for\(uuid\)', 'public\._org_insert_gate\(\)',\s*'public\._freemail_domain\(text\)'\] loop/);
  assert.ok(sql.includes("or has_function_privilege('authenticated', t, 'execute') then"));
  assert.ok(sql.includes("has_sequence_privilege('authenticated', 'public.org_seat_changes_id_seq', 'usage,select,update')"));
  assert.match(sql, /if public\._teams_open_for\(gen_random_uuid\(\)\) then/);
  assert.match(sql, /commit;\s*$/);
});

// ── 0530: every access path learns about teams ──────────────────────────────

// Each re-emit's latest definition is 0530, and it routes through the helper.
const ROUTED = ['is_workspace_member', '_workspace_member_can_write', 'can_manage_workspace',
  '_user_can_read_board', 'scout_can_write_board', '_file_share_reaches', '_workspace_invite_link_live',
  'merge_workspace_settings'];
const INVARIANTS = [
  // The plan's own body for the directory decides by the workspace's team and
  // can_manage_workspace (which carries the team branch), not the helper.
  ['workspace_user_directory', /case when w\.org_id is null or wm\.user_id = auth\.uid\(\) or public\.can_manage_workspace\(wm\.workspace_id\)/],
  ['get_or_create_personal_workspace', /and w\.org_id is null/],
  ['transfer_workspace_ownership', /hint = 'team_workspace'/],
  ['prepare_account_deletion', /hint = 'team_owner'/],
  ['prepare_admin_account_deletion', /hint = 'team_owner'/],
  ['my_deletion_impact', /'owns_team'/],
];

test('0530: every choke point and per-user helper is re-emitted with the team branch', () => {
  for (const fn of ROUTED) {
    const d = def(fn);
    assert.equal(d.file, ACCESS, `${fn}'s latest definition must be 0530`);
    assert.ok(code(d.body).includes('_org_ws_role_for('), `${fn} must ask _org_ws_role_for`);
  }
  for (const [fn, re] of INVARIANTS) {
    const d = def(fn);
    assert.equal(d.file, ACCESS, `${fn}'s latest definition must be 0530`);
    assert.match(code(d.body), re, `${fn} lacks its 0530 line`);
  }
});

test('0530: the re-emits keep what earlier migrations pinned', () => {
  assert.match(def('_workspace_member_can_write').body, /in \('owner', 'coowner', 'admin', 'editor', 'service'\)/);
  const manage = code(def('can_manage_workspace').body);
  assert.match(manage, /auth\.uid\(\) is not null\s+and public\._actor_active\(\)/);
  assert.match(manage, /m\.role = 'coowner'/);
  assert.match(manage, /or coalesce\(public\._org_ws_role_for\(ws, auth\.uid\(\)\) = 'coowner', false\)\s*\)/, 'a third OR inside the parenthesis');
  const t = code(def('transfer_workspace_ownership').body);
  assert.match(t, /if v_old <> auth\.uid\(\) then/);
  assert.doesNotMatch(t, /can_manage_workspace/, 'a team admin still cannot hand a workspace over');
  assert.ok(t.indexOf("hint = 'team_workspace'") < t.indexOf('update workspaces set created_by'), 'refused before it moves anything');
  for (const fn of ['prepare_account_deletion', 'prepare_admin_account_deletion']) {
    const b = code(def(fn).body);
    assert.ok(b.indexOf("hint = 'team_owner'") < b.indexOf('_deletion_heir('), `${fn}: refused before any hand-over`);
  }
  assert.match(def('prepare_account_deletion').body, /if public\._user_banned\(p_user_id\) then/);
  const merge = code(def('merge_workspace_settings').body);
  assert.match(merge, /wm\.role in \('owner', 'coowner', 'admin', 'editor'\)/);
  assert.match(merge, /_org_ws_role_for\(p_workspace_id, auth\.uid\(\)\) in \('coowner', 'editor'\)/);
  assert.match(merge, /\? 'icon_url'\s+and not public\.can_manage_workspace\(p_workspace_id\)/);
  const link = code(def('_workspace_invite_link_live').body);
  assert.match(link, /or coalesce\(public\._org_ws_role_for\(l\.workspace_id, l\.created_by\) = 'coowner', false\)/);
  const dir = code(def('workspace_user_directory').body);
  assert.match(dir, /returns table\s*\(\s*user_id\s+uuid,\s*workspace_id uuid,\s*title\s+text,\s*email\s+text,\s*created_at\s+timestamptz\s*\)/i);
  assert.match(dir, /case when w\.org_id is null or wm\.user_id = auth\.uid\(\) or public\.can_manage_workspace\(wm\.workspace_id\)\s+then u\.email end as email/,
    'in a team workspace only the owner and admins read addresses');
});

test('0530: the predicates that inherit the branch were not rewritten', () => {
  for (const [fn, file, calls] of [
    ['can_read_board', '0373_audit_suspended_accounts_act_on_nothing.sql', 'is_workspace_member('],
    // 0526 (security: a share on a trashed cluster grants nothing) re-emitted
    // can_write_board; it still reaches the team through the helper.
    ['can_write_board', '0526_trashed_shares_grant_nothing.sql', '_workspace_member_can_write('],
    ['can_write_workspace', '0318_workspace_roles_real.sql', '_workspace_member_can_write('],
  ]) {
    const d = def(fn);
    assert.equal(d.file, file, `${fn} must still be defined by ${file}`);
    assert.ok(d.body.includes(calls), `${fn} must still call ${calls}`);
  }
});

test('0530: the set readers union the team workspaces through unnest, never = any', () => {
  for (const fn of ['my_readable_board_ids', 'my_workspace_ids']) {
    const d = def(fn);
    assert.equal(d.file, ACCESS, `${fn}'s latest definition must be 0530`);
    const b = code(d.body);
    assert.match(b, /unnest\(public\._my_org_workspace_ids\(\)\)/, `${fn} must unnest _my_org_workspace_ids()`);
    assert.doesNotMatch(b, /=\s*any\s*\(/i, `${fn}: = any is not sargable`);
    assert.match(b, /public\._actor_active\(\)/, `${fn} keeps the suspend gate`);
  }
});

test('0530: _org_ws_role_for is the one rule', () => {
  const b = flat(code(def('_org_ws_role_for').body));
  assert.ok(b.includes('join public.organizations o on o.id = w.org_id and o.closed_at is null'), 'a closed team grants nothing');
  // An active team: owner/admin → coowner everywhere; member → editor and
  // viewer → viewer where the team can see; nothing on a private one.
  const active = "when m.role in ('owner', 'admin') then 'coowner' "
    + "when w.org_visibility = 'team' and m.role = 'member' then 'editor' "
    + "when w.org_visibility = 'team' and m.role = 'viewer' then 'viewer' end";
  assert.ok(b.includes(active), 'the active mapping, exactly');
  // A team that isn't active fails closed: viewer at most, and the inactive
  // branch is tested first.
  const inactive = "when o.status <> 'active' then case when m.role in ('owner', 'admin') then 'viewer' "
    + "when w.org_visibility = 'team' then 'viewer' end";
  assert.ok(b.includes(inactive), 'a team that is not active fails closed');
  assert.ok(b.indexOf(inactive) < b.indexOf("then 'coowner'"), 'the status test comes first');
  assert.equal((b.match(/\bwhen\b/g) || []).length, 6, 'no other mapping');
  assert.equal((b.match(/'coowner'|'editor'/g) || []).length, 2, 'only an active team grants writing');
  assert.ok(b.includes('p_user is not null'));
  const ids = flat(code(def('_my_org_workspace_ids').body));
  assert.ok(ids.includes('o.closed_at is null') && ids.includes("(m.role in ('owner', 'admin') or w.org_visibility = 'team')"));
});

test('0530–0535: every comparison with the team role is coalesced', () => {
  // Outside a team _org_ws_role_for answers NULL, and NULL = 'coowner' is
  // NULL. A boolean helper built on it then answers NULL for everyone with no
  // team, and `if not can_manage_workspace(…) then raise` lets them by. Probe
  // A's parity check caught can_manage_workspace doing exactly that.
  const files = [ACCESS, SEATS, '0532_teams_rpcs.sql', '0533_teams_people.sql',
    '0534_teams_joining.sql', '0535_teams_read.sql'];
  const call = 'public._org_ws_role_for(';
  let compared = 0;
  for (const f of files) {
    const s = flat(code(fileText(f)));
    for (let i = s.indexOf(call); i !== -1; i = s.indexOf(call, i + 1)) {
      let j = i + call.length;
      for (let depth = 1; depth; j++) depth += s[j] === '(' ? 1 : s[j] === ')' ? -1 : 0;
      if (!/^\s*(=|<>|!=|in \()/.test(s.slice(j))) continue;
      compared++;
      assert.ok(s.slice(0, i).endsWith('coalesce('), `${f}: ${s.slice(i, j + 16)} is not coalesced`);
    }
  }
  assert.ok(compared >= 5, 'the comparisons were found');
});

test('0530: the rooms\' re-checks are the security session\'s (0620–0622); 0530 requires them and never redefines them', () => {
  const sql = fileText(ACCESS);
  // Redefining either here would replace the security session's body after
  // it, out of file order (and the 0620 shape would not even apply: create
  // or replace can't rename parameters). The org branch reaches both through
  // my_readable_board_ids / can_write_board / is_workspace_member.
  const proof = sql.slice(sql.lastIndexOf('do $$'));
  for (const fn of ['party_board_access', 'party_workspace_access']) {
    assert.doesNotMatch(code(sql), new RegExp(`create or replace function public\\.${fn}\\(`), `${fn} is 0620–0622's`);
    assert.doesNotMatch(code(sql), new RegExp(`(grant|revoke) execute on function public\\.${fn}\\(`), `${fn}: its ACL is 0620–0622's`);
    assert.ok(proof.includes(`'public.${fn}(uuid,uuid[])'`), `the proof covers ${fn}`);
  }
  assert.match(proof, /if to_regprocedure\(v_fn\) is null then\s+raise exception '0530 needs the security session''s %/, 'the proof requires them live');
});

test('0530: the new client RPCs are signed-in only; the helpers are revoked; the file proves it', () => {
  const sql = fileText(ACCESS);
  for (const f of ['can_open_workspace(uuid)', 'my_workspace_role(uuid)']) {
    assert.ok(sql.includes(`revoke execute on function public.${f} from public, anon;`), `${f}: anon`);
    assert.ok(sql.includes(`grant execute on function public.${f} to authenticated;`), `${f}: authenticated`);
    assert.doesNotMatch(sql, new RegExp(`grant execute on function public\\.${esc(f)} to [^;]*anon`), `${f}: never anon`);
  }
  for (const h of ['_org_ws_role_for(uuid, uuid)', '_my_org_workspace_ids()', '_ws_role_rank(text)'])
    assert.ok(sql.includes(`revoke execute on function public.${h} from public, anon, authenticated;`), `${h} is not revoked`);
  assert.match(code(def('can_open_workspace').body), /auth\.uid\(\) is not null and public\._actor_active\(\) and public\.is_workspace_member\(p_workspace_id\)/);
  assert.match(code(def('my_workspace_role').body), /order by public\._ws_role_rank\(r\) desc/);
  const proof = sql.slice(sql.lastIndexOf('do $$'));
  for (const sig of ['public._org_ws_role_for(uuid,uuid)', 'public.party_board_access(uuid,uuid[])',
    'public.is_workspace_member(uuid)', 'public.can_manage_workspace(uuid)', 'public.workspace_user_directory()',
    'public._workspace_invite_link_live(uuid)', 'public._file_share_reaches(public.file_shares,uuid)',
    'public.prepare_account_deletion(uuid)', 'public.can_open_workspace(uuid)', 'public.my_workspace_role(uuid)'])
    assert.ok(proof.includes(`'${sig}'`), `the proof covers ${sig}`);
  assert.match(proof, /has_function_privilege\('service_role'/);
  assert.match(proof, /having count\(\*\) > 1/);
  assert.match(proof, /cardinality\(public\._my_org_workspace_ids\(\)\) <> 0/);
  assert.doesNotMatch(code(sql), /\bdrop\s+function\b/i, 'no DROP: create or replace keeps each ACL');
  assert.doesNotMatch(code(sql), /create policy|drop policy/i, 'no policy text changes in S2a');
  assert.match(sql, /commit;\s*$/);
});

// ── 0531: seats, and the team branch of the editor limit ────────────────────

test('0531: _editor_admit asks the team first and is otherwise 0520\'s body', () => {
  const d = def('_editor_admit');
  assert.equal(d.file, SEATS);
  const b = code(d.body);
  assert.ok(b.indexOf('_team_admit(') > 0 && b.indexOf('_team_admit(') < b.indexOf('_editor_limit_on('),
    'a team workspace never reaches the personal limit');
  const core = definitionsOf('_editor_admit').find((x) => x.file === EDITOR_CORE);
  assert.ok(core, '0520 still defines the personal body');
  const personal = b
    .replace(/\n\s*v_org\s+uuid;/, '')
    .replace('select w.created_by, w.org_id into v_owner, v_org', 'select w.created_by into v_owner')
    .replace(/if v_org is not null then\s+return public\._team_admit\(v_org, p_user, p_email\);\s+end if;/, '');
  assert.equal(flat(personal), flat(code(core.body)), 'the personal branch is byte-identical to 0520 (whitespace aside)');
});

test('0531: personal accounts count personal workspaces only', () => {
  const d = def('_account_editor_grants');
  assert.equal(d.file, SEATS);
  assert.match(code(d.body), /where w\.created_by = p_owner and w\.org_id is null/);
});

test('0531: a seat is held as 0520 holds a place, plus the team and its invites', () => {
  const g = code(def('_team_seat_grants').body);
  for (const s of [
    "m.role in ('owner', 'admin', 'member')",
    "m.role in ('owner', 'coowner', 'admin', 'editor')",
    "s.role = 'editor'",
    'b.deleted_at is null',
    "pi.role in ('editor', 'workspace')",
    'pi.held_at is null',
    'not public._sharer_suspended(pi.invited_by)',
    'not public._user_banned(u.id)',
    'not public._is_service_identity(u.id)',
    "oi.role in ('admin', 'member')",
    'oi.revoked_at is null',
    'oi.claimed_at is null',
    'oi.expires_at > now()',
  ]) assert.ok(g.includes(s), `_team_seat_grants lacks ${s}`);
  const s = code(def('_team_seat_slots').body);
  assert.match(s, /distinct on \(g\.user_id\)/, 'an account counts once');
  assert.match(s, /case g\.source when 'team' then 0 when 'member' then 1 else 2 end/);
  assert.ok(s.includes('not exists (select 1 from accounts a where a.email = g.email)'));
  assert.match(code(def('_team_seats_used').body), /count\(\*\)::integer from public\._team_seat_slots\(p_org\)/);
});

test('0531: admission locks per team, honours the rule, and never passes the ceiling', () => {
  const a = code(def('_team_admit').body);
  assert.ok(a.includes("pg_advisory_xact_lock(hashtext('team_seats:' || p_org::text))"));
  assert.ok(a.indexOf('pg_advisory_xact_lock') < a.indexOf('_team_seat_slots('), 'lock, then count');
  // A seat count read before the wait could be stale, and 'auto' would buy twice.
  assert.ok(a.indexOf('pg_advisory_xact_lock') < a.indexOf('from public.organizations'), 'lock, then read the team');
  assert.match(a, /if v_held then return 'already'; end if;/);
  assert.match(a, /if v_used < v_org\.seats then return 'ok'; end if;/);
  assert.match(a, /v_org\.seats \+ v_need <= v_org\.seat_ceiling/, 'B: auto stops at the ceiling');
  assert.match(a, /_team_auto_added_this_month\(p_org\) \+ v_need <= v_org\.auto_monthly_limit/);
  assert.match(a, /_org_add_seats\(p_org, v_need, 'auto', auth\.uid\(\)\)/);
  assert.doesNotMatch(a, /raise exception/, 'a claim must never break');
  const add = code(def('_org_add_seats').body);
  assert.match(add, /if p_n > 0 and v_seats \+ p_n > v_ceiling then/);
  assert.match(add, /hint = 'team_seats_ceiling'/);
  assert.match(add, /insert into public\.org_seat_changes \(org_id, delta, seats_after, reason, actor\)/, 'every change is a ledger row');
  assert.match(code(def('_team_auto_added_this_month').body), /date_trunc\('month', now\(\) at time zone 'utc'\) at time zone 'utc'/);
});

test('0531: the refusal, the fallback, the numbers and the ask each branch for a team', () => {
  const r = def('_editor_refuse').body;
  assert.ok(r.includes("hint = 'team_seats_full'") && r.includes("hint = 'team_seats_ask_admin'"));
  assert.ok(r.includes("hint = 'editor_limit'") && r.includes("hint = 'editor_limit_ask_owner'"), 'the personal hints stay');
  assert.ok(code(r).indexOf('team_seats_full') < code(r).indexOf("hint = 'editor_limit'"), 'the team answers first');
  const f = code(def('_editor_limit_fallback').body);
  const team = f.indexOf('_team_request_and_notify(');
  assert.ok(team > 0, 'the fallback asks the team');
  assert.ok(f.indexOf('return;', team) < f.indexOf('_notify_editor_limit('), 'and returns before the personal notices');
  const c = code(def('get_editor_capacity').body);
  assert.ok(c.includes("'team'::text"), 'subject is team in a team workspace');
  assert.ok(c.includes("'account'::text"), 'and account otherwise');
  assert.doesNotMatch(c, /email/i, 'numbers only');
  const ask = code(def('ask_owner_for_editor_slot').body);
  assert.ok(ask.includes("'team.seats_full'"));
  assert.ok(ask.indexOf("'team.seats_full'") < ask.indexOf('_notify_editor_limit('), 'the team branch answers first');
});

test('0531: the request core and the doors\' fallback (amendment D)', () => {
  const d = def('_team_request');
  assert.equal(d.file, SEATS, '_team_request lives in 0531');
  assert.equal(definitionsOf('_team_request').length, 1, 'no later migration re-defines it');
  assert.match(d.body, /_team_request\(p_org uuid, p_user uuid, p_wanted text, p_via text, p_ws uuid, p_board uuid\)\s+returns uuid/);
  const b = code(d.body);
  assert.match(b, /on conflict \(org_id, user_id\) where status = 'pending' do update/, 'the arbiter repeats the partial predicate');
  assert.ok(b.includes("'team.join_request'"));
  assert.match(b, /continue when r\.user_id = p_user;/, 'never the person asking');
  assert.match(b, /interval '24 hours'/);
  const n = def('_team_request_and_notify');
  assert.equal(n.file, SEATS);
  const nb = code(n.body);
  assert.ok(nb.includes('public._team_request('), '_team_request_and_notify calls the core');
  assert.ok(nb.includes("'team.joined_as_viewer'"));
  assert.ok(nb.includes("'team_seat_viewer_fallback'"));
  assert.doesNotMatch(nb, /token/i, 'a link token never reaches analytics (0474)');
  assert.match(nb, /exception when others then\s+raise warning/, 'it never breaks a claim');
});

test('0531: every helper is revoked, nothing is overloaded, and the file proves it', () => {
  const sql = fileText(SEATS);
  for (const h of ['_org_role(uuid, uuid)', '_org_is_admin(uuid, uuid)', '_team_seat_grants(uuid)',
    '_team_seat_slots(uuid)', '_team_seats_used(uuid)', '_team_auto_added_this_month(uuid)',
    '_org_add_seats(uuid, integer, text, uuid)', '_team_admit(uuid, uuid, text)',
    '_team_request(uuid, uuid, text, text, uuid, uuid)', '_team_request_and_notify(uuid, uuid, uuid, text)'])
    assert.ok(sql.includes(`revoke execute on function public.${h} from public, anon, authenticated;`), `${h} is not revoked`);
  const proof = sql.slice(sql.lastIndexOf('do $$'));
  assert.match(proof, /has_function_privilege\('anon'/);
  assert.match(proof, /has_function_privilege\('authenticated'/);
  assert.match(proof, /having count\(\*\) > 1/);
  assert.match(proof, /public\._editor_admit\(gen_random_uuid\(\), gen_random_uuid\(\), null\) <> 'ok'/);
  for (const fn of ['_team_admit', '_team_seat_slots', '_team_seat_grants', '_org_add_seats', '_team_request_and_notify'])
    assert.equal(definitionsOf(fn).length, 1, `${fn} is defined once`);
  assert.doesNotMatch(code(sql), /\bdrop\s+function\b/i);
  assert.match(sql, /commit;\s*$/);
});

test('0522–0531 write no parent_board_id and carry no live figures', () => {
  for (const f of [TABLES, ACCESS, SEATS]) {
    const c = code(fileText(f));
    assert.doesNotMatch(c, /set\s+parent_board_id/i, `${f} must not move a board`);
    // All three went live on the owner's go (2026-10-22), teams still closed.
    assert.match(fileText(f), /STATUS: written 2026-10-22\. Applied 2026-10-22 \(owner's go\), teams closed\./, `${f}: header`);
  }
});
