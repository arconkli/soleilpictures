// testsMigration.test.mjs — Analytics › Tests reads one RPC, admin_tests_read
// (0810), whose per-test helpers 0855 re-aimed at what each test now decides on.
//
//   node --test src/lib/testsMigration.test.mjs
//
// What this guards:
//   * the 0311 habit: admin_tests_read is admin-gated, closed to PUBLIC and anon,
//     open to authenticated and service_role; every _admin_test_* helper is
//     closed to all three; and each file proves it;
//   * 0810 stays the word on the read and the helpers 0855 leaves alone; 0855
//     is the word on the five it re-aims and on the release instant;
//   * every test on the page has a helper the read asks, and anything else the
//     read still asks is a test the page lists as earlier;
//   * the start instants are the code's own, so the page and the database
//     can't count from different moments;
//   * counts only: the read divides nothing; rates are the page's job;
//   * the team, service and banned accounts are left out of every test;
//   * every event it counts is one the client emits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MIGRATIONS_DIR, latestDefinition, duplicatePrefixes } from './migrationText.mjs';
import { EV } from './analyticsEvents.js';
import { EXPERIMENTS } from './experiments.js';
import { SETUP_EPOCH } from './setupRule.js';
import { BOARD_MORE_EPOCH } from './boardMoreEpoch.js';
import { TESTS, EARLIER_TESTS, SHARE_ASK_RELEASE, SHARE_ASK_BEFORE_FROM, EMAIL_HOLDOUT_START } from './testsCatalog.js';

const READ_FILE = '0810_admin_tests_read.sql';
const REAIM_FILE = '0855_admin_tests_reaim.sql';
const REAIMED = ['_admin_test_first_board_more', '_admin_test_signup_box', '_admin_test_email_holdout',
  '_admin_test_share_ask', '_admin_test_trial_early', '_admin_test_release_builds', '_admin_test_release_seen'];
const UNTOUCHED = ['admin_tests_read', '_admin_test_excluded', '_admin_test_accounts',
  '_admin_test_workspace_setup', '_admin_test_whats_new'];

const load = (file) => {
  const p = join(MIGRATIONS_DIR, file);
  const src = existsSync(p) ? readFileSync(p, 'utf8') : '';
  return { file, src, code: src.replace(/--.*$/gm, '') };
};
const FILES = [load(READ_FILE), load(REAIM_FILE)];
const [READ, REAIM] = FILES;

const helperNames = (code) => [...code.matchAll(/create or replace function public\.(_admin_test_[a-z_]+)\(([^)]*)\)/g)]
  .map((m) => ({ name: m[1], args: m[2] }));
const bodyIn = (code, name, file) => {
  const m = code.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?as (\\$[a-z]*\\$)([\\s\\S]*?)\\1;`));
  assert.ok(m, `${file} defines ${name}`);
  return m[2];
};
// The body live in Postgres: the latest migration that defines it.
const liveBody = (name) => {
  const d = latestDefinition(name);
  assert.ok(d, `some migration defines ${name}`);
  return bodyIn(d.body.replace(/--.*$/gm, ''), name, d.file);
};
const at = (iso) => new Date(iso).toISOString();

test('0810 and 0855 each run in one transaction, and each is the word on its own functions', () => {
  for (const { file, src, code } of FILES) {
    assert.ok(src, `${file} is in supabase/migrations`);
    assert.match(code, /^\s*begin;/m, file);
    assert.match(code, /set local lock_timeout = '3s';/, file);
    assert.match(code, /notify pgrst, 'reload schema';\s*commit;\s*$/, file);
    const prefix = file.slice(0, 4);
    assert.ok(!duplicatePrefixes().some((d) => String(d).includes(prefix)), `another migration is numbered ${prefix}`);
  }
  for (const fn of UNTOUCHED) assert.equal(latestDefinition(fn)?.file, READ_FILE, `${fn} is still 0810's`);
  for (const fn of REAIMED) assert.equal(latestDefinition(fn)?.file, REAIM_FILE, `${fn} is 0855's`);
  assert.doesNotMatch(REAIM.code, /function public\.admin_tests_read\(/, '0855 leaves the read as 0810 wrote it');
});

test('the read is admin-only, and only the read is callable', () => {
  const main = READ.code.match(/create or replace function public\.admin_tests_read\(p_now timestamptz default now\(\)\)\s*returns jsonb\s*language plpgsql stable security definer\s*set search_path = 'public'\s*as \$fn\$([\s\S]*?)\$fn\$;/);
  assert.ok(main, 'admin_tests_read(p_now) returns jsonb, a stable definer pinned to public');
  assert.match(main[1], /^\s*declare[\s\S]*?begin\s*perform public\._require_admin\(\);/, 'the gate comes first');
  assert.match(READ.code, /revoke execute on function public\.admin_tests_read\(timestamptz\) from public, anon;/);
  assert.match(READ.code, /grant execute on function public\.admin_tests_read\(timestamptz\) to authenticated, service_role;/);
  for (const { file, code } of FILES) {
    const proof = code.match(/do \$\$([\s\S]*?)\$\$;/);
    assert.ok(proof, `${file} proves its grants`);
    for (const { name, args } of helperNames(code)) {
      const sig = `public.${name}(${args.split(',').map((a) => a.trim().split(/\s+/).pop()).filter(Boolean).join(', ')})`;
      assert.ok(code.includes(`revoke execute on function ${sig} from public, anon, authenticated;`), `${file}: ${sig} is revoked`);
      assert.ok(proof[1].includes(`'${sig}'`), `${file}: the proof checks ${sig}`);
      assert.doesNotMatch(bodyIn(code, name, file), /security definer/, `${name} runs as its caller`);
    }
    assert.match(proof[1], /has_function_privilege\('anon', f, 'execute'\)/, file);
    assert.match(proof[1], /has_function_privilege\('authenticated', f, 'execute'\)/, file);
  }
  assert.match(READ.code.match(/do \$\$([\s\S]*?)\$\$;/)[1],
    /has_function_privilege\('anon', 'public\.admin_tests_read\(timestamptz\)', 'execute'\)/);
});

test('every test on the page has a helper the read asks; the rest are earlier tests', () => {
  const keys = TESTS.map((t) => t.key);
  const loop = READ.code.match(/foreach v_key in array array\[([\s\S]*?)\] loop/);
  assert.ok(loop, 'the read loops over the tests');
  const asked = [...loop[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  for (const k of keys) {
    assert.ok(latestDefinition(`_admin_test_${k}`), `_admin_test_${k} exists`);
    assert.ok(asked.includes(k), `the read asks ${k}`);
  }
  // Legacy keys stay in the read until production carries the new catalog.
  const earlier = new Set(EARLIER_TESTS.map((t) => t.key));
  for (const k of asked.filter((x) => !keys.includes(x))) {
    assert.ok(earlier.has(k), `the read still asks ${k}, which the page lists neither as a test nor as an earlier one`);
  }
  assert.match(READ.code, /exception when others then\s*v_part := jsonb_build_object\('error', sqlstate\);/, 'one failing test doesn’t blank the page');
});

test('the start instants are the code’s own', () => {
  const constant = (name, v) => {
    const m = liveBody(name).match(new RegExp(`${v}(?: constant)? timestamptz := '([^']+)'`));
    assert.ok(m, `${name} declares ${v}`);
    return at(m[1]);
  };
  assert.equal(constant('_admin_test_workspace_setup', 'v_start'), at(SETUP_EPOCH));
  assert.equal(constant('_admin_test_first_board_more', 'v_start'), at(BOARD_MORE_EPOCH));
  assert.equal(constant('_admin_test_signup_box', 'v_start'), at(EXPERIMENTS.signup_box.startsAt));
  assert.equal(constant('_admin_test_share_ask', 'v_live'), at(SHARE_ASK_RELEASE));
  assert.equal(constant('_admin_test_share_ask', 'v_before'), at(SHARE_ASK_BEFORE_FROM));
  assert.equal(constant('_admin_test_email_holdout', 'v_start'), at(EMAIL_HOLDOUT_START));
});

test('0855: the release instant is one helper, and the fix reads come from it', () => {
  // A build carries the release only by sending an event only the release
  // sends. exp_trial_early rides old builds too once an account is stamped
  // (armCache.adoptServer), so it must never mark one.
  const builds = liveBody('_admin_test_release_builds');
  assert.match(builds, /e\.event in \('share_ask_skipped', 'up_settings_view'\)/);
  assert.doesNotMatch(builds, /exp_trial_early/);
  const rel = liveBody('_admin_test_release_seen');
  assert.doesNotMatch(rel, /exp_trial_early/);
  assert.match(rel, /public\._admin_test_release_builds\(p_now\)/);
  assert.match(rel, /o\.event = 'app_open'/);
  assert.match(rel, /public\._admin_test_excluded\(\)/);
  const share = liveBody('_admin_test_share_ask');
  assert.match(share, /v_fix := public\._admin_test_release_seen\(p_now\);/);
  assert.match(share, /fixed as \(\s*select b as build from public\._admin_test_release_builds\(p_now\) b/);
  const trial = liveBody('_admin_test_trial_early');
  assert.match(trial, /v_on := public\._admin_test_release_seen\(p_now\);/);
  assert.match(trial, /e\.props->>'build' in \(select b from public\._admin_test_release_builds\(p_now\) b\)/);
  // Each person's first crossing decides the side, so nobody is counted on both.
  assert.match(share, /load_cross as \([\s\S]*?distinct on \(e\.user_id\)[\s\S]*?order by e\.user_id, e\.occurred_at/);
  assert.doesNotMatch(share, /distinct on \(s\.arm, s\.user_id\)/);
  // An offer seen on a build without the switch, before or after on_from, drops the account.
  assert.match(trial, /seen_before as \([\s\S]*?e\.occurred_at < v_on\s+or coalesce\(e\.props->>'build', ''\) not in \(select b from public\._admin_test_release_builds\(p_now\) b\)/);
});

test('0855: the email hold-back runs 12 weeks for both emails, and the file checks it', () => {
  assert.match(REAIM.code, /'activate_nudge_1', \(c\.value -> 'activate_nudge_1'\) \|\| jsonb_build_object\('holdout_weeks', 12\)/);
  assert.match(REAIM.code, /'board_waiting', \(c\.value -> 'board_waiting'\) \|\| jsonb_build_object\('holdout_weeks', 12\)/);
  assert.match(REAIM.code, /holdout_weeks' = '12'[\s\S]*?raise exception/);
});

test('counts only: the read divides nothing', () => {
  for (const { file, code } of FILES) {
    assert.doesNotMatch(code, /\s\/\s|round\(|avg\(|percentile_|::numeric|::float|double precision/, file);
  }
});

test('the team, service and banned accounts are left out of every test', () => {
  const ex = liveBody('_admin_test_excluded');
  assert.match(ex, /public\._internal_user_ids\(\)/);
  assert.match(ex, /banned_at is not null/);
  assert.match(ex, /coalesce\(p\.is_service, false\)/);
  const uses = (b) => b.includes('public._admin_test_excluded()') || b.includes('public._admin_test_accounts(');
  for (const t of TESTS.filter((x) => x.key !== 'whats_new')) {
    assert.ok(uses(liveBody(`_admin_test_${t.key}`)), `_admin_test_${t.key} leaves the excluded accounts out`);
  }
  // _admin_test_release_builds names builds, not people; the instant read from
  // them (_admin_test_release_seen) is where the excluded accounts are left out.
  for (const name of REAIMED.filter((n) => n !== '_admin_test_release_builds')) {
    assert.ok(uses(liveBody(name)), `${name} leaves the excluded accounts out`);
  }
  // The rotation's counts are the sender's own tallies; nothing per person to filter.
  assert.doesNotMatch(liveBody('_admin_test_whats_new'), /auth\.users|analytics_events/);
});

test('every event it counts is one the client emits', () => {
  const known = new Set(Object.values(EV));
  for (const { file, code } of FILES) {
    const named = new Set();
    for (const m of code.matchAll(/event\s*=\s*'([a-z_0-9]+)'/g)) named.add(m[1]);
    for (const m of code.matchAll(/event\s*<>\s*'([a-z_0-9]+)'/g)) named.add(m[1]);
    for (const m of code.matchAll(/event\s+in\s*\(([^)]*)\)/g)) {
      for (const n of m[1].matchAll(/'([a-z_0-9]+)'/g)) named.add(n[1]);
    }
    assert.ok(named.size >= 10, `found ${file}'s events`);
    for (const e of named) assert.ok(known.has(e), `${file}: ${e} is not in analyticsEvents.js`);
  }
});
