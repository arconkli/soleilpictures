// A preview deploy or a dev build labels its rows so the divert trigger keeps
// them out of the live table, and tells set_first_source so a new account made
// there is internal (0470). See eventEnv.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eventEnv, envMarks, firstSourcePayload, DIVERTED_ENVS } from './eventEnv.js';
import { MIGRATIONS_DIR, latestDefinition } from './migrationText.mjs';

function onHost(hostname, fn) {
  const had = 'window' in globalThis;
  const prev = globalThis.window;
  globalThis.window = { location: { hostname } };
  try { return fn(); } finally { if (had) globalThis.window = prev; else delete globalThis.window; }
}

test('a dev build is dev wherever it runs, a workers.dev host is preview, anything else is prod', () => {
  assert.equal(onHost('clusters.soleilpictures.com', () => eventEnv(true)), 'dev');
  assert.equal(onHost('main-soleil-boards.arconkli.workers.dev', () => eventEnv(false)), 'preview');
  assert.equal(onHost('clusters.soleilpictures.com', () => eventEnv(false)), 'prod');
  assert.equal(onHost('localhost', () => eventEnv(false)), 'prod', 'the native shell (capacitor://localhost) is production');
  assert.equal(eventEnv(false), 'prod', 'no window at all is production');
});

test("a production build served locally is marked by the server, from the request's Origin (0476)", () => {
  const FILE = '0476_local_pages_are_dev.sql';
  const guard = latestDefinition('_tg_event_caller_guard');
  assert.equal(guard.file, FILE);
  const at = guard.body.indexOf("elsif new.props->>'synthetic_reason' is null and public.request_is_local() then");
  assert.ok(at > guard.body.indexOf("'uid_mismatch'") && at > guard.body.indexOf("'stale'"),
    'after the sender and clock checks, and only on a row nothing has marked');
  assert.match(guard.body.slice(at),
    /^[^\n]*\n(?:\s*--[^\n]*\n)*\s*new\.props := coalesce\(new\.props, '\{\}'::jsonb\) \|\| jsonb_build_object\('synthetic_reason', 'dev'\);/);
  assert.ok(DIVERTED_ENVS.includes('dev'), 'which the divert takes');

  const local = latestDefinition('request_is_local');
  assert.equal(local.file, FILE);
  assert.doesNotMatch(local.body, /security definer/i);
  assert.match(readFileSync(join(MIGRATIONS_DIR, FILE), 'utf8'),
    /^grant execute on function public\.request_is_local\(\) to anon, authenticated, service_role;$/m,
    "the guard runs with the caller's rights, so every client role must be able to call it");
  // The native app serves itself from localhost with no port, and stays production.
  assert.match(local.body, /\(\(v_host = 'localhost' or v_host ~ '\\\.localhost\$'\) and v_port is not null\)/);
});

test('only a preview or dev row is marked, and never as a QA-harness row', () => {
  assert.equal(envMarks('prod'), null);
  for (const env of ['preview', 'dev']) {
    assert.deepEqual(envMarks(env), { env, synthetic_reason: env });
    assert.ok(!('synthetic' in envMarks(env)), 'synthetic:true would divert it as qa_harness');
  }
});

test('every env the client marks is one the divert trigger and set_first_source take', () => {
  const divert = latestDefinition('_tg_divert_synthetic_events').body;
  const listed = divert.match(/'synthetic_reason' in \(([^)]*)\)/)[1].match(/'[a-z_]+'/g).map((s) => s.slice(1, -1));
  const firstSource = latestDefinition('set_first_source').body;
  for (const env of DIVERTED_ENVS) {
    assert.ok(listed.includes(env), `the divert takes '${env}'`);
    assert.match(firstSource, new RegExp(`v_env in \\([^)]*'${env}'`), `set_first_source treats '${env}' as a test build`);
  }
});

test('set_first_source gets the env only off production, beside the first-touch bag', () => {
  const src = { utm_source: 'x', landing_path: '/' };
  assert.equal(firstSourcePayload(src, 'prod'), src);
  assert.deepEqual(firstSourcePayload(src, 'preview'), { ...src, env: 'preview' });
  assert.deepEqual(firstSourcePayload(null, 'dev'), { env: 'dev' });
  assert.deepEqual(firstSourcePayload(null, 'prod'), {});
});

test('analytics.js marks every row it builds and checks the first-source stamp for an error', () => {
  const src = readFileSync(new URL('./analytics.js', import.meta.url), 'utf8');
  assert.match(src, /const ENV = eventEnv\(import\.meta\.env\.DEV\);/);
  const build = src.slice(src.indexOf('function buildRow('), src.indexOf('function enqueue('));
  assert.match(build, /if \(ENV_MARKS\) Object\.assign\(merged, ENV_MARKS\);/);
  assert.ok(build.indexOf('Object.assign(merged, ENV_MARKS)') > build.indexOf("{ ...props }"),
    'after the caller props, so a call site cannot unmark a row');
  const stamp = src.slice(src.indexOf('async function stampFirstSourceIfNeeded'), src.indexOf('// Experiment arms ride every event'));
  assert.match(stamp, /firstSourcePayload\(getFirstSource\(\), ENV\)/);
  assert.match(stamp, /const \{ error \} = await supabase\.rpc\('set_first_source'/);
  assert.match(stamp, /if \(error\) throw error;/, 'supabase-js resolves an error rather than throwing; a failed stamp must not be marked done');
});
