// shareLedgerMigration.test.mjs — the sharing insight's ledger (0744 onward),
// read as text.
//
//   node --test src/lib/shareLedgerMigration.test.mjs
//
// 0744 writes the three helpers every sharing read in the admin is built from:
// _admin_workspace_adds() (who put each member straight into a workspace),
// _admin_brought_in() (how each account came to sign up, every piece of
// evidence ranked, rank 1 the credit) and _admin_share_ledger() (one row per
// fact, on the share it belongs to). Its proof block checked the ledger against
// totals counted straight from their tables on the live database; this holds
// the file to what was proven: closed to clients, planned per call, a banned
// person flagged rather than silently dropped, the evidence in the header's
// order, a device only where views are counted, and no token wherever a key is
// made.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MIGRATIONS_DIR, latestDefinition } from './migrationText.mjs';

const FILE_0744 = '0744_share_ledger.sql';
const sql0744 = readFileSync(join(MIGRATIONS_DIR, FILE_0744), 'utf8');
const proof0744 = sql0744.slice(sql0744.indexOf('do $proof$'));
const SIGNATURES = {
  _admin_workspace_adds: 'public._admin_workspace_adds()',
  _admin_brought_in: 'public._admin_brought_in()',
  _admin_share_ledger: 'public._admin_share_ledger(timestamptz, boolean, boolean, uuid)',
};
const bodyOf = (fn) => {
  const def = latestDefinition(fn);
  assert.equal(def?.file, FILE_0744, `${fn} is 0744's`);
  return def.body;
};
const columnsOf = (fn) => bodyOf(fn).match(/returns table \(([\s\S]*?)\)\s*language/)[1]
  .split(',').map((c) => c.trim().split(/\s+/)[0]);
const TOKEN_TABLES = ['public_share_links', 'workspace_invite_links', 'file_shares',
                      'pending_invites', 'org_invites', 'org_invite_links'];

test('0744: the three helpers are definers closed to every client, and its proof checks each of them', () => {
  for (const [fn, sig] of Object.entries(SIGNATURES)) {
    assert.match(bodyOf(fn), /stable security definer\s+set search_path = 'public'/, `${fn} is a definer on public`);
    assert.ok(sql0744.includes(`revoke execute on function ${sig} from public, anon, authenticated;`), `${fn} is revoked`);
    assert.ok(proof0744.includes(`'${sig}'`), `the proof checks ${fn}`);
  }
  assert.doesNotMatch(sql0744, /grant\s+execute[^;]*to\s+(public|anon|authenticated)/i);
  assert.ok(proof0744.includes("foreach v_who in array array['public', 'anon', 'authenticated'] loop"));
  assert.ok(proof0744.includes("if has_function_privilege(v_who, v_fn, 'execute') then"));
});

test('0744: the ledger plans each call for its own arguments, with the memory its sorts need, and the proof holds it there', () => {
  assert.match(bodyOf('_admin_share_ledger'),
    /language plpgsql stable security definer\s+set search_path = 'public'\s+set plan_cache_mode = 'force_custom_plan'\s+set work_mem = '32MB'\s+as \$fn\$/);
  assert.ok(proof0744.includes("and p.prosecdef\n                    and p.proconfig @> array['plan_cache_mode=force_custom_plan']"));
});

test('0744: every events read leads with the event, or with sessions or people from an array', () => {
  const reads = [...sql0744.matchAll(/from public\.analytics_events e\b/g)];
  assert.equal(reads.length, 7, 'workspace adds, panel, views, edit-link views, file views, devices, cards');
  for (const r of reads) {
    const where = sql0744.slice(r.index).match(/\bwhere\s+([\s\S]{0,80})/)[1];
    assert.match(where, /^(p_with_views\s+and\s+)?e\.(event\s*=|session_id\s*=\s*any\s*\(array\()/,
      `an events read starts on its index: ${where.split('\n')[0]}`);
  }
  // A lateral over a materialized CTE re-ran its subplan per pair; the
  // lateral reads the indexed table, and the kind is worked out once.
  assert.match(sql0744, /svk as materialized \(/);
  assert.match(sql0744, /left join lateral \(\s*select [\s\S]*?from public\.public_share_links l\s+where svk\.kind is distinct from 'public' and l\.board_id = svk\.root/);
});

test('0744: a banned sharer or recipient is flagged for the caller to leave out and count, never dropped here', () => {
  const ledger = bodyOf('_admin_share_ledger');
  assert.match(ledger, /banned_people as \(\s+select p\.user_id from public\.profiles p where p\.banned_at is not null\s+\)/);
  assert.match(ledger, /coalesce\(f\.sharer in \(select bp\.user_id from banned_people bp\), false\)\s+or coalesce\(f\.recip in \(select bp\.user_id from banned_people bp\), false\)\s+from allf f/);
  const tail = ledger.slice(ledger.indexOf('from allf f'));
  assert.doesNotMatch(tail, /banned/, 'flagged, not filtered');
  // Insiders, only when asked.
  assert.match(ledger, /internal as \(\s+select iu\.user_id from public\._internal_user_ids\(\) iu where p_exclude_internal\s+\)/);
  assert.match(tail, /and not exists \(select 1 from internal i where i\.user_id = f\.sharer or i\.user_id = f\.recip\);/);
});

test("0744: an account is credited by its first evidence in the header's order, once", () => {
  const brought = bodyOf('_admin_brought_in');
  const order = [...brought.matchAll(/select u\.id, u\.created_at, (\d)(?: as pri)?,/g)].map((m) => Number(m[1]));
  assert.deepEqual(order, [1, 2, 3, 4, 5, 6, 7, 7], 'link, Explore, referral, invitation, workspace link, add, file (page, then named)');
  assert.ok(brought.includes('(row_number() over (partition by ev.id order by ev.pri, ev.ek))::int'));
  for (const window of [
    "where rf.created_at <= u.created_at + interval '1 day'",
    "and pi.created_at <= u.created_at\n       and pi.claimed_at <= u.created_at + interval '1 day'",
    "where j.joined_at <= u.created_at + interval '1 day'",
    "where wa.at <= u.created_at + interval '1 day'",
    'where p.created_at <= u.created_at',
  ]) assert.ok(brought.includes(window), `evidence window: ${window.split('\n')[0]}`);
  // A link that no longer exists is still the credit, never "organic".
  assert.ok(brought.includes("left join public.public_share_links l on l.token::text = lower(u.fs->>'share_token')"));
  assert.ok(brought.includes("case when l.token is null then 'deleted'"));
  // The ledger's new accounts are the people who entered the code, credited once.
  const ledger = bodyOf('_admin_share_ledger');
  assert.match(ledger, /where bi\.rank = 1\s+and bi\.user_id in \(select pp\.user_id from public\._admin_people\(false, true\) pp\)\s+and \(f\.fact = 'new_account' or bi\.user_id in \(select ms\.user_id from public\._admin_made_something\(\) ms\)\)/);
  assert.ok(proof0744.includes("raise exception '0744: an account is credited twice';"));
});

test('0744: a workspace add is a member put in by hand, never the creator, an owner, a service or a member a link or invitation explains', () => {
  const adds = bodyOf('_admin_workspace_adds');
  for (const rule of [
    'where m.user_id is distinct from w.created_by',
    "and m.role not in ('owner', 'service')",
    "and m.created_at > w.created_at + interval '10 seconds'",
    "join ag on ag.occurred_at between m.created_at - interval '5 minutes' and m.created_at + interval '5 minutes'",
    "and mm.role in ('owner', 'coowner')",
    "where coalesce(rec.joined_via, 'direct_add') in ('direct_add', 'other')",
    'from public.workspace_invite_link_joins j',
    'and pi.claimed_by = m.user_id',
  ]) assert.ok(adds.includes(rule), rule);
  assert.match(adds, /case when rec\.added_by is not null then 'recorded'\s+when matched\.adder is not null then 'matched_event'\s+else 'not_recorded' end/);
});

test('0744: a device is counted only where views are, once per share, and only the ledger carries it', () => {
  assert.ok(columnsOf('_admin_share_ledger').includes('device_id'));
  for (const fn of ['_admin_workspace_adds', '_admin_brought_in']) {
    assert.ok(!columnsOf(fn).some((c) => /device|session/.test(c)), `${fn} has no device`);
  }
  const ledger = bodyOf('_admin_share_ledger');
  assert.equal(ledger.split('vd.session_id as dev').length, 2, 'views are the only source of a device');
  assert.match(ledger, /select x\.\*, null::uuid as dev from base x\s+union all select x\.\*, null::uuid from panel x\s+union all select x\.\* from views x\s+union all select x\.\*, null::uuid from cofacts x/);
  assert.ok(ledger.includes('group by va.ek, va.route, va.sharer, va.okind, va.oid, va.access_board, va.lk, va.session_id'));
  assert.ok(ledger.includes("coalesce(e.props->>'valid', 'true') <> 'false'"));
  assert.match(ledger, /where du\.user_id = vd\.sharer or acc\.user_id is not null\s+or du\.user_id in \(select i\.user_id from internal i\)/);
});

test('0744: no token leaves: no column is one, every key made from one is its hash prefix, and the proof looks', () => {
  for (const fn of Object.keys(SIGNATURES)) {
    assert.ok(!columnsOf(fn).some((c) => /token/.test(c)), `${fn} returns no token`);
  }
  let keyed = 0;
  for (const m of sql0744.matchAll(/\|\|\s*([^\n,]*)/g)) {
    if (!/token/.test(m[1])) continue;
    assert.match(m[1], /^(coalesce\()?left\(md5\(/, `hashed before it joins a key: ${m[1]}`);
    keyed += 1;
  }
  assert.ok(keyed >= 8, `every link and workspace link key is read (${keyed})`);
  assert.equal(sql0744.split('md5(').length, sql0744.split('left(md5(').length, 'every hash is cut to a prefix');
  assert.ok(proof0744.includes("where link_key is not null and link_key !~ '^[0-9a-f]{12}$') then"));
  for (const t of TOKEN_TABLES) assert.ok(proof0744.includes(`select t.token from public.${t} t`), `the proof looks in ${t}`);
});

test("0744's proof checks the ledger against three totals counted straight from their tables", () => {
  assert.ok(proof0744.includes('create temp table _0744_ledger on commit drop as\n    select * from public._admin_share_ledger(null, false, true, null);'));
  for (const msg of [
    "'0744: % joins through edit links, the ledger says %'",
    "'0744: % claimed invitations, the ledger says %'",
    "'0744: % sign-ups through a cluster link, the ledger says %'",
  ]) assert.ok(proof0744.includes(`raise exception ${msg}`), msg);
});
