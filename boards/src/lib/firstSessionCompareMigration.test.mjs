// firstSessionCompareMigration.test.mjs — 0495 makes Retention's first-session
// table read each person's signup day once. It was applied to the shared
// database the day it was written, so this pins what the table stands on.
//
//   node --test src/lib/firstSessionCompareMigration.test.mjs
//
// What this guards:
//   * the read stays linear. The day-one events are read once, as an instant
//     range events_user_time can bound, and no share probes a list of events
//     once per person, which a pooled connection's generic plan turned into
//     time in the square of the population;
//   * the rows. Only the day-one read changed: the population, the outcome,
//     the metric list, the error share and the final select are 0461's, so a
//     "while I was in there" edit fails here;
//   * the header, so the client's call and the fixture's rows still fit;
//   * the 0311 habit: closed to PUBLIC and anon, open to authenticated and
//     service_role, and the file proves it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MIGRATIONS_DIR, definitionsOf, latestDefinition } from './migrationText.mjs';

const FILE = '0495_first_session_compare_reads_day_one_once.sql';
const PREVIOUS = '0461_signups_count_once_the_code_is_entered.sql';
const FN = 'admin_first_session_compare';
const PATH = join(MIGRATIONS_DIR, FILE);
const src = existsSync(PATH) ? readFileSync(PATH, 'utf8') : '';

// Comments stripped line-wise, never inside a quoted string; whitespace collapsed.
const flat = (text) => text.split('\n').map((line) => {
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    if (line[i] === "'") quoted = !quoted;
    else if (!quoted && line[i] === '-' && line[i + 1] === '-') return line.slice(0, i);
  }
  return line;
}).join('\n').replace(/\s+/g, ' ').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').trim();

const defIn = (file) => {
  const d = definitionsOf(FN).find((x) => x.file === file);
  assert.ok(d, `${file} defines ${FN}`);
  return flat(d.body);
};

// The text of `name as (...)` inside a body, parentheses matched outside quotes.
function cte(body, name) {
  const m = body.match(new RegExp(`\\b${name}(?:\\([^)]*\\))? as \\(`));
  assert.ok(m, `the body has a ${name} step`);
  let depth = 0, quoted = false;
  for (let i = m.index + m[0].length - 1; i < body.length; i += 1) {
    const ch = body[i];
    if (ch === "'") quoted = !quoted;
    else if (!quoted && ch === '(') depth += 1;
    else if (!quoted && ch === ')' && (depth -= 1) === 0) return body.slice(m.index, i + 1);
  }
  assert.fail(`${name} never closes`);
}

const finalSelect = (body) => {
  const m = body.match(/select m\.metric, 'median'::text[\s\S]*?order by 3;/);
  assert.ok(m, 'the body ends on the three-part select');
  return m[0];
};

test(`${FILE} is the latest definition of ${FN}`, () => {
  assert.ok(src, `${FILE} exists`);
  assert.equal(latestDefinition(FN)?.file, FILE);
});

test('the signup day is read once, as an instant range, and nothing is probed per person', () => {
  const body = flat(latestDefinition(FN).body);
  const day1 = cte(body, 'day1');
  assert.match(day1, /left join public\.analytics_events e on e\.user_id = p\.user_id and e\.occurred_at >= p\.signup::timestamptz and e\.occurred_at < \(p\.signup \+ 1\)::timestamptz/);
  assert.match(day1, /group by p\.user_id, p\.returned, p\.signup/, 'one row per person');
  assert.equal((body.match(/public\.analytics_events/g) || []).length, 2, 'the day-one read and the first-seen probe, nothing else');
  assert.doesNotMatch(day1, /::date = p\.signup/, 'no ::date predicate on the events, which no index can bound');
  assert.doesNotMatch(body, /\bev as \(|from ev\b/, 'no materialised list of events to probe');
  assert.doesNotMatch(body, /group by e\.event/, 'no pass over every event to find when one began');
  const shares = cte(body, 'shares');
  assert.match(shares, /left join lateral \(select min\(e\.occurred_at\)::date as first_seen from public\.analytics_events e where e\.event = d\.src\) ep on true/);
  assert.match(shares, /d\.src = any\(p\.seen\)/);
  assert.doesNotMatch(shares, /exists/, 'a share asks the per-person list, never a probe');
});

test('only the day-one read changed: the population, the metrics, the error share and the select are 0461\'s', () => {
  const was = defIn(PREVIOUS);
  const now = defIn(FILE);
  for (const name of ['u', 'outcome', 'pop', 'share_defs', 'err_share']) {
    assert.equal(cte(now, name), cte(was, name), `${name} is unchanged`);
  }
  assert.equal(cte(now, 'medians'), cte(was, 'medians').replace('from spans sp', 'from day1 sp'),
    'the medians read the same four inputs, now from day1');
  assert.equal(finalSelect(now), finalSelect(was));
  for (const field of ['minutes', 'events_n', 'gcards', 'boards']) {
    assert.match(cte(now, 'day1'), new RegExp(`as ${field}\\b`), `day1 carries ${field}, as spans did`);
  }
  // The four day-one inputs are still taken from the ps_ events alone: the
  // span's two ends, the count, and the two maxima.
  assert.equal((cte(now, 'day1').match(/filter \(where e\.event like 'ps\\_%'\)/g) || []).length, 5);
  assert.match(now, /^create or replace function public\.admin_first_session_compare\([\s\S]*?\$function\$ #variable_conflict use_column declare v_age int := least\(greatest\(coalesce\(p_min_age_days, 14\), 0\), 365\); v_since date := coalesce\(p_since, '2026-06-16'::date\); begin perform public\._require_admin\(\); return query with u as/,
    'the gate comes first and the arguments are clamped as before');
});

test('the header is the one the client calls and the fixture mirrors', () => {
  const now = defIn(FILE);
  assert.match(now, /admin_first_session_compare\(p_since date default '2026-06-16'::date, p_min_age_days integer default 14, p_exclude_internal boolean default true, p_verified_only boolean default true\)/);
  assert.match(now, /returns table\(metric text, kind text, ord integer, measured_from date, returned_n integer, returned_val numeric, oneshot_n integer, oneshot_val numeric\)/);
  assert.match(now, /language plpgsql stable security definer set search_path to 'public' set work_mem to '24MB' as \$function\$/);
  const call = readFileSync(new URL('../pages/admin/analytics/views/RetentionView.jsx', import.meta.url), 'utf8')
    .match(/rpc\('admin_first_session_compare', \{([^}]*)\}/);
  assert.ok(call, 'Retention calls the read');
  assert.deepEqual(call[1].match(/p_[a-z_]+/g), ['p_exclude_internal', 'p_verified_only']);
});

test('the 0311 habit: closed to PUBLIC and anon, open to the signed-in admin, proved in the file', () => {
  const code = flat(src);
  const sig = 'public.admin_first_session_compare(date, integer, boolean, boolean)';
  assert.ok(code.includes(`revoke execute on function ${sig} from public, anon;`));
  assert.ok(code.includes(`grant execute on function ${sig} to authenticated, service_role;`));
  const proof = code.match(/do \$proof\$([\s\S]*?)\$proof\$;/);
  assert.ok(proof, 'the file proves its grants');
  for (const role of ['anon', 'authenticated', 'service_role']) {
    assert.ok(proof[1].includes(`has_function_privilege('${role}', v_sig, 'execute')`), `the proof checks ${role}`);
  }
  assert.match(proof[1], /proname = 'admin_first_session_compare'\) <> 1/, 'and that no overload sits beside it');
  assert.match(code, /^begin; set local lock_timeout = '3s';[\s\S]*commit;$/, 'one transaction that never waits on a lock');
});
