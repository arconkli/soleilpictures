// indexCoverage.test.mjs — 0480: Google's own verdict on every sitemap page,
// IndexNow on every new production build, and a canonical for each .md mirror.
//
//   node --test src/lib/indexCoverage.test.mjs
//
// The 2026-10-20 SEO/AEO sweep found a third of the marketing pages sitting out
// of Google ("Discovered - currently not indexed") with nothing saying so, and
// Bing hearing about a change only when someone pressed the admin IndexNow
// button. This file pins the diff that decides what a build announces, the
// ping's bookkeeping against a stubbed Supabase and IndexNow, the scoping of the
// new alerts in the latest check_discovery_pipelines(), and the _headers rule
// that points every .md mirror at its page.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { indexNowDiff, runIndexNowForBuild } from '../worker-seo.js';
import { MIGRATIONS_DIR, latestDefinition } from './migrationText.mjs';
import { SEO_LANDING_PATHS } from './seoLanding.js';
import { SEO_LISTICLE_INDEX } from './seoListicleIndex.js';
import { DOCS_PATHS } from './docsiteIndex.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const BOARDS = resolve(HERE, '../..');
const read = (p) => readFileSync(resolve(BOARDS, p), 'utf8');
const ORIGIN = 'https://clusters.soleilpictures.com';

const FILE = '0480_index_coverage_and_indexnow.sql';
const mig = readFileSync(join(MIGRATIONS_DIR, FILE), 'utf8');
const def = latestDefinition('check_discovery_pipelines');

// ── indexNowDiff ─────────────────────────────────────────────────────────────

const e = (loc, lastmod) => ({ loc: `${ORIGIN}${loc}`, lastmod });

test('the first ping announces the whole sitemap, in sitemap order', () => {
  const { lastmods, changed } = indexNowDiff(null, [e('/', '2026-10-02'), e('/pricing'), e('/vs/pureref', '2026-10-18')]);
  assert.deepEqual(changed, [`${ORIGIN}/`, `${ORIGIN}/pricing`, `${ORIGIN}/vs/pureref`]);
  assert.deepEqual(lastmods, { [`${ORIGIN}/`]: '2026-10-02', [`${ORIGIN}/pricing`]: null, [`${ORIGIN}/vs/pureref`]: '2026-10-18' });
});

test('a later ping announces only new pages and moved lastmods', () => {
  const prev = { [`${ORIGIN}/`]: '2026-10-02', [`${ORIGIN}/pricing`]: null, [`${ORIGIN}/vs/pureref`]: '2026-10-18',
                 [`${ORIGIN}/vs/gone`]: '2026-09-01' };
  const { changed } = indexNowDiff(prev, [
    e('/', '2026-10-02'),                     // unchanged
    e('/pricing'),                            // null then, null now: unchanged
    e('/vs/pureref', '2026-10-20'),           // moved
    e('/tools/video-reference-board', '2026-10-20'),   // new
  ]);
  assert.deepEqual(changed, [`${ORIGIN}/vs/pureref`, `${ORIGIN}/tools/video-reference-board`],
    'a page that left the sitemap is not announced');
});

test('a page that gains a lastmod counts as moved; entries without a loc are dropped', () => {
  const { lastmods, changed } = indexNowDiff({ [`${ORIGIN}/pricing`]: null }, [e('/pricing', '2026-10-20'), { lastmod: 'x' }, null]);
  assert.deepEqual(changed, [`${ORIGIN}/pricing`]);
  assert.deepEqual(Object.keys(lastmods), [`${ORIGIN}/pricing`]);
});

// ── runIndexNowForBuild, against a stubbed fetch ─────────────────────────────

const ENV = { SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_ROLE_KEY: 'service' };
const SHA = 'c6915e8';
const ENTRIES = [e('/', '2026-10-02'), e('/vs/pureref', '2026-10-20')];

// mine: this build's earlier rows. base: the newest ok row's map, or null.
// indexnow: an HTTP status, or an Error to throw.
async function ping({ mine = [], base = null, indexnow = 200, build = { sha: SHA, date: '2026-10-20' }, env = ENV } = {}) {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const call = { url: u, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null };
    calls.push(call);
    const ok = (body, status = 200) => new Response(body == null ? null : JSON.stringify(body), { status });
    if (u.startsWith('https://api.indexnow.org/')) {
      if (indexnow instanceof Error) throw indexnow;
      return new Response(null, { status: indexnow });
    }
    if (u === `${ENV.SUPABASE_URL}/rest/v1/indexnow_pings` && call.method === 'POST') return ok(null, 201);
    if (u.includes('/rest/v1/indexnow_pings?build_sha=eq.')) return ok(mine);
    if (u.includes('/rest/v1/indexnow_pings?ok=is.true')) return ok(base ? [{ lastmods: base }] : []);
    throw new Error(`unexpected fetch ${u}`);
  };
  try {
    await runIndexNowForBuild(env, build, async () => ENTRIES);
  } finally {
    globalThis.fetch = real;
  }
  return {
    calls,
    submitted: calls.find((c) => c.url.startsWith('https://api.indexnow.org/'))?.body ?? null,
    row: calls.find((c) => c.method === 'POST' && c.url.endsWith('/rest/v1/indexnow_pings'))?.body ?? null,
  };
}

test('an unstamped build, or a Worker without the service key, never pings', async () => {
  for (const sha of ['dev', 'unknown', '', 'C6915E8; drop']) {
    assert.equal((await ping({ build: { sha } })).calls.length, 0, `sha ${JSON.stringify(sha)}`);
  }
  assert.equal((await ping({ env: { SUPABASE_URL: ENV.SUPABASE_URL } })).calls.length, 0);
});

test('the first build pings the whole sitemap and stores the map it announced', async () => {
  const { submitted, row } = await ping();
  assert.deepEqual(submitted.urlList, ENTRIES.map((x) => x.loc));
  assert.equal(submitted.host, 'clusters.soleilpictures.com');
  assert.match(submitted.keyLocation, /^https:\/\/clusters\.soleilpictures\.com\/[0-9a-f]{32}\.txt$/);
  assert.equal(row.build_sha, SHA);
  assert.equal(row.build_date, '2026-10-20');
  assert.equal(row.ok, true);
  assert.equal(row.status, 200);
  assert.equal(row.sent, 2);
  assert.deepEqual(row.lastmods, { [`${ORIGIN}/`]: '2026-10-02', [`${ORIGIN}/vs/pureref`]: '2026-10-20' });
});

test('a later build pings only what moved since the last successful ping', async () => {
  const { submitted, row } = await ping({ base: { [`${ORIGIN}/`]: '2026-10-02', [`${ORIGIN}/vs/pureref`]: '2026-10-18' } });
  assert.deepEqual(submitted.urlList, [`${ORIGIN}/vs/pureref`]);
  assert.equal(row.sent, 1);
  assert.deepEqual(Object.keys(row.lastmods), ENTRIES.map((x) => x.loc), 'the stored map is the whole sitemap');
});

test('202 is a success: IndexNow received the list and has yet to check the key', async () => {
  assert.equal((await ping({ indexnow: 202 })).row.ok, true);
});

test('a refused or failed ping is recorded without a map, so the next build still diffs against the last good one', async () => {
  const refused = await ping({ indexnow: 403 });
  assert.equal(refused.row.ok, false);
  assert.equal(refused.row.status, 403);
  assert.equal(refused.row.lastmods, undefined);
  const down = await ping({ indexnow: new Error('network down') });
  assert.equal(down.row.ok, false);
  assert.match(down.row.error, /network down/);
  assert.equal(down.row.lastmods, undefined);
});

test('a build that already landed, or has used its three attempts, is left alone', async () => {
  for (const mine of [[{ ok: true }], [{ ok: false }, { ok: false }, { ok: false }]]) {
    const { submitted, row } = await ping({ mine });
    assert.equal(submitted, null);
    assert.equal(row, null);
  }
  assert.notEqual((await ping({ mine: [{ ok: false }, { ok: false }] })).submitted, null, 'a third attempt still runs');
});

test('a build that moved nothing records a success without calling IndexNow', async () => {
  const base = { [`${ORIGIN}/`]: '2026-10-02', [`${ORIGIN}/vs/pureref`]: '2026-10-20' };
  const { submitted, row } = await ping({ base });
  assert.equal(submitted, null);
  assert.equal(row.ok, true);
  assert.equal(row.sent, 0);
  assert.deepEqual(row.lastmods, base);
});

test('a build date that is not a date is stored as null rather than failing the insert', async () => {
  assert.equal((await ping({ build: { sha: SHA, date: 'dev' } })).row.build_date, null);
});

// ── 0480: tables, grants, cron ──────────────────────────────────────────────

test('both tables are service-role only, and the migration proves it', () => {
  for (const t of ['seo_index_status', 'indexnow_pings']) {
    assert.match(mig, new RegExp(`alter table public\\.${t}\\s+enable row level security`), `${t} has RLS on`);
  }
  assert.match(mig, /revoke all on public\.seo_index_status, public\.indexnow_pings from public, anon, authenticated;/);
  assert.doesNotMatch(mig, /create policy/i, 'no policy: nothing but the service role reads or writes either table');
  assert.match(mig, /has_table_privilege\('anon', 'public\.' \|\| t, 'select'\)/);
  assert.match(mig, /has_table_privilege\('authenticated', 'public\.' \|\| t, 'insert'\)/);
  assert.match(mig, /relrowsecurity/);
});

test('check_discovery_pipelines keeps its ACL: no drop, the revoke restated, the grant proven', () => {
  assert.doesNotMatch(mig, /drop\s+function/i);
  assert.match(mig, /revoke execute on function public\.check_discovery_pipelines\(\) from public, anon, authenticated;/);
  assert.match(mig, /has_function_privilege\('anon', 'public\.check_discovery_pipelines\(\)', 'execute'\)/);
  assert.match(mig, /has_function_privilege\('authenticated', 'public\.check_discovery_pipelines\(\)', 'execute'\)/);
});

test('the inspection runs daily between the performance sync and the morning check', () => {
  assert.match(mig, /cron\.schedule\('gsc-inspect-daily', '30 6 \* \* \*',\s*\$\$select public\._cron_edge_post\('gsc-sync', jsonb_build_object\('trigger', 'cron', 'mode', 'inspect'\)\)\$\$\)/);
  assert.match(mig, /jobname = 'gsc-inspect-daily'/, 'and the proof checks the job exists');
});

// ── 0480: the alerts ────────────────────────────────────────────────────────

const NEW_ALERTS = ['Index coverage check stale', 'Index coverage check failing', 'Google de-indexed a page',
                    'Pages not indexed after 14 days', 'IndexNow failing'];

test('the live body is 0480’s, and every new alert is raised under a fixed name', () => {
  assert.equal(def.file, FILE);
  // admin_markers (0372) folds re-fires by name: a page or a count in the name
  // would make every morning a new marker.
  const literals = [...def.body.matchAll(/_discovery_alert\('([^']+)',/g)].map((m) => m[1]);
  for (const name of NEW_ALERTS) assert.ok(literals.includes(name), `"${name}" is the literal first argument`);
});

const section = (from, to) => {
  const a = def.body.indexOf(from), b = def.body.indexOf(to, a + 1);
  assert.ok(a > 0 && b > a, `section ${from} … ${to}`);
  return def.body.slice(a, b);
};

test('a failing or stale instrument never reads as pages leaving Google', () => {
  const body = def.body;
  assert.match(body, /v_ix_day is null or v_ix_day < current_date - 2/);
  assert.match(body, /v_ix\.failed \* 2 >= v_ix\.n/);
  assert.ok(body.indexOf("'Index coverage check failing'") < body.indexOf("'Google de-indexed a page'"),
    'the page alerts sit in the branch after the health checks');
  const gone = section("'Index coverage check failing'", "'Google de-indexed a page'");
  const streak = section("'Google de-indexed a page'", "'Pages not indexed after 14 days'");
  for (const [label, s] of [['de-indexed', gone], ['14 days', streak]]) {
    assert.match(s, /error is null/, `${label}: an errored inspection has no verdict and is skipped`);
  }
  assert.match(gone, /verdict is distinct from 'PASS'/, 'PASS is the only verdict that means indexed');
  assert.match(gone, /p\.verdict = 'PASS'\s+and p\.day between v_ix_day - 7 and v_ix_day - 1/, 'indexed within the past week');
  assert.match(streak, /min\(rn\) filter \(where verdict = 'PASS'\)/);
  assert.match(streak, /days_out = 14 and last_day = v_ix_day/, 'raised on the fourteenth day only');
});

test('the impressions that widen the de-index alert are page-level web rows', () => {
  const gone = section("'Index coverage check failing'", "'Google de-indexed a page'");
  assert.match(gone, /from public\.seo_page_daily d\s+where d\.path = s\.path and d\.query = '' and d\.search_type = 'web'/);
});

test('page lists lead with their count: _discovery_alert keeps 500 characters', () => {
  assert.match(def.body, /v_cnt \|\| ' page\(s\) Google had on its index/);
  assert.match(def.body, /v_cnt \|\| ' marketing page\(s\) still off Google/);
});

test('IndexNow failing means a recent build used all three attempts without one landing', () => {
  const s = def.body.slice(def.body.indexOf('from public.indexnow_pings p'));
  assert.match(s, /pinged_at > now\(\) - interval '7 days'/);
  assert.match(s, /not exists \(select 1 from public\.indexnow_pings p where p\.build_sha = v_ping\.build_sha and p\.ok\)/);
  assert.match(s, /where p\.build_sha = v_ping\.build_sha\) >= 3/);
});

// ── gsc-sync {mode: 'inspect'} ───────────────────────────────────────────────

const gsc = readFileSync(resolve(BOARDS, '../supabase/functions/gsc-sync/index.ts'), 'utf8');

test('gsc-sync inspects every sitemap URL and writes one row per path and day', () => {
  assert.match(gsc, /opts\.mode === 'inspect'/);
  assert.match(gsc, /searchconsole\.googleapis\.com\/v1\/urlInspection\/index:inspect/);
  assert.match(gsc, /upsert\('seo_index_status', 'path,day'/);
  assert.match(gsc, /\/sitemap\.xml`, \{\s*headers: \{ 'x-soleil-probe': '1' \}/, 'the sitemap read stays out of crawler_hits');
});

test('every inspection row carries every column, so PostgREST accepts the bulk upsert', () => {
  const cols = mig.match(/create table if not exists public\.seo_index_status \(([\s\S]*?)primary key/)[1]
    .split('\n').map((l) => l.trim().split(/\s+/)[0]).filter(Boolean);
  const noResult = gsc.match(/const NO_RESULT = \{([\s\S]*?)\};/)[1];
  const keys = [...noResult.matchAll(/(\w+):/g)].map((m) => m[1]);
  assert.deepEqual([...new Set([...keys, 'path', 'day', 'checked_at'])].sort(), [...cols].sort());
});

// ── the Worker ──────────────────────────────────────────────────────────────

test('the hourly cron pings for the running build, from the same list the sitemap serves', () => {
  const worker = read('src/worker.js');
  assert.match(worker, /runIndexNowForBuild\(env, \{ sha: BUILD_SHA, date: BUILD_DATE \}, \(\) => sitemapUrls\(env\)\)/);
  const tick = worker.slice(worker.indexOf("'15 * * * *'"), worker.indexOf("'15 * * * *'") + 2000);
  assert.match(tick, /runIndexNowForBuild/, 'inside the :15 branch');
  assert.match(worker, /async function handleSitemap\(env, request\) \{\s*const urls = await sitemapUrls\(env\);/);
});

// ── .md mirrors: one canonical each ─────────────────────────────────────────

const headers = read('public/_headers');

test('every .md mirror names its page as canonical, and only one rule sets Link', () => {
  assert.match(headers, /^\/\*\.md\n  Link: <https:\/\/clusters\.soleilpictures\.com\/:splat>; rel="canonical"$/m);
  assert.match(headers, /^\/docs\/index\.md\n  ! Link$/m, 'the docs hub mirror detaches it: its page is /docs');
  // Two rules setting Link are joined into one header naming two canonicals.
  assert.equal(headers.split('\n').filter((l) => /^\s+Link:/i.test(l)).length, 1);
});

test(':splat is the page path for every mirror gen-docs writes, the docs hub excepted', () => {
  const pages = new Set([...SEO_LANDING_PATHS, ...SEO_LISTICLE_INDEX.map((p) => p.path), ...DOCS_PATHS, '/pricing', '/changelog']);
  const pub = resolve(BOARDS, 'public');
  const walk = (d) => readdirSync(d).flatMap((f) => {
    const p = join(d, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
  const mirrors = walk(pub).filter((p) => p.endsWith('.md')).map((p) => p.slice(pub.length));
  assert.ok(mirrors.length > 50, 'the mirrors are there');
  const orphans = mirrors.filter((m) => m !== '/docs/index.md' && !pages.has(m.slice(0, -3)));
  assert.deepEqual(orphans, [], 'a mirror whose path minus .md is not a page would name a 404 as canonical');
});
