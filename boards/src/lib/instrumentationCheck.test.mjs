// instrumentationCheck.test.mjs — 0472's daily check that each feature's events
// still arrive, and admin_event_coverage's four new rows.
//
//   node --test src/lib/instrumentationCheck.test.mjs
//
// 0472 was applied the day it was written; its own proof block checks the
// grants, the schedule and the samples in the database. This pins the shape
// against a later edit:
//   * only an event that STOPPED pages; never-measured and thinning don't;
//   * the team's accounts are left out of every source, truth and events alike,
//     so preview traffic (whose events divert) can never read as loss;
//   * admin_event_coverage is 0461's body with the ev CTE keyed and four rows
//     added, and nothing else moved.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MIGRATIONS_DIR, latestDefinition, definitionsOf } from './migrationText.mjs';

const FILE = '0472_instrumentation_check.sql';
const src = readFileSync(join(MIGRATIONS_DIR, FILE), 'utf8');

// A body's code lines: whole-line and trailing comments dropped, whitespace
// collapsed, blank lines gone.
function bodyLines(def) {
  const m = def.match(/as\s*(\$[a-z_]*\$)([\s\S]*?)\1/i);
  assert.ok(m, 'a dollar-quoted body');
  return m[2].replace(/--.*$/gm, '').split('\n').map((l) => l.trim().replace(/\s+/g, ' ')).filter(Boolean);
}

test('this file is where the check, its numbers and the email kinds live', () => {
  for (const fn of ['_instrumentation_pairs', 'check_instrumentation', 'admin_event_coverage', '_email_kind', '_email_school_domain']) {
    assert.equal(latestDefinition(fn)?.file, FILE, `the live ${fn} is ${FILE}'s`);
  }
  assert.doesNotMatch(src.replace(/--.*$/gm, ''), /\bdrop\s+function\b/i, 'create or replace keeps every grant');
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
});

test("admin_event_coverage is 0461's with the ev CTE keyed and four rows added", () => {
  const defs = definitionsOf('admin_event_coverage');
  const now = defs.at(-1), before = defs.at(-2);
  assert.equal(now.file, FILE);
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
