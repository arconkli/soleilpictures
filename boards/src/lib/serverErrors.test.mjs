// serverErrors.test.mjs — the servers' rows: what they say, what they never
// say, how often, and that the Worker records every failure it answers with.
//
//   node --test src/lib/serverErrors.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  serverErrorRow, makeServerErrorState, serverEnv, scrubServerText, isOurFailure, failedCall, watchJob,
} from './serverErrors.js';
import { answeredWith, answerOf } from './workerErrors.js';
import { ERROR_CONTEXT_KEYS } from './errorCore.js';

const SRC = new URL('../', import.meta.url).pathname;
const read = (f) => readFileSync(SRC + f, 'utf8');
const req = (url, method = 'GET') => ({ url, method });

test('a route that threw is a worker row, with its route and never its query', () => {
  const row = serverErrorRow({
    source: 'worker', kind: 'route', status: 500, release: 'abc1234',
    request: req('https://clusters.soleilpictures.com/api/tags/apply?q=My%20Film', 'POST'),
    error: Object.assign(new TypeError("Cannot read properties of undefined (reading 'id')"), {
      stack: 'TypeError: Cannot read properties of undefined (reading \'id\') at "My Film"\n    at handleApply (worker.js:10:5)',
    }),
  }, makeServerErrorState(), 1_000_000);
  assert.equal(row.source, 'worker');
  assert.equal(row.kind, 'route');
  assert.equal(row.severity, 'error');
  assert.equal(row.name, 'TypeError');
  assert.equal(row.path, '/api/tags/apply');
  assert.equal(row.message, "Cannot read properties of undefined (reading 'id')");
  assert.equal(row.stack, "TypeError: Cannot read properties of undefined (reading 'id')\n    at handleApply (worker.js:10:5)");
  assert.equal(row.env, 'prod');
  assert.equal(row.release, 'abc1234');
  assert.equal(row.user_agent, null);
  assert.deepEqual(row.context, { op: 'route', http: { method: 'POST', svc: 'worker', route: 'api/tags/apply', status: 500 } });
  assert.doesNotMatch(JSON.stringify(row), /My%20Film|My Film/);
  for (const k of Object.keys(row.context)) assert.ok(ERROR_CONTEXT_KEYS.includes(k), `${k} survives 0580's allowlist`);
});

test('a message keeps what failed and loses what anyone sent', () => {
  const s = scrubServerText(
    'Unexpected token \'h\', "hello my secret plan" is not valid JSON; '
    + 'user person@example.com at https://abcdefghijklmnop.supabase.co/rest/v1/rpc/get_share_meta?p_token=x '
    + 'token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9abcdefgh',
    { supabase: 'abcdefghijklmnop.supabase.co' },
  );
  assert.match(s, /Unexpected token 'h', "…" is not valid JSON/);
  assert.match(s, /<email>/);
  assert.match(s, /rpc\/get_share_meta/);
  assert.match(s, /<token>/);
  assert.doesNotMatch(s, /secret plan|person@|p_token|eyJhbGci/);
});

test('which deployment answered', () => {
  assert.equal(serverEnv('clusters.soleilpictures.com'), 'prod');
  assert.equal(serverEnv('main-soleil-boards.arconkli.workers.dev'), 'preview');
  assert.equal(serverEnv('soleil-boards-party.arconkli.workers.dev', { workersDevIsProd: true }), 'prod');
  assert.equal(serverEnv('localhost'), 'dev');
  assert.equal(serverEnv(''), 'prod');
});

test('a page served without its read is recorded when it was ours, never for the database saying no', () => {
  const timeout = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
  assert.equal(isOurFailure(timeout), true);
  assert.equal(isOurFailure(new TypeError('Network connection lost.')), true);
  assert.equal(isOurFailure(new Error('rpc get_share_meta 503: <html>gateway</html>')), true);
  assert.equal(isOurFailure(new Error('rpc get_share_meta 500: {"code":"57014","message":"canceling statement"}')), true);
  // A migration's grants: anon can no longer run it. Ours.
  assert.equal(isOurFailure(new Error('rpc get_share_meta 401: {"code":"42501","message":"permission denied"}')), true);
  assert.equal(isOurFailure(new Error('rpc get_share_meta 404: {"code":"PGRST202","message":"no function"}')), true);
  // PostgREST answers a function's own raise with a 500 (P0002): a revoked
  // link, an unpublished board. The database's answer, not a failure.
  assert.equal(isOurFailure(new Error('rpc get_share_meta 500: {"code":"P0002","details":null,"hint":null,"message":"invalid or expired share link"}')), false);
  assert.equal(isOurFailure(new Error('rpc get_file_share 400: {"code":"P0001","message":"revoked"}')), false);
  assert.equal(isOurFailure(new Error('rpc get_share_meta 400: {"code":"22P02","message":"invalid input syntax for type uuid"}')), false);
  const row = serverErrorRow({
    source: 'worker', kind: 'degraded', what: 'share_meta',
    request: req('https://clusters.soleilpictures.com/share/8d0c6a4e-1f7b-4c1e-9a55-3b1d2f0e9c11?b=1'),
    error: new Error('rpc get_share_meta 500: {"code":"57014","details":"the row with Secret Name","message":"canceling statement due to statement timeout"}'),
  }, makeServerErrorState(), 0);
  assert.equal(row.severity, 'warning');
  assert.equal(row.message, 'share_meta: statement timeout (57014)');
  assert.equal(row.name, null);
  assert.equal(row.stack, null);
  assert.equal(row.path, '/share/:x');
  assert.deepEqual(row.context, { op: 'degraded', code: '57014', tag: 'share_meta', http: { method: 'GET', svc: 'worker', route: 'share/:x' } });
  assert.doesNotMatch(JSON.stringify(row), /Secret Name|8d0c6a4e/);
  const slow = serverErrorRow({ source: 'worker', kind: 'degraded', what: 'explore_list', error: timeout,
    request: req('https://clusters.soleilpictures.com/explore') }, makeServerErrorState(), 0);
  assert.equal(slow.message, 'explore_list: timed out');
});

test('a failed database call is said by what was called and why, never its body', () => {
  assert.deepEqual(failedCall('select boards 400: {"code":"42703","message":"column x does not exist"}'),
    { what: 'select boards', status: 400, code: '42703' });
  assert.deepEqual(failedCall('createUser 422: {"error_code":"email_exists","msg":"a@b.co"}'),
    { what: 'createUser', status: 422, code: 'email_exists' });
  assert.equal(failedCall('Cannot read properties of undefined'), null);
  const api = serverErrorRow({
    source: 'worker', kind: 'api', status: 500, code: 'internal_error',
    request: req('https://clusters.soleilpictures.com/api/v1/boards/8d0c6a4e-1f7b-4c1e-9a55-3b1d2f0e9c11/cards', 'POST'),
    // restError curates .message for the caller and keeps what failed in .detail.
    error: Object.assign(new Error('something went wrong on our end'), {
      detail: 'insert card_index 409: {"code":"23505","details":"Key (name)=(My Film) already exists."}',
    }),
  }, makeServerErrorState(), 0);
  assert.equal(api.message, 'insert card_index: duplicate key (23505)');
  assert.equal(api.path, '/api/v1/boards/:x');
  assert.equal(api.context.code, 'internal_error');
  assert.doesNotMatch(JSON.stringify(api), /My Film/);
});

test('a 5xx answered with nothing thrown is named by its route', () => {
  const row = serverErrorRow({ source: 'worker', kind: 'route', status: 504,
    request: req('https://main-soleil-boards.arconkli.workers.dev/api/tags/embed', 'POST') }, makeServerErrorState(), 0);
  assert.equal(row.message, 'POST /api/tags/embed: gateway timeout');
  assert.equal(row.env, 'preview');
  assert.equal(row.stack, null);
});

test('a guard hands the door what it caught, by the request', () => {
  const request = req('https://clusters.soleilpictures.com/api/tags/apply');
  assert.deepEqual(answerOf(request), {});
  const e = new Error('x');
  answeredWith(request, e, { kind: 'api', code: 'internal_error' });
  assert.deepEqual(answerOf(request), { error: e, kind: 'api', code: 'internal_error' });
  assert.deepEqual(answerOf(req('https://clusters.soleilpictures.com/api/tags/apply')), {});
  assert.deepEqual(answerOf(null), {});
});

test('the same failure is written once per five minutes, and 30 a minute at most', () => {
  const state = makeServerErrorState();
  const info = { source: 'worker', kind: 'job', job: 'r2_sweep', error: new Error('list failed') };
  const first = serverErrorRow(info, state, 0);
  assert.equal(first.message, 'r2_sweep: list failed');
  assert.equal(first.env, 'prod');
  assert.equal(first.path, null);
  assert.deepEqual(first.context, { op: 'job', tag: 'r2_sweep' });
  assert.equal(serverErrorRow(info, state, 60_000), null);
  assert.ok(serverErrorRow(info, state, 5 * 60_000 + 1));
  // A number in a message is the same failure.
  const s2 = makeServerErrorState();
  assert.ok(serverErrorRow({ ...info, error: new Error('list failed after 3 tries') }, s2, 0));
  assert.equal(serverErrorRow({ ...info, error: new Error('list failed after 4 tries') }, s2, 1), null);
  const s3 = makeServerErrorState();
  let n = 0;
  for (let i = 0; i < 50; i++) if (serverErrorRow({ ...info, job: `job_${'x'.repeat(i)}` }, s3, 10)) n++;
  assert.equal(n, 30);
  assert.equal(serverErrorRow({ source: 'client', kind: 'route', error: new Error('x') }, makeServerErrorState()), null);
});

test('a job that fails is recorded and still fails', async () => {
  const seen = [];
  const report = (_env, _ctx, info) => seen.push(info);
  await assert.rejects(watchJob({}, null, 'compaction', Promise.reject(new Error('boom')), { report }), /boom/);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].kind, 'job');
  assert.equal(seen[0].job, 'compaction');
  assert.equal(await watchJob({}, null, 'ok', Promise.resolve(7), { report }), 7);
  assert.equal(seen.length, 1);
});

test('the Worker records every 5xx it answers, what escapes it, and every cron job', () => {
  const worker = read('worker.js');
  const door = worker.slice(worker.indexOf('  async handleFetch(request, env, ctx) {'), worker.indexOf('  async route(request, env, ctx) {'));
  assert.match(door, /res = await worker\.route\(request, env, ctx\);/);
  assert.match(door, /if \(res\.status >= 500 && !theirFailure\(new URL\(request\.url\)\.pathname, res\.status\)\) \{\s*report\(env, ctx, \{ kind: 'route', request, status: res\.status, \.\.\.answerOf\(request\) \}\);/);
  assert.match(door, /await report\(env, ctx, \{ kind: 'route', error: e, request, status: 500, phase: 'tail' \}\);\s*throw e;/);
  // The /api/* guard hands its error to the door.
  assert.match(worker, /\} catch \(e\) \{\s*answeredWith\(request, e\);\s*return json\(\{ error: e\?\.message \|\| String\(e\) \}, 500\);/);
  // Only a link preview's page and a saved picture's site are someone else's.
  const theirs = worker.slice(worker.indexOf('function theirFailure('), worker.indexOf('const worker = {'));
  assert.match(theirs, /pathname === '\/api\/og' \|\| \(status === 502 && pathname\.startsWith\('\/api\/media\/'\)\)/);
  // Every public-page read that fails open goes through failOpen.
  const reads = worker.slice(worker.indexOf('const failOpen = '), worker.indexOf('let assetReq = request;'));
  assert.doesNotMatch(reads, /\.catch\(\(\) => null\)/);
  assert.equal([...reads.matchAll(/\.catch\(failOpen\('[a-z_]+'\)\)/g)].length, 9);
  // Every scheduled job leaves through watch().
  const scheduled = worker.slice(worker.indexOf('async scheduled('), worker.indexOf('export default worker'));
  const waits = [...scheduled.matchAll(/ctx\.waitUntil\(([^;]*)\);/g)].map((m) => m[1]);
  assert.ok(waits.length >= 9, 'the cron branches are still read');
  for (const w of waits) assert.match(w, /^watch\('[a-z0-9_]+', /, `a cron job is watched: ${w.slice(0, 60)}`);
  // /api/v1 hands the door its 5xx, and a tool's failure (which leaves /mcp as
  // the tool's answer) is recorded where it happens.
  const api = read('worker-api.js');
  assert.match(api, /if \(status >= 500\) \{\s*console\.error\('\[api\]'[^\n]*\n[^\n]*\n\s*answeredWith\(request, e, \{ kind: 'api', code \}\);/);
  assert.match(api, /if \(status >= 500\) \{\s*console\.error\('\[mcp→api\]'[^\n]*\n(?:\s*\/\/[^\n]*\n)*\s*reportWorkerError\(env, ctx, \{ kind: 'api', error: e, request: req, status, code, op: 'mcp' \}\);/);
});

test('a job that swallows a failure so its run goes on still records it', () => {
  const sites = {
    'worker.js': ["'r2_sweep', e, 'audit'", "'r2_sweep', e)", "'r2_tombstone', e)", "'size_backfill', e)",
      "'r2_mirror', e, 'images'", "'r2_mirror', e, 'batches'", "'r2_mirror', e, 'watermark'"],
    'worker-compaction.js': ["'compaction', e, 'candidates'"],
    'worker-aiwatch.js': ["'ai_watch', e, 'raise'", "'ai_watch', e)", "'ai_digest', e)"],
    'worker-aeo.js': ["'aeo_probe', err, 'questions'", "'aeo_probe', err, 'record'"],
    'worker-seo.js': ["'indexnow', e)"],
    'worker-playCopy.js': ["'play_copies', err, 'tick'"],
    'lib/webhooks.js': ["'webhooks', e, 'fan_out'", "'webhooks', e, 'delivery'"],
  };
  for (const [file, calls] of Object.entries(sites)) {
    const src = read(file);
    for (const c of calls) assert.ok(src.includes(`await jobFailed(env, ${c}`), `${file} records ${c}`);
  }
});
