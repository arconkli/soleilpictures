// errorCore.test.mjs — what a failed request is, and what an error row may
// carry. See errorCore.js; errorSender.js is its only importer.
//
//   node --test src/lib/errorCore.test.mjs
//
// Two halves. The table pins classifyHttpFailure(): which failures are
// someone's problem and how bad. The rest pins privacy: a row's route, crumbs
// and context are cut down here and again by 0580's _client_error_context()
// and _client_error_crumbs(), and the two lists must stay the same. The
// extractors hard-fail on zero matches: one that matches nothing agrees with
// everything.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  ERROR_CONTEXT_KEYS, ERROR_HTTP_KEYS, errorContext, dedupeKey, crumbNames,
  routeOf, bodyCode, classifyHttpFailure, scrubUrls, channelFailure, channelLabel, timersRanAhead,
} from './errorCore.js';
import { isNoise, isBotUA } from './errorNoise.js';
import { crumb, crumbsSnapshot, __resetCrumbsForTest } from './errorCrumbs.js';
import { latestDefinition } from './migrationText.mjs';

const HOSTS = { app: 'clusters.soleilpictures.com', supabase: 'abc.supabase.co' };
const SB = 'https://abc.supabase.co';
const PARTY = 'https://soleil-boards-party.arconkli.workers.dev';
const ID = '6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b';

const route = (url) => {
  const r = routeOf(url, HOSTS);
  return r && `${r.svc}/${r.route}`;
};

test('a request is named by its service and its route, never by what is in it', () => {
  const cases = [
    [`${SB}/rest/v1/boards?id=eq.${ID}&select=*`, 'rest/boards'],
    [`${SB}/rest/v1/rpc/save_board_snapshot`, 'rpc/save_board_snapshot'],
    [`${SB}/auth/v1/token?grant_type=refresh_token`, 'auth/token/refresh_token'],
    [`${SB}/auth/v1/verify`, 'auth/verify'],
    [`${SB}/auth/v1/factors/${ID}/verify`, 'auth/factors/:x'],
    [`${SB}/storage/v1/object/sign/files/${ID}/Wedding%20plans.pdf?token=abc`, 'storage/object/sign/:x'],
    [`${SB}/functions/v1/create-checkout-session`, 'functions/create-checkout-session'],
    [`https://acct123.r2.cloudflarestorage.com/soleil-files/${ID}/holiday.jpg?X-Amz-Signature=f00`, 'r2/soleil-files/:x'],
    [`${PARTY}/parties/upload/${ID}/mpu/create`, 'party/parties/upload/:x/mpu/create'],
    [`${PARTY}/parties/main/${ID}`, 'party/parties/main/:x'],
    [`${PARTY}/parties/upload/share/share-bundle`, 'party/parties/upload/:x/share-bundle'],
    [`${PARTY}/health`, 'party/health'],
    [`/api/v1/boards/${ID}/cards`, 'worker/api/v1/boards/:x'],
    ['/api/clusters/move', 'worker/api/clusters/move'],
    ['/api/og?url=https%3A%2F%2Fexample.com%2Fsecret', 'worker/api/og'],
    ['/c/my-wedding-plans', 'worker/c/:x'],
    ['/share/Xk3jT9qLmN2p', 'worker/share/:x'],
    ['/assets/index-BJXXWrDl.js', 'worker/assets/index'],
    ['/assets/vendor-react-xzG6aVBS.js', 'worker/assets/vendor-react'],
    ['/assets/FeedbackOverlay-DXqqNEIM.css', 'worker/assets/FeedbackOverlay'],
    ['/assets/holiday-photo.png', 'worker/assets/:x'],
    ['https://soleilpictures.com/', 'worker//'],
  ];
  for (const [url, want] of cases) assert.equal(route(url), want, url);
});

test('anyone else\'s server, a data: picture or a blob: is not ours to report', () => {
  for (const url of ['https://example.com/a.png', 'https://fonts.gstatic.com/x.woff2', 'data:image/png;base64,AAAA',
    'blob:https://clusters.soleilpictures.com/0b1c2d3e-0000-4000-8000-000000000000', 'http://', 'https://[bad']) {
    assert.equal(routeOf(url, HOSTS), null, url);
  }
});

test('a route never keeps a slug, a token, an id or a file name, however plain it looks', () => {
  const secrets = ['my-wedding-plans', 'wedding', 'Xk3jT9qLmN2p', ID, 'holiday', 'Wedding', 'secret', 'example'];
  const urls = [
    '/c/my-wedding-plans', '/c/wedding', '/b/wedding/sub', '/share/Xk3jT9qLmN2p', `/api/v1/boards/${ID}/wedding`,
    `${SB}/storage/v1/object/public/files/wedding/holiday.jpg`, `${PARTY}/parties/doc/wedding/recheck`,
    `https://acct.r2.cloudflarestorage.com/soleil-files/wedding/holiday.jpg`, '/api/og?url=https%3A%2F%2Fexample.com%2Fsecret',
    `${SB}/auth/v1/factors/wedding/verify`,
  ];
  for (const url of urls) {
    const r = routeOf(url, HOSTS);
    assert.ok(r, url);
    for (const s of secrets) assert.ok(!r.route.includes(s), `${url} kept "${s}" in ${r.route}`);
    assert.doesNotMatch(r.route, /\d(?<!v\d)/, `${url}: a digit outside v1 is an id: ${r.route}`);
  }
});

test('an address in a message becomes its service and route', () => {
  assert.equal(scrubUrls('Failed to fetch dynamically imported module: https://clusters.soleilpictures.com/assets/AppShell-BCWNygQL.js', HOSTS),
    'Failed to fetch dynamically imported module: worker/assets/AppShell');
  assert.equal(scrubUrls(`GET ${SB}/rest/v1/boards?name=eq.Wedding%20plans failed`, HOSTS), 'GET rest/boards failed');
  assert.equal(scrubUrls('HTTP 404 https://clusters.soleilpictures.com/s/AbCdEf123456', HOSTS), 'HTTP 404 worker/s/:x');
  assert.equal(scrubUrls('blocked (https://example.com/track?u=secret)', HOSTS), 'blocked (<url>)');
  assert.equal(scrubUrls('no address here', HOSTS), 'no address here');
});

const fail = (over) => classifyHttpFailure({ method: 'GET', status: 500, ms: 120, online: true, ...over }, HOSTS);

test('what a failed request is: the table', () => {
  const rest = `${SB}/rest/v1/boards`;
  const rpc = `${SB}/rest/v1/rpc/save_board_snapshot`;
  const cases = [
    // [what, failure, severity or null, message]
    ['offline is the network, not us', { url: rest, status: 0, online: false }, null],
    ['an abort is the page calling it off', { url: rest, status: 0, aborted: true }, null],
    ['online and no answer', { url: rest, status: 0 }, 'error', 'GET rest/boards: network failure'],
    ['a 500', { url: rpc, method: 'post', status: 500 }, 'error', 'POST rpc/save_board_snapshot: server error'],
    ['a statement timeout', { url: rpc, method: 'POST', status: 500, pg: '57014' }, 'error',
      'POST rpc/save_board_snapshot: statement timeout (57014)'],
    ['a query we built badly', { url: rest, status: 400, pg: '22P02' }, 'error', 'GET rest/boards: invalid input (22P02)'],
    ['refused by RLS', { url: rest, method: 'PATCH', status: 403, pg: '42501' }, 'error',
      'PATCH rest/boards: permission denied (42501)'],
    ['no rows from .single()', { url: rest, status: 406, pg: 'PGRST116' }, null],
    ['a duplicate', { url: rest, method: 'POST', status: 409, pg: '23505' }, 'warning', 'POST rest/boards: duplicate key (23505)'],
    ['an expired token', { url: rest, status: 401, pg: 'PGRST303' }, 'warning', 'GET rest/boards: token expired (PGRST303)'],
    ['rate limited', { url: rpc, method: 'POST', status: 429 }, 'warning', 'POST rpc/save_board_snapshot: rate limited'],
    ['a wrong code typed at sign-in', { url: `${SB}/auth/v1/verify`, method: 'POST', status: 403, pg: 'otp_expired' }, null],
    ['sign-in rate limited', { url: `${SB}/auth/v1/otp`, method: 'POST', status: 429 }, 'warning', 'POST auth/otp: rate limited'],
    ['auth down', { url: `${SB}/auth/v1/otp`, method: 'POST', status: 502 }, 'error', 'POST auth/otp: bad gateway'],
    ['a session the server forgot', { url: `${SB}/auth/v1/token?grant_type=refresh_token`, method: 'POST', status: 400,
      pg: 'refresh_token_not_found' }, 'warning', 'POST auth/token/refresh_token: session lost (refresh_token_not_found)'],
    ['a refresh that failed on the server is not a lost session',
      { url: `${SB}/auth/v1/token?grant_type=refresh_token`, method: 'POST', status: 500 }, 'error',
      'POST auth/token/refresh_token: server error'],
    ['a slow query', { url: rpc, method: 'POST', status: 200, ms: 9100, slow: true }, 'warning',
      'POST rpc/save_board_snapshot: slow'],
    ['a big upload is as slow as it is big', { url: 'https://a.r2.cloudflarestorage.com/soleil-files/x/y', method: 'PUT',
      status: 200, ms: 40_000, slow: true }, null],
    ['a slow Storage read', { url: `${SB}/storage/v1/object/sign/files/x`, status: 200, ms: 9000, slow: true }, null],
    // An upload's PUT goes by XHR, which fetch can't watch (uploads.js says so
    // itself), and is tried again: a warning, and the toast is the error.
    ['an upload PUT that dropped', { url: 'https://a.r2.cloudflarestorage.com/soleil-files/ws/u/photo.jpg', method: 'PUT',
      status: 0, retried: true }, 'warning', 'PUT r2/soleil-files/:x: network failure'],
    ['an upload PUT that stalled', { url: 'https://a.r2.cloudflarestorage.com/soleil-files/ws/u/photo.jpg', method: 'PUT',
      status: 0, stalled: true, retried: true }, 'warning', 'PUT r2/soleil-files/:x: stalled'],
    ['storage refusing an upload PUT', { url: 'https://a.r2.cloudflarestorage.com/soleil-files/ws/u/photo.jpg', method: 'PUT',
      status: 503, retried: true }, 'warning', 'PUT r2/soleil-files/:x: unavailable'],
    ['an upload PUT the page called off', { url: 'https://a.r2.cloudflarestorage.com/soleil-files/x', method: 'PUT',
      status: 0, aborted: true, retried: true }, null],
    ['our own telemetry failing', { url: `${SB}/rest/v1/client_errors`, method: 'POST', status: 500 }, null],
    ['analytics failing', { url: `${SB}/rest/v1/analytics_events`, method: 'POST', status: 503 }, null],
    ['a link that will not unfurl', { url: '/api/og?url=x', status: 404 }, 'warning', 'GET worker/api/og: not found'],
    ['the Party failing', { url: `${PARTY}/parties/upload/${ID}/sign-reads`, method: 'POST', status: 500 }, 'error',
      'POST party/parties/upload/:x/sign-reads: server error'],
    ['a file over the limit', { url: `${PARTY}/parties/upload/${ID}/mpu/create`, method: 'POST', status: 413 }, 'warning',
      'POST party/parties/upload/:x/mpu/create: too large'],
    ['anyone else', { url: 'https://example.com/x', status: 500 }, null],
  ];
  for (const [what, f, severity, message] of cases) {
    const v = fail(f);
    if (severity === null) { assert.equal(v, null, what); continue; }
    assert.ok(v, what);
    assert.equal(v.severity, severity, what);
    assert.equal(v.message, message, what);
    assert.deepEqual(Object.keys(v.http).sort(), [...ERROR_HTTP_KEYS].sort(), `${what}: the http context`);
  }
});

test('a body gives up its code and nothing else', () => {
  assert.equal(bodyCode('{"code":"57014","details":null,"hint":null,"message":"canceling statement due to statement timeout"}'), '57014');
  assert.equal(bodyCode('{"code":"PGRST116","message":"JSON object requested, multiple (or no) rows returned"}'), 'PGRST116');
  assert.equal(bodyCode('{"code":400,"error_code":"otp_expired","msg":"Token has expired or is invalid"}'), 'otp_expired');
  assert.equal(bodyCode('{"error":"invalid_grant","error_description":"Invalid Refresh Token: Already Used"}'), 'invalid_grant');
  assert.equal(bodyCode('{"statusCode":"404","error":"not_found","message":"Object not found"}'), 'not_found');
  // A code-shaped field that is really a sentence (or a row) is not a code.
  assert.equal(bodyCode('{"error":"Card \\"Wedding plans\\" is locked"}'), null);
  assert.equal(bodyCode('<html>502 Bad Gateway</html>'), null);
  assert.equal(bodyCode(`{"code":"57014","pad":"${'x'.repeat(5000)}"}`), null);
  assert.equal(bodyCode(''), null);
  assert.equal(bodyCode(null), null);
});

test('context keeps the allowlist only, cut down the server\'s way', () => {
  const ctx = errorContext({
    op: 'board_snapshot', code: 'save_failed', board_id: ID.toUpperCase(), online: true, attempt: 2.4, ms: 812.6,
    surface: `board ${ID}`, group: 'someone@example.com', title: 'Wedding plans', text: 'anything',
    http: { method: 'POST', svc: 'rpc', route: 'save_board_snapshot', status: 500, body: 'row', ms: 'slow' },
    phase: 'x'.repeat(200), online2: false,
  });
  assert.deepEqual(ctx, {
    op: 'board_snapshot', code: 'save_failed', surface: 'board :id', phase: 'x'.repeat(80), board_id: ID,
    online: true, attempt: 2, ms: 813, http: { method: 'POST', svc: 'rpc', route: 'save_board_snapshot', status: 500 },
  });
  assert.equal(errorContext({ board_id: 'wedding-plans', online: 'yes', title: 'x' }), null);
  assert.equal(errorContext(null), null);
  assert.equal(errorContext('op'), null);
});

// The server's twin. Every key the client keeps, the server keeps, and the
// other way round: a key only one side knows is either dropped on arrival or
// never sent.
test('the context allowlist is the same on both sides', () => {
  const def = latestDefinition('_client_error_context');
  assert.ok(def, '_client_error_context() is defined in a migration');
  const [top, http] = def.body.split(/'http'\s*,/);
  assert.ok(http, 'the http object is found in _client_error_context()');
  const keys = (s) => [...s.matchAll(/'([a-z_]+)'\s*,\s*(?:public\._error_ctx|case\b)/g)].map((m) => m[1]);
  const serverTop = [...keys(top), 'http'];
  const serverHttp = keys(http);
  assert.ok(serverTop.length > 5 && serverHttp.length > 3, 'the extractor matched the keys');
  assert.deepEqual([...serverTop].sort(), [...ERROR_CONTEXT_KEYS].sort());
  assert.deepEqual([...serverHttp].sort(), [...ERROR_HTTP_KEYS].sort());
});

const SRC = new URL('..', import.meta.url).pathname;
function sources(dir = SRC, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) sources(p, out);
    else if (/\.(js|jsx)$/.test(e.name) && !/\.test\./.test(e.name)) out.push(p);
  }
  return out;
}

test('every crumb kind the app records is one the server keeps', () => {
  const def = latestDefinition('_client_error_crumbs');
  assert.ok(def, '_client_error_crumbs() is defined in a migration');
  const list = /->>\s*'k'\s+in\s*\(([^)]*)\)/.exec(def.body);
  assert.ok(list, 'the kinds list is found in _client_error_crumbs()');
  const server = new Set([...list[1].matchAll(/'([a-z]+)'/g)].map((m) => m[1]));
  const used = new Set();
  for (const file of sources()) {
    for (const m of readFileSync(file, 'utf8').matchAll(/\bcrumb\(\s*'([a-z]+)'/g)) used.add(m[1]);
  }
  assert.ok(used.size >= 5, `the extractor found the app's crumbs (${[...used]})`);
  for (const k of used) assert.ok(server.has(k), `crumb kind "${k}" is dropped by _client_error_crumbs()`);
});

test('crumbs: names only, the last 20, and a failed request\'s address never leaves the page', () => {
  __resetCrumbsForTest();
  for (let i = 0; i < 25; i += 1) crumb('ev', `step_${i}`);
  crumb('http', 'POST 500', `${SB}/rest/v1/rpc/rename_board?name=Wedding%20plans`);
  crumb('toast', 'x'.repeat(100));
  const snap = crumbsSnapshot();
  assert.equal(snap.length, 20);
  assert.ok(snap.every((c) => c.t <= 0 && typeof c.n === 'string' && c.n.length <= 60));
  const sent = crumbNames(snap, HOSTS);
  assert.equal(sent.length, 20);
  assert.deepEqual(sent.at(-2), { t: snap.at(-2).t, k: 'http', n: 'POST rpc/rename_board 500' });
  assert.ok(sent.every((c) => !('u' in c)), 'no crumb carries an address');
  assert.doesNotMatch(JSON.stringify(sent), /Wedding|name=|supabase\.co/);
  assert.deepEqual(crumbNames([{ t: -5, k: 'http', n: 'GET 0', u: 'https://example.com/x' }], HOSTS),
    [{ t: -5, k: 'http', n: 'GET elsewhere 0' }]);
  assert.equal(crumbNames([], HOSTS), null);
  __resetCrumbsForTest();
});

test('one failure with a different number in it is one failure', () => {
  const a = dedupeKey('save', `Save failed for ${ID} after 3 tries`, 'Error\n    at save (https://x/assets/AppShell-1.js:1:200)');
  const b = dedupeKey('save', `Save failed for ${ID.replace('6f', '7a')} after 5 tries`, 'Error\n    at save (https://x/assets/AppShell-1.js:1:900)');
  const c = dedupeKey('save', 'Save failed for x after 3 tries', 'Error\n    at load (https://x/assets/Board-2.js:1:200)');
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.notEqual(dedupeKey('render', 'x', ''), dedupeKey('save', 'x', ''));
});

test('noise is dropped, a real failure is kept', () => {
  const chrome = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
  assert.equal(isNoise('Failed to fetch', 'TypeError: Failed to fetch', chrome), false);
  assert.equal(isNoise("Cannot read properties of undefined (reading 'id')", 'at x (https://x/assets/a.js:1:1)', chrome), false);
  assert.equal(isNoise('Failed to fetch', '', 'Mozilla/5.0 (compatible; Googlebot/2.1)'), true);
  assert.equal(isBotUA('facebookexternalhit/1.1'), true);
  assert.equal(isBotUA(chrome), false);
  for (const m of ['Script error.', 'ResizeObserver loop completed with undelivered notifications.',
    'AbortError: The user aborted a request.', 'signal is aborted without reason', 'The operation was aborted.',
    'Object Not Found Matching Id:3, MethodName:update, ParamCount:4']) {
    assert.equal(isNoise(m, '', chrome), true, m);
  }
  assert.equal(isNoise('x', 'at y (chrome-extension://abc/content.js:1:1)', chrome), true);
});

test('a channel is named by its leading words, never its ids', () => {
  const cases = [
    [`comments:${ID}:k3j2h1`, 'comments'],
    [`autotag-tags-${ID}-x9y8z7`, 'autotag-tags'],
    // A uuid whose first group is all letters is an id all the same.
    ['autotag-tags-deadbeef-aaaa-4bbb-8ccc-123456789abc-x9y8z7', 'autotag-tags'],
    [`user:${ID}`, 'user'],
    [`y:${ID}`, 'y'],
    ['admin:activity', 'admin'],
    ['doc-page-tags:doc-123:page-1:abc', 'doc-page-tags'],
    ['profiles-cache:qwerty1', 'profiles-cache'],
    [ID, 'other'],
    ['', 'other'],
    [null, 'other'],
  ];
  for (const [name, want] of cases) assert.equal(channelLabel(name), want, String(name));
});

test('what a status says about the channel itself, and a dropped socket says nothing', () => {
  const cases = [
    ['SUBSCRIBED', undefined, null],
    ['CLOSED', undefined, null],
    ['TIMED_OUT', undefined, 'timed out'],
    // normalizeChannelError's words for the socket going: every channel's at once.
    ['CHANNEL_ERROR', new Error('socket closed: 1006'), null],
    ['CHANNEL_ERROR', new Error('channel error: transport failure'), null],
    ['CHANNEL_ERROR', new Error('channel error: connection lost'), null],
    ['CHANNEL_ERROR', undefined, null],
    ['CHANNEL_ERROR', new Error('mismatch between server and client bindings for postgres changes'), 'mismatched'],
    ['CHANNEL_ERROR', new Error(`Unauthorized: You do not have permissions to read from this Channel topic: realtime:user:${ID}`), 'refused (Unauthorized)'],
    ['CHANNEL_ERROR', new Error('ChannelRateLimitReached: Too many channels'), 'refused (ChannelRateLimitReached)'],
    ['CHANNEL_ERROR', new Error('Realtime was unable to connect to the project database'), 'refused'],
  ];
  for (const [status, err, want] of cases) assert.equal(channelFailure(status, err), want, `${status} ${err?.message || ''}`);
});

test('a watchdog that went off before its time is a renderer\'s, never a person\'s', () => {
  // As the renderers that set off "the app is not opening" (2026-10-27) did:
  // the 45-second splash watchdog, after 9 and 5 seconds of the page's clock.
  assert.equal(timersRanAhead(9047, 45_000), true);
  assert.equal(timersRanAhead(4815, 45_000), true);
  assert.equal(timersRanAhead(45_000, 45_000), false);
  assert.equal(timersRanAhead(61_200, 45_000), false, 'a browser fires a timer late');
  // Knowing nothing proves nothing: an item without its delay still counts.
  assert.equal(timersRanAhead(9047, undefined), false);
  assert.equal(timersRanAhead(undefined, 45_000), false);

  // The splash watchdog hands its delay along, and the sender drops it early.
  const reporting = readFileSync(new URL('./errorReporting.js', import.meta.url), 'utf8');
  const delay = Number(reporting.match(/const BOOT_STUCK_MS = ([\d_]+);/)[1].replace(/_/g, ''));
  assert.equal(delay, 45_000);
  assert.match(reporting, /hand\(\{ t: 'boot', m: moment\(\), after: BOOT_STUCK_MS \}\)/);
  assert.match(reporting, /\}, BOOT_STUCK_MS\);/);
  const sender = readFileSync(new URL('./errorSender.js', import.meta.url), 'utf8');
  const boot = sender.slice(sender.indexOf("it.t === 'boot'"), sender.indexOf("it.t === 'perf'"));
  assert.match(boot, /timersRanAhead\(m\.at, it\.after\)[\s\S]*?\) return;/);
  // 0583 drops the rows builds already out still send, at the same 45 seconds.
  const sql = latestDefinition('_breaking_candidates').body;
  assert.match(sql, new RegExp(`message like 'Boot stuck after %'\\s+and coalesce\\(\\(e\\.context->>'ms'\\)::numeric, ${delay}\\) < ${delay}\\)`));
});
