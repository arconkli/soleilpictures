// weeklySeriesMigration.test.mjs — 0372 is the data contract the admin
// Overview's weekly trend read stands on: one population predicate, one wide
// row per UTC week, the owner's dated notes, the markers, and two definition
// fixes made in place to admin_kpi_summary.
//
//   node --test src/lib/weeklySeriesMigration.test.mjs
//
// What this guards, beyond the grants:
//   * the row shape. lib/weeklySeries.js reads admin_weekly_series by column
//     NAME, so a renamed or dropped column is a silent gap on the chart, never
//     an error. The columns are pinned in order and cross-checked against the
//     adapter's own metric list;
//   * the in-place rewrite. admin_kpi_summary had to be 0149's body with only
//     the listed changes, each line marked -- 0372. That is checked line by
//     line against 0149, so "while I was in there" edits fail here;
//   * the boundaries. Nothing 0322/0347/0361/0363/0365 owns is re-created, and
//     nothing is dropped: a DROP discards a function's ACL (0149's lesson).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MIGRATIONS_DIR, migrationFiles, latestDefinition } from './migrationText.mjs';
import { WEEKLY_METRICS } from './weeklySeries.js';
import { WEEKLY_SERIES_KEYS } from './adminDefinitionBreaks.js';

const FILE = '0372_admin_weekly_series_and_notes.sql';
const PATH = join(MIGRATIONS_DIR, FILE);
// Read leniently so a missing file fails every test on its own assertion
// rather than as one unreadable module crash.
const src = existsSync(PATH) ? readFileSync(PATH, 'utf8') : '';
const code = src.replace(/--.*$/gm, '');

const ADMIN_FNS = ['admin_weekly_series', 'admin_note_add', 'admin_note_delete', 'admin_note_restore',
                   'admin_markers', 'admin_kpi_summary'];
const ALL_FNS = ['_admin_people', ...ADMIN_FNS];
const SIGNATURES = [
  'public._admin_people(boolean, boolean)',
  'public.admin_weekly_series(integer, boolean, boolean)',
  'public.admin_note_add(date, text, text)',
  'public.admin_note_delete(bigint)',
  'public.admin_note_restore(bigint)',
  'public.admin_markers(date)',
  'public.admin_kpi_summary(integer, boolean, boolean)',
];
const SERIES_COLUMNS = [
  ['week_start', 'date'], ['complete', 'boolean'], ['settling', 'boolean'], ['signups', 'int'],
  ['active_users', 'int'], ['active_measurable', 'boolean'], ['work_users', 'int'],
  ['work_measurable', 'boolean'], ['cards', 'int'], ['active_floor', 'date'], ['work_floor', 'date'],
];

const defOf = (fn) => {
  const def = latestDefinition(fn);
  assert.ok(def, `${fn} is defined somewhere`);
  return def;
};

// The same shape latestDefinition matches, scoped to one file's text.
function definitionIn(sql, fn) {
  const re = new RegExp(
    `create\\s+(?:or\\s+replace\\s+)?function\\s+(?:public\\.)?${fn}\\s*\\(` +
    `[\\s\\S]*?as\\s*(\\$[a-z_]*\\$)[\\s\\S]*?\\1\\s*;`, 'i');
  return sql.match(re)?.[0] ?? null;
}

// "returns table ( a type, b type, ... )" -> [[a, type], [b, type], ...]
function returnsTable(body) {
  const m = body.match(/returns table\s*\(([\s\S]*?)\)\s*language/i);
  assert.ok(m, 'returns table (...) is declared');
  return m[1].split(',').map((s) => s.trim().split(/\s+/));
}

// One CTE's text, for bodies laid out as this file's are: "\n  name as (" … "\n  )".
// Scoping an assertion to its CTE is what stops a match elsewhere in the body
// from passing for a CTE that lost the line.
function cteIn(body, name) {
  const m = body.match(new RegExp(`\\n  ${name} as \\(([\\s\\S]*?)\\n  \\)`));
  assert.ok(m, `the ${name} CTE`);
  return m[1];
}

test('the migration exists and is one transaction', () => {
  assert.ok(src, `${FILE} exists`);
  assert.match(src, /^begin;$/m, 'opens a transaction');
  assert.ok(src.trimEnd().endsWith('commit;'), 'and commits it last');
});

test('all seven functions are defined here, and every admin_* one asks _require_admin() first', () => {
  for (const fn of ALL_FNS) {
    assert.equal(defOf(fn).file, FILE, `${fn} is defined in ${FILE}`);
  }
  for (const fn of ADMIN_FNS) {
    const body = defOf(fn).body;
    assert.match(body, /_require_admin\(\)/, `${fn} is admin-only`);
    assert.match(body, /\bbegin\s+perform public\._require_admin\(\);/i, `${fn} checks before it does anything`);
  }
});

test('_admin_people is the one population predicate, callable by definer functions only', () => {
  const body = defOf('_admin_people').body;
  assert.deepEqual(returnsTable(body), [['user_id', 'uuid'], ['created_at', 'timestamptz']]);
  assert.match(body, /language sql stable security definer set search_path = public/i);
  assert.match(body, /not p_verified_only\s+or \(u\.email_confirmed_at is not null and u\.last_sign_in_at is not null\)/,
    "0149's verified rule");
  assert.match(body, /not p_exclude_internal\s+or u\.id not in \(select iu\.user_id from public\._internal_user_ids\(\) iu\)/,
    "0110's internal rule");
  assert.match(src, /revoke all on function public\._admin_people\(boolean, boolean\) from public, anon, authenticated;/);
  const grants = [...src.matchAll(/grant execute on function public\._admin_people\([^)]*\)\s+to ([^;]+);/g)]
    .map((m) => m[1].trim());
  assert.deepEqual(grants, ['service_role'], 'granted to service_role only');
});

test('every admin_* function is revoked from public and anon, and granted to authenticated and service_role', () => {
  for (const fn of ADMIN_FNS) {
    assert.match(src, new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\)\\s+from public, anon;`), `${fn} revoke`);
    assert.match(src, new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\)\\s+to authenticated, service_role;`),
      `${fn} grant`);
  }
});

test('the proof names all seven signatures and checks every role, the table, its sequence and the admin gate', () => {
  const proof = src.match(/do \$proof\$[\s\S]*?\$proof\$;/)?.[0];
  assert.ok(proof, 'a do $proof$ block');
  for (const sig of SIGNATURES) assert.ok(proof.includes(`'${sig}'`), `the proof names ${sig}`);
  for (const role of ['anon', 'authenticated', 'service_role']) {
    assert.ok(proof.includes(`has_function_privilege('${role}', `), `the proof checks ${role}`);
  }
  assert.match(proof, /not has_function_privilege\('service_role', /, 'service_role must be able to execute');
  for (const role of ['anon', 'authenticated']) {
    assert.ok(proof.includes(`has_table_privilege('${role}', 'public.admin_notes', `), `admin_notes is closed to ${role}`);
  }
  assert.match(proof, /'select'/, 'including select');
  for (const role of ['anon', 'authenticated']) {
    assert.ok(proof.includes(`has_sequence_privilege('${role}', 'public.admin_notes_id_seq', 'usage')`),
      `admin_notes_id_seq is proven closed to ${role}`);
  }
  assert.match(proof, /relrowsecurity/, 'row-level security is proven on');
  assert.match(proof, /position\('_require_admin\(\)' in v_src\)/, 'each admin_* body is proven admin-gated');
});

test('admin_notes is reachable only through the RPCs', () => {
  assert.match(src, /create table if not exists public\.admin_notes \(/);
  assert.match(src, /id\s+bigint generated always as identity primary key/);
  assert.match(src, /day\s+date not null/);
  assert.match(src, /label\s+text not null check \(length\(label\) between 1 and 120\)/);
  assert.match(src, /kind\s+text not null default 'note' check \(kind in \('ship', 'event', 'note'\)\)/);
  assert.match(src, /created_by\s+uuid references auth\.users on delete set null/);
  assert.match(src, /deleted_at\s+timestamptz\b/);
  assert.match(src, /on public\.admin_notes \(day\) where deleted_at is null;/, 'partial index on live notes');
  assert.match(src, /alter table public\.admin_notes enable row level security;/);
  assert.match(src, /revoke all on table public\.admin_notes from public, anon, authenticated;/);
  assert.match(src, /revoke all on sequence public\.admin_notes_id_seq from public, anon, authenticated;/,
    "the identity column's sequence is born with default grants");
  assert.doesNotMatch(code, /create policy[^;]*admin_notes/i, 'no policies: RLS denies every client');
  assert.doesNotMatch(code, /grant [^;]*on (table )?public\.admin_notes/i, 'no table grants');
});

test('nothing is dropped', () => {
  assert.ok(src, `${FILE} exists`);
  assert.doesNotMatch(src, /drop\s+function/i);
  assert.doesNotMatch(code, /\bdrop\s+\w+/i, 'no DROP of anything (comments aside)');
});

test('admin_weekly_series returns the eleven columns, in order, that the client adapter reads', () => {
  const body = defOf('admin_weekly_series').body;
  assert.deepEqual(returnsTable(body), SERIES_COLUMNS);
  const names = SERIES_COLUMNS.map(([n]) => n);
  for (const m of WEEKLY_METRICS) {
    assert.ok(names.includes(m.col), `${m.key} reads ${m.col}`);
    if (m.measurableCol) assert.ok(names.includes(m.measurableCol), `${m.key} reads ${m.measurableCol}`);
  }
  for (const k of WEEKLY_SERIES_KEYS) assert.ok(names.includes(k), `${k} is a series column`);
});

test('admin_weekly_series counts complete UTC weeks from durable tables, with honest floors', () => {
  const body = defOf('admin_weekly_series').body;
  assert.match(body, /as \$\$\s*#variable_conflict use_column/, 'use_column is the first line of the body');
  assert.match(body, /language plpgsql\s+stable\s+security definer\s+set search_path = public/i);
  assert.match(body, /least\(greatest\(coalesce\(p_weeks, 14\), 2\), 52\)/, 'clamped to 2..52 weeks');
  assert.match(body, /date_trunc\('week', current_date\)::date/, 'weeks start on Monday');
  assert.match(body, /generate_series\(v_first, v_this, interval '7 days'\)/, 'zero-filled');
  assert.match(body, /people as \(select \* from public\._admin_people\(p_exclude_internal, p_verified_only\)\)/);
  assert.match(cteIn(body, 'su'), /from people p\b/, 'signups count only the population');
  assert.match(cteIn(body, 'act'), /from public\.user_active_day a\s+join people p on p\.user_id = a\.user_id/,
    'presence and work count only the population');
  assert.match(cteIn(body, 'ca'),
    /not p_exclude_internal\s+or b\.created_by is null\s+or b\.created_by not in \(select iu\.user_id from public\._internal_user_ids\(\) iu\)/,
    'cards leave out internal owners, as admin_cards_per_day (0254) does');
  assert.match(body, /date_trunc\('week', \(p\.created_at at time zone 'utc'\)\)::date/, 'signups by UTC week');
  assert.match(body, /date_trunc\('week', a\.day\)::date/, 'presence by week');
  assert.match(body, /count\(distinct a\.user_id\) filter \(where a\.did_work\)/, 'work is distinct people');
  assert.match(body, /date_trunc\('week', \(ci\.created_at at time zone 'utc'\)\)::date/, 'cards by creation, UTC');
  assert.doesNotMatch(body, /updated_at/, 'never by last edit');
  assert.match(body, /min\(a\.day\) from public\.user_active_day a\)/, 'the presence floor is derived');
  assert.match(body, /min\(a\.day\) from public\.user_active_day a where a\.did_work\)/, 'the work floor is derived');
  assert.match(body, /\(w\.wk \+ 7\) <= current_date/, 'complete');
  assert.match(body, /\(w\.wk \+ 7 \+ 3\) > current_date/, 'settling');
  assert.match(body, /v_active_floor is null or w\.wk < v_active_floor/, 'NULL before presence was recorded');
  assert.match(body, /v_work_floor is null or w\.wk < v_work_floor/, 'NULL before work was recorded');
  assert.doesNotMatch(body, /metrics_daily/, 'never the snapshot table');
  assert.match(body, /order by w\.wk;/);
});

test('admin_kpi_summary is 0149 with only the listed changes, each marked -- 0372', () => {
  const before = definitionIn(readFileSync(join(MIGRATIONS_DIR, '0149_verified_logged_in_users.sql'), 'utf8'),
    'admin_kpi_summary');
  assert.ok(before, "0149's admin_kpi_summary is readable");
  const def = defOf('admin_kpi_summary');
  assert.equal(def.file, FILE, 'the live definition is this one');
  const after = def.body;
  const beforeLines = before.split('\n').map((l) => l.trimEnd());
  const afterLines = after.split('\n').map((l) => l.trimEnd());

  const unmarked = afterLines.filter((l) => !beforeLines.includes(l) && !/-- 0372\b/.test(l));
  assert.deepEqual(unmarked, [], 'a line that is not 0149 verbatim carries -- 0372');

  // The only 0149 lines allowed to disappear are the population predicates,
  // the WAU windows and the card timestamps. Everything else stays verbatim.
  const CHANGED = /select u\.id|auth\.users|profiles p on p\.user_id = u\.id|email_confirmed_at|u\.created_at >= v_prev_lo|u\.id not in|user_active_day|select day, user_id|user_id not in|interval '7 days'|updated_at/;
  const gone = beforeLines.filter((l) => !afterLines.includes(l) && !CHANGED.test(l));
  assert.deepEqual(gone, [], 'every other 0149 line survives verbatim');
});

test('admin_kpi_summary counts one population, exact windows, work, and card creation', () => {
  const body = defOf('admin_kpi_summary').body;
  assert.match(body, /admin_kpi_summary\(\s*p_days integer DEFAULT 30,\s*p_exclude_internal boolean DEFAULT true,\s*p_verified_only boolean DEFAULT true\)/,
    'same signature, so create or replace keeps the ACL');
  assert.match(body, /people as \(select \* from public\._admin_people\(p_exclude_internal, p_verified_only\)\)/);
  assert.doesNotMatch(body, /auth\.users|email_confirmed_at|last_sign_in_at/, 'no inline population predicate is left');
  assert.match(body, /from people u/, 'signers are people');
  assert.match(body, /join people u on u\.user_id = a\.user_id/, 'so are the weekly actives');
  assert.match(body, /cards as \(\s*select ci\.created_at/, 'the cards CTE selects creation time');
  assert.match(body, /where ci\.created_at >= v_prev_lo/);
  assert.doesNotMatch(body, /updated_at/, 'and never last edit');
  assert.match(body, /where day > v_cur_lo::date and day <= v_now::date\)/, 'current WAU is exactly p_days days');
  assert.match(body, /where day > v_prev_lo::date and day <= v_cur_lo::date\)/, 'and so is the previous one');
  assert.match(body, /where did_work and day > v_cur_lo::date and day <= v_now::date\)/, 'current work_users');
  assert.match(body, /where did_work and day > v_prev_lo::date and day <= v_cur_lo::date\)/, 'previous work_users');
  for (const key of ['signups', 'activated', 'activation_rate', 'demo_base', 'converted', 'demo_to_paid_rate',
                     'checkout_open', 'checkout_success', 'checkout_success_rate', 'wau', 'work_users', 'cards_created']) {
    // Line-anchored: 'checkout_open', also appears mid-line in the ev CTE.
    assert.equal(body.match(new RegExp(`^\\s+'${key}',`, 'gm'))?.length ?? 0, 2, `${key} is in current and previous`);
  }
  assert.match(body, /_internal_session_ids\(\)/, 'checkout events keep their session-level exclusion');
});

test('admin_markers reads notes, collapses repeated alerts, and leaves routine ops rows out', () => {
  const body = defOf('admin_markers').body;
  assert.deepEqual(returnsTable(body),
    [['day', 'date'], ['kind', 'text'], ['label', 'text'], ['source', 'text'], ['ref_id', 'bigint']]);
  assert.match(body, /as \$\$\s*#variable_conflict use_column/);
  assert.match(body, /coalesce\(p_since, current_date - 120\)/);
  assert.match(body, /deleted_at is null/, 'live notes only');
  assert.match(body, /kind = 'discovery_pipeline'/);
  assert.match(body, /row_number\(\) over \(partition by [^)]*order by [^)]*\)/, 'runs of consecutive days');
  assert.match(body, /' days\)'/, 'a run says how many days');
  assert.match(body, /\.kind not in \('heartbeat', 'test', 'held_reminder', 'signups'\)/);
  for (const k of ["'heartbeat'", "'test'", "'held_reminder'", "'signups'"]) assert.ok(body.includes(k), `${k} is excluded`);
  assert.match(body, /order by m\.day, m\.source, m\.label/);

  // client_errors is purged after 90 days (0108): discovery reads no further back.
  assert.match(cteIn(body, 'disc_days'), /ce\.occurred_at >= greatest\(v_since, current_date - 90\)/,
    'discovery is clamped to the client_errors horizon');
  const comment = src.match(/comment on function public\.admin_markers\(date\) is([\s\S]*?)';/)?.[1] ?? '';
  assert.match(comment, /~90 days/, 'the comment states the discovery horizon');
  assert.match(comment, /shortened \(n days\)/, 'and that a run begun before it is cut short');
  assert.match(comment, /24-hour dedupe/, 'the comment says why ops runs are bridged');
  assert.match(comment, /bridges gaps of up to 2 days/, 'and by how much');

  // Discovery re-fires daily (20-hour dedupe), so its runs are strictly
  // consecutive days. A stuck 0374 invariant goes through a 24-hour dedupe and
  // skips days at random, so an ops run bridges gaps of up to 2 days.
  assert.match(cteIn(body, 'disc_runs'), /row_number\(\) over \(partition by d\.name order by d\.day\)/, 'discovery runs');
  assert.doesNotMatch(cteIn(body, 'disc_runs'), /lag\(/, 'discovery stays strictly consecutive');
  assert.equal(body.match(/row_number\(\) over \(partition by/g)?.length ?? 0, 1, 'only discovery numbers its days');
  assert.match(cteIn(body, 'ops_gaps'),
    /case when o\.day - lag\(o\.day\) over \(partition by o\.k order by o\.day\) > 2 then 1 else 0 end as starts/,
    'a new ops run starts only after a gap of more than 2 days');
  assert.match(cteIn(body, 'ops_runs'),
    /sum\(g\.starts\) over \(partition by g\.k order by g\.day rows unbounded preceding\) as grp/,
    'an ops run id is the count of starts so far');
  assert.match(cteIn(body, 'ops_days'), /min\(oa\.title\) as title/, 'one title per kind per day');
  const ops = cteIn(body, 'ops');
  assert.match(ops, /from ops_runs r\s+group by r\.k, r\.grp/, 'one ops marker per run');
  assert.match(ops,
    /case when max\(r\.day\) = min\(r\.day\) then min\(r\.title\)\s+else min\(r\.title\) \|\| ' \(' \|\| \(max\(r\.day\) - min\(r\.day\) \+ 1\) \|\| ' days\)' end/,
    'a one-day run is its title; a longer one says its span in days');
});

test('notes are validated, soft-deleted and restorable as the same row', () => {
  const add = defOf('admin_note_add').body;
  assert.match(add, /returns jsonb/i);
  assert.match(add, /\bvolatile\b/i);
  assert.match(add, /date '2026-01-01'/);
  assert.match(add, /current_date \+ 1/);
  assert.match(add, /btrim\(/, 'the label is trimmed before it is measured');
  assert.equal(add.split("errcode = '22023'").length - 1, 3, 'day, label and kind each refuse with 22023');
  assert.match(add, /auth\.uid\(\)/, 'created_by is the caller');
  assert.match(add, /to_jsonb\(v_row\) - 'deleted_at'/);

  const del = defOf('admin_note_delete').body;
  assert.match(del, /returns boolean/i);
  assert.match(del, /set deleted_at = now\(\)/);
  assert.match(del, /and n\.deleted_at is null/, 'deleting twice changes nothing');

  const restore = defOf('admin_note_restore').body;
  assert.match(restore, /returns jsonb/i);
  assert.match(restore, /set deleted_at = null/);
  assert.match(restore, /and n\.deleted_at is not null/);
  assert.match(restore, /errcode = '22023'/, 'nothing to restore is an error, not a silent null');
  assert.match(restore, /to_jsonb\(v_row\) - 'deleted_at'/);
});

test('nothing 0322, 0347, 0361, 0363 or 0365 defined is dropped or re-created here', () => {
  assert.ok(src, `${FILE} exists`);
  const owned = new Set();
  for (const prefix of ['0322', '0347', '0361', '0363', '0365']) {
    const f = migrationFiles().find((n) => n.startsWith(`${prefix}_`));
    assert.ok(f, `${prefix} exists`);
    const sql = readFileSync(join(MIGRATIONS_DIR, f), 'utf8');
    for (const m of sql.matchAll(/create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?(\w+)\s*\(/gi)) owned.add(m[1]);
  }
  assert.ok(owned.has('_admin_visits') && owned.has('admin_return_by_mode'), 'the earlier files were read');
  for (const fn of [...owned, 'admin_cards_per_day', 'admin_signups_by_day', '_internal_user_ids', '_require_admin']) {
    assert.doesNotMatch(src, new RegExp(`(create|drop)\\s+(or\\s+replace\\s+)?function\\s+(if\\s+exists\\s+)?(public\\.)?${fn}\\s*\\(`, 'i'),
      `${fn} belongs to an earlier migration`);
  }
});
