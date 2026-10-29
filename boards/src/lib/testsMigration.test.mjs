// testsMigration.test.mjs — 0810 gives Analytics › Tests its one read.
//
//   node --test src/lib/testsMigration.test.mjs
//
// What this guards:
//   * the 0311 habit: admin_tests_read is admin-gated, closed to PUBLIC and anon,
//     open to authenticated and service_role; every _admin_test_* helper is
//     closed to all three; and the file proves it;
//   * one helper per test on the page, and the read asks each of them;
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
import { TESTS, SHARE_ASK_RELEASE, SHARE_ASK_BEFORE_FROM, EMAIL_HOLDOUT_START } from './testsCatalog.js';

const FILE = '0810_admin_tests_read.sql';
const PATH = join(MIGRATIONS_DIR, FILE);
const src = existsSync(PATH) ? readFileSync(PATH, 'utf8') : '';
const code = src.replace(/--.*$/gm, '');

const helperNames = () => [...code.matchAll(/create or replace function public\.(_admin_test_[a-z_]+)\(([^)]*)\)/g)]
  .map((m) => ({ name: m[1], args: m[2] }));
const fnBody = (name) => {
  const m = code.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?as (\\$[a-z]*\\$)([\\s\\S]*?)\\1;`));
  assert.ok(m, `${FILE} defines ${name}`);
  return m[2];
};
const at = (iso) => new Date(iso).toISOString();

test('0810 exists, runs in one transaction and is the latest word on its read', () => {
  assert.ok(src, `${FILE} is in supabase/migrations`);
  assert.match(code, /^\s*begin;/m);
  assert.match(code, /set local lock_timeout = '3s';/);
  assert.match(code, /notify pgrst, 'reload schema';\s*commit;\s*$/);
  assert.equal(latestDefinition('admin_tests_read')?.file, FILE);
  assert.ok(!duplicatePrefixes().some((d) => String(d).includes('0810')), 'another migration is numbered 0810');
});

test('the read is admin-only, and only the read is callable', () => {
  const main = code.match(/create or replace function public\.admin_tests_read\(p_now timestamptz default now\(\)\)\s*returns jsonb\s*language plpgsql stable security definer\s*set search_path = 'public'\s*as \$fn\$([\s\S]*?)\$fn\$;/);
  assert.ok(main, 'admin_tests_read(p_now) returns jsonb, a stable definer pinned to public');
  assert.match(main[1], /^\s*declare[\s\S]*?begin\s*perform public\._require_admin\(\);/, 'the gate comes first');
  assert.match(code, /revoke execute on function public\.admin_tests_read\(timestamptz\) from public, anon;/);
  assert.match(code, /grant execute on function public\.admin_tests_read\(timestamptz\) to authenticated, service_role;/);
  const proof = code.match(/do \$\$([\s\S]*?)\$\$;/);
  assert.ok(proof, 'the file proves its grants');
  for (const { name, args } of helperNames()) {
    const sig = `public.${name}(${args.split(',').map((a) => a.trim().split(/\s+/).pop()).filter(Boolean).join(', ')})`;
    assert.ok(code.includes(`revoke execute on function ${sig} from public, anon, authenticated;`), `${sig} is revoked`);
    assert.ok(proof[1].includes(`'${sig}'`), `the proof checks ${sig}`);
    assert.doesNotMatch(fnBody(name), /security definer/, `${name} runs as its caller`);
  }
  assert.match(proof[1], /has_function_privilege\('anon', 'public\.admin_tests_read\(timestamptz\)', 'execute'\)/);
  assert.match(proof[1], /has_function_privilege\('authenticated', f, 'execute'\)/);
});

test('one helper per test on the page, and the read asks each one', () => {
  const keys = TESTS.map((t) => t.key).sort();
  const helpers = helperNames().map((h) => h.name.replace(/^_admin_test_/, ''))
    .filter((k) => k !== 'excluded' && k !== 'accounts').sort();
  assert.deepEqual(helpers, keys);
  const loop = code.match(/foreach v_key in array array\[([\s\S]*?)\] loop/);
  assert.ok(loop, 'the read loops over the tests');
  assert.deepEqual([...loop[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort(), keys);
  assert.match(code, /exception when others then\s*v_part := jsonb_build_object\('error', sqlstate\);/, 'one failing test doesn’t blank the page');
});

test('the start instants are the code’s own', () => {
  const constant = (name, v) => {
    const m = fnBody(name).match(new RegExp(`${v}(?: constant)? timestamptz := '([^']+)'`));
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

test('counts only: the read divides nothing', () => {
  assert.doesNotMatch(code, /\s\/\s|round\(|avg\(|percentile_|::numeric|::float|double precision/);
});

test('the team, service and banned accounts are left out of every test', () => {
  const ex = fnBody('_admin_test_excluded');
  assert.match(ex, /public\._internal_user_ids\(\)/);
  assert.match(ex, /banned_at is not null/);
  assert.match(ex, /coalesce\(p\.is_service, false\)/);
  for (const t of TESTS.filter((x) => x.key !== 'whats_new')) {
    const b = fnBody(`_admin_test_${t.key}`);
    const uses = b.includes('public._admin_test_excluded()') || b.includes('public._admin_test_accounts(');
    assert.ok(uses, `_admin_test_${t.key} leaves the excluded accounts out`);
  }
  // The rotation's counts are the sender's own tallies; nothing per person to filter.
  assert.doesNotMatch(fnBody('_admin_test_whats_new'), /auth\.users|analytics_events/);
});

test('every event it counts is one the client emits', () => {
  const known = new Set(Object.values(EV));
  const named = new Set();
  for (const m of code.matchAll(/event\s*=\s*'([a-z_0-9]+)'/g)) named.add(m[1]);
  for (const m of code.matchAll(/event\s+in\s*\(([^)]*)\)/g)) {
    for (const n of m[1].matchAll(/'([a-z_0-9]+)'/g)) named.add(n[1]);
  }
  assert.ok(named.size >= 10, 'found the events');
  for (const e of named) assert.ok(known.has(e), `${e} is not in analyticsEvents.js`);
});
