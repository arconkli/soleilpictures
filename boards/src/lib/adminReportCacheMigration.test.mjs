// 0892 + 0893: admin_report keeps the seven heavy admin reports for ten minutes
// in admin_report_cache. It is SECURITY DEFINER and writes, so what is pinned
// here is the fence: the admin check first, a fixed list of reports, no dynamic
// SQL, a table no client role can reach. Text only, no Postgres.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { latestDefinition, bodyText, MIGRATIONS_DIR } from './migrationText.mjs';

const TABLE_FILE = '0892_admin_report_cache.sql';
const FN_FILE = '0893_admin_report.sql';
const read = (f) => readFileSync(join(MIGRATIONS_DIR, f), 'utf8');
const code = (s) => s.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim();   // comments are not wiring

const tableSql = code(read(TABLE_FILE));
const fnSql = code(read(FN_FILE));

// The reports admin_report may run, with every argument each one takes. The
// names and arguments are the live signatures (pg_get_function_arguments).
const REPORTS = {
  admin_return_fixed_horizon: ['p_since', 'p_horizon_days', 'p_exclude_internal', 'p_verified_only', 'p_merge_hours', 'p_weeks'],
  admin_built_return: ['p_since', 'p_horizon_days', 'p_exclude_internal', 'p_verified_only', 'p_merge_hours', 'p_weeks'],
  admin_second_sitting: ['p_since', 'p_exclude_internal', 'p_verified_only', 'p_merge_hours', 'p_weeks', 'p_gap_minutes'],
  admin_return_by_mode: ['p_since', 'p_horizon_days', 'p_measure', 'p_exclude_internal', 'p_verified_only', 'p_merge_hours'],
  admin_activity_heatmap: ['p_days', 'p_tz', 'p_exclude_internal'],
  admin_sharing_overview: ['p_days', 'p_exclude_internal'],
  admin_tests_read: ['p_now'],
};
const TABLE_REPORTS = ['admin_return_fixed_horizon', 'admin_built_return', 'admin_second_sitting',
  'admin_return_by_mode', 'admin_activity_heatmap'];

const def = () => {
  const d = latestDefinition('admin_report');
  assert.ok(d, 'no definition of admin_report');
  return d;
};
const body = () => bodyText(code(def().body));

test('both files fit apply_migration', () => {
  for (const f of [TABLE_FILE, FN_FILE]) {
    const n = read(f).length;
    assert.ok(n < 5000, `${f} is ${n} characters; the limit is 5,000`);
  }
});

test('the table: keyed by report and arguments, with the two clocks', () => {
  assert.match(tableSql, /create table if not exists public\.admin_report_cache \(/);
  assert.match(tableSql, /fn text not null,/);
  assert.match(tableSql, /args jsonb not null default '\{\}'::jsonb,/);
  assert.match(tableSql, /result jsonb,/);
  assert.match(tableSql, /computed_at timestamptz not null default now\(\),/);
  assert.match(tableSql, /read_at timestamptz not null default now\(\),/);
  assert.match(tableSql, /primary key \(fn, args\)/);
});

test('the table is closed to clients: RLS on, no policy, the default grants taken back', () => {
  assert.match(tableSql, /alter table public\.admin_report_cache enable row level security;/);
  assert.match(tableSql, /revoke all on table public\.admin_report_cache from public, anon, authenticated;/);
  assert.doesNotMatch(tableSql + fnSql, /create policy/i);
  assert.doesNotMatch(tableSql + fnSql, /grant [a-z, ]+ on (table )?public\.admin_report_cache/i);
});

test('the table proves its own lock: RLS, no policy, no client privilege', () => {
  const proof = tableSql.slice(tableSql.indexOf('do $proof$'));
  assert.ok(tableSql.indexOf('revoke all') < tableSql.indexOf('do $proof$'), 'the proof runs after the revoke');
  assert.match(proof, /relrowsecurity/);
  assert.match(proof, /pg_policy/);
  assert.match(proof, /array\['anon', 'authenticated'\]/);
  assert.match(proof, /array\['select', 'insert', 'update', 'delete'\]/);
  assert.match(proof, /if has_table_privilege\(r, 'public\.admin_report_cache', p\) then raise exception/);
});

test('admin_report lives in 0893 with the signature the client calls', () => {
  const d = def();
  assert.equal(d.file, FN_FILE);
  assert.match(code(d.body),
    /create or replace function public\.admin_report\( p_fn text, p_args jsonb default '\{\}'::jsonb, p_fresh boolean default false \) returns jsonb/);
});

test('security definer, search_path pinned, volatile because it writes', () => {
  assert.match(code(def().body),
    /returns jsonb language plpgsql volatile security definer set search_path = public as \$fn\$/);
});

test('the admin check is the first statement', () => {
  const b = body();
  const first = b.slice(b.indexOf(' begin ') + ' begin '.length);
  assert.ok(first.startsWith('perform public._require_admin();'), first.slice(0, 80));
  // Nothing in the declarations reads the table or runs a report either.
  const declared = b.slice(0, b.indexOf(' begin '));
  assert.doesNotMatch(declared, /admin_report_cache|public\.admin_/);
});

test('the allowlist is exactly the seven reports, checked before anything is read', () => {
  const b = body();
  const m = b.match(/if p_fn is null or p_fn not in \(([^)]*)\) or jsonb_typeof\(a\) <> 'object' or length\(a::text\) > 2000 then raise exception '[^']+' using errcode = '22023'; end if;/);
  assert.ok(m, 'the allowlist check');
  const names = m[1].split(',').map(s => s.trim().replace(/^'|'$/g, '')).sort();
  assert.deepEqual(names, Object.keys(REPORTS).sort());
  assert.ok(b.indexOf(m[0]) < b.indexOf('admin_report_cache'), 'checked before the cache is read');
});

test('no dynamic SQL: the only functions it can run are the seven, by name', () => {
  const b = body();
  assert.doesNotMatch(b, /\bexecute\b/i);
  assert.doesNotMatch(b, /\bformat\s*\(/i);
  assert.doesNotMatch(b, /\bquote_(ident|literal|nullable)\b/i);
  const called = [...b.matchAll(/public\.(admin_[a-z_]+)\(/g)].map(x => x[1]).sort();
  assert.deepEqual(called, Object.keys(REPORTS).sort(), 'each report is called once, and nothing else');
  for (const fn of Object.keys(REPORTS).filter(f => f !== 'admin_tests_read')) {
    assert.ok(b.includes(`if p_fn = '${fn}' then`), `a branch for ${fn}`);
  }
  // admin_tests_read is the else: the allowlist above leaves nothing else.
  assert.match(b, /else v := public\.admin_tests_read\(/);
});

test('every argument it reads from p_args is one a report takes', () => {
  const b = body();
  const keys = new Set([...b.matchAll(/a \? '([a-z_]+)'/g)].map(x => x[1]));
  const real = new Set(Object.values(REPORTS).flat());
  assert.deepEqual([...keys].sort(), [...real].sort());
  // Left out -> the report's own default; present -> the value, null included.
  for (const k of real) {
    assert.match(b, new RegExp(`case when a \\? '${k}' then `), `${k} is read with its default`);
  }
});

test('each argument falls back to the report\'s own default', () => {
  const b = body();
  const dflt = (k, v) => new RegExp(`case when a \\? '${k}' then [^;]*? else ${v} end`);
  assert.match(b, dflt('p_horizon_days', '7'));
  assert.match(b, dflt('p_exclude_internal', 'true'));
  assert.match(b, dflt('p_verified_only', 'true'));
  assert.match(b, dflt('p_merge_hours', '2'));
  assert.match(b, dflt('p_weeks', '12'));
  assert.match(b, dflt('p_gap_minutes', '30'));
  assert.match(b, dflt('p_measure', "'any'"));
  assert.match(b, dflt('p_tz', "'UTC'"));
  assert.match(b, dflt('p_now', 'now\\(\\)'));
  // p_since and p_days differ by report.
  assert.match(b, /v_since := case when a \? 'p_since' then \(a->>'p_since'\)::date else '2026-08-17' end;/);
  assert.match(b, /public\.admin_return_fixed_horizon\( case when a \? 'p_since' then v_since else '2026-06-16' end,/);
  assert.match(b, /public\.admin_activity_heatmap\( case when a \? 'p_days' then \(a->>'p_days'\)::int else 30 end,/);
  assert.match(b, /public\.admin_sharing_overview\( case when a \? 'p_days' then \(a->>'p_days'\)::int else 90 end,/);
});

test('arguments go to each report in its own order', () => {
  const b = body();
  assert.match(b, /public\.admin_return_fixed_horizon\( case [^;]*? end, v_h, v_ex, v_ver, v_merge, v_weeks\)/);
  assert.match(b, /public\.admin_built_return\(v_since, v_h, v_ex, v_ver, v_merge, v_weeks\)/);
  assert.match(b, /public\.admin_second_sitting\(v_since, v_ex, v_ver, v_merge, v_weeks, case when a \? 'p_gap_minutes'/);
  assert.match(b, /public\.admin_return_by_mode\(v_since, v_h, case when a \? 'p_measure' [^;]*? end, v_ex, v_ver, v_merge\)/);
  assert.match(b, /public\.admin_activity_heatmap\( case when a \? 'p_days' [^;]*? end, case when a \? 'p_tz' [^;]*? end, v_ex\)/);
});

test('a table report comes back as PostgREST sends it: rows in order, [] when empty', () => {
  const b = body();
  for (const fn of TABLE_REPORTS) {
    const re = new RegExp(
      `select coalesce\\(jsonb_agg\\(to_jsonb\\(r\\) - 'ordinality' order by ordinality\\), '\\[\\]'\\) into v ` +
      `from public\\.${fn}\\([^;]*\\) with ordinality r;`);
    assert.match(b, re, fn);
  }
  assert.match(b, /v := public\.admin_sharing_overview\(/);
  assert.match(b, /v := public\.admin_tests_read\(/);
});

test('kept ten minutes, unless asked fresh; read_at moves at most hourly', () => {
  const b = body();
  const hit = b.slice(b.indexOf('if p_fresh is not true then'), b.indexOf('v_since :='));
  assert.ok(hit.length > 0);
  assert.match(hit, /where c\.fn = p_fn and c\.args = a and c\.computed_at > now\(\) - interval '10 minutes';/);
  assert.match(hit, /if found then update public\.admin_report_cache set read_at = now\(\) where fn = p_fn and args = a and read_at < now\(\) - interval '1 hour';/);
  assert.match(hit, /return jsonb_build_object\('data', v, 'at', v_at\); end if; end if;/);
  assert.equal((b.match(/interval '10 minutes'/g) || []).length, 1);
});

test('a computed answer is stamped, handed to _admin_report_keep, then {data, at} returned', () => {
  const b = body();
  const stamp = b.indexOf('v_at := now();');
  const keep = b.indexOf('perform public._admin_report_keep(p_fn, a, v, v_at);');
  const ret = b.lastIndexOf("return jsonb_build_object('data', v, 'at', v_at);");
  assert.ok(stamp > -1 && keep > stamp && ret > keep);
  assert.ok(b.includes('end if; v_at := now(); perform public._admin_report_keep('),
    'the stamp follows the dispatch\'s end if: a miss leaves v_at null');
  // Storing and purging live in the helper (0892), so two computes cannot deadlock on the purge.
  assert.doesNotMatch(b, /insert into/i);
  assert.doesNotMatch(b, /delete from/i);
});

test('_admin_report_keep (0892): invoker, skips a failed tests read, purges without waiting', () => {
  const fnStart = tableSql.indexOf('create or replace function public._admin_report_keep(');
  assert.ok(fnStart > -1, 'the helper is in 0892');
  const h = tableSql.slice(fnStart, tableSql.indexOf('$fn$;', fnStart) + 5);
  assert.match(h,
    /^create or replace function public\._admin_report_keep\( p_fn text, p_args jsonb, p_result jsonb, p_at timestamptz \) returns void language plpgsql volatile set search_path = public as \$fn\$/);
  assert.doesNotMatch(h, /security definer/i);
  const guard = "if p_fn <> 'admin_tests_read' or not jsonb_path_exists(p_result, '$.tests.*.error') then";
  const guardAt = h.indexOf(guard);
  const upsert = h.indexOf('insert into public.admin_report_cache (fn, args, result, computed_at, read_at) values (p_fn, p_args, p_result, p_at, p_at)');
  const conflict = h.indexOf('on conflict (fn, args) do update set (result, computed_at, read_at) = (excluded.result, p_at, p_at);');
  const endIf = h.indexOf('end if;', conflict);
  const purge = h.indexOf('delete from public.admin_report_cache');
  assert.ok(guardAt > -1, 'the guard');
  assert.ok(upsert > guardAt && conflict > upsert && endIf > conflict, 'the upsert sits inside the guard');
  assert.ok(purge > endIf, 'the purge comes after the upsert\'s end if');
  assert.match(h.slice(purge), /read_at < now\(\) - interval '2 days' for update skip locked/);
  const sig = 'public._admin_report_keep(text, jsonb, jsonb, timestamptz)';
  assert.ok(tableSql.includes(`revoke execute on function ${sig} from public, anon, authenticated;`));
  assert.ok(tableSql.indexOf('revoke execute on function') < tableSql.indexOf('do $proof$'), 'the proof runs after the revoke');
  const proof = tableSql.slice(tableSql.indexOf('do $proof$'));
  assert.ok(proof.includes(`if has_function_privilege(r, '${sig}', 'execute') then raise exception`));
});

test('grants: clients signed in may call it, anon may not, and the file proves it', () => {
  const sig = 'public.admin_report(text, jsonb, boolean)';
  const after = fnSql.slice(fnSql.indexOf('$fn$;'));
  assert.ok(after.includes(`revoke execute on function ${sig} from public, anon;`));
  assert.ok(after.includes(`grant execute on function ${sig} to authenticated, service_role;`));
  const proof = after.slice(after.indexOf('do $proof$'));
  assert.ok(after.indexOf('grant execute') < after.indexOf('do $proof$'), 'the proof runs after the grants');
  assert.ok(proof.includes(`f constant text := '${sig}';`));
  assert.match(proof, /if has_function_privilege\('anon', f, 'execute'\) then raise exception/);
  assert.match(proof, /if not has_function_privilege\('authenticated', f, 'execute'\) then raise exception/);
  assert.match(fnSql, /end \$proof\$; commit;$/);
});
