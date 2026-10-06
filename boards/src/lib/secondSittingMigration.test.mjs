// secondSittingMigration.test.mjs — 0361's two reads must stay comparable with
// the visit definition they sit beside, and must stay internal / admin-only.
//
//   node --test src/lib/secondSittingMigration.test.mjs
//
// The sittings helper keeps its own copy of 0322's passive-event list (it has to
// look at events INSIDE a visit, which _admin_visits does not expose). Two copies
// of one list drift silently: a passive event added to 0322 and not here would
// let a background tab's own telemetry count as a person coming back, and the
// second-sitting rate would rise with no change in anyone's behaviour.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MIGRATIONS_DIR, latestDefinition } from './migrationText.mjs';

const FILE = '0361_built_return_and_second_sitting.sql';
const src = readFileSync(join(MIGRATIONS_DIR, FILE), 'utf8');

function eventList(body, marker) {
  const at = body.indexOf(marker);
  assert.ok(at >= 0, `${marker} clause found`);
  const open = body.indexOf('(', at);
  const close = body.indexOf(')', open);
  return new Set([...body.slice(open, close).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]));
}

test('every event 0322 treats as passive is passive for sittings too', () => {
  const visits = latestDefinition('_admin_visits');
  const sittings = latestDefinition('_admin_day_one_sittings');
  assert.ok(visits && sittings, 'both helpers are defined');
  const passive = eventList(visits.body, 'bool_or(e.event not in');
  const ignored = eventList(sittings.body, 'e.event not in');
  assert.ok(passive.size >= 10, `parsed 0322's passive list (${passive.size}) — an empty parse would pass vacuously`);
  for (const ev of passive) assert.ok(ignored.has(ev), `${ev} must not count as a sitting`);
});

test('a sitting gap is a real break, and only finished first visits are read', () => {
  const helper = latestDefinition('_admin_day_one_sittings').body;
  assert.match(helper, /make_interval\(mins => greatest\(coalesce\(p_gap_minutes, 30\), 5\)\)/);
  const rpc = latestDefinition('admin_second_sitting').body;
  assert.match(rpc, /first_day <= current_date - 2/, 'a visit still in progress could gain a sitting (0322 merges the next UTC day in)');
  assert.match(rpc, /first_day <= current_date - 8/, 'the 7-day link rows only use cohorts that have answered');
});

test('built return counts only a later visit that held work', () => {
  const body = latestDefinition('admin_built_return').body;
  assert.match(body, /_admin_engaged_visits\(/, 'reads 0347 engaged visits');
  assert.match(body, /v2\.k >= 2 and v2\.worked/, 'a later WORKED visit');
});

test('the helper is internal and both reads are admin-only, authenticated-only and proven', () => {
  assert.match(src, /revoke execute on function public\._admin_day_one_sittings\(date, boolean, boolean, int, int\)\s+from public, anon, authenticated/);
  for (const fn of ['admin_second_sitting', 'admin_built_return']) {
    assert.match(src, new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\)\\s+to authenticated`), `${fn} grant`);
    assert.match(latestDefinition(fn).body, /_require_admin\(\)/, `${fn} is admin-only`);
  }
  assert.match(src, /has_function_privilege\('anon', f, 'execute'\)/, 'anon proof');
  assert.match(src, /public\._admin_day_one_sittings\(date, boolean, boolean, integer, integer\)/, 'helper proof names it');
});

test('nothing 0322 or 0347 defined is dropped or re-created here', () => {
  for (const fn of ['_admin_visits', '_admin_engaged_visits', 'admin_return_fixed_horizon', 'admin_engaged_return']) {
    assert.doesNotMatch(src, new RegExp(`(drop|create)\\s+(or\\s+replace\\s+)?function\\s+(if exists\\s+)?public\\.${fn}\\b`, 'i'),
      `${fn} is read here, never redefined`);
  }
});

test('the day-one greeting\'s own impression is passive everywhere sittings and visits are counted', () => {
  // Logged when a person comes back to a tab, not when they do anything: if it
  // counted, the greeting would inflate the very rate that grades it.
  for (const [fn, marker] of [['_admin_visits', 'bool_or(e.event not in'], ['_admin_day_one_sittings', 'e.event not in']]) {
    const body = latestDefinition(fn).body;
    assert.ok(eventList(body, marker).has('resume_greet_shown'), `${fn} treats resume_greet_shown as passive`);
    assert.ok(!eventList(body, marker).has('resume_greet_action'), `${fn} still counts the click on it`);
  }
});

test('day-one cards are null-safe and counted the same way in both new reads', () => {
  for (const fn of ['admin_second_sitting', 'admin_built_return']) {
    const body = latestDefinition(fn).body;
    assert.match(body, /case when e\.id is null then 0\s+when e\.props->>'n' ~ '\^\[0-9\]\{1,6\}\$' then \(e\.props->>'n'\)::int\s+else 1 end/,
      `${fn}: a user with no placement scores 0 cards, not 1`);
  }
});
