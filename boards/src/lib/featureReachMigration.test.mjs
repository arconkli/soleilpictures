// featureReachMigration.test.mjs — 0365's two reads are NEW functions beside
// 0322/0347/0361, admin-only, granted to authenticated only, and proven.
//
//   node --test src/lib/featureReachMigration.test.mjs
//
// The trap this guards: the easy way to add an import-mode split was to
// re-create admin_return_fixed_horizon with one more dim, and the easy way to
// stop tab restores counting as visits was to edit _admin_visits. Both bodies
// belong to 0322 (retentionVisitsMigration.test.mjs pins them), so 0365 adds
// functions and touches nothing it did not create. The feature list is also
// pinned here: a feature silently dropped from the read would make a signup
// week look like it stopped reaching something.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MIGRATIONS_DIR, latestDefinition } from './migrationText.mjs';

const FILE = '0365_feature_reach_and_import_mode.sql';
const src = readFileSync(join(MIGRATIONS_DIR, FILE), 'utf8');

test('both RPCs are granted to authenticated only, admin-gated, and proven', () => {
  for (const fn of ['admin_feature_reach', 'admin_return_by_mode']) {
    assert.match(src, new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\)\\s+from public, anon`), `${fn} revoke`);
    assert.match(src, new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\)\\s+to authenticated`), `${fn} grant`);
    const def = latestDefinition(fn);
    assert.ok(def && def.file === FILE, `${fn} is defined in ${FILE}`);
    assert.match(def.body, /_require_admin\(\)/, `${fn} is admin-only`);
  }
  assert.match(src, /public\.admin_feature_reach\(date, integer, boolean, boolean\)/, 'reach proof names it');
  assert.match(src, /public\.admin_return_by_mode\(date, integer, text, boolean, boolean, integer\)/, 'mode proof names it');
  assert.match(src, /has_function_privilege\('anon', f, 'execute'\)/, 'anon proof');
  assert.match(src, /not has_function_privilege\('authenticated', f, 'execute'\)/, 'authenticated proof');
});

test('nothing 0322, 0347 or 0361 defined is dropped or re-created here', () => {
  for (const fn of ['_admin_visits', '_admin_engaged_visits', 'admin_return_fixed_horizon', 'admin_built_return',
                    'admin_second_sitting', 'admin_survival_curve', 'admin_return_gap']) {
    assert.doesNotMatch(src, new RegExp(`(create|drop)\\s+(or\\s+replace\\s+)?function\\s+(if\\s+exists\\s+)?public\\.${fn}\\s*\\(`, 'i'),
      `${fn} belongs to an earlier migration`);
  }
});

test('the mode read builds on the engaged visits and reads all three measures', () => {
  const body = latestDefinition('admin_return_by_mode').body;
  assert.match(body, /_admin_engaged_visits\(/, 'reads 0347 engaged visits so any/engaged/built share one visit set');
  assert.match(body, /when 'built'\s+then v2\.worked/, 'built = a later worked visit (0361)');
  assert.match(body, /when 'engaged' then v2\.engaged/, 'engaged = a later engaged visit (0347)');
  assert.match(body, /interval '2 seconds'/, 'burst = placements two seconds apart');
  assert.match(body, />= 0\.5 then 'burst'/, 'at least half of the placements');
  assert.match(body, /when p\.n > 1 then p\.n/, 'a batch event counts as n placements');
  for (const dim of ['mode:', 'band:', 'mode_band:']) assert.ok(body.includes(`'${dim}'`), `${dim} rows`);
});

test('the reach read keeps every feature the panel and the plan grade on', () => {
  const body = latestDefinition('admin_feature_reach').body;
  for (const f of ['list_view', 'writing', 'doc', 'grid', 'cluster', 'files_links', 'import', 'share', 'search',
                   'download', 'arrows', 'comments', 'tags', 'help', 'docs_site', 'second_cluster']) {
    assert.ok(body.includes(`'${f}'`), `${f} is read`);
  }
  assert.match(body, /interval '24 hours'/, 'day one is the first 24 hours, as in 0322/0361');
  assert.match(body, /interval '14 days'/, 'day fourteen window');
  assert.match(body, /\(c\.created_at <= now\(\) - interval '14 days'\) as matured/, 'd14 counts only matured people');
  assert.match(body, /not in \('seed', 'template', 'system'\)/, 'seed cards do not count as placing');
});
