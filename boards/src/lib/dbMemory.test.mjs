// The database memory watch: reading the metrics text, judging two readings,
// and the Worker job around them (worker-dbmemory.js). Figures are as
// Supabase's metrics endpoint served them.
//
// Run: node --test src/lib/dbMemory.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { alertText, judge, parseReading, rates } from './dbMemory.js';
import { runDbMemoryWatch } from '../worker-dbmemory.js';

const L = '{supabase_project_ref="ref",supabase_identifier="ref",service_type="db"}';
function metrics(v) {
  return [
    '# HELP node_cpu_seconds_total Seconds the CPUs spent in each mode.',
    '# TYPE node_cpu_seconds_total counter',
    `node_cpu_seconds_total{cpu="0",mode="idle",supabase_project_ref="ref"} 123456.78`,
    '# HELP node_memory_MemTotal_bytes Memory information field MemTotal_bytes.',
    '# TYPE node_memory_MemTotal_bytes gauge',
    `node_memory_MemTotal_bytes${L} ${v.mt}`,
    `node_memory_MemAvailable_bytes${L} ${v.ma}`,
    `node_memory_MemFree_bytes${L} 1.2e+07`,
    `node_memory_SwapTotal_bytes${L} ${v.st}`,
    `node_memory_SwapFree_bytes${L} ${v.sf}`,
    '# TYPE node_vmstat_pswpin untyped',
    `node_vmstat_pswpin${L} ${v.in}`,
    `node_vmstat_pswpout${L} ${v.out}`,
    `node_vmstat_pgmajfault${L} ${v.mf}`,
    `node_vmstat_pgfault ${v.mf * 90}`,
    '',
  ].join('\n');
}

const MICRO = { mt: '9.48195328e+08', ma: '2.63667712e+08', st: '1.073737728e+09', sf: '5.18057984e+08', in: 411570, out: 507222, mf: 712213 };
const SMALL = { mt: '1.924182016e+09', ma: '1.434955776e+09', st: '1.073737728e+09', sf: '1.073737728e+09', in: 0, out: 0, mf: 3362 };

test('the micro server after its restart is read exactly, and is fine', () => {
  const r = parseReading(metrics(MICRO));
  assert.deepEqual(r, {
    mem_total: 948195328, mem_available: 263667712, swap_total: 1073737728, swap_free: 518057984,
    pswpin: 411570, pswpout: 507222, pgmajfault: 712213,
  });
  assert.equal(judge(null, r).verdict, 'ok');
});

test('the small server is fine', () => {
  const r = parseReading(metrics(SMALL));
  assert.equal(r.mem_total, 1924182016);
  assert.equal(r.pgmajfault, 3362);
  assert.equal(judge(null, r).verdict, 'ok');
});

const reading = (availPct, swapUsedPct, extra = {}) => ({
  mem_total: 1_000_000_000, mem_available: availPct * 10_000_000,
  swap_total: 1_000_000_000, swap_free: (100 - swapUsedPct) * 10_000_000,
  pswpin: 100, pswpout: 100, pgmajfault: 100, ...extra,
});
const prevOf = (r, age_s = 300) => ({ ...r, age_s });

test('short needs two readings in a row, or one that could not be stored', () => {
  const bad = reading(5, 70);
  const healthy = reading(40, 0);
  assert.equal(judge(prevOf(bad), bad).verdict, 'short');
  assert.equal(judge(prevOf(healthy), bad).verdict, 'ok');
  assert.equal(judge(null, bad).verdict, 'ok');
  assert.equal(judge(null, bad, { recorded: false }).verdict, 'short');
  assert.equal(judge(null, healthy, { recorded: false }).verdict, 'ok');
});

test('a server with no swap is short on available memory alone', () => {
  const noSwap = (availPct) => reading(availPct, 0, { swap_total: 0, swap_free: 0 });
  const bad = noSwap(5);
  assert.equal(judge(prevOf(bad), bad).verdict, 'short');
  assert.equal(judge(prevOf(noSwap(50)), noSwap(50)).verdict, 'ok');
  const text = metrics({ mt: 1e9, ma: 5e7, st: 0, sf: 0, in: 0, out: 0, mf: 0 })
    .split('\n').filter((l) => !l.includes('Swap')).join('\n');
  const parsed = parseReading(text);
  assert.equal(judge(prevOf(parsed), parsed).verdict, 'short');
});

test('thrash comes from swap-in or major-fault rates', () => {
  const base = reading(40, 0);
  const swap = judge(prevOf(base), { ...base, pswpin: base.pswpin + 120000 });
  assert.equal(swap.verdict, 'thrash');
  assert.equal(swap.swapInPerSec, 400);
  const fault = judge(prevOf(base), { ...base, pgmajfault: base.pgmajfault + 360000 });
  assert.equal(fault.verdict, 'thrash');
  assert.equal(fault.majfltPerSec, 1200);
});

test('rates need readings 60 s to 20 min apart and counters that only went up', () => {
  const base = reading(40, 0);
  const big = { ...base, pswpin: base.pswpin + 120000 };
  assert.equal(rates(prevOf(base, 30), big), null);
  assert.equal(rates(prevOf(base, 3600), big), null);
  assert.equal(judge(prevOf(base, 30), big).verdict, 'ok');
  // The server restarted: counters start again from zero. Not thrash.
  const restarted = judge(prevOf({ ...base, pswpin: 900000 }), { ...base, pswpin: 5 });
  assert.equal(restarted.verdict, 'ok');
  assert.equal(restarted.swapInPerSec, null);
  assert.equal(rates(null, base), null);
});

test('text without memory figures is null, and nothing throws', () => {
  const noTotal = metrics(MICRO).split('\n').filter((l) => !l.startsWith('node_memory_MemTotal_bytes')).join('\n');
  assert.equal(parseReading(noTotal), null);
  assert.equal(parseReading('this is not metrics at all {{{'), null);
  for (const v of ['', null, undefined, 42, {}, '\0\0']) assert.equal(parseReading(v), null);
  const partial = parseReading('node_memory_MemTotal_bytes 100\nnode_memory_MemAvailable_bytes 50\n');
  assert.equal(partial.swap_total, null);
  assert.equal(judge(null, partial).verdict, 'ok');
});

test('the alert says what is short, in plain words', () => {
  const bad = reading(5, 70);
  const a = alertText(judge(prevOf(bad), bad), bad);
  assert.equal(a.title, 'Database memory is running out');
  assert.match(a.body, /Free memory: 5% \(48 MB of 954 MB\)/);
  assert.match(a.body, /Swap used: 70%/);
  assert.match(a.body, /The 17 Nov 2026 restart came after hours like this\./);
  const t = judge(prevOf(bad), { ...bad, pswpin: bad.pswpin + 120000 });
  const b = alertText(t, bad);
  assert.equal(b.title, 'Database is swapping hard');
  assert.match(b.body, /Swap-in: 400 pages\/s/);
});

// ── The job ─────────────────────────────────────────────────────────────────

const ENV = { SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_ROLE_KEY: 'svc' };

// A fake fetch for the job, and a fake global fetch for jobFailed's own write.
function world({ text, status = 200, prev = null, recordStatus = 200, raiseStatus = 200 }) {
  const log = [];
  const fetchImpl = async (url, init = {}) => {
    const path = new URL(url).pathname;
    log.push({ path, method: init.method || 'GET', headers: init.headers, body: init.body ? JSON.parse(init.body) : null });
    if (path === '/customer/v1/privileged/metrics') return new Response(status === 200 ? text : 'no', { status });
    if (path === '/rest/v1/rpc/db_memory_record') {
      return recordStatus === 200 ? new Response(JSON.stringify(prev), { status: 200 }) : new Response('boom', { status: recordStatus });
    }
    if (path === '/rest/v1/rpc/ops_alert_raise') return new Response(raiseStatus === 200 ? '"id"' : 'boom', { status: raiseStatus });
    throw new Error('unexpected ' + path);
  };
  return { log, fetchImpl };
}

async function withGlobalFetch(fn) {
  const real = globalThis.fetch;
  const errors = [];
  globalThis.fetch = async (url, init = {}) => {
    errors.push({ url: String(url), body: init.body ? JSON.parse(init.body) : null });
    return new Response(null, { status: 201 });
  };
  const realLog = console.error;
  console.error = () => {};
  try { return await fn(errors); } finally { globalThis.fetch = real; console.error = realLog; }
}

const SHORT = { mt: 1e9, ma: 5e7, st: 1e9, sf: 3e8, in: 10, out: 10, mf: 10 };
const shortPrev = { age_s: 300, mem_total: 1e9, mem_available: 5e7, swap_total: 1e9, swap_free: 3e8, pswpin: 10, pswpout: 10, pgmajfault: 10 };

test('a healthy reading is read and stored, and nothing is raised', async () => {
  const w = world({ text: metrics(SMALL) });
  const j = await runDbMemoryWatch(ENV, { fetchImpl: w.fetchImpl });
  assert.equal(j.verdict, 'ok');
  assert.deepEqual(w.log.map((c) => `${c.method} ${c.path}`), ['GET /customer/v1/privileged/metrics', 'POST /rest/v1/rpc/db_memory_record']);
  assert.equal(w.log[0].headers.authorization, 'Basic ' + btoa('service_role:svc'));
  assert.equal(w.log[1].body.p.mem_total, 1924182016);
});

test('short twice in a row raises one page', async () => {
  const w = world({ text: metrics(SHORT), prev: shortPrev });
  const j = await runDbMemoryWatch(ENV, { fetchImpl: w.fetchImpl });
  assert.equal(j.verdict, 'short');
  const raises = w.log.filter((c) => c.path.endsWith('ops_alert_raise'));
  assert.equal(raises.length, 1);
  assert.equal(raises[0].body.p_page, true);
  assert.equal(raises[0].body.p_dedupe_key, 'db_memory');
  assert.equal(raises[0].body.p_kind, 'db_memory');
  assert.equal(raises[0].body.p_title, 'Database memory is running out');
});

test('when the reading cannot be stored while memory is short, it still pages', async () => {
  await withGlobalFetch(async (errors) => {
    const w = world({ text: metrics(SHORT), recordStatus: 500 });
    const j = await runDbMemoryWatch(ENV, { fetchImpl: w.fetchImpl });
    assert.equal(j.verdict, 'short');
    assert.equal(w.log.filter((c) => c.path.endsWith('ops_alert_raise')).length, 1);
    assert.ok(errors.some((e) => e.url.endsWith('/client_errors')), 'the failed record is a row');
  });
});

test('when the metrics are refused, nothing is stored or raised and the failure is recorded', async () => {
  await withGlobalFetch(async (errors) => {
    const w = world({ text: '', status: 401 });
    assert.equal(await runDbMemoryWatch(ENV, { fetchImpl: w.fetchImpl }), null);
    assert.equal(w.log.length, 1);
    const row = errors.find((e) => e.url.endsWith('/client_errors'));
    assert.ok(row, 'a client_errors row was written');
    assert.match(JSON.stringify(row.body), /db_memory/);
  });
});

test('metrics with no memory figures, no service role, and a throwing fetch never throw', async () => {
  await withGlobalFetch(async () => {
    const w = world({ text: 'nothing here' });
    assert.equal(await runDbMemoryWatch(ENV, { fetchImpl: w.fetchImpl }), null);
    assert.equal(w.log.length, 1);
    assert.equal(await runDbMemoryWatch({}, { fetchImpl: w.fetchImpl }), null);
    assert.equal(await runDbMemoryWatch(ENV, { fetchImpl: async () => { throw new Error('offline'); } }), null);
    assert.equal(await runDbMemoryWatch(undefined, { fetchImpl: w.fetchImpl }), null);
  });
});

test('the cron runs it every fifth minute, and picture embedding only when worth it', () => {
  const worker = readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
  assert.match(worker, /minute % 5 === 0\) \{\s*ctx\.waitUntil\(watch\('db_memory', runDbMemoryWatch\(env\)\)\);/);
  assert.match(worker, /minute % 10 === 0 \|\| r\?\.claimed > 0 \|\| embedLaneFull\)\) return null;\s*embedLaneFull = false;[^\n]*\s*const result = await runImageEmbedLane\(env\);\s*embedLaneFull = \(result\?\.due \?\? 0\) >= IMAGE_EMBED_LANE_LIMIT;/);
  assert.match(worker, /^let embedLaneFull = false;/m);
  assert.match(worker, /if \(minute % 2 === 0\) \{\s*ctx\.waitUntil\(watch\('image_describe', runImageDescribe\(env\)/);
});
