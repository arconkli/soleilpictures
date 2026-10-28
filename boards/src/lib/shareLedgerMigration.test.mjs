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
//
// 0745 reads the ledger three ways for the admin: one person's sharing
// (admin_user_sharing), Analytics › Sharing (admin_sharing_overview) and the
// feed (admin_sharing_recent). Its proof read all three as an admin on the
// live database, turned a non-admin away, and checked the routes add up to the
// shares; this holds the file to that: admin-only definers, the helpers under
// them closed, banned rows left out and counted, a workspace link a share only
// once copied, and neither a token nor a device in what they hand back.
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

const FILE_0745 = '0745_admin_sharing_reads.sql';
const sql0745 = readFileSync(join(MIGRATIONS_DIR, FILE_0745), 'utf8');
const proof0745 = sql0745.slice(sql0745.indexOf('do $proof$'));
const READS_0745 = {
  admin_user_sharing: ['public.admin_user_sharing(uuid)', 'public.admin_user_sharing(uuid)'],
  admin_sharing_overview: ['public.admin_sharing_overview(int, boolean)', 'public.admin_sharing_overview(integer, boolean)'],
  admin_sharing_recent: ['public.admin_sharing_recent(int, timestamptz, boolean)',
                         'public.admin_sharing_recent(integer, timestamp with time zone, boolean)'],
};
const HELPERS_0745 = {
  _admin_share_object_names: 'public._admin_share_object_names(text[], uuid[])',
  _admin_share_people: 'public._admin_share_people(uuid[])',
};
// 0746 restated admin_user_sharing with one line changed (its own test pins it).
const LATER_0745 = { admin_user_sharing: '0746_users_list_sharing.sql' };
const bodyOf0745 = (fn) => {
  const def = latestDefinition(fn);
  assert.equal(def?.file, LATER_0745[fn] ?? FILE_0745, `${fn} is ${LATER_0745[fn] ?? "0745's"}`);
  return def.body;
};

test("0745: the three reads ask for an admin, run as definers on public, and only signed-in callers reach them", () => {
  for (const [fn, [sig, proofSig]] of Object.entries(READS_0745)) {
    const body = bodyOf0745(fn);
    assert.match(body, /security definer\s+set search_path = 'public'/, `${fn} is a definer on public`);
    assert.ok(body.includes('perform public._require_admin();'), `${fn} asks for an admin`);
    assert.ok(sql0745.includes(`revoke execute on function ${sig} from public, anon;`), `${fn} is revoked from anon`);
    assert.ok(sql0745.includes(`grant execute on function ${sig} to authenticated;`), `${fn} is granted to the signed in`);
    assert.ok(proof0745.includes(`'${proofSig}'`), `the proof checks ${fn}`);
  }
  assert.match(proof0745, /exception when insufficient_privilege then null;/, 'the proof turns a non-admin away');
});

test('0745: the helpers under the reads are closed to every client', () => {
  for (const [fn, sig] of Object.entries(HELPERS_0745)) {
    assert.match(bodyOf0745(fn), /security definer/);
    assert.ok(sql0745.includes(`revoke execute on function ${sig} from public, anon, authenticated;`), `${fn} is closed`);
    assert.ok(proof0745.includes(`'${sig}'`), `the proof checks ${fn}`);
  }
  assert.doesNotMatch(sql0745, /grant\s+execute\s+on\s+function\s+public\._admin_share[^;]*to/i);
});

test('0745: every read leaves banned rows out and counts them, and plans each call for its own arguments', () => {
  for (const fn of Object.keys(READS_0745)) {
    const body = bodyOf0745(fn);
    assert.match(body, /_admin_share_ledger\(/, `${fn} reads the ledger`);
    assert.match(body, /not r\.banned/, `${fn} leaves banned rows out`);
    assert.match(body, /set plan_cache_mode = 'force_custom_plan'/, `${fn} plans per call`);
  }
  for (const fn of ['admin_user_sharing', 'admin_sharing_overview']) {
    assert.match(bodyOf0745(fn), /'banned_left_out', \(/, `${fn} says how many it left out`);
  }
});

test('0745: a workspace link is a share only once someone copied it', () => {
  for (const fn of ['admin_user_sharing', 'admin_sharing_recent']) {
    assert.ok(bodyOf0745(fn).includes("not (r.fact = 'shared' and r.route = 'workspace_link')"), `${fn} drops the setup step's links`);
  }
  assert.ok(bodyOf0745('admin_sharing_overview').includes(
    "(r.fact = 'shared' and r.route <> 'workspace_link')\n             or (r.fact = 'copied' and r.route = 'workspace_link') as is_share"));
  assert.match(proof0745, /a workspace link nobody copied/);
});

test('0745: no token and no device leaves: devices are counted, never listed, and the proof looks', () => {
  for (const fn of Object.keys(READS_0745)) {
    const body = bodyOf0745(fn);
    assert.doesNotMatch(body, /'token'/, `${fn} names no token`);
    assert.doesNotMatch(body, /'device_id'/, `${fn} hands out no device`);
    for (const m of body.matchAll(/device_id/g)) {
      const before = body.slice(Math.max(0, m.index - 30), m.index);
      assert.match(before, /count\(distinct [a-z]\.$/, `${fn} only counts devices`);
    }
  }
  assert.equal((proof0745.match(/~\* '"token"'/g) || []).length, 3, 'the proof looks in all three');
});

// 0746: the Users list and its count take a Sharing filter and a reach sort,
// and each row carries what the person shared and the cards in each workspace.
const FILE_0746 = '0746_users_list_sharing.sql';
const sql0746 = readFileSync(join(MIGRATIONS_DIR, FILE_0746), 'utf8');
const proof0746 = sql0746.slice(sql0746.indexOf('do $proof$'));
const LIST_0746 = 'public.admin_list_users(integer,integer,text,text,text,text,text,text,text,text,text)';
const COUNT_0746 = 'public.admin_user_count(text,text,text,text,text,text,text,text)';

test('0746: the old list and count are renamed and closed, the marks helper too, and the proof says so', () => {
  assert.match(sql0746, /^begin;$/m);
  assert.match(sql0746, /^set local lock_timeout = '3s';$/m);
  assert.ok(sql0746.trimEnd().endsWith('commit;'));
  assert.match(sql0746, /^notify pgrst, 'reload schema';$/m);
  assert.match(sql0746, /alter function public\.admin_list_users\(integer, integer, text, text, text, text, text, text, text, text\) rename to admin_list_users_0462;/);
  assert.match(sql0746, /alter function public\.admin_user_count\(text, text, text, text, text, text, text\) rename to admin_user_count_0461;/);
  assert.match(sql0746, /revoke execute on function public\.admin_list_users_0462\([^)]*\) from public, anon, authenticated;/);
  assert.match(sql0746, /revoke execute on function public\.admin_user_count_0461\([^)]*\) from public, anon, authenticated;/);
  assert.match(sql0746, /revoke execute on function public\._admin_user_sharing_marks\(\) from public, anon, authenticated;/);
  for (const fn of ['public._admin_user_sharing_marks()', 'public.admin_list_users_0462(', 'public.admin_user_count_0461(']) {
    assert.ok(proof0746.includes(`'${fn}`), `the proof checks ${fn} is closed`);
  }
  assert.match(proof0746, /an old list or count is still callable by its name/);
});

test('0746: the new reads are admin definers, signed-in only, and service_role keeps the list', () => {
  for (const sig of [LIST_0746, COUNT_0746, 'public.admin_user_workspaces(uuid)', 'public.admin_user_sharing(uuid)']) {
    assert.ok(proof0746.includes(`'${sig}'`), `the proof names ${sig}`);
  }
  for (const fn of ['admin_list_users', 'admin_user_count', 'admin_user_workspaces']) {
    const d = latestDefinition(fn);
    assert.equal(d.file, FILE_0746, `the live ${fn} is 0746's`);
    assert.match(d.body, /security definer/);
    assert.match(d.body, /perform public\._require_admin\(\);/);
  }
  assert.match(sql0746, /grant execute on function public\.admin_list_users\(integer, integer, text, text, text, text, text, text, text, text, text\) to authenticated, service_role;/);
  assert.match(sql0746, /revoke execute on function public\.admin_user_workspaces\(uuid\) from public, anon;/);
  assert.match(proof0746, /service_role lost the list/);
});

test('0746: the filter is off by default, and with it off the list and count are 0462 and 0461 to the row', () => {
  for (const fn of ['admin_list_users', 'admin_user_count']) {
    const body = latestDefinition(fn).body;
    assert.match(body, /p_sharing text default 'all'/, `${fn} takes p_sharing, defaulting to all`);
    for (const v of ['shared', 'brought', 'came', 'works_with']) assert.match(body, new RegExp(`when '${v}'\\s+then`), `${fn} filters ${v}`);
    assert.match(body, /from public\._admin_user_sharing_marks\(\)/, `${fn} reads the one helper`);
  }
  assert.match(latestDefinition('admin_list_users').body, /case when v_k = 'reach'\s+then base\.reach_n end desc nulls last/);
  assert.match(proof0746, /the list moved with the filter off/);
  assert.match(proof0746, /the count moved with the filter off/);
  assert.match(proof0746, /Most people reached is out of order/);
});

test("0746: marks credit only recorded sharers and leave banned rows out; workspace cards are live boards' and agree with the owner's", () => {
  const marks = sql0746.match(/create or replace function public\._admin_user_sharing_marks\(\)[\s\S]*?\$\$;/)[0];
  assert.match(marks, /_admin_share_ledger\(null, false, false, null\)/, 'no views: the list counts people, never devices');
  assert.match(marks, /where not r\.banned and r\.sharer_id is not null and r\.sharer_recorded/);
  assert.match(marks, /\(l\.fact = 'copied' and l\.route = 'workspace_link'\)/, 'a workspace link counts once copied');
  assert.doesNotMatch(marks, /token|device_id/);
  const list = latestDefinition('admin_list_users').body;
  assert.match(list, /coalesce\(sum\(ci\.weight\), 0\)::int as cards\s+from public\.boards b left join public\.card_index ci on ci\.board_id = b\.id\s+where b\.deleted_at is null/);
  assert.match(proof0746, /a workspace''s cards disagree with its owner''s/);
  assert.match(sql0746, /mine as materialized \(select \* from l where l\.sharer_id = p_user_id and l\.sharer_recorded\)/,
    "the profile credits the same recorded sharers the list does");
  const strip = (b) => b.replace(/--.*$/gm, '').replace(/\s+/g, ' ');
  assert.equal(strip(latestDefinition('admin_user_sharing').body).replace(' and l.sharer_recorded)', ')'),
    strip(sql0745.match(/create or replace function public\.admin_user_sharing\(p_user_id uuid\)[\s\S]*?\$fn\$;|create or replace function public\.admin_user_sharing\(p_user_id uuid\)[\s\S]*?\$function\$;/)?.[0] ?? ''),
    "admin_user_sharing is 0745's but for that one line");
});

// 0747: the live feed in words. A new read beside the two the console already
// calls, so production's admin is untouched.
const FILE_0747 = '0747_live_feed_words.sql';
const sql0747 = readFileSync(join(MIGRATIONS_DIR, FILE_0747), 'utf8');
const proof0747 = sql0747.slice(sql0747.indexOf('do $proof$'));

test('0747: the words read is an admin definer, signed-in only, its helper closed, and the feed reads are left alone', () => {
  assert.match(sql0747, /^begin;$/m);
  assert.ok(sql0747.trimEnd().endsWith('commit;'));
  const words = latestDefinition('admin_event_words');
  assert.equal(words.file, FILE_0747);
  assert.match(words.body, /security definer/);
  assert.match(words.body, /perform public\._require_admin\(\);/);
  assert.match(words.body, /cardinality\(p_ids\) > 200/);
  assert.match(sql0747, /revoke execute on function public\._admin_event_facts\(text, jsonb, uuid\) from public, anon, authenticated;/);
  assert.match(sql0747, /revoke execute on function public\.admin_event_words\(uuid\[\], boolean\) from public, anon;/);
  assert.doesNotMatch(sql0747, /function public\.admin_recent_events|function public\.admin_events_by_id/,
    'the two reads production calls are not touched');
  assert.match(proof0747, /a non-admin read the feed/);
});

test("0747: the internal rule is admin_events_by_id's word for word, and the proof compares their rows", () => {
  const rule = (b) => b.match(/and \(not p_exclude_internal[\s\S]*?\)\)\)\)/)[0].replace(/\s+/g, ' ');
  assert.equal(rule(latestDefinition('admin_event_words').body), rule(latestDefinition('admin_events_by_id').body));
  assert.match(proof0747, /the internal rule differs from admin_events_by_id''s/);
});

test('0747: the facts copy only listed props, never a token or a device, and only for sharing events', () => {
  const facts = latestDefinition('_admin_event_facts').body;
  const keys = facts.match(/foreach v_key in array array\[([\s\S]*?)\] loop/)[1].match(/'[^']+'/g).map((k) => k.slice(1, -1));
  for (const k of keys) assert.doesNotMatch(k, /token|session|device|email/, `${k} is safe to copy`);
  assert.doesNotMatch(facts.replace(/--.*$/gm, ''), /'token'|session_id|device_id/);
  assert.match(facts, /return '\{\}'::jsonb;/, 'every other event carries nothing');
  assert.match(proof0747, /a token or a device left in the facts/);
  assert.match(proof0747, /a bad id or an unlisted key got through/);
});
