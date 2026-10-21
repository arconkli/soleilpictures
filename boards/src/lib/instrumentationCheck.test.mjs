// instrumentationCheck.test.mjs — 0472's daily check that each feature's events
// still arrive, admin_event_coverage's four new rows, and 0475's rule that an
// import's clusters are the import's to record.
//
//   node --test src/lib/instrumentationCheck.test.mjs
//
// 0472 and 0475 were applied the day they were written; their own proof blocks
// check the grants, the schedule and the samples in the database. This pins the
// shape against a later edit:
//   * only an event that STOPPED pages; never-measured and thinning don't;
//   * the team's accounts are left out of every source, truth and events alike,
//     so preview traffic (whose events divert) can never read as loss;
//   * admin_event_coverage is 0461's body with the ev CTE keyed and four rows
//     added, and nothing else moved;
//   * the cluster_create pair leaves out the clusters an import made, by a
//     ledger that outlives the window the check reads, and first_cluster's
//     people count by either event (0475).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MIGRATIONS_DIR, latestDefinition, definitionsOf, migrationFiles } from './migrationText.mjs';

const FILE = '0472_instrumentation_check.sql';
const IMPORTS = '0475_import_clusters_count_as_imports.sql';
const src = readFileSync(join(MIGRATIONS_DIR, FILE), 'utf8');
const fix = readFileSync(join(MIGRATIONS_DIR, IMPORTS), 'utf8');

// A body's code lines: whole-line and trailing comments dropped, whitespace
// collapsed, blank lines gone.
function bodyLines(def) {
  const m = def.match(/as\s*(\$[a-z_]*\$)([\s\S]*?)\1/i);
  assert.ok(m, 'a dollar-quoted body');
  return m[2].replace(/--.*$/gm, '').split('\n').map((l) => l.trim().replace(/\s+/g, ' ')).filter(Boolean);
}

test('these files are where the check, its numbers and the email kinds live', () => {
  for (const fn of ['check_instrumentation', '_email_kind', '_email_school_domain']) {
    assert.equal(latestDefinition(fn)?.file, FILE, `the live ${fn} is ${FILE}'s`);
  }
  for (const fn of ['_instrumentation_pairs', 'admin_event_coverage']) {
    assert.equal(latestDefinition(fn)?.file, IMPORTS, `the live ${fn} is ${IMPORTS}'s`);
  }
  for (const [name, text] of [[FILE, src], [IMPORTS, fix]]) {
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

test('seven pairs, and the team is left out of every source', () => {
  const body = latestDefinition('_instrumentation_pairs').body;
  const pairs = [...body.matchAll(/^\s*\('(\w+)',\s+(true|false),/gm)].map((m) => m[1]);
  assert.deepEqual(pairs, ['active', 'session_context', 'first_card', 'cluster_create', 'msg_send', 'import_job', 'link_claim']);
  assert.match(body, /internal as \(select i\.user_id from public\._internal_user_ids\(\) i\)/);
  // user_active_day, profiles, boards, messages, import_jobs, link joins, analytics_events.
  for (const col of ['d.user_id', 'p.user_id', 'b.created_by', 'm.sender_id', 'j.owner_id', 'l.user_id', 'e.user_id']) {
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
  const pairs = definitionsOf('_instrumentation_pairs');
  const [was, now] = [pairs.at(-2), pairs.at(-1)];
  assert.deepEqual([was.file, now.file], [FILE, IMPORTS]);
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
  // check reads, or they would count as made by hand again: the ledger purge
  // (0440, rescheduled only by a later cron.schedule of the same job) keeps a
  // job's rows for longer than base_since looks back.
  const look = Number(now.body.match(/p_at - interval '(\d+) days'\s+as base_since/)?.[1]);
  const keeps = migrationFiles().flatMap((f) => [...readFileSync(join(MIGRATIONS_DIR, f), 'utf8')
    .matchAll(/cron\.schedule\('purge-import-ledger', '[^']*', \$\$\s*select public\.purge_old_import_ledger\((\d+)\)\s*\$\$\)/g)]
    .map((m) => Number(m[1])));
  assert.ok(look > 0 && keeps.length > 0, 'found the window and the purge');
  assert.ok(keeps.at(-1) > look, `import_folders is purged after ${keeps.at(-1)} days, inside the ${look} the check reads`);

  // The coverage: first_cluster's people count by either event, an import's
  // start or cluster_create, so its ledger's purge can't bite there.
  const cov = definitionsOf('admin_event_coverage');
  const [cwas, cnow] = [cov.at(-2), cov.at(-1)];
  assert.deepEqual([cwas.file, cnow.file], [FILE, IMPORTS]);
  const ca = bodyLines(cnow.body), cb = bodyLines(cwas.body);
  assert.deepEqual(cb.filter((l) => !ca.includes(l)), ["'cluster_create'"], "first_cluster's row stops reading cluster_create alone");
  assert.deepEqual(ca.filter((l) => !cb.includes(l)), [
    "select 'cluster_made', count(distinct user_id)",
    "and (event = 'cluster_create' or (event = 'import_job' and props->>'phase' = 'start'))",
    "'cluster_made'",
  ]);
  assert.equal(ca.filter((l) => l.includes("'cluster_made'")).length, 2, 'cluster_made is keyed in ev and read by its row');
});
