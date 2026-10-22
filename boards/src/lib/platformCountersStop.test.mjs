// platformCountersStop.test.mjs — 0496 stops keeping platform_counters, which
// nothing has read since 0460 counted the Universe from live rows. It was
// applied to the shared database the day it was written, so this pins that
// the counters stay stopped.
//
//   node --test src/lib/platformCountersStop.test.mjs
//
// What this guards:
//   * everything that kept the counters is gone: every trigger any migration
//     put on a _counter_ function, every _counter_ function, _bump_counter,
//     and both recount crons with their functions;
//   * the heartbeat is 0470's body with the counter's lines taken out and
//     nothing else changed: it still credits only its caller, still writes
//     the day's seconds, and is still closed to anon;
//   * nothing after 0496 writes the table again, and no client, party or
//     edge function reads it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { MIGRATIONS_DIR, migrationFiles, latestDefinition, definitionsOf } from './migrationText.mjs';

const FILE = '0496_platform_counters_stop.sql';
const PATH = join(MIGRATIONS_DIR, FILE);
const src = existsSync(PATH) ? readFileSync(PATH, 'utf8') : '';
const uncomment = (text) => text.replace(/--.*$/gm, '');
const code = uncomment(src).replace(/\s+/g, ' ');
const readMigration = (f) => readFileSync(join(MIGRATIONS_DIR, f), 'utf8');
const before = migrationFiles().filter((f) => f < FILE);

test(`${FILE} exists`, () => assert.ok(src));

test('every counter trigger any migration made is dropped', () => {
  const made = new Set();
  for (const f of before) {
    const sql = uncomment(readMigration(f));
    for (const m of sql.matchAll(/create\s+trigger\s+([a-z_]+)[\s\S]*?\son\s+([a-z_.]+)[\s\S]*?execute\s+(?:function|procedure)\s+(?:public\.)?_counter_[a-z_]+\s*\(/gi)) {
      made.add(`${m[1]} on ${m[2].includes('.') ? m[2] : `public.${m[2]}`}`);
    }
  }
  assert.equal(made.size, 14, 'fourteen triggers fed the counters');
  for (const t of made) assert.ok(code.includes(`drop trigger if exists ${t};`), `0496 drops ${t}`);
  const drops = [...code.matchAll(/drop trigger if exists ([a-z_]+ on [a-z_.]+);/g)].map((m) => m[1]);
  assert.ok(drops.slice(-3).every((d) => d.endsWith(' on auth.users')), 'auth.users goes last, so its lock is held the shortest time');
});

test('every function that kept the counters is dropped', () => {
  const made = new Set();
  for (const f of before) {
    for (const m of uncomment(readMigration(f)).matchAll(/create\s+(?:or\s+replace\s+)?function\s+public\.(_counter_[a-z_]+|_bump_counter|_reconcile_universe_counters(?:_full)?)\s*\(/gi)) {
      made.add(m[1].toLowerCase());
    }
  }
  assert.ok(made.has('_bump_counter') && made.has('_reconcile_universe_counters') && made.has('_reconcile_universe_counters_full'));
  for (const fn of made) {
    const args = fn === '_bump_counter' ? 'text, bigint' : '';
    assert.ok(code.includes(`drop function if exists public.${fn}(${args});`), `0496 drops ${fn}`);
  }
});

test('both recount crons are unscheduled', () => {
  const scheduled = new Set();
  for (const f of before) {
    for (const m of readMigration(f).matchAll(/cron\.schedule\(\s*'(universe_counters[a-z_]*)'/gi)) scheduled.add(m[1]);
  }
  assert.deepEqual([...scheduled].sort(), ['universe_counters_minutely', 'universe_counters_nightly']);
  const m = code.match(/select cron\.unschedule\(jobid\) from cron\.job where jobname in \(([^)]*)\);/);
  assert.ok(m, '0496 unschedules by name');
  for (const job of scheduled) assert.ok(m[1].includes(`'${job}'`), `${job} is unscheduled`);
});

// Lines of a body, trimmed, blank lines dropped.
const bodyLines = (def) => def.match(/as\s*(\$[a-z_]*\$)([\s\S]*?)\1/i)[2]
  .split('\n').map((l) => l.trim().replace(/\s+/g, ' ')).filter(Boolean);

test('the heartbeat is 0470\'s body without the counter, and nothing else changed', () => {
  const defs = definitionsOf('bump_seconds_in_app');
  const mine = defs.find((d) => d.file === FILE);
  assert.ok(mine, `${FILE} restates bump_seconds_in_app`);
  const prev = defs[defs.indexOf(mine) - 1];
  assert.equal(prev.file, '0470_analytics_integrity.sql', 'restated from the live body, which 0470 wrote');
  const was = bodyLines(prev.body);
  const now = bodyLines(mine.body);
  assert.deepEqual(was.filter((l) => !now.includes(l)), [
    '-- 0254: both writes are now inside the same guard, so the counter and the',
    '-- summed profile column cannot diverge again.',
    "update public.platform_counters set value = value + v_credit, updated_at = v_now where key = 'total_seconds_in_app';",
  ]);
  assert.deepEqual(now.filter((l) => !was.includes(l)), [
    '-- 0496: the platform total this guard kept in step is gone; the profile',
    '-- column and the day rows are the record.',
  ]);
  assert.equal(mine.body.slice(0, mine.body.search(/\bAS \$function\$/)), prev.body.slice(0, prev.body.search(/\bAS \$function\$/)),
    'the same header, so the client in production calls it unchanged');
});

test('the live heartbeat credits its caller, keeps its writes, and stays closed to anon', () => {
  const bump = latestDefinition('bump_seconds_in_app').body;
  assert.doesNotMatch(uncomment(bump), /platform_counters/);
  assert.ok(bump.indexOf('p_user_id := auth.uid();') > 0
    && bump.indexOf('p_user_id := auth.uid();') < bump.indexOf('insert into public.heartbeat_session'));
  assert.match(bump, /update public\.profiles set seconds_in_app = seconds_in_app \+ v_credit where user_id = p_user_id;/);
  assert.match(bump, /seconds\s+= public\.user_active_day\.seconds \+ excluded\.seconds;/);
  assert.ok(code.includes('revoke execute on function public.bump_seconds_in_app(integer, uuid, uuid, boolean) from public, anon;'));
  assert.ok(code.includes('grant execute on function public.bump_seconds_in_app(integer, uuid, uuid, boolean) to authenticated, service_role;'));
  assert.doesNotMatch(code, /grant [^;]*bump_seconds_in_app[^;]* to [^;]*\banon\b/, 'never back to anon');
  const proof = code.match(/do \$proof\$([\s\S]*?)\$proof\$;/)?.[1];
  assert.ok(proof, 'the file proves what it did');
  for (const role of ['anon', 'authenticated', 'service_role']) {
    assert.ok(proof.includes(`has_function_privilege('${role}', v_sig, 'execute')`), `the proof checks ${role}`);
  }
  for (const what of ["p.proname like '\\_counter\\_%'", "j.jobname like 'universe\\_counters%'", "p.prosrc ilike '%platform_counters%'"]) {
    assert.ok(proof.includes(what), `the proof looks for ${what}`);
  }
});

test('nothing after 0496 keeps the counters again', () => {
  for (const f of migrationFiles().filter((x) => x > FILE)) {
    const sql = uncomment(readMigration(f));
    assert.doesNotMatch(sql, /(update|insert\s+into)\s+(public\.)?platform_counters/i, `${f} writes platform_counters`);
    assert.doesNotMatch(sql, /execute\s+(function|procedure)\s+(public\.)?_counter_/i, `${f} puts a counter trigger back`);
    assert.doesNotMatch(sql, /cron\.schedule\(\s*'universe_counters/i, `${f} schedules a recount`);
  }
});

test('no client, party, worker or edge function reads the table', () => {
  const roots = ['../', '../../party/', '../../../supabase/functions/'].map((r) => new URL(r, import.meta.url).pathname);
  const reads = /from\(\s*['"`]platform_counters['"`]\s*\)|\/rest\/v1\/platform_counters/;
  const walk = (dir) => readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (name === 'node_modules' || name.startsWith('.')) return [];
    return statSync(p).isDirectory() ? walk(p) : (/\.(m?js|jsx|ts)$/.test(name) ? [p] : []);
  });
  const files = roots.filter(existsSync).flatMap(walk);
  assert.ok(files.length > 100, 'the walk reached the source');
  for (const p of files) assert.doesNotMatch(readFileSync(p, 'utf8'), reads, `${p} reads platform_counters`);
});
