// engagedVisitsMigration.test.mjs — 0347's engaged-visit read must count the
// same work the client counts, and must stay internal.
//
//   node --test src/lib/engagedVisitsMigration.test.mjs
//
// The work list in _admin_engaged_visits is SQL, and WORK_EVENTS is JS. Two
// copies of one list drift silently: an event added to WORK_EVENTS and not to
// the SQL makes a visit holding only that event read as un-engaged, and nothing
// in the deck could ever show why. So the two are pinned together here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MIGRATIONS_DIR, latestDefinition } from './migrationText.mjs';
import { WORK_EVENTS } from './analyticsEvents.js';

const FILE = '0347_honest_work_and_engaged_visits.sql';
const src = readFileSync(join(MIGRATIONS_DIR, FILE), 'utf8');

test('the engaged-visit work list is exactly WORK_EVENTS', () => {
  const def = latestDefinition('_admin_engaged_visits');
  assert.ok(def, '_admin_engaged_visits is defined');
  const m = def.body.match(/e\.event\s+in\s*\(([\s\S]*?)\)/i);
  assert.ok(m, 'the work list is an `e.event in (...)` clause');
  const sql = new Set([...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]));
  assert.deepEqual([...sql].sort(), [...WORK_EVENTS].sort(),
    'a WORK_EVENTS event missing here would make visits holding only it read as un-engaged');
});

test('the did_work trigger ignores a no-op re-sync and credits the actor', () => {
  const def = latestDefinition('_stamp_active_day_work');
  assert.ok(def && def.file === FILE, '0347 owns the latest trigger body');
  assert.match(def.body, /tg_op\s*=\s*'UPDATE'[\s\S]*is not distinct from/i,
    'an UPDATE that changed nothing must return before stamping');
  assert.match(def.body, /v_actor\s*:=\s*auth\.uid\(\)/i, 'the person who did it is stamped first');
});

test('the helper is internal and every admin read is authenticated-only and proven', () => {
  assert.match(src, /revoke execute on function public\._admin_engaged_visits\(date, boolean, boolean, int\)\s+from public, anon, authenticated/);
  for (const fn of ['admin_engaged_return', 'admin_engaged_survival', 'admin_engaged_weeks']) {
    assert.match(src, new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\)\\s+to authenticated`), `${fn} grant`);
    assert.match(src, new RegExp(`has_function_privilege\\('anon',\\s*'public\\.${fn}\\(`), `${fn} anon proof`);
    assert.match(latestDefinition(fn).body, /_require_admin\(\)/, `${fn} is admin-only`);
  }
  assert.match(src, /has_function_privilege\('authenticated',\s*'public\._admin_engaged_visits\(/, 'helper proof');
});

test('nothing 0322 defined is dropped or re-created here', () => {
  for (const fn of ['_admin_visits', 'admin_survival_curve', 'admin_return_gap', 'admin_return_fixed_horizon']) {
    assert.doesNotMatch(src, new RegExp(`(drop|create)\\s+(or\\s+replace\\s+)?function\\s+(if exists\\s+)?public\\.${fn}\\b`, 'i'),
      `${fn} belongs to 0322; the deck calls it`);
  }
});
