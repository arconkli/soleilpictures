// instrumentationCheck.test.mjs — 0472's daily check that each feature's events
// still arrive, admin_event_coverage's four new rows, 0475's rule that an
// import's clusters are the import's to record, and 0497's watch on the
// welcome email.
//
//   node --test src/lib/instrumentationCheck.test.mjs
//
// 0472, 0475 and 0497 were applied the day they were written; their own proof
// blocks check the grants, the schedule and the samples in the database. This
// pins the shape against a later edit:
//   * only an event that STOPPED pages; never-measured and thinning don't;
//   * the team's accounts are left out of every source, truth and events alike,
//     so preview traffic (whose events divert) can never read as loss;
//   * admin_event_coverage is 0461's body with the ev CTE keyed and four rows
//     added, and nothing else moved;
//   * the cluster_create pair leaves out the clusters an import made, by a
//     ledger that outlives the window the check reads, and first_cluster's
//     people count by either event (0475);
//   * the welcome pair counts who lifecycle_due_welcome_board would find, late
//     enough that each has had its send hour, and every other pair's words
//     and numbers are what they were (0497).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MIGRATIONS_DIR, latestDefinition, definitionsOf, migrationFiles } from './migrationText.mjs';

const FILE = '0472_instrumentation_check.sql';
const IMPORTS = '0475_import_clusters_count_as_imports.sql';
const WELCOME = '0497_instrumentation_watches_the_welcome.sql';
const src = readFileSync(join(MIGRATIONS_DIR, FILE), 'utf8');
const fix = readFileSync(join(MIGRATIONS_DIR, IMPORTS), 'utf8');
const wel = readFileSync(join(MIGRATIONS_DIR, WELCOME), 'utf8');
const defIn = (fn, file) => definitionsOf(fn).find((d) => d.file === file);

// A body's code lines: whole-line and trailing comments dropped, whitespace
// collapsed, blank lines gone.
function bodyLines(def) {
  const m = def.match(/as\s*(\$[a-z_]*\$)([\s\S]*?)\1/i);
  assert.ok(m, 'a dollar-quoted body');
  return m[2].replace(/--.*$/gm, '').split('\n').map((l) => l.trim().replace(/\s+/g, ' ')).filter(Boolean);
}

test('these files are where the check, its numbers and the email kinds live', () => {
  for (const fn of ['_email_kind', '_email_school_domain']) {
    assert.equal(latestDefinition(fn)?.file, FILE, `the live ${fn} is ${FILE}'s`);
  }
  assert.equal(latestDefinition('admin_event_coverage')?.file, IMPORTS, `the live admin_event_coverage is ${IMPORTS}'s`);
  for (const fn of ['check_instrumentation', '_instrumentation_pairs']) {
    assert.equal(latestDefinition(fn)?.file, WELCOME, `the live ${fn} is ${WELCOME}'s`);
  }
  for (const [name, text] of [[FILE, src], [IMPORTS, fix], [WELCOME, wel]]) {
    assert.doesNotMatch(text.replace(/--.*$/gm, ''), /\bdrop\s+function\b/i, `${name}: create or replace keeps every grant`);
  }
});

test('only an event that stopped pages', () => {
  const body = latestDefinition('check_instrumentation').body;
  const raises = [...body.matchAll(/ops_alert_raise\('instrumentation',[\s\S]*?\n\s*(true|false), 'instrumentation:(\w+):'/g)]
    .map((m) => [m[2], m[1]]);
  assert.deepEqual(raises, [['dark', 'true'], ['never', 'false'], ['thin', 'false']]);
  // Stopped: three or more people, none of its events, and it arrived before.
  assert.match(body, /if r\.truth_users >= 3 and r\.ev_n = 0 and r\.base_ev_n > 0 then/);
  assert.match(body, /elsif not r\.per_person and r\.truth_users >= 3 and r\.ev_n = 0 and r\.base_ev_n = 0 then/);
  assert.match(body, /r\.ev_n::numeric \/ r\.truth_n < 0\.5 \* r\.base_ev_n::numeric \/ r\.base_truth_n/);
});

test('eight pairs, and the team is left out of every source', () => {
  const body = latestDefinition('_instrumentation_pairs').body;
  const pairs = [...body.matchAll(/^\s*\('(\w+)',\s+(true|false),/gm)].map((m) => m[1]);
  assert.deepEqual(pairs, ['active', 'session_context', 'first_card', 'cluster_create', 'msg_send', 'import_job', 'link_claim', 'welcome']);
  assert.match(body, /internal as \(select i\.user_id from public\._internal_user_ids\(\) i\)/);
  // user_active_day, profiles, boards, messages, import_jobs, link joins,
  // analytics_events, and the welcome's accounts.
  for (const col of ['d.user_id', 'p.user_id', 'b.created_by', 'm.sender_id', 'j.owner_id', 'l.user_id', 'e.user_id', 'u.id']) {
    assert.ok(body.includes(`and not exists (select 1 from internal i where i.user_id = ${col})`), `${col} leaves the team out`);
  }
});

test('internal, daily, and closed to every client role', () => {
  for (const sig of ['_instrumentation_pairs(timestamptz)', 'check_instrumentation()']) {
    const esc = sig.replace(/[()]/g, '\\$&');
    assert.match(src, new RegExp(`^revoke all on function public\\.${esc} from public, anon, authenticated;$`, 'm'));
    assert.match(src, new RegExp(`^grant execute on function public\\.${esc} to service_role;$`, 'm'));
  }
  assert.match(src, /^select cron\.schedule\('instrumentation-daily', '10 15 \* \* \*', \$\$ select public\.check_instrumentation\(\); \$\$\);$/m);
  // 0475 replaced two of them in place, and proves their grants survived.
  for (const [role, sig] of [['anon', '_instrumentation_pairs(timestamptz)'], ['authenticated', '_instrumentation_pairs(timestamptz)'],
                             ['service_role', '_instrumentation_pairs(timestamptz)'], ['anon', 'admin_event_coverage(integer, boolean, boolean)']]) {
    const esc = sig.replace(/[()]/g, '\\$&');
    assert.match(fix, new RegExp(`has_function_privilege\\('${role}', 'public\\.${esc}', 'execute'\\)`), `0475 proves ${role} on ${sig}`);
  }
  // 0497 replaced both in place, and proves each is service_role's alone.
  const proof = wel.match(/do \$proof\$([\s\S]*?)\$proof\$;/)?.[1];
  assert.ok(proof, '0497 proves what it did');
  assert.ok(proof.includes("foreach v_fn in array array['public._instrumentation_pairs(timestamptz)', 'public.check_instrumentation()'] loop"));
  for (const role of ['anon', 'authenticated', 'service_role']) {
    assert.ok(proof.includes(`has_function_privilege('${role}', v_fn, 'execute')`), `0497 proves ${role} on both`);
  }
  assert.doesNotMatch(wel.replace(/--.*$/gm, ''), /\b(grant|revoke)\b[^;]*\bon\s+function\b/i, '0497 leaves both ACLs as they were');
});

test("admin_event_coverage is 0461's with the ev CTE keyed and four rows added", () => {
  const defs = definitionsOf('admin_event_coverage');
  const i = defs.findIndex((d) => d.file === FILE);
  assert.ok(i > 0, `${FILE} defines it, after something before it`);
  const now = defs[i], before = defs[i - 1];
  assert.equal(before.file, '0461_signups_count_once_the_code_is_entered.sql');
  const a = bodyLines(now.body), b = bodyLines(before.body);
  const removed = b.filter((l) => !a.includes(l));
  assert.deepEqual(removed, ['select event, count(distinct user_id) as users', 'group by event'], 'only the ev CTE\'s key moved');
  for (const m of ['first_cluster', 'first_message', 'first_import', 'joined_by_link']) {
    assert.ok(a.includes(`select '${m}',`), `the ${m} row`);
  }
  for (const key of ['msg_send:ok', 'import_job:start', 'workspace_link_claim_result:joined']) {
    assert.equal(a.filter((l) => l.includes(`'${key}'`)).length, 2, `${key} is keyed in ev and read by its row`);
  }
  assert.ok(a.includes('perform public._require_admin();'));
});

test("an import's clusters are the import's to record (0475)", () => {
  // The pair: its label, and one line that leaves an import's boards out.
  const [was, now] = [defIn('_instrumentation_pairs', FILE), defIn('_instrumentation_pairs', IMPORTS)];
  assert.ok(was && now, `${FILE} and ${IMPORTS} both define it`);
  const a = bodyLines(now.body), b = bodyLines(was.body);
  assert.deepEqual(b.filter((l) => !a.includes(l)),
    ["('cluster_create', false, 'Clusters made (boards with a parent)', 'cluster_create events', 4),"]);
  assert.deepEqual(a.filter((l) => !b.includes(l)), [
    "('cluster_create', false, 'Clusters made by hand (boards with a parent, none from an import)', 'cluster_create events', 4),",
    'and not exists (select 1 from public.import_folders f where f.board_id = b.id)',
  ]);
  const truth = now.body.match(/select 'cluster_create'::text as pair[\s\S]*?\n\s*union all/);
  assert.ok(truth, "cluster_create's truth rows");
  assert.match(truth[0], /and not exists \(select 1 from public\.import_folders f where f\.board_id = b\.id\)/,
    'the line sits in cluster_create\'s truth, not in another source');

  // import_folders must still name an import's clusters as far back as the
  // live check reads, or they would count as made by hand again: the ledger
  // purge (0440, rescheduled only by a later cron.schedule of the same job)
  // keeps a job's rows for longer than base_since looks back.
  const look = Number(latestDefinition('_instrumentation_pairs').body.match(/p_at - interval '(\d+) days'\s+as base_since/)?.[1]);
  const keeps = migrationFiles().flatMap((f) => [...readFileSync(join(MIGRATIONS_DIR, f), 'utf8')
    .matchAll(/cron\.schedule\('purge-import-ledger', '[^']*', \$\$\s*select public\.purge_old_import_ledger\((\d+)\)\s*\$\$\)/g)]
    .map((m) => Number(m[1])));
  assert.ok(look > 0 && keeps.length > 0, 'found the window and the purge');
  assert.ok(keeps.at(-1) > look, `import_folders is purged after ${keeps.at(-1)} days, inside the ${look} the check reads`);

  // The coverage: first_cluster's people count by either event, an import's
  // start or cluster_create, so its ledger's purge can't bite there.
  const [cwas, cnow] = [defIn('admin_event_coverage', FILE), defIn('admin_event_coverage', IMPORTS)];
  assert.ok(cwas && cnow, `${FILE} and ${IMPORTS} both define it`);
  const ca = bodyLines(cnow.body), cb = bodyLines(cwas.body);
  assert.deepEqual(cb.filter((l) => !ca.includes(l)), ["'cluster_create'"], "first_cluster's row stops reading cluster_create alone");
  assert.deepEqual(ca.filter((l) => !cb.includes(l)), [
    "select 'cluster_made', count(distinct user_id)",
    "and (event = 'cluster_create' or (event = 'import_job' and props->>'phase' = 'start'))",
    "'cluster_made'",
  ]);
  assert.equal(ca.filter((l) => l.includes("'cluster_made'")).length, 2, 'cluster_made is keyed in ev and read by its row');
});

test('the welcome pair counts who lifecycle_due_welcome_board would find (0497)', () => {
  const [was, now] = [defIn('_instrumentation_pairs', IMPORTS), defIn('_instrumentation_pairs', WELCOME)];
  assert.ok(was && now, `${IMPORTS} and ${WELCOME} both define it`);
  const a = bodyLines(now.body), b = bodyLines(was.body);
  // Nothing else moved: the last label row gains its comma, and the since
  // case gains the welcome's line.
  assert.deepEqual(b.filter((l) => !a.includes(l)), [
    "('link_claim', false, 'Workspace joins through an invite link', 'workspace_link_claim_result events with status joined', 7)",
    "case when l.pair in ('active', 'session_context') then w.t_since else w.since end,",
  ]);
  const branch = now.body.replace(/--.*$/gm, '').match(/select 'welcome',[\s\S]*?\) wl\n/)?.[0];
  assert.ok(branch, "the welcome's people");
  const branchLines = branch.split('\n').map((l) => l.trim().replace(/\s+/g, ' ')).filter(Boolean);
  assert.deepEqual(a.filter((l) => !b.includes(l)), [
    "p_at - interval '108 hours' as wl_since,",
    "p_at - interval '36 hours' as wl_until,",
    "p_at - interval '108 hours' - interval '14 days' as wl_base,",
    "('link_claim', false, 'Workspace joins through an invite link', 'workspace_link_claim_result events with status joined', 7),",
    "('welcome', true, 'Accounts due the welcome email, signed up 36 to 108 hours before', 'sent it (lifecycle_email_log)', 8)",
    ...branchLines.filter((l) => !b.includes(l)),
    "case when l.pair in ('active', 'session_context') then w.t_since",
    "when l.pair = 'welcome' then w.wl_since",
    "else w.since end,",
  ]);

  // Who is due: the live due function's own rule, predicate for predicate.
  const due = latestDefinition('lifecycle_due_welcome_board');
  assert.equal(due?.file, '0184_lifecycle_welcome_board.sql', 'the rule this pair mirrors is still 0184\'s; if it moved, move the pair with it');
  const flat = (t) => t.replace(/--.*$/gm, '').replace(/\s+/g, ' ');
  const [d, w] = [flat(due.body), flat(branch)];
  for (const both of [
    'u.email_confirmed_at is not null and u.email is not null',
    'p.banned_at is null',
    "public._email_pref_enabled(u.id, 'email_lifecycle')",
    'b.created_by = u.id and b.deleted_at is null and b.thumb_key is not null and coalesce(b.card_count, 0) > 0',
    "l.user_id = u.id and l.email_type = 'welcome_board'",
  ]) {
    assert.ok(d.includes(both), `the due rule says ${both}`);
    assert.ok(w.includes(both), `the pair says ${both}`);
  }
  assert.ok(d.includes('join public.email_unsub_tokens t on t.user_id = u.id'));
  assert.ok(w.includes('exists (select 1 from public.email_unsub_tokens t where t.user_id = u.id)'), 'an unsubscribe token, as the join asks');
  assert.match(d, /p_exclude_internal boolean default true/);
  assert.ok(w.includes('not exists (select 1 from internal i where i.user_id = u.id)'), 'not the team, as the cron sends');

  // When: due from p_min_hours, then up to a day for the send hour, so the
  // cohort ends that many hours plus 24 back, runs three days, and is
  // measured against the 14 days of signups before it.
  const minHours = Number(due.body.match(/p_min_hours int default (\d+)/)?.[1]);
  const hours = (re) => Number(now.body.match(re)?.[1]);
  const until = hours(/p_at - interval '(\d+) hours'\s+as wl_until/);
  const since = hours(/p_at - interval '(\d+) hours'\s+as wl_since/);
  assert.equal(until, minHours + 24, 'the send hour comes round within a day');
  assert.equal(since - until, 72, 'three days of signups');
  assert.match(now.body, new RegExp(`p_at - interval '${since} hours' - interval '14 days'\\s+as wl_base`));
  assert.match(branch, /where u\.created_at >= w\.wl_base and u\.created_at < w\.wl_until/);
  assert.match(branch, /u\.created_at >= w\.wl_since as recent/);
  assert.match(branch, /l\.status = 'sent' and l\.sent_at < p_at/);
});

test("the welcome's alerts name the email; every other pair's words are 0472's (0497)", () => {
  const was = defIn('check_instrumentation', FILE).body;
  const now = defIn('check_instrumentation', WELCOME).body;
  // Everything but the three alerts' arguments is 0472's: the facts, the rules
  // and their order, the dedupe keys' windows.
  const outside = (body) => body.replace(/ops_alert_raise\('instrumentation',[\s\S]*?\) is not null then/g, 'ops_alert_raise(…) is not null then');
  assert.equal(outside(now), outside(was), 'only the alerts\' words changed');
  // Each raise's words, with the welcome's branch taken out, are 0472's.
  const raises = (body) => [...body.matchAll(/ops_alert_raise\('instrumentation',([\s\S]*?)\) is not null then/g)].map((m) => m[1]);
  const words = (call) => [...call.replace(/case when r\.pair = 'welcome'\s+then\s[\s\S]*?\selse\s/g, '')
    .matchAll(/E?'((?:[^']|'')*)'/g)].map((m) => m[1]).join('');
  assert.deepEqual(raises(now).map(words), raises(was).map(words));
  // And the welcome's own: what stopped, and where to look.
  const dark = raises(now)[0], thin = raises(now)[2];
  assert.match(dark, /case when r\.pair = 'welcome' then 'Welcome emails stopped' else/);
  assert.match(thin, /case when r\.pair = 'welcome' then 'Welcome emails thinning' else/);
  for (const name of ['lifecycle-email-hourly', 'lifecycle-email-cron', 'lifecycle_due_welcome_board']) {
    assert.ok(dark.includes(name), `the dark alert points at ${name}`);
  }
  assert.ok(thin.includes('lifecycle-email-cron'));
  const sched = migrationFiles().flatMap((f) => [...readFileSync(join(MIGRATIONS_DIR, f), 'utf8')
    .matchAll(/cron\.schedule\('lifecycle-email-hourly',\s*'[^']*',\s*\$\$\s*select public\._cron_edge_post\('([a-z-]+)'\)\s*\$\$\)/g)].map((m) => m[1]));
  assert.equal(sched.at(-1), 'lifecycle-email-cron', 'the cron the alert names exists, and posts to the function it names');
  // never-measured stays for row pairs; the welcome is per person and can't reach it.
  assert.equal(raises(now)[1].includes('welcome'), false);
});
