// The once-a-session context row. These pin what it may hold — categories,
// rounded numbers and codes — and that a browser missing any of it, or one
// that throws when asked, still costs nothing.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readSessionContext, contextDue, browserMajor, CTX_SENT_KEY } from './sessionContext.js';

function fakeWindow({ media = [], meta = null, theme = 'dark', nav = {}, ...rest } = {}) {
  const on = new Set(media);
  return {
    Intl: { DateTimeFormat: () => ({ resolvedOptions: () => ({ timeZone: 'America/Los_Angeles' }) }) },
    navigator: {
      language: 'en-US', languages: ['en-US', 'en', 'fr-CA', 'de'], deviceMemory: 8, hardwareConcurrency: 12,
      maxTouchPoints: 0, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
      connection: { effectiveType: '4g', type: 'wifi', saveData: false },
      ...nav,
    },
    matchMedia: (q) => ({ matches: on.has(q) }),
    document: {
      querySelector: (sel) => (meta && sel === 'meta[name="soleil-ctx"]' ? { getAttribute: () => meta } : null),
      documentElement: { getAttribute: (a) => (a === 'data-theme' ? theme : null) },
    },
    innerWidth: 1437, innerHeight: 803, devicePixelRatio: 2, screen: { width: 1512, height: 982 },
    ...rest,
  };
}

const NOW = { getTimezoneOffset: () => 420 };

test('a desktop browser reads as itself', () => {
  const ctx = readSessionContext(fakeWindow({
    media: ['(pointer: fine)', '(any-pointer: fine)', '(hover: hover)', '(prefers-color-scheme: dark)', '(color-gamut: p3)'],
    meta: 'r=US-CA;n=isp',
  }), { now: NOW, flags: { sidebarFiles: true, bulkImport: false }, webview: { is_webview: false, webview_app: null } });
  assert.deepEqual(ctx, {
    tz: 'America/Los_Angeles', tz_offset_min: -420, lang: 'en-US', langs: ['en-US', 'en', 'fr-CA'],
    region: 'US-CA', net_kind: 'isp', edge_src: 'meta',
    vw: 1440, vh: 800, sw: 1510, sh: 980, dpr: 2, gamut: 'p3',
    pointer: 'fine', any_fine: true, any_coarse: false, hover: true, touch_points: 0,
    scheme: 'dark', theme: 'dark', reduced_motion: false, contrast: null, forced_colors: false,
    mem_gb: 8, cores: 12, net_type: '4g', conn_type: 'wifi', save_data: false, browser_major: 18,
    standalone: false, native: null, webview: false, webview_app: null,
    ff: { sidebarFiles: true, bulkImport: false },
  });
});

test('a phone, installed, on a slow connection, in an in-app browser', () => {
  const ctx = readSessionContext(fakeWindow({
    media: ['(pointer: coarse)', '(any-pointer: coarse)', '(display-mode: standalone)', '(prefers-reduced-motion: reduce)', '(prefers-contrast: more)'],
    nav: { maxTouchPoints: 5, hardwareConcurrency: 64, deviceMemory: 0.5, connection: { effectiveType: '3g', type: 'cellular', saveData: true } },
    innerWidth: 393, innerHeight: 659, devicePixelRatio: 2.625, theme: 'light',
  }), { now: NOW, webview: { is_webview: true, webview_app: 'instagram' } });
  assert.equal(ctx.pointer, 'coarse');
  assert.equal(ctx.any_fine, false);
  assert.equal(ctx.touch_points, 5);
  assert.equal(ctx.standalone, true);
  assert.equal(ctx.reduced_motion, true);
  assert.equal(ctx.contrast, 'more');
  assert.equal(ctx.cores, 16, 'cores are capped');
  assert.equal(ctx.mem_gb, 0.5);
  assert.equal(ctx.net_type, '3g');
  assert.equal(ctx.conn_type, 'cellular');
  assert.equal(ctx.save_data, true);
  assert.equal(ctx.dpr, 2.75, 'to the nearest quarter');
  assert.equal(ctx.vw, 390);
  assert.equal(ctx.theme, 'light');
  assert.equal(ctx.webview, true);
  assert.equal(ctx.webview_app, 'instagram');
  assert.equal(ctx.region, null, 'no meta, no region');
  assert.equal(ctx.edge_src, null);
  assert.deepEqual(ctx.ff, {});
});

test('nothing it is handed passes through unchecked', () => {
  const ctx = readSessionContext(fakeWindow({
    meta: 'r=US-CA-Exampleville;n=Example Widgets LLC',
    theme: '<b>',
    nav: {
      language: 'en-US"><script>', languages: ['x'.repeat(40), 'ja', 'ja'], userAgent: 'Mozilla/5.0',
      connection: { effectiveType: '5g', type: 'satellite' },
    },
    Intl: { DateTimeFormat: () => ({ resolvedOptions: () => ({ timeZone: 'Exampleville <b>' }) }) },
    Capacitor: { isNativePlatform: () => true, getPlatform: () => 'web' },
  }), { now: NOW, flags: { 'bad key!': true, ok: 'yes', fine: true }, webview: { is_webview: true, webview_app: 'x'.repeat(100) } });
  assert.equal(ctx.tz, null);
  assert.equal(ctx.lang, null);
  assert.deepEqual(ctx.langs, ['ja'], 'invalid tags dropped, duplicates folded');
  assert.equal(ctx.region, null);
  assert.equal(ctx.net_kind, null);
  assert.equal(ctx.theme, null);
  assert.equal(ctx.net_type, null);
  assert.equal(ctx.conn_type, null);
  assert.equal(ctx.native, null);
  assert.equal(ctx.browser_major, null);
  assert.deepEqual(ctx.ff, { ok: false, fine: true }, 'only true is true, and only plain keys');
  assert.equal(ctx.webview_app.length, 32);
});

test('a bare or hostile global costs nothing', () => {
  const bare = readSessionContext({}, {});
  assert.equal(bare.tz, null);
  assert.equal(bare.vw, null);
  assert.equal(bare.scheme, 'light');
  assert.deepEqual(bare.langs, []);
  const throwing = new Proxy({}, { get() { throw new Error('denied'); } });
  assert.doesNotThrow(() => readSessionContext(throwing, {}));
  assert.doesNotThrow(() => readSessionContext(fakeWindow({ matchMedia: () => { throw new Error('x'); } }), {}));
});

test('every value is a primitive, a short list of codes, or the flags', () => {
  const ctx = readSessionContext(fakeWindow({ meta: 'r=GB-ENG;n=edu' }), { now: NOW, flags: { a: true } });
  for (const [k, v] of Object.entries(ctx)) {
    if (k === 'langs') { assert.ok(Array.isArray(v) && v.length <= 3); continue; }
    if (k === 'ff') { assert.ok(Object.values(v).every((b) => typeof b === 'boolean')); continue; }
    assert.ok(v === null || ['string', 'number', 'boolean'].includes(typeof v), k);
    if (typeof v === 'string') assert.ok(v.length <= 48, k);
  }
  for (const banned of ['ua', 'user_agent', 'city', 'org', 'asn', 'ip', 'gpu', 'fonts']) {
    assert.ok(!(banned in ctx), banned);
  }
});

test('the browser major follows the browser device.js names', () => {
  const cases = [
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36', 130],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/129.0.0.0', 129],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1', 131],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1', 18],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:132.0) Gecko/20100101 Firefox/132.0', 132],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 OPR/114.0.0.0', 114],
    ['', null], [undefined, null], ['Mozilla/5.0 (X11; Linux x86_64)', null],
  ];
  for (const [ua, want] of cases) assert.equal(browserMajor(ua), want, String(ua).slice(0, 60));
});

test('a context row is due once per app session, on a row of real activity', () => {
  assert.equal(contextDue({ app_session_id: 's1', event: 'app_open' }, null), true);
  assert.equal(contextDue({ app_session_id: 's1', event: 'card_placed' }, 's1'), false, 'already sent');
  assert.equal(contextDue({ app_session_id: 's2', event: 'card_placed' }, 's1'), true, 'a new session');
  for (const event of ['session_context', 'session_summary', 'telemetry_drop']) {
    assert.equal(contextDue({ app_session_id: 's3', event }, 's1'), false, event);
  }
  assert.equal(contextDue({ event: 'app_open' }, null), false);
  assert.equal(contextDue(null, null), false);
});

test('analytics.js sends it from enqueue, once, with the holds and the webview', () => {
  const src = readFileSync(new URL('./analytics.js', import.meta.url), 'utf8');
  const enqueue = src.slice(src.indexOf('function enqueue(row) {'), src.indexOf('let ctxSentFor;'));
  assert.match(enqueue, /sendContextIfDue\(row\);\n\}/, 'enqueue ends by offering the row');
  const send = src.slice(src.indexOf('function sendContextIfDue(row) {'));
  assert.match(send, /if \(!contextDue\(row, ctxSentFor\)\) return;\s*ctxSentFor = row\.app_session_id;/,
    'marked sent before the row is built, so the context row cannot call for another');
  assert.match(send, /localStorage\.setItem\(CTX_SENT_KEY, ctxSentFor\)/);
  assert.match(send, /readSessionContext\(window, \{ flags: featureFlags\(\), webview: getWebviewInfo\(\) \}\)/);
  assert.match(send, /const ctxRow = buildRow\(EV\.SESSION_CONTEXT, props\);\s*enqueue\(ctxRow\);/);
  assert.equal(CTX_SENT_KEY, 'soleil_ctx_session');
});

test('a session that started on / asks the Worker, only on our own web hosts, through the same reader', () => {
  const src = readFileSync(new URL('./analytics.js', import.meta.url), 'utf8');
  assert.match(src, /if \(!props\.edge_src && \(onProdHost\(\) \|\| onPreviewHost\(\)\)\) fillEdgeContext\(ctxRow\);/,
    'never from dev or the native shells, and never when the tag was there');
  const fill = src.slice(src.indexOf('function fillEdgeContext(ctxRow) {'));
  assert.match(fill, /fetch\('\/api\/ctx', \{ cache: 'no-store', credentials: 'omit'/);
  assert.match(fill, /const edge = parseEdgeContext\(text\);/, 'the answer passes the same checks as the tag');
  assert.match(fill, /Object\.assign\(ctxRow\.props, edge, \{ edge_src: 'api' \}\)/);
});

test('every hold in appHost.js is read into ff', () => {
  const src = readFileSync(new URL('./appHost.js', import.meta.url), 'utf8');
  const holds = [...src.matchAll(/^export function (\w+Allowed)\(/gm)].map((m) => m[1]);
  assert.ok(holds.length >= 10, `found ${holds.length} holds — the scan is broken`);
  const body = src.slice(src.indexOf('export function featureFlags() {'));
  const missing = holds.filter((h) => !new RegExp(`:\\s*${h},`).test(body));
  assert.deepEqual(missing, [], `featureFlags() does not read ${missing.join(', ')}: add it so session_context says when it was on`);
});
