// 0536, 0537 and 0650: who pays (Team S2b), pinned at the source. A team
// workspace's cards and files are the team's, a personal workspace's its
// owner's, and a seat holder's personal workspaces get the seat perk. With no
// team every gate answers what it answered before; the parity probe proves
// that on real accounts, these pin the wiring it relies on.
// teamsMigration.test.mjs and teamsRpcMigration.test.mjs pin 0522–0535.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { latestDefinition, MIGRATIONS_DIR } from './migrationText.mjs';

const METERS = '0536_teams_pay_meters.sql';
const GATES = '0537_teams_pay_gates.sql';
const UPLOADS = '0650_teams_pay_upload_reserve.sql';   // after 0610, which wrote the live body
const fileText = (f) => readFileSync(join(MIGRATIONS_DIR, f), 'utf8');
const code = (s) => s.replace(/--[^\n]*/g, '');   // comments are not wiring
const def = (fn) => {
  const d = latestDefinition(fn);
  assert.ok(d, `no definition of ${fn}`);
  return d;
};
const body = (fn) => code(def(fn).body);

const OWN = {
  [METERS]: ['_org_storage_usage_apply', '_workspace_meter_follows_team_trg', '_workspace_set_owner'],
  [GATES]: ['_team_storage_floor_bytes', '_team_storage_seat_bytes', '_seat_perk_storage_bytes', '_seat_perk_on',
    '_board_card_payer', '_owner_card_count', 'enforce_demo_card_cap_trg', 'get_board_capacity',
    'scout_board_capacity', 'restore_board', '_storage_used_bytes', '_storage_pending_bytes',
    '_org_storage_used_bytes', '_org_storage_pending_bytes', '_org_storage_quota_bytes', '_storage_quota_bytes',
    '_storage_quota_if_blocks', '_drive_quota_bytes', '_drive_used_bytes', 'authorize_upload',
    'authorize_image_upload', '_storage_apply_ws', 'storage_usage_trg', 'reconcile_storage_usage'],
  [UPLOADS]: ['record_upload_intent'],
};

test('each file is written, not applied, one transaction that proves its grants and changes nothing while no team exists', () => {
  for (const f of [METERS, GATES, UPLOADS]) {
    const sql = fileText(f);
    assert.match(sql, /STATUS: written 2026-10-22\. NOT APPLIED until the owner says go\./, `${f}: header`);
    assert.match(sql, /^begin;$/m, `${f}: begin`);
    assert.match(sql, /commit;\s*$/, `${f}: commit`);
    assert.match(sql, /has_function_privilege\('anon'/, `${f}: proves anon`);
    assert.match(sql, /has_function_privilege\('authenticated'/, `${f}: proves authenticated`);
    assert.match(sql, /if exists \(select 1 from public\.organizations\) then\s+raise exception '\d{4}: an organization exists';/,
      `${f}: refuses once a team exists`);
    assert.match(sql, /Rebased on/, `${f}: names the live bodies it starts from`);
    assert.doesNotMatch(code(sql), /\bdrop\s+(function|table|trigger|policy)\b/i, `${f}: no DROP`);
  }
  assert.match(fileText(GATES), /if to_regclass\('public\.org_storage_usage'\) is null/, '0537 needs 0536 live');
  assert.match(fileText(UPLOADS), /raise exception '0650 needs 0537 live first';/);
});

test('every function lives in its S2b file, and nothing later in the folder overrides it', () => {
  for (const [f, fns] of Object.entries(OWN)) {
    assert.deepEqual([...code(fileText(f)).matchAll(/create or replace function public\.(\w+)\(/gi)].map((m) => m[1]).sort(),
      [...fns].sort(), `${f} defines exactly its share`);
    for (const fn of fns) assert.equal(def(fn).file, f, `${fn}'s latest definition must be ${f}`);
  }
});

test('each re-emit names the live body it starts from', () => {
  const md5 = (f, name) => assert.match(fileText(f), new RegExp(`^--\\s+${name}\\s+[0-9a-f]{32}$`, 'm'), `${f}: ${name}`);
  md5(METERS, '_workspace_set_owner');
  for (const fn of ['enforce_demo_card_cap_trg', 'get_board_capacity', 'scout_board_capacity', 'restore_board',
    '_owner_card_count', '_storage_used_bytes', '_storage_pending_bytes', '_storage_quota_bytes\\(uuid\\)',
    '_storage_quota_if_blocks', 'authorize_upload', 'authorize_image_upload', 'storage_usage_trg',
    'reconcile_storage_usage']) md5(GATES, fn);
  md5(UPLOADS, 'record_upload_intent');
});

// ── 0536: the team's meter ───────────────────────────────────────────────────

test('the team meter is server-only, and S3\'s columns are not client-writable', () => {
  const sql = fileText(METERS);
  assert.match(sql, /org_id\s+uuid primary key references public\.organizations\(id\) on delete cascade/);
  assert.match(sql, /alter table public\.org_storage_usage enable row level security;/);
  assert.match(sql, /revoke all on public\.org_storage_usage from public, anon, authenticated;/);
  assert.doesNotMatch(code(sql), /grant [^;]* on (table )?public\.org_storage_usage/i, 'no client privilege');
  assert.doesNotMatch(code(sql), /create policy/i, 'no policy: nothing but definer code reads it');
  assert.match(sql, /add column if not exists first_paid_at\s+timestamptz/);
  assert.match(sql, /add column if not exists storage_blocks integer not null default 0\s+check \(storage_blocks between 0 and 1000\)/);
  assert.match(sql, /has_column_privilege\('authenticated', 'public\.organizations', 'first_paid_at', 'update'\)/);
  for (const sig of ['_org_storage_usage_apply(uuid, bigint, bigint)', '_workspace_meter_follows_team_trg()', '_workspace_set_owner(uuid, uuid)'])
    assert.ok(sql.includes(`revoke execute on function public.${sig} from public, anon, authenticated;`), sig);
});

test('a workspace\'s bytes follow its team: off the old payer\'s meter, onto the new one\'s', () => {
  const sql = fileText(METERS);
  assert.match(sql, /create or replace trigger workspaces_meter_follows_team\s+after update of org_id on public\.workspaces\s+for each row when \(old\.org_id is distinct from new\.org_id\)\s+execute function public\._workspace_meter_follows_team_trg\(\);/);
  assert.ok(sql.indexOf("set local lock_timeout = '3s';") > 0
    && sql.indexOf("set local lock_timeout = '3s';") < sql.indexOf('create or replace trigger workspaces_meter_follows_team'),
    'the trigger never queues behind production traffic');
  const COUNTS = 'public._image_counts(i.deleted_at, i.storage_path, i.ref_count, i.live_board_ids, i.first_referenced_at)';
  const mv = body('_workspace_meter_follows_team_trg');
  assert.ok(mv.includes(COUNTS) && body('transfer_workspace_ownership').includes(COUNTS), 'transfer\'s rule for what counts');
  assert.match(mv, /where i\.workspace_id = new\.id/);
  assert.match(mv, /if old\.org_id is not null then\s+perform public\._org_storage_usage_apply\(old\.org_id, -v_bytes, -v_objects\);\s+else\s+perform public\._storage_usage_apply\(old\.created_by, -v_bytes, -v_objects\);/);
  assert.match(mv, /if new\.org_id is not null then\s+perform public\._org_storage_usage_apply\(new\.org_id, v_bytes, v_objects\);\s+else\s+perform public\._storage_usage_apply\(new\.created_by, v_bytes, v_objects\);/);
});

test('an owner change moves bytes between people only while the workspace is personal', () => {
  // 0532 sets the team before the owner and clears it before handing a
  // workspace on, so the trigger and this never move the same bytes.
  const owner = body('_workspace_set_owner');
  assert.match(owner, /select created_by, org_id into v_old, v_org from public\.workspaces where id = p_ws for update;/);
  const at = owner.indexOf('if v_org is null then');
  assert.ok(at > 0, 'the storage move is guarded');
  assert.ok(!owner.slice(0, at).includes('_storage_usage_apply('), 'nothing moves before the guard');
  assert.equal((owner.slice(at).match(/public\._storage_usage_apply\(/g) || []).length, 2, 'off the old owner, onto the new');
});

// ── 0537: cards ──────────────────────────────────────────────────────────────

test('every card gate asks whose meter a cluster is on, not who owns it', () => {
  for (const fn of ['enforce_demo_card_cap_trg', 'get_board_capacity', 'scout_board_capacity', 'restore_board']) {
    assert.doesNotMatch(body(fn), /board_workspace_owner\(/, `${fn} asks the payer`);
    assert.match(body(fn), /public\._board_card_payer\(/, fn);
  }
  assert.equal((body('enforce_demo_card_cap_trg').match(/public\._board_card_payer\(/g) || []).length, 3,
    'the insert, and both sides of a move');
  const payer = body('_board_card_payer');
  assert.match(payer, /case when w\.org_id is not null or public\._seat_perk_on\(w\.created_by\) then null\s+else w\.created_by end/,
    'nobody\'s for a team\'s cluster or a perk holder\'s; a null payer is "no cap" in every gate');
  assert.match(payer, /from public\.boards b\s+join public\.workspaces w on w\.id = b\.workspace_id\s+where b\.id = p_board_id/,
    'otherwise board_workspace_owner\'s answer (0187)');
  assert.match(body('_owner_card_count'), /and w\.org_id is null/, 'a team\'s cards are on no one\'s personal meter');
});

test('the seat perk is a seat in an open, active team that keeps the perk on', () => {
  const perk = body('_seat_perk_on');
  for (const term of [/m\.user_id = p_user/, /and m\.seat\b/, /and o\.closed_at is null/, /and o\.seat_perk\b/, /and o\.status = 'active'/])
    assert.match(perk, term);
  const PERK = /\+ case when public\._seat_perk_on\(p_owner\) then public\._seat_perk_storage_bytes\(\) else 0 end;/;
  assert.match(def('_storage_quota_bytes').body, PERK, 'on top of whichever drive the person has');
  assert.match(def('_storage_quota_if_blocks').body, PERK, 'and in the drive the storage add-on quotes');
});

// ── 0537 and 0650: files ─────────────────────────────────────────────────────

test('the drives are in the code\'s units: 1 TB is 1 TiB, 250 GB and 50 GB are GiB', () => {
  const lit = (fn) => Number(body(fn).match(/select (\d+)::bigint;/)[1]);
  assert.equal(lit('_team_storage_floor_bytes'), 2 ** 40);
  assert.equal(lit('_team_storage_seat_bytes'), 250 * 2 ** 30);
  assert.equal(lit('_seat_perk_storage_bytes'), 50 * 2 ** 30);
  const team = body('_org_storage_quota_bytes');
  assert.match(team, /case when o\.first_paid_at is null\s+then public\._storage_quota_trial_bytes\(\)/, 'the trial drive until the first payment');
  assert.match(team, /greatest\(public\._team_storage_floor_bytes\(\), public\._team_storage_seat_bytes\(\) \* o\.seats\)\s+\+ o\.storage_blocks::bigint \* public\._storage_addon_block_bytes\(\)/);
});

test('a team workspace\'s files fill the team\'s drive; a personal one\'s, exactly the owner\'s', () => {
  for (const fn of ['_storage_used_bytes', '_storage_pending_bytes'])
    assert.match(body(fn), /and w\.org_id is null/, `${fn}: the personal drive leaves teams out`);
  for (const fn of ['_org_storage_used_bytes', '_org_storage_pending_bytes'])
    assert.match(body(fn), /where w\.org_id = p_org/, fn);
  assert.match(body('_org_storage_used_bytes'), /from public\.org_storage_usage s where s\.org_id = p_org/, 'the meter first');
  assert.match(body('_drive_quota_bytes'),
    /select coalesce\(case when p_org is not null then public\._org_storage_quota_bytes\(p_org\)\s+else public\._storage_quota_bytes\(p_owner\) end, 0\);/,
    'never null: an upload with nowhere to go is refused');
  assert.match(body('_drive_used_bytes'),
    /then public\._org_storage_used_bytes\(p_org\) \+ public\._org_storage_pending_bytes\(p_org\)\s+else public\._storage_used_bytes\(p_owner\) \+ public\._storage_pending_bytes\(p_owner\) end/);
  for (const fn of ['authorize_upload', 'authorize_image_upload', 'record_upload_intent']) {
    const b = body(fn);
    assert.match(b, /public\._drive_quota_bytes\(v_org, v_owner\)/, fn);
    assert.match(b, /public\._drive_used_bytes\(v_org, v_owner\)/, fn);
    assert.doesNotMatch(b, /public\._storage_(quota|used|pending)_bytes\(v_owner\)/, `${fn}: no owner-only drive left`);
  }
  assert.match(body('authorize_upload'), /select created_by, org_id into v_owner, v_org from public\.workspaces where id = p_workspace_id;/);
  assert.match(body('authorize_image_upload'), /select w\.created_by, w\.org_id into v_owner, v_org\s+from public\.boards b join public\.workspaces w on w\.id = b\.workspace_id\s+where b\.id = p_board_id;/);
  const rui = def('record_upload_intent').body;
  assert.ok(rui.includes("hashtextextended('soleil.upload_space:' || coalesce('org:' || v_org::text, v_owner::text), 0)"),
    'one lock per drive; a personal drive keeps 0610\'s key');
});

test('the meters move with each file: the images trigger and the nightly truth know about teams', () => {
  const trg = body('storage_usage_trg');
  assert.doesNotMatch(trg, /_storage_usage_apply\(|_image_owner\(/, 'every delta goes through the workspace');
  assert.equal((trg.match(/public\._storage_apply_ws\(/g) || []).length, 4, 'insert, delete, and both sides of an update');
  const ws = body('_storage_apply_ws');
  assert.match(ws, /if v_org is not null then\s+perform public\._org_storage_usage_apply\(v_org, p_bytes, p_objects\);\s+else\s+perform public\._storage_usage_apply\(v_owner, p_bytes, p_objects\);/);
  const rec = body('reconcile_storage_usage');
  assert.equal((rec.match(/and w\.org_id is null/g) || []).length, 2, 'the people\'s truth and its zeroing leave teams out');
  assert.match(rec, /insert into public\.org_storage_usage \(org_id, bytes_used, object_count, updated_at\)/, 'and the teams\' truth is written');
  assert.match(rec, /where w\.org_id is not null/);
  assert.match(rec, /update public\.org_storage_usage s/, 'a team with nothing left reads zero');
});

test('helpers are server-only and the app\'s gates keep exactly their grants', () => {
  const gates = fileText(GATES);
  for (const sig of ['_team_storage_floor_bytes()', '_team_storage_seat_bytes()', '_seat_perk_storage_bytes()',
    '_seat_perk_on(uuid)', '_board_card_payer(uuid)', '_org_storage_used_bytes(uuid)', '_org_storage_pending_bytes(uuid)',
    '_org_storage_quota_bytes(uuid)', '_drive_quota_bytes(uuid, uuid)', '_drive_used_bytes(uuid, uuid)',
    '_storage_apply_ws(uuid, bigint, bigint)', '_owner_card_count(uuid)', '_storage_used_bytes(uuid)',
    '_storage_pending_bytes(uuid)', '_storage_quota_bytes(uuid)', '_storage_quota_if_blocks(uuid, integer)',
    'enforce_demo_card_cap_trg()', 'reconcile_storage_usage()', 'scout_board_capacity(uuid, uuid)'])
    assert.ok(gates.includes(`revoke execute on function public.${sig} from public, anon, authenticated;`), sig);
  assert.ok(gates.includes('grant execute on function public.scout_board_capacity(uuid, uuid) to service_role;'), 'Scout still reads it');
  assert.ok(gates.includes('revoke execute on function public.restore_board(uuid) from public, anon;'));
  assert.ok(gates.includes('grant execute on function public.restore_board(uuid) to authenticated;'));
  for (const fn of ['get_board_capacity', 'authorize_upload', 'authorize_image_upload'])
    assert.doesNotMatch(code(gates), new RegExp(`(revoke|grant) execute on function public\\.${fn}\\(`), `${fn} keeps live's grants`);
  const uploads = fileText(UPLOADS);
  assert.ok(uploads.includes('revoke execute on function public.record_upload_intent(text, bigint, text, uuid) from public, anon;'));
  assert.ok(uploads.includes('grant execute on function public.record_upload_intent(text, bigint, text, uuid) to authenticated;'));
  assert.match(gates, /having count\(\*\) > 1/, 'no overloads (PGRST203)');
  assert.match(gates, /p\.proname = '_storage_quota_bytes'\) <> 2 then/, 'the plan drive and the person\'s, and no third');
  assert.match(uploads, /p\.proname = 'record_upload_intent'\) <> 1 then/);
});
