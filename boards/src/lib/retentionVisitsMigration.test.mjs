// retentionVisitsMigration.test.mjs — 0322 must define the visit helper as
// INTERNAL and re-create (not overload) the two 0279 retention RPCs.
//
//   node --test src/lib/retentionVisitsMigration.test.mjs
//
// The trap this guards: adding a parameter to an existing RPC with `create or
// replace` leaves the OLD signature in place. PostgREST resolves overloads by
// argument name, and a client passing only the shared names gets "function is
// not unique" — the dashboard panel goes blank with no error a reader can
// place. The only safe shape is drop + create + restated grants, and the
// migration must prove its own grants (the 0311 habit: a REVOKE that reports
// success proves nothing).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MIGRATIONS_DIR, latestDefinition } from './migrationText.mjs';

const FILE = '0322_honest_visits_fixed_horizon.sql';
const src = readFileSync(join(MIGRATIONS_DIR, FILE), 'utf8');

test('0322 drops the 0279 signatures before re-creating them', () => {
  assert.match(src, /drop function if exists public\.admin_survival_curve\(date, int, int, boolean, boolean, boolean\)/);
  assert.match(src, /drop function if exists public\.admin_return_gap\(date, boolean, boolean\)/);
});

test('the visit helper is internal: revoked from public, anon AND authenticated', () => {
  assert.match(src, /revoke execute on function public\._admin_visits\(date, boolean, boolean, int\)\s+from public, anon, authenticated/);
});

test('every admin RPC in 0322 is granted to authenticated only and proven', () => {
  for (const fn of ['admin_survival_curve', 'admin_return_gap', 'admin_return_fixed_horizon']) {
    assert.match(src, new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\)\\s+to authenticated`), `${fn} grant`);
    assert.match(src, new RegExp(`has_function_privilege\\('anon',\\s*'public\\.${fn}\\(`), `${fn} anon proof`);
  }
  assert.match(src, /has_function_privilege\('authenticated',\s*'public\._admin_visits\(/, 'helper proof');
});

test('0322 owns the latest definition of every function it touches', () => {
  for (const fn of ['admin_survival_curve', 'admin_return_gap', '_admin_visits', 'admin_return_fixed_horizon']) {
    const def = latestDefinition(fn);
    assert.ok(def, `${fn}: no definition found in any migration`);
    assert.equal(def.file, FILE, `${fn} is last defined in ${def.file}`);
  }
});

test('the survival curve keeps the 0279 return columns the widget reads', () => {
  const def = latestDefinition('admin_survival_curve');
  assert.match(def.body, /returns table \(\s*visit int,\s*reached int,\s*continued int,\s*pct numeric,\s*since date,\s*work_floor date\s*\)/);
});
