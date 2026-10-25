// 0700 admin_mcp_funnel — the parts of the connect funnel that must agree with
// code elsewhere, checked without a database.
//
//   node --test src/lib/mcpFunnelMigration.test.mjs
//
// The function counts a call as a write by its tool's name, so its read
// pattern has to say "read" for exactly the tools lib/mcpTools.js marks
// readOnlyHint; a new tool it misread would be counted on the wrong side for
// as long as nobody looked. And it buckets redirect hosts the way the consent
// page's events do (lib/oauthConnect.js), or the funnel's steps would land in
// different rows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { TOOLS } from './mcpTools.js';
import { redirectHostOf } from './oauthConnect.js';
import { EV } from './analyticsEvents.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(path.join(here, '../../../supabase/migrations/0700_admin_mcp_funnel.sql'), 'utf8');

test('the read pattern says read for exactly the read-only tools', () => {
  const m = sql.match(/else l\.tool !~ '([^']+)'/);
  assert.ok(m, 'the write test still reads `else l.tool !~ \'<pattern>\'`');
  const reads = new RegExp(m[1]);
  assert.ok(TOOLS.length > 20, `found ${TOOLS.length} tools; the registry import is wrong`);
  for (const t of TOOLS) {
    assert.equal(reads.test(t.name), t.annotations?.readOnlyHint === true,
      `${t.name}: readOnlyHint is ${t.annotations?.readOnlyHint}, but 0700 counts it as a ${reads.test(t.name) ? 'read' : 'write'}`);
  }
});

test('redirect hosts land in the same buckets as the consent page\'s events', () => {
  const pairs = [...sql.matchAll(/_oauth_redirect_host\('([^']*)'\) <> '([^']*)'/g)];
  assert.ok(pairs.length >= 8, `found ${pairs.length} proof cases`);
  for (const [, uri, bucket] of pairs) {
    assert.equal(redirectHostOf(uri), bucket, `${JSON.stringify(uri)}: SQL says ${bucket}`);
  }
});

test('the events it reads are the ones the page emits', () => {
  for (const key of ['OAUTH_AUTHORIZE_VIEW', 'OAUTH_CONSENT_ALLOWED', 'OAUTH_CONSENT_DENIED', 'OAUTH_AUTHORIZE_ERROR']) {
    assert.ok(EV[key], `EV.${key} exists`);
    assert.ok(sql.includes(`'${EV[key]}'`), `0700 reads ${EV[key]}`);
  }
  assert.ok(sql.includes("a.path = '/oauth/authorize'"), 'signed-out arrivals are the sign-in screen on that path');
});

test('admin only, with its helper closed to callers', () => {
  assert.match(sql, /perform public\._require_admin\(\);/);
  assert.match(sql, /revoke execute on function public\._oauth_redirect_host\(text\) from public, anon, authenticated;/);
  assert.match(sql, /revoke execute on function public\.admin_mcp_funnel\(integer, boolean\) from public, anon;/);
  assert.match(sql, /do \$proof\$/);
});
