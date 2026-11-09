import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MIGRATIONS_DIR, migrationFiles, latestDefinition } from './migrationText.mjs';

// The privacy policy's retention periods are plain text in the client bundle
// (auth/legalContent.js), where {{fact:…}} can't reach and this module can't be
// imported. Every period it states must equal what the database purge actually
// runs, read here from the migrations: change a purge, change the sentence.
const policy = readFileSync(new URL('../auth/legalContent.js', import.meta.url), 'utf8');

// The number in the LAST cron.schedule(...) call (apply order, then position in
// the file) that runs `fn(N)`. Tolerant of quoting, whitespace and `public.`.
function scheduledDays(fn) {
  const re = new RegExp(
    `cron\\.schedule\\s*\\([^;]*?\\$[a-z_]*\\$\\s*select\\s+(?:public\\.)?${fn}\\s*\\(\\s*(\\d+)\\s*\\)`,
    'gi',
  );
  let last = null;
  for (const f of migrationFiles()) {
    const sql = readFileSync(join(MIGRATIONS_DIR, f), 'utf8');
    for (const m of sql.matchAll(re)) last = { file: f, days: Number(m[1]) };
  }
  assert.ok(last, `no cron.schedule(...) calling ${fn}(N) found in the migrations`);
  return last.days;
}

// Every `interval 'N days'` in the LATEST definition of the trash purge `fn`.
function trashDays(fn) {
  const def = latestDefinition(fn);
  assert.ok(def, `no definition of ${fn}() found in the migrations`);
  const days = [...def.body.matchAll(/interval\s+'(\d+)\s+days'/gi)].map(m => Number(m[1]));
  assert.ok(days.length, `${fn}() (${def.file}) has no interval 'N days' in its body`);
  assert.equal(new Set(days).size, 1, `${fn}() (${def.file}) mixes intervals: ${days.join(', ')}`);
  return days[0];
}

function assertPolicyHas(text) {
  assert.ok(policy.includes(text), `the privacy policy must contain: ${text}`);
}

test('the privacy policy states the retention the purge crons run', () => {
  const api = scheduledDays('purge_api_request_log');
  const webhook = scheduledDays('purge_webhook_log');
  const errors = scheduledDays('purge_old_client_errors');
  const events = scheduledDays('purge_old_analytics_events');
  const sessions = scheduledDays('purge_old_usage_sessions');
  const origins = scheduledDays('purge_old_request_origins');
  assert.equal(events, sessions, 'purge_old_analytics_events and purge_old_usage_sessions must keep the same number of days');

  assertPolicyHas(`Records of calls made through the API or by a connected app: ${api} days.`);
  assertPolicyHas(`Records of calls are deleted after ${api} days.`);
  assertPolicyHas(`Webhook delivery records: ${webhook} days.`);
  assertPolicyHas(`Webhook delivery records are deleted after ${webhook} days.`);
  assertPolicyHas(`Records of errors in the Service: ${errors} days.`);
  assertPolicyHas(`Usage events and visit records: ${events} days.`);
  assertPolicyHas(`Hashed network and browser records kept to prevent abuse: ${origins} days.`);
});

test('the privacy policy states how long layout outlines are kept', () => {
  const days = scheduledDays('purge_old_cluster_outlines');
  assert.equal(days, 400, 'layout outlines are kept 400 days');
  assertPolicyHas(`Layout outlines: ${days} days.`);
});

test('the privacy policy states the Trash window the purge functions run', () => {
  const fns = ['purge_old_deleted_boards', 'purge_old_deleted_comments', 'purge_old_deleted_tags', 'purge_old_deleted_vote_cards'];
  const days = fns.map(trashDays);
  assert.equal(new Set(days).size, 1, `the Trash purges disagree: ${fns.map((f, i) => `${f}=${days[i]}`).join(', ')}`);

  assertPolicyHas(`stay in Trash for ${days[0]} days, then are permanently deleted`);
  assertPolicyHas(`it stays in Trash for ${days[0]} days`);
});

test('the privacy policy states when the reaper removes a draft key\'s hashed record', () => {
  const def = latestDefinition('mcp_draft_reap');
  assert.ok(def, 'no definition of mcp_draft_reap() found in the migrations');
  const days = [...def.body.matchAll(/reaped_at\s*<\s*now\(\)\s*-\s*interval\s+'(\d+)\s+days'/gi)].map(m => Number(m[1]));
  assert.ok(days.length, `mcp_draft_reap() (${def.file}) has no "reaped_at < now() - interval 'N days'" in its body`);
  assert.equal(new Set(days).size, 1, `mcp_draft_reap() (${def.file}) mixes reaped_at intervals: ${days.join(', ')}`);

  assertPolicyHas(`the hashed record of its key is removed ${days[0]} days after that`);
});
