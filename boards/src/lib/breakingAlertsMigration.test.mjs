// breakingAlertsMigration.test.mjs — 0581 emails the owner only when something
// is super breaking; these pin the owner's rules, caps and exclusions.
//
//   node --test src/lib/breakingAlertsMigration.test.mjs
//
// The owner decided on 2026-10-24: no digest and no routine email. Every
// problem waits in the admin Errors tab, and five rules send an email right
// away; 0583 added a sixth, the database crashing, which no count of people
// can see. A threshold nudged down, a window widened, a cap dropped or an
// exclusion lost would all still run, and would email the owner about
// nothing, so each one is read out of the latest definition here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { MIGRATIONS_DIR, latestDefinition } from './migrationText.mjs';

const FILE = '0581_only_breaking_problems_email.sql';
const src = readFileSync(join(MIGRATIONS_DIR, FILE), 'utf8');
const FUNCTIONS_DIR = new URL('../../../supabase/functions/', import.meta.url).pathname;

const body = (name) => {
  const def = latestDefinition(name);
  assert.ok(def, `${name} is defined`);
  return def.body;
};

// _breaking_candidates is one select per rule, joined by UNION ALL after the
// base CTE; each branch starts with its rule's name.
function branches() {
  const sql = body('_breaking_candidates');
  const tail = sql.slice(sql.indexOf("select 'wont_open'"));
  const parts = tail.split(/\bunion all\b/i);
  const out = {};
  for (const p of parts) {
    const name = p.match(/select\s+'(\w+)'/)?.[1];
    if (name) out[name] = p;
  }
  return out;
}

test('the six rules, with the owner\'s thresholds and windows', () => {
  const b = branches();
  assert.deepEqual(Object.keys(b).sort(), ['db_down', 'payments', 'saves', 'sign_in', 'widespread', 'wont_open']);
  for (const rule of ['wont_open', 'saves', 'sign_in']) {
    assert.match(b[rule], /interval '30 minutes'/, `${rule} looks at 30 minutes`);
    assert.match(b[rule], /having count\(distinct [^\n]*\) >= 3\s*$/, `${rule} needs 3 people`);
  }
  assert.match(b.payments, /having count\(\*\) >= 2/, 'payments: 2 failures');
  assert.doesNotMatch(b.payments, /interval '30 minutes'/, 'payments look at the whole hour');
  assert.match(b.widespread, /having count\(distinct b\.person\) >= 5/, 'one problem: 5 people');
  assert.match(b.widespread, /b\.severity in \('crash', 'error'\)/, 'a crash or an error, not a warning');
  assert.match(b.widespread, /b\.bucket is null/, 'a problem a dedicated rule covers emails once, by that rule');
  // A crash of the database: one in the last hour, by when it came back; the
  // day's are counted for the email. Nobody is counted: while it is down no
  // one's failure lands.
  assert.match(b.db_down, /select 'db_down', 'the database', 0, count\(\*\)::integer/);
  assert.match(b.db_down, /d\.source = 'db' and d\.kind = 'db_restart' and d\.severity = 'crash'/, 'a clean restart never emails');
  assert.match(b.db_down, /d\.occurred_at > p_at - interval '24 hours' and d\.occurred_at <= p_at/);
  assert.match(b.db_down, /having max\(d\.occurred_at\) > p_at - interval '1 hour'\s*\$\$;\s*$/);
  assert.match(b.db_down, /g\.fingerprint = d\.fingerprint and g\.status = 'muted'/, 'muting it stops it');
  // The base window is the hour.
  const base = body('_breaking_candidates');
  assert.match(base, /e\.received_at > p_at - interval '1 hour' and e\.received_at <= p_at/);
});

test('what each rule counts', () => {
  const base = body('_breaking_candidates');
  // The crash screen (AppErrorBoundary's 'render') or a load stuck on its splash.
  assert.match(base, /e\.kind = 'render' or \(e\.kind = 'stuck' and e\.context->>'op' = 'boot'\)/);
  assert.match(base, /when e\.kind = 'save' then 'saves'/);
  // Sign-in on OUR side only: a 5xx or no answer, never a person's wrong code.
  assert.match(base, /'svc' = 'auth'[\s\S]*?>= 500[\s\S]*?= 0\) then 'sign_in'/);
  for (const fn of ['create-checkout-session', 'verify-checkout-session', 'stripe-webhook', 'storage-addon', 'team-billing']) {
    assert.ok(base.includes(`'${fn}'`), `payments include ${fn}`);
    assert.ok(existsSync(join(FUNCTIONS_DIR, fn)), `${fn} is still an edge function's name`);
  }
});

test('never counted: other channels, preview and dev, staff, crawlers, offline, muted', () => {
  const base = body('_breaking_candidates');
  assert.match(base, /coalesce\(e\.env, 'prod'\) = 'prod'/, 'preview and dev never count; an old client sends no env');
  for (const kind of ['csp_violation', 'perf', 'seo_health', 'discovery_pipeline', 'aeo_probe']) {
    assert.ok(base.includes(`'${kind}'`), `${kind} has its own channel`);
  }
  assert.match(base, /e\.context->>'online', ''\) <> 'false'/, 'a row sent offline');
  assert.match(base, /not public\._error_is_bot_ua\(e\.user_agent\)/);
  // NOT EXISTS, not NOT IN: one null id from the helper would empty NOT IN.
  assert.match(base, /not exists \(select 1 from public\._internal_user_ids\(\) i where i\.user_id = e\.user_id\)/);
  assert.match(base, /g\.status = 'muted'/);
  assert.match(base, /client_error_mutes m[\s\S]*?_error_message_key\(e\.message\)/, "0133's mutes count too");
  // A browser that was signed in as staff, though this row came before sign-in.
  const check = body('check_breaking');
  assert.match(check, /public\.analytics_events a[\s\S]*?_internal_user_ids\(\)/);
  assert.match(check, /_breaking_candidates\(v_at, v_skip\)/);
});

test('the crawler test knows every crawler the client drops', () => {
  const noise = readFileSync(new URL('./errorNoise.js', import.meta.url), 'utf8');
  const words = noise.match(/function isBotUA[\s\S]*?\/([^/]+)\/i\.test/)[1].split('|');
  assert.ok(words.length >= 8);
  const sql = body('_error_is_bot_ua');
  for (const w of words) assert.ok(sql.includes(w), `the SQL crawler test misses ${w}`);
});

test('caps: once per problem per 6 hours, 6 emails a day, one email per pass', () => {
  const check = body('check_breaking');
  assert.match(check, /c_per_problem\s+constant interval := interval '6 hours'/);
  assert.match(check, /c_per_day\s+constant integer\s+:= 6/);
  assert.match(check, /a\.kind = c_kind and a\.page and a\.created_at > v_at - interval '24 hours'/);
  assert.match(check, /v_page := v_sent < c_per_day/);
  // One paged alert per pass; the rest of what it found rides along unpaged.
  assert.equal((check.match(/ops_alert_raise\(/g) || []).length, 2);
  assert.match(check, /ops_alert_raise\(c_kind, v_item->>'title',[^;]*false, v_item->>'key'/);
  // The template builds the subject from the kind; it keeps [a-z_] and 40.
  const kind = check.match(/c_kind\s+constant text\s+:= '([^']+)'/)[1];
  assert.match(kind, /^[a-z_]{1,40}$/);
});

test('the dry run writes nothing', () => {
  const check = body('check_breaking');
  const stop = check.indexOf('if p_dry_run or jsonb_array_length(v_items) = 0 then');
  assert.ok(stop > 0);
  assert.ok(check.indexOf('ops_alert_raise(') > stop, 'every raise comes after the dry run has returned');
  assert.match(check, /if not p_dry_run and not pg_try_advisory_xact_lock/);
});

test('the 5-minute job runs each step on its own, and a broken breaking check is emailed', () => {
  const watch = body('error_watch');
  const steps = [...watch.matchAll(/perform public\.(\w+)\((?:false)?\);\s+exception when others then\s+perform public\._error_watch_step_failed\('(\w+)'/g)]
    .map((m) => [m[1], m[2]]);
  assert.deepEqual(steps, [
    // First, so a start is on record for the same pass's breaking check (0583).
    ['_note_db_restart', 'note_db_restart'],
    ['check_server_health', 'check_server_health'],
    ['refresh_error_groups', 'refresh_error_groups'],
    ['check_breaking', 'check_breaking'],
  ]);
  assert.match(watch, /check_breaking\(false\)/);
  const failed = body('_error_watch_step_failed');
  assert.match(failed, /if p_step = 'check_breaking' then[\s\S]*?ops_alert_raise\([\s\S]*?true, 'error_watch:check_breaking', interval '1 day'/);
});

test('server failures are rows, cut to one per job and failure a pass', () => {
  const health = body('check_server_health');
  assert.match(health, /from cron\.job_run_details d/);
  assert.match(health, /from net\._http_response r/);
  assert.match(health, /'server_health_watermark'/);
  assert.match(health, /_error_scrub_server\(d\.return_message\)/, "a job's message is scrubbed");
  assert.doesNotMatch(health, /r\.content/, "a response's body is never stored");
});

test('every function 0581 creates is in its grants proof', () => {
  assert.doesNotMatch(src, /drop\s+(function|policy|trigger|table)/i, 'a DROP discards the ACL');
  const proof = src.slice(src.indexOf('do $proof$'));
  const created = [...src.matchAll(/create or replace function (public\.\w+)\(/g)].map((m) => m[1]);
  assert.equal(created.length, 7);
  for (const fn of created) {
    assert.ok(proof.includes(`'${fn}(`), `${fn} is checked with has_function_privilege`);
  }
  assert.match(proof, /has_function_privilege\('anon', v_fn, 'execute'\)/);
  assert.match(proof, /has_function_privilege\('authenticated', v_fn, 'execute'\)/);
  for (const fn of created.filter((f) => f.startsWith('public._'))) {
    assert.match(src, new RegExp(`revoke all on function ${fn.replace('.', '\\.')}\\([^)]*\\) from public, anon, authenticated;`),
      `${fn} is revoked from PUBLIC too`);
  }
});

// ── 0583: a database that crashed emails ────────────────────────────────────
const SRC_0583 = readFileSync(join(MIGRATIONS_DIR, '0583_a_database_crash_emails.sql'), 'utf8');

test('each start of the database is written down once, a crash\'s as a crash', () => {
  const note = body('_note_db_restart');
  assert.match(note, /v_start timestamptz := pg_postmaster_start_time\(\)/);
  // Once a start: the watermark holds the last one written down.
  assert.match(note, /'db_restart_watermark'[\s\S]*?if v_seen >= v_start then\s+return 0;/);
  // Postgres throws its statistics away after a crash and stamps the reset with
  // the start; a clean shutdown keeps them.
  assert.match(note, /coalesce\(w\.stats_reset >= v_start, false\) into v_crash from pg_stat_wal w/);
  assert.match(note, /values \('db', 'db_restart', case when v_crash then 'crash' else 'warning' end/);
  assert.match(note, /'prod', v_start\);/, 'the row is when it came back');
  const check = body('check_breaking');
  assert.match(check, /array\['db_down', 'wont_open', 'saves', 'sign_in', 'payments', 'widespread'\]/, 'it leads the email');
  assert.match(check, /when 'db_down'\s+then 'The database crashed and restarted'/);
});

test('every function 0583 creates or restates is in its grants proof', () => {
  assert.doesNotMatch(SRC_0583, /drop\s+(function|policy|trigger|table)/i, 'a DROP discards the ACL');
  const proof = SRC_0583.slice(SRC_0583.indexOf('do $proof$'));
  const created = [...SRC_0583.matchAll(/create or replace function (public\.\w+)\(/g)].map((m) => m[1]);
  assert.deepEqual(created, ['public._note_db_restart', 'public.error_watch', 'public._breaking_candidates', 'public.check_breaking']);
  for (const fn of created) assert.ok(proof.includes(`'${fn}(`), `${fn} is checked with has_function_privilege`);
  for (const fn of created.filter((f) => f.startsWith('public._'))) {
    assert.match(SRC_0583, new RegExp(`revoke all on function ${fn.replace('.', '\\.')}\\([^)]*\\) from public, anon, authenticated;`),
      `${fn} is revoked from PUBLIC too`);
  }
  // Its probes: a start written once, an old crash and a clean restart quiet, a
  // renderer's early watchdog uncounted and a person's counted.
  for (const said of ['the first pass after a start wrote', 'the second pass wrote the same start again',
                      'an old crash or a clean restart emailed', 'a renderer\'\'s splash watchdog counted',
                      'a person\'\'s stuck boot no longer counts']) {
    assert.ok(proof.includes(said), `the proof checks: ${said}`);
  }
});
