// 0852: _cron_edge_post waits up to 30 s for the edge function's answer
// (pg_net's own default is 5 s, and every slow answer logged a timeout while
// the job finished fine). The live body is 0386's plus the timeout argument
// and nothing else, and the helper stays out of clients' reach.
//
//   node --test src/lib/cronEdgeTimeoutMigration.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { definitionsOf, bodyText, MIGRATIONS_DIR } from './migrationText.mjs';

const FILE = '0852_cron_edge_post_timeout.sql';
const TIMEOUT = 'timeout_milliseconds := 30000';

test('_cron_edge_post waits 30 s, and changes nothing else', () => {
  const [before, live] = definitionsOf('_cron_edge_post').slice(-2);
  assert.equal(live.file, FILE, `the live _cron_edge_post is ${FILE}`);
  assert.equal(before.file, '0386_audit_cron_secret_in_vault.sql');
  const body = bodyText(live.body);
  assert.equal(body.split(TIMEOUT).length, 2, 'the timeout is passed once');
  assert.equal(body.replace(`, ${TIMEOUT}`, ''), bodyText(before.body), `${FILE} is 0386's body plus the timeout`);
});

test('the helper stays out of clients\' reach, and the migration proves it', () => {
  const sql = readFileSync(MIGRATIONS_DIR + FILE, 'utf8');
  assert.match(sql, /revoke execute on function public\._cron_edge_post\(text, jsonb\) from public, anon, authenticated;/);
  for (const role of ['anon', 'authenticated']) {
    assert.ok(sql.includes(`has_function_privilege('${role}', 'public._cron_edge_post(text, jsonb)', 'execute')`), `proves ${role} cannot call it`);
  }
});
