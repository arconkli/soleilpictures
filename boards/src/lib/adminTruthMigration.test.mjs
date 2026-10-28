// adminTruthMigration.test.mjs — 0460 makes the /admin numbers count what
// their labels say. It was applied to the shared database the day it was
// written, so this pins what the shipped client, the party worker and the
// nightly cron stand on.
//
//   node --test src/lib/adminTruthMigration.test.mjs
//
// What this guards, beyond the grants:
//   * the retired signatures. Four functions gained an argument. Each old
//     identity is renamed out of PostgREST's way and closed to every client
//     role: left beside a replacement whose last argument has a default, a
//     call matches both and fails;
//   * the defaults. Every new argument defaults to the old behaviour, so a
//     bundle that never sends it keeps reading what it read;
//   * one "made something". Every Users figure reads _admin_made_something,
//     so the list, its count, the source counts and the share column cannot
//     disagree again;
//   * the in-place rewrites. Each body is its previous definition with only
//     the listed lines changed, comments aside, so a "while I was in there"
//     edit fails here;
//   * the Universe payload: exact live totals, no clock in it (the party
//     worker pushes only when the payload changes), and `today` exactly as the
//     Command Center's cards chart reads it;
//   * the growth series: admin_weekly_series' columns first and in order, and
//     its cards CTE verbatim, so the long charts and the tile strips agree.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MIGRATIONS_DIR, migrationFiles, latestDefinitionPastCodeEntry, CODE_ENTRY_FILE } from './migrationText.mjs';

const FILE = '0460_admin_numbers_tell_the_truth.sql';
const PATH = join(MIGRATIONS_DIR, FILE);
// Read leniently so a missing file fails every test on its own assertion
// rather than as one unreadable module crash.
const src = existsSync(PATH) ? readFileSync(PATH, 'utf8') : '';
const code = src.replace(/--.*$/gm, '');

// The same shape latestDefinition matches.
const definitionRe = (fn) => new RegExp(
  `create\\s+(?:or\\s+replace\\s+)?function\\s+(?:public\\.)?${fn}\\s*\\(` +
  `[\\s\\S]*?as\\s*(\\$[a-z_]*\\$)[\\s\\S]*?\\1\\s*;`, 'i');

// Past 0461, which restated several of these only to change who counts as a
// signup; their logic is still this file's.
const defOf = (fn) => {
  const def = latestDefinitionPastCodeEntry(fn);
  assert.ok(def, `${fn} is defined somewhere`);
  return def;
};

// This file's own definition, whatever came after it.
const ownDefinition = (fn) => {
  const body = src.match(definitionRe(fn))?.[0];
  assert.ok(body, `${FILE} defines ${fn}`);
  return { file: FILE, body };
};

// The last definition before this file: what 0460 rewrote.
function previousDefinition(fn) {
  let found = null;
  for (const f of migrationFiles()) {
    if (f === FILE) break;
    const m = readFileSync(join(MIGRATIONS_DIR, f), 'utf8').match(definitionRe(fn));
    if (m) found = { file: f, body: m[0] };
  }
  assert.ok(found, `${fn} was defined before ${FILE}`);
  return found;
}

// A body's code lines: comments stripped line-wise (never inside a quoted
// string), whitespace collapsed, blank lines dropped. Comparing these is what
// lets a rewrite copied from pg_get_functiondef, whose header and comments
// differ from the file it came from, be checked against that file at all.
function bodyLines(def) {
  const m = def.match(/as\s*(\$[a-z_]*\$)([\s\S]*?)\1/i);
  assert.ok(m, 'a dollar-quoted body');
  return m[2].split('\n').map((line) => {
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      if (line[i] === "'") quoted = !quoted;
      else if (!quoted && line[i] === '-' && line[i + 1] === '-') return line.slice(0, i);
    }
    return line;
  }).map((l) => l.trim().replace(/\s+/g, ' ')).filter(Boolean);
}

// "returns table ( a type, b type, ... )" -> [[a, type], [b, type], ...]
function returnsTable(body) {
  const m = body.match(/returns table\s*\(([\s\S]*?)\)\s*language/i);
  assert.ok(m, 'returns table (...) is declared');
  return m[1].split(',').map((s) => s.trim().split(/\s+/));
}

// One CTE's text, for bodies laid out as "\n  name as (" … "\n  )".
function cteIn(body, name) {
  const m = body.match(new RegExp(`\\n  ${name} as \\(([\\s\\S]*?)\\n  \\)`));
  assert.ok(m, `the ${name} CTE`);
  return m[1];
}

const RETIRED = [
  // [old identity, renamed to]
  ['admin_active_now(integer)', 'admin_active_now_0101'],
  ['admin_signups_by_day(integer, boolean)', 'admin_signups_by_day_0149'],
  ['admin_acquisition_channels(text)', 'admin_acquisition_channels_0159'],
  ['capture_metrics_daily()', 'capture_metrics_daily_0332'],
];

// Callable signed in (each checks _require_admin), never by anon.
const ADMIN_READS = [
  'public.admin_active_now(integer,boolean)',
  'public.admin_signups_by_day(integer,boolean,boolean)',
  'public.admin_acquisition_channels(text,text)',
  'public.admin_lifetime_totals(boolean,boolean)',
  'public.admin_recent_signups(integer,boolean,boolean)',
  'public.admin_growth_series(integer,boolean,boolean)',
  'public.admin_universe_stats()',
  'public.admin_universe_snapshot_v2(timestamptz,text,integer)',
  'public.admin_universe_edges_v2(timestamptz,text,integer)',
  'public.admin_list_users(integer,integer,text,text,text,text,text,text,text,text)',
  'public.admin_user_count(text,text,text,text,text,text,text)',
  'public.admin_share_signups(integer)',
  'public.admin_user_detail(uuid)',
];
const INTERNAL = ['public._admin_made_something()', 'public.capture_metrics_daily(date)'];

const MADE_SOMETHING_READERS = ['admin_list_users', 'admin_user_count', 'admin_acquisition_channels', 'admin_share_signups'];

test('the migration exists, is one transaction, and waits at most 3s for a lock', () => {
  assert.ok(src, `${FILE} exists`);
  assert.match(src, /^begin;$/m, 'opens a transaction');
  assert.match(src, /^set local lock_timeout = '3s';$/m, 'a hot table is altered: never queue behind a long lock');
  assert.ok(src.trimEnd().endsWith('commit;'), 'and commits it last');
  assert.match(src, /^notify pgrst, 'reload schema';$/m, 'PostgREST sees the new signatures at once');
});

test('the four retired signatures are renamed out of the way, closed, and proven gone', () => {
  for (const [old, renamed] of RETIRED) {
    const name = old.slice(0, old.indexOf('('));
    const args = old.slice(old.indexOf('('));
    const esc = (s) => s.replace(/[()[\].*+?^$|\\]/g, '\\$&');
    assert.match(src, new RegExp(`alter function public\\.${esc(old)} rename to ${renamed};`), `${name} is renamed`);
    assert.match(src, new RegExp(`revoke execute on function public\\.${renamed}${esc(args)} from public, anon, authenticated;`),
      `${renamed} is closed to every client role`);
  }
  const proof = src.match(/do \$proof\$[\s\S]*?\$proof\$;/)?.[0] ?? '';
  for (const [old, renamed] of RETIRED) {
    assert.ok(proof.includes(`('public.${old.replace(/, /g, ',')}')`), `the proof names ${old}`);
    assert.ok(proof.includes(`('public.${renamed}${old.slice(old.indexOf('(')).replace(/, /g, ',')}')`),
      `the proof names ${renamed}`);
  }
  assert.match(proof, /if to_regprocedure\(r\.sig\) is not null then/, 'the old identities are proven gone');
  // Renamed, never dropped: a DROP would also take an ACL the proof could not
  // then speak for, and the 0410 precedent keeps the old body inspectable.
  assert.doesNotMatch(code, /\bdrop\s+function\b/i, 'nothing is dropped');
});

test('every new argument defaults to the old behaviour', () => {
  assert.match(defOf('admin_active_now').body,
    /admin_active_now\(\s*p_window_minutes integer default 5,\s*p_exclude_internal boolean default false\s*\)/);
  assert.match(previousDefinition('admin_active_now').body, /p_window_minutes int default 5\)/, 'as 0101 had it');

  assert.match(defOf('admin_signups_by_day').body,
    /admin_signups_by_day\(\s*p_days integer default 30,\s*p_verified_only boolean default true,\s*p_exclude_internal boolean default false\s*\)/);
  assert.match(previousDefinition('admin_signups_by_day').body,
    /p_days integer default 30,\s*p_verified_only boolean default true\)/, 'as 0149 had it');

  assert.match(defOf('admin_acquisition_channels').body,
    /admin_acquisition_channels\(\s*p_verification text default 'all'::text,\s*p_activity text default 'all'::text\s*\)/);
  assert.match(previousDefinition('admin_acquisition_channels').body,
    /p_verification text DEFAULT 'all'::text\)/, 'as 0159 had it');

  // The cron used to call it bare, which captured today; bare still does.
  assert.match(defOf('capture_metrics_daily').body, /capture_metrics_daily\(p_day date default current_date\)/);

  for (const fn of ['admin_active_now', 'admin_signups_by_day', 'admin_acquisition_channels', 'capture_metrics_daily']) {
    assert.equal(defOf(fn).file, FILE, `the live ${fn} is this one`);
  }
});

test('"made something" has one definition, and every Users figure reads it', () => {
  const helper = defOf('_admin_made_something');
  assert.equal(helper.file, FILE);
  assert.deepEqual(returnsTable(helper.body.replace(/returns table\(user_id uuid\)/, 'returns table (user_id uuid)')),
    [['user_id', 'uuid']]);
  assert.match(helper.body, /language sql\s+stable\s+security definer\s+set search_path to 'public'/);
  const lines = bodyLines(helper.body);
  assert.deepEqual(lines, [
    'select p.user_id from public.profiles p where p.first_card_at is not null',
    'union',
    'select c.user_id from public._owner_card_counts c where c.live_cards > 0 and c.user_id is not null',
    'union',
    'select b.created_by from public.boards b',
    'where b.created_by is not null and b.deleted_at is null and b.parent_board_id is not null;',
  ], 'placed a card ever, holds cards, or made a cluster that is not a Studio');

  // 0746 restated the Users list and its count with a Sharing filter beside
  // this one; the predicate below is still 0460's, word for word.
  const SHARING_FILE = '0746_users_list_sharing.sql';
  const LIVE_IN = { admin_list_users: SHARING_FILE, admin_user_count: SHARING_FILE };
  for (const fn of ['admin_list_users', 'admin_user_count', 'admin_acquisition_channels']) {
    const body = defOf(fn).body;
    assert.equal(defOf(fn).file, LIVE_IN[fn] ?? FILE, `the live ${fn} is ${LIVE_IN[fn] ?? 'this one'}`);
    assert.match(body, /when 'active'\s+then [a-z_.]+ in\s+\(select m\.user_id from public\._admin_made_something\(\) m\)/,
      `${fn}: 'active' is made something`);
    assert.match(body, /when 'inactive' then [a-z_.]+ not in \(select m\.user_id from public\._admin_made_something\(\) m\)/,
      `${fn}: 'inactive' is its complement`);
  }
  const share = defOf('admin_share_signups');
  assert.equal(share.file, FILE);
  assert.match(cteIn(share.body.replace(/\n  with active_users as \(/, '\n  active_users as ('), 'active_users'),
    /^\s*select m\.user_id as id from public\._admin_made_something\(\) m\s*$/, 'activated is made something');
  for (const fn of MADE_SOMETHING_READERS) {
    assert.doesNotMatch(defOf(fn).body, /board_count > 0|b\.created_by = u\.id and b\.deleted_at is null/,
      `${fn} keeps no Studio-satisfied rule`);
  }
});

// Each rewrite, comments aside: the lines 0460 added and the lines it removed.
// Everything else is the previous definition verbatim.
const REWRITES = {
  bump_seconds_in_app: {
    prev: '0254_universe_counter_truth.sql',
    added: [
      'insert into public.user_active_day (user_id, day, did_work, work_ops, seconds)',
      'values (p_user_id, current_date, coalesce(p_did_work, false), case when p_did_work then 1 else 0 end, v_credit)',
      'work_ops = public.user_active_day.work_ops + excluded.work_ops,',
      'seconds = public.user_active_day.seconds + excluded.seconds;',
    ],
    removed: [
      'insert into public.user_active_day (user_id, day, did_work, work_ops)',
      'values (p_user_id, current_date, coalesce(p_did_work, false), case when p_did_work then 1 else 0 end)',
      'work_ops = public.user_active_day.work_ops + excluded.work_ops;',
    ],
  },
  admin_universe_snapshot_v2: {
    prev: '0254_universe_counter_truth.sql',
    added: [
      'join public.boards cb on cb.id = ci.board_id',
      'where cb.deleted_at is null',
      'and (p_cursor_ts is null or ci.created_at >= p_cursor_ts)',
    ],
    removed: ['where (p_cursor_ts is null or ci.created_at >= p_cursor_ts)'],
  },
  admin_universe_edges_v2: {
    prev: '0254_universe_counter_truth.sql',
    added: [
      'join public.boards cb on cb.id = ci.board_id',
      'where cb.deleted_at is null',
      'and (p_cursor_ts is null or ci.created_at >= p_cursor_ts)',
    ],
    removed: ['where (p_cursor_ts is null or ci.created_at >= p_cursor_ts)'],
  },
  admin_list_users: {
    prev: '0339_admin_card_counts_read_the_view.sql',
    added: [
      "when 'active' then base.user_id in (select m.user_id from public._admin_made_something() m)",
      "when 'inactive' then base.user_id not in (select m.user_id from public._admin_made_something() m)",
    ],
    removed: [
      "when 'active' then (base.card_count > 0 or base.board_count > 0)",
      "when 'inactive' then (base.card_count = 0 and base.board_count = 0)",
    ],
  },
  admin_user_count: {
    prev: '0339_admin_card_counts_read_the_view.sql',
    added: [
      "when 'active' then u.id in (select m.user_id from public._admin_made_something() m)",
      "when 'inactive' then u.id not in (select m.user_id from public._admin_made_something() m)",
    ],
    removed: [
      "when 'active' then (",
      'exists (select 1 from public._owner_card_counts c where c.user_id = u.id and c.live_cards > 0)',
      'or exists (select 1 from public.boards b where b.created_by = u.id and b.deleted_at is null))',
      "when 'inactive' then (",
      'not exists (select 1 from public._owner_card_counts c where c.user_id = u.id and c.live_cards > 0)',
      'and not exists (select 1 from public.boards b where b.created_by = u.id and b.deleted_at is null))',
    ],
  },
  admin_share_signups: {
    prev: '0193_share_signup_provenance.sql',
    added: ['select m.user_id as id from public._admin_made_something() m'],
    removed: [
      'select u.id',
      'from auth.users u',
      'where exists (select 1 from public.card_index ci join public.boards b on b.id = ci.board_id where b.created_by = u.id)',
      'or exists (select 1 from public.boards b where b.created_by = u.id and b.deleted_at is null)',
    ],
  },
  admin_user_detail: {
    prev: '0339_admin_card_counts_read_the_view.sql',
    added: [
      "'clusters_made', coalesce(ob.clusters_made, 0),",
      "'studios', coalesce(ob.studios, 0),",
      "'active_days', coalesce(ad.active_days, 0),",
      "'work_days', coalesce(ad.work_days, 0),",
      "'first_active_day', ad.first_day,",
      "'last_active_day', ad.last_day,",
      'select count(*)::int as board_count,',
      '(count(*) filter (where b.parent_board_id is not null))::int as clusters_made,',
      '(count(*) filter (where b.parent_board_id is null))::int as studios',
      'select count(*)::int as active_days,',
      '(count(*) filter (where a.did_work))::int as work_days,',
      'min(a.day) as first_day,',
      'max(a.day) as last_day',
      'from public.user_active_day a',
      'where a.user_id = u.id',
      ') ad on true',
    ],
    removed: ['select count(*)::int as board_count'],
  },
  admin_active_now: {
    prev: '0101_admin_metrics_history.sql',
    added: [
      'from public.user_presence pr',
      'where pr.last_seen_at > now() - make_interval(mins => p_window_minutes)',
      'and (not p_exclude_internal',
      'or pr.user_id not in (select iu.user_id from public._internal_user_ids() iu));',
    ],
    removed: [
      'from public.user_presence',
      'where last_seen_at > now() - make_interval(mins => p_window_minutes);',
    ],
  },
  admin_signups_by_day: {
    prev: '0149_verified_logged_in_users.sql',
    added: [
      'and (not p_exclude_internal',
      'or u.id not in (select iu.user_id from public._internal_user_ids() iu))',
    ],
    removed: [],
  },
  admin_acquisition_channels: {
    prev: '0159_admin_acquisition_channels.sql',
    added: [
      'declare',
      "v_v text := lower(coalesce(nullif(trim(p_verification), ''), 'all'));",
      "v_a text := lower(coalesce(nullif(trim(p_activity), ''), 'all'));",
      'and (case v_a',
      "when 'active' then u.id in (select m.user_id from public._admin_made_something() m)",
      "when 'inactive' then u.id not in (select m.user_id from public._admin_made_something() m)",
    ],
    removed: ["declare v_v text := lower(coalesce(nullif(trim(p_verification), ''), 'all'));"],
  },
  capture_metrics_daily: {
    prev: '0332_money_counters_read_true.sql',
    added: [
      'if p_day is null or p_day > current_date or p_day < current_date - 1 then',
      "raise exception 'capture_metrics_daily: only today or yesterday, not %', p_day using errcode = '22023';",
      'end if;',
      'p_day,',
      'where email_confirmed_at is not null and last_sign_in_at is not null',
      'and created_at >= p_day and created_at < p_day + 1)::int,',
      '(select count(*) from public.user_active_day where day = p_day)::int,',
    ],
    removed: [
      'current_date,',
      'where email_confirmed_at is not null and last_sign_in_at is not null and created_at >= current_date)::int,',
      '(select count(*) from public.user_presence where last_seen_at >= current_date)::int,',
    ],
  },
};

test('each rewrite is its previous definition with only the listed lines changed', () => {
  for (const [fn, want] of Object.entries(REWRITES)) {
    const prev = previousDefinition(fn);
    assert.equal(prev.file, want.prev, `${fn} was last defined in ${want.prev}`);
    const before = bodyLines(prev.body);
    const after = bodyLines(ownDefinition(fn).body);
    assert.deepEqual(after.filter((l) => !before.includes(l)), want.added, `${fn}: the lines 0460 added`);
    assert.deepEqual(before.filter((l) => !after.includes(l)), want.removed, `${fn}: the lines 0460 removed`);
    // A later migration may restate it (0470 makes bump_seconds_in_app credit
    // only its caller), but what is live keeps what 0460 wrote.
    const live = defOf(fn);
    const liveLines = bodyLines(live.body);
    assert.deepEqual(want.added.filter((l) => !liveLines.includes(l)), [], `${fn}: the live one (${live.file}) keeps 0460's lines`);
    assert.deepEqual(want.removed.filter((l) => liveLines.includes(l)), [], `${fn}: the live one (${live.file}) does not bring back what 0460 removed`);
  }
});

test('the admin reads are for signed-in callers, the internals for service_role alone', () => {
  for (const sig of ['admin_active_now(integer, boolean)', 'admin_signups_by_day(integer, boolean, boolean)',
                     'admin_acquisition_channels(text, text)', 'admin_lifetime_totals(boolean, boolean)',
                     'admin_recent_signups(integer, boolean, boolean)', 'admin_growth_series(integer, boolean, boolean)']) {
    const esc = sig.replace(/[()]/g, '\\$&');
    assert.match(src, new RegExp(`revoke execute on function public\\.${esc} from public, anon;`), `${sig} revoke`);
    assert.match(src, new RegExp(`grant execute on function public\\.${esc} to authenticated, service_role;`), `${sig} grant`);
  }
  for (const sig of ['_admin_made_something()', 'capture_metrics_daily(date)']) {
    const esc = sig.replace(/[()]/g, '\\$&');
    assert.match(src, new RegExp(`revoke execute on function public\\.${esc} from public, anon, authenticated;`), `${sig} revoke`);
    const grants = [...src.matchAll(new RegExp(`grant execute on function public\\.${esc} to ([^;]+);`, 'g'))].map((m) => m[1]);
    assert.deepEqual(grants, ['service_role'], `${sig} is granted to service_role only`);
  }
  const ADMIN_FNS = [...code.matchAll(/create or replace function public\.(admin_\w+)\(/g)].map((m) => m[1]);
  assert.equal(ADMIN_FNS.length, 13, 'thirteen admin_* functions are defined here');
  for (const fn of ADMIN_FNS) {
    assert.match(defOf(fn).body, /\bbegin\s+perform public\._require_admin\(\);/i, `${fn} checks the caller first`);
  }
});

test('the proof names every signature and checks every role, the heartbeat and the cron', () => {
  const proof = src.match(/do \$proof\$[\s\S]*?\$proof\$;/)?.[0];
  assert.ok(proof, 'a do $proof$ block');
  for (const sig of [...ADMIN_READS, ...INTERNAL]) assert.ok(proof.includes(`('${sig}')`), `the proof names ${sig}`);
  for (const role of ['anon', 'authenticated', 'service_role']) {
    assert.ok(proof.includes(`has_function_privilege('${role}', r.sig, 'execute')`), `the proof checks ${role}`);
  }
  assert.match(proof, /or not has_function_privilege\('authenticated', r\.sig, 'execute'\)/, 'admin reads must be callable signed in');
  assert.match(proof, /has_function_privilege\('authenticated', 'public\.bump_seconds_in_app\(integer,uuid,uuid,boolean\)', 'execute'\)/,
    'the heartbeat keeps its grant');
  assert.match(proof, /command like '%capture_metrics_daily\(current_date - 1\)%'/, 'the cron is proven to close yesterday');
});

test('admin_universe_stats counts live rows exactly, carries no clock, and keeps today as the cards chart reads it', () => {
  // 0461 rewrote how its people are counted; signupAtCodeEntryMigration.test.mjs
  // pins that edit against this body, and the clock again.
  assert.equal(defOf('admin_universe_stats').file, CODE_ENTRY_FILE);
  const body = ownDefinition('admin_universe_stats').body;
  assert.doesNotMatch(body, /platform_counters/, 'no counter maintained by triggers and a cron');
  assert.match(body, /'total_cards',\s+\(select count\(\*\) from public\.card_index ci join public\.boards b on b\.id = ci\.board_id where b\.deleted_at is null\)/,
    'cards on live clusters only');
  assert.match(body, /'total_boards',\s+\(select count\(\*\) from public\.boards where deleted_at is null\)/, 'kept for shipped bundles');
  assert.match(body, /'total_clusters_made',\s+\(select count\(\*\) from public\.boards where deleted_at is null and parent_board_id is not null\)/);
  assert.match(body, /'total_studios',\s+\(select count\(\*\) from public\.boards where deleted_at is null and parent_board_id is null\)/);
  assert.match(body, /v_since\s+timestamptz := now\(\) - interval '24 hours';/, 'a rolling day, not since UTC midnight');
  const last24 = body.match(/v_24h := jsonb_build_object\(([\s\S]*?)\n  \);/)?.[1] ?? '';
  assert.deepEqual([...last24.matchAll(/^\s+'(\w+)',/gm)].map((m) => m[1]), ['users', 'workspaces', 'boards', 'clusters_made', 'cards']);
  assert.equal(last24.match(/>= v_since/g)?.length, 5, 'every 24h figure is since v_since');

  // The party worker diffs this payload every second and pushes on change.
  assert.equal(body.match(/now\(\)/g)?.length, 2, 'now() only in the two declared bounds');
  const keys = [...body.matchAll(/^\s+'(\w+)',/gm)].map((m) => m[1]);
  assert.deepEqual(keys.filter((k) => /_at$|time|clock|stamp/.test(k)), [], 'no key carries a time');
  for (const k of ['total_users', 'total_workspaces', 'total_boards', 'total_clusters_made', 'total_studios', 'total_cards',
                   'total_links', 'total_seconds_in_app', 'nodes_created_24h', 'last_24h', 'today']) {
    assert.ok(body.includes(`'${k}'`), `the payload has ${k}`);
  }

  const todayOf = (b) => {
    const m = b.match(/v_today := jsonb_build_object\(([\s\S]*?)\n  \);/);
    assert.ok(m, 'a v_today block');
    return bodyLines(`as $x$${m[1]}$x$`);
  };
  assert.deepEqual(todayOf(body), todayOf(previousDefinition('admin_universe_stats').body),
    "today is 0254's, so its cards stay admin_cards_per_day's last bar");
});

test('capture_metrics_daily records the day it is given, and the cron closes yesterday then opens today', () => {
  const body = defOf('capture_metrics_daily').body;
  assert.match(body, /from public\.subscriptions where status = 'active'/, 'MRR is still active subscriptions only');
  assert.match(code, /select cron\.unschedule\(jobid\) from cron\.job where jobname = 'capture_metrics_daily';/);
  assert.match(code,
    /select cron\.schedule\('capture_metrics_daily', '5 0 \* \* \*',\s*\$\$select public\.capture_metrics_daily\(current_date - 1\), public\.capture_metrics_daily\(current_date\)\$\$\);/,
    'one statement, yesterday first');

  // The restatement touches only what a past day can be derived from.
  const updates = [...code.matchAll(/update public\.metrics_daily m\s+set (\w+) =[\s\S]*?;/g)];
  assert.deepEqual(updates.map((m) => m[1]), ['signups', 'active_users']);
  for (const m of updates) assert.match(m[0], /where m\.day < current_date/, `${m[1]} restates past days only`);
  assert.match(updates[1][0], /m\.day >= \(select min\(a\.day\) from public\.user_active_day a\)/,
    'active users only from the first day they were recorded');
  for (const m of updates) {
    assert.doesNotMatch(m[0], /mrr_cents|total_users|paid_users|trialing_users|demo_users|waitlist_users|admin_users/,
      `restating ${m[1]} leaves the snapshots what they were`);
  }
});

test('user_active_day.seconds is a catalog-only column, written only by the heartbeat', () => {
  assert.match(src, /alter table public\.user_active_day add column if not exists seconds integer not null default 0;/);
  assert.doesNotMatch(code, /grant [^;]*on (table )?public\.user_active_day/i, 'no new table grant: clients read it, never write it');
  // A later migration may restate the heartbeat (0470 did); nothing else may
  // write the column.
  const writes = /seconds\s*=\s*public\.user_active_day\.seconds/;
  const heartbeat = new RegExp(definitionRe('bump_seconds_in_app').source, 'gi');
  const writers = migrationFiles().filter((f) => f >= FILE)
    .filter((f) => writes.test(readFileSync(join(MIGRATIONS_DIR, f), 'utf8')));
  assert.equal(writers[0], FILE);
  for (const f of writers) {
    assert.doesNotMatch(readFileSync(join(MIGRATIONS_DIR, f), 'utf8').replace(heartbeat, ''), writes,
      `${f} writes user_active_day.seconds outside bump_seconds_in_app`);
  }
});

test('admin_growth_series is admin_weekly_series, then the long-run columns', () => {
  const def = defOf('admin_growth_series');
  assert.equal(def.file, FILE);
  const body = def.body;
  const weekly = defOf('admin_weekly_series').body;
  const cols = returnsTable(body);
  const weeklyCols = returnsTable(weekly).map(([n, t]) => [n, t === 'int' ? 'integer' : t]);
  assert.deepEqual(cols.slice(0, weeklyCols.length), weeklyCols, "admin_weekly_series' columns first, in order");
  assert.deepEqual(cols.slice(weeklyCols.length), [
    ['users_total', 'integer'], ['new_active', 'integer'], ['returning_active', 'integer'],
    ['clusters_made', 'integer'], ['cards_total', 'integer'],
    ['day_one_n', 'integer'], ['day_one_activated', 'integer'], ['day_one_complete', 'boolean'],
    ['seconds_in_app', 'bigint'], ['seconds_measurable', 'boolean'], ['seconds_floor', 'date'],
  ]);

  assert.match(body, /as \$function\$\s*#variable_conflict use_column/, 'use_column is the first line of the body');
  assert.match(body, /least\(greatest\(coalesce\(p_weeks, 104\), 2\), 260\)/, 'two years by default, five at most');
  assert.match(body, /date_trunc\('week', \(\(select min\(u\.created_at\) from auth\.users u\) at time zone 'utc'\)\)::date/,
    'never before the first account');
  assert.match(body, /people as \(select \* from public\._admin_people\(p_exclude_internal, p_verified_only\)\)/,
    "admin_weekly_series' population");
  assert.deepEqual(bodyLines(`as $x$${cteIn(body, 'ca')}$x$`), bodyLines(`as $x$${cteIn(weekly, 'ca')}$x$`),
    "cards per week are admin_weekly_series' cards, verbatim");
  assert.match(body, /-- card-count-lint: activity/, 'and say why they span trashed clusters');
  assert.match(cteIn(body, 'cl'), /where b\.deleted_at is null/, 'the running card total counts what still exists');
  assert.match(cteIn(body, 'cm'), /where b\.parent_board_id is not null/, 'a Studio is never a cluster made');
  assert.match(body, /v_seconds_floor := \(select min\(a\.day\) from public\.user_active_day a where a\.seconds > 0\);/,
    'time in app starts the first day it was recorded');
  assert.match(body, /case when v_seconds_floor is null or w\.wk < v_seconds_floor then null/, 'and is NULL before it');
  for (const expr of ['\\(w\\.wk \\+ 7\\) <= current_date', '\\(w\\.wk \\+ 7 \\+ 3\\) > current_date',
                      'v_active_floor is null or w\\.wk < v_active_floor', 'v_work_floor is null or w\\.wk < v_work_floor']) {
    assert.match(body, new RegExp(expr), `as admin_weekly_series: ${expr}`);
    assert.match(weekly, new RegExp(expr));
  }
  assert.doesNotMatch(body, /metrics_daily|updated_at/, 'durable tables, by creation time');
});

test('the lifetime totals and the newest signups draw people from _admin_people', () => {
  for (const fn of ['admin_lifetime_totals', 'admin_recent_signups']) {
    assert.equal(defOf(fn).file, FILE);
    assert.match(defOf(fn).body, /public\._admin_people\(p_exclude_internal, p_verified_only\)/, `${fn}'s population`);
  }
  const totals = defOf('admin_lifetime_totals').body;
  assert.match(totals, /admin_lifetime_totals\(\s*p_exclude_internal boolean default true,\s*p_verified_only boolean default true\s*\)/);
  assert.match(totals, /'cards',\s+\(select count\(\*\) from public\.card_index ci\s+join public\.boards b on b\.id = ci\.board_id\s+where b\.deleted_at is null/,
    'cards that still exist');
  const recent = defOf('admin_recent_signups').body;
  assert.match(recent, /least\(coalesce\(p_limit, 8\), 50\)/, 'clamped');
  assert.match(recent, /order by pe\.created_at desc/);
  assert.match(recent, /coalesce\(occ\.guest_cards, 0\)::int/, "work in someone else's cluster counts");
});
