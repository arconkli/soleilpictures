// discoveryAlertsMigration.test.mjs — 0360's outcome alerts must stay honest.
//
//   node --test src/lib/discoveryAlertsMigration.test.mjs
//
// check_discovery_pipelines() is one function that every alert lives in, so the
// next migration to touch it re-states the whole body. These pin what a rewrite
// could silently lose: the freshness alerts 0335 shipped, the three outcome
// alerts 0360 added, and the two scoping rules without which the new alerts
// would lie — email_sends also holds another product's mail, and seo_page_daily
// mixes page-level rows with GSC's partial per-query breakdown.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MIGRATIONS_DIR, latestDefinition } from './migrationText.mjs';

const FILE = '0360_discovery_alerts_outcomes.sql';
const src = readFileSync(join(MIGRATIONS_DIR, FILE), 'utf8');
const def = latestDefinition('check_discovery_pipelines');

test('the live body is the one that carries the outcome alerts', () => {
  assert.ok(def, 'check_discovery_pipelines is defined');
  assert.match(def.body, /'Google dropped '/, 'the page-vanished alert is in the latest body');
});

test('no alert 0335 shipped was lost, and the three 0360 alerts are there', () => {
  for (const name of ['gsc-sync stale', 'AEO probe stale', 'AEO probe failing', 'AI crawler silence',
                      'seo-health prober stale', 'Sign-in email opens collapsed',
                      'Sign-in email bounces spiked', 'App email volume spike', 'Sign-in email rows missing']) {
    assert.ok(def.body.includes(`'${name}'`), `alert "${name}" is raised`);
  }
});

test('the page read uses page-level web rows only', () => {
  // query <> '' rows are a partial breakdown of the same impressions: summing
  // them in would double-count every page, and image search ranks separately.
  const page = def.body.slice(def.body.indexOf("'Google dropped '") - 1600, def.body.indexOf("'Google dropped '"));
  assert.match(page, /query\s*=\s*''/, "page-level rows (query = '')");
  assert.match(page, /search_type\s*=\s*'web'/, 'web search only');
});

test('every email read is scoped to our sending domain', () => {
  // email_sends also stores another product's mail under a different sending
  // domain; without this the code-email open rate would be mostly theirs.
  const reads = def.body.match(/from public\.email_sends es[\s\S]*?(?=\)\s*s;|group by|limit 1)/g) || [];
  assert.ok(reads.length >= 3, 'three email_sends reads');
  for (const r of reads) {
    // _email_domain_is_ours: ours, or NULL (a failed send never gets a domain).
    assert.match(r, /public\._email_domain_is_ours\(es\.sending_domain\)/, 'scoped to our domain, NULL included');
  }
  assert.match(def.body, /es\.category = 'external'/, 'the code email is the external category');
  assert.match(def.body, /_internal_user_ids\(\)/, 'internal recipients are excluded from the open rate');
});

test('the function keeps its signature and its grants are proven, not trusted', () => {
  assert.doesNotMatch(src, /drop\s+function/i, 'a DROP would discard the ACL');
  assert.match(src, /has_function_privilege\('anon',\s*'public\.check_discovery_pipelines\(\)'/);
  assert.match(src, /has_function_privilege\('authenticated',\s*'public\.check_discovery_pipelines\(\)'/);
});

test('the page-drop baseline is lagged, so a long outage cannot erode it', () => {
  // A baseline that ends days before the anchor absorbs a continuing drop
  // within a week and the alert goes quiet while the page is still gone.
  assert.match(def.body, /where day between v_gsc - 31 and v_gsc - 18/, 'baseline fortnight a month back');
  assert.match(def.body, /p\.day between v_gsc - 3 and v_gsc - 1/, 'recent window: the three days before the newest');
});
