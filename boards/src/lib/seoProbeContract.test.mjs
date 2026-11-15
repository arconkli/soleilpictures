// seoProbeContract.test.mjs — the gate that keeps the SEO health strip honest.
//
//   node --test src/lib/seoProbeContract.test.mjs
//
// seo_health_expectations holds live production assertions about strings that
// live in THIS repo. Nothing used to check that direction, so a copy edit could
// invalidate a health check and the only signal was a red strip six hours later
// blaming the AI crawlers. See the header of seoProbeContract.js for the
// incident this is built from.
//
// This test resolves each contract row to the artifact the Worker actually
// serves for that URL and asserts the string is still in it. It is the same
// property docsite.test.mjs enforces for the docs surface, pointed at the
// prober instead: a stale assertion is a FAILING TEST, not a red dashboard.
//
// IF THIS GOES RED: you rewrote prose a production health check asserts on.
// Either put the words back, or update that row in seo_health_expectations —
// the live check stays red until you do. Deleting the contract row is not a
// fix; it just restores the blind spot.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SEO_PROBE_CONTRACT, SEO_PROBE_UNPINNABLE, SEO_PROBE_UNWATCHED, PROBE_ORIGIN } from './seoProbeContract.js';
import { CHANGELOG_HTML } from './changelogCrawlable.js';
import { docsHtmlAsset, docsHtmlFrom } from './docsiteHtml.js';
import { buildListicleCrawlableHtml } from './seoListicleHtml.js';
import { getListicleSpec, SEO_LISTICLE_PAGES, SEO_LISTICLE_PATHS } from './seoListicles.js';
import { getLandingSpec, SEO_LANDING_PAGES, SEO_LANDING_LISTED, SEO_LANDING_PATHS } from './seoLanding.js';
import { buildPricingCrawlableHtml } from './pricingCrawlable.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const BOARDS = resolve(HERE, '../..');
const read = (p) => readFileSync(resolve(BOARDS, p), 'utf8');

// Every route the sitemap is expected to carry. `/changelog` is not in either
// registry — it is a hand-written branch in worker.js — so it is added here.
const ROUTES = [...SEO_LANDING_PATHS, ...SEO_LISTICLE_PATHS, '/changelog'];

// The search pages production answers 200 for: what the sitemap lists. A held
// page (the template store) has a spec and still 404s, so it is not here.
const LISTED = new Set([...SEO_LANDING_LISTED.map((p) => p.path), ...SEO_LISTICLE_PATHS]);

// The DB row's kind. Every row was 'body' before 0883, so that is the default.
const kindOf = (row) => row.kind || 'body';

// Resolve a contract row to the bytes a crawler receives for its URL. Each arm
// is the SAME builder the Worker calls, not a copy of it — a test against a
// reimplementation would pass while production served something else.
function resolveSource(source) {
  switch (source.kind) {
    case 'changelog':
      // worker.js: .on('main#seo-fallback', new SetInnerHtml(CHANGELOG_HTML))
      return { text: CHANGELOG_HTML, what: 'the changelog crawlable HTML (src/lib/changelogCrawlable.js)' };
    case 'listicle': {
      const spec = getListicleSpec(source.path);
      assert.ok(spec, `no listicle spec for ${source.path} — the page itself is gone`);
      return { text: buildListicleCrawlableHtml(spec), what: `the crawlable HTML for ${source.path}` };
    }
    case 'docs': {
      // worker.js readDocsHtml: the page's own file in the assets.
      const file = `public${docsHtmlAsset(source.path)}`;
      const html = existsSync(resolve(BOARDS, file)) && docsHtmlFrom(read(file), source.path);
      assert.ok(html, `no crawlable HTML for ${source.path} in ${file} — the page itself is gone`);
      return { text: html, what: `the crawlable HTML for ${source.path}` };
    }
    case 'pricing':
      // worker.js: .on('main#seo-fallback', new SetInnerHtml(PRICING_HTML))
      return { text: buildPricingCrawlableHtml(), what: 'the /pricing crawlable HTML (src/lib/pricingCrawlable.js)' };
    case 'file':
      return { text: read(source.path), what: `boards/${source.path}` };
    case 'route':
      return { text: ROUTES.join('\n'), what: 'the landing/listicle route registries' };
    case 'title': {
      // worker.js: .on('title', new SetText(spec.title)) for a landing page and
      // the same with the listicle spec for a /best page.
      const spec = getLandingSpec(source.path) || getListicleSpec(source.path);
      assert.ok(spec, `no landing or listicle spec for ${source.path} — the page itself is gone`);
      return { text: spec.title, what: `the title of ${source.path} (its spec's \`title\`)` };
    }
    case 'status':
      // The prober compares the HTTP status. Production answers 200 for a page
      // it lists and 404 for a spec that is retired or held.
      return {
        text: LISTED.has(source.path) ? '200' : '',
        what: `the pages production lists (SEO_LANDING_LISTED, SEO_LISTICLE_PATHS): ${source.path} is not one`,
      };
    default:
      throw new Error(`unknown contract source kind: ${source.kind}`);
  }
}

// ── The load-bearing one ────────────────────────────────────────────────────

test('every prober expectation still matches the source it asserts on', () => {
  assert.ok(SEO_PROBE_CONTRACT.length > 0, 'the contract is empty');

  for (const row of SEO_PROBE_CONTRACT) {
    const { text, what } = resolveSource(row.source);
    assert.ok(
      text.includes(row.expected),
      `seo_health_expectations id=${row.id} ("${row.check}") asserts a string that is no longer in ${what}.\n`
      + `  url:      ${PROBE_ORIGIN}${row.path}\n`
      + `  expected: ${JSON.stringify(row.expected)}\n`
      + '  The live health check is RED until this is reconciled. Either restore the text, or:\n'
      + `    update seo_health_expectations set expected = '<the new string>' where id = ${row.id};\n`
      + '  Do not delete the contract row — that only hides the next one.',
    );
  }
});

// ── The comparison is exact, so near-misses have to be caught here ──────────

test('expectations match case-sensitively, the way the prober compares them', () => {
  // seo-health/index.ts evaluates kind:'body' as `body.includes(expected)`.
  // That is what turned a headline being moved mid-sentence ("A tab…" ->
  // "…a tab…") into three red checks, so a case-insensitive match here would
  // pass while production went red. Assert the exact bytes, and say so if the
  // only thing wrong is capitalisation.
  for (const row of SEO_PROBE_CONTRACT) {
    const { text, what } = resolveSource(row.source);
    if (text.includes(row.expected)) continue;
    const loose = text.toLowerCase().includes(row.expected.toLowerCase());
    assert.fail(
      `seo_health_expectations id=${row.id} ("${row.check}"): ${JSON.stringify(row.expected)} is not in ${what}`
      + (loose
        ? '.\n  It IS present in a different case. The prober compares case-sensitively, so this is still a red check.'
        : '.'),
    );
  }
});

// ── The contract has to stay a faithful mirror ──────────────────────────────

test('contract rows are well-formed and unambiguous', () => {
  const ids = SEO_PROBE_CONTRACT.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length,
    `duplicate expectation id in the contract: ${ids.filter((id, i) => ids.indexOf(id) !== i).join(', ')}`);

  // An id here that is also declared unpinnable would be a lie in one of the
  // two places, and the reader has no way to tell which.
  for (const u of SEO_PROBE_UNPINNABLE) {
    assert.ok(!ids.includes(u.id), `id=${u.id} is both pinned and declared unpinnable`);
  }

  for (const row of SEO_PROBE_CONTRACT) {
    assert.ok(Number.isInteger(row.id) && row.id > 0, `bad id: ${row.id}`);
    assert.ok(row.check?.trim(), `id=${row.id}: no check_name`);
    assert.ok(row.path?.startsWith('/'), `id=${row.id}: path must be origin-relative`);
    assert.ok(row.expected?.trim(), `id=${row.id}: empty expected string`);
    // A one-word expectation is not evidence a crawler got the real page —
    // "Changelog" is in the <title> of a challenge page too.
    // A status row's expected IS the status code, so the length rule is for
    // the rows that assert words.
    if (kindOf(row) !== 'status') {
      assert.ok(row.expected.length >= 8, `id=${row.id}: ${JSON.stringify(row.expected)} is too short to prove anything`);
    }
    assert.ok(['body', 'title', 'status'].includes(kindOf(row)), `id=${row.id}: unknown kind ${row.kind}`);
    // A title or status row resolves against the page it is filed under.
    if (kindOf(row) !== 'body') {
      assert.equal(row.source.kind, kindOf(row), `id=${row.id}: a ${kindOf(row)} row needs a ${kindOf(row)} source`);
      assert.equal(row.source.path, row.path, `id=${row.id}: its source must be its own page`);
    }
    if (kindOf(row) === 'status') {
      assert.equal(row.expected, '200', `id=${row.id}: only "the page loads" (200) is mirrored here`);
    }
    if (kindOf(row) === 'title') {
      // The prober reads the <title> as served, where HTMLRewriter has escaped
      // & < > — "Simpler & Free" arrives as "Simpler &amp; Free". A typographic
      // apostrophe is one keystroke from a straight one in a retitle.
      assert.ok(!/[&<>'’]/.test(row.expected),
        `id=${row.id}: ${JSON.stringify(row.expected)} carries a character the served <title> escapes or a retitle swaps`);
    }
  }
});

// ── No search page ships unwatched ──────────────────────────────────────────

test('every landing and listicle page has a prober row or a stated reason', () => {
  // 0883 exists because twelve search pages had no row at all: a page could
  // 404 or be served the bare app shell and nothing would say so. A new spec
  // now needs a row in seo_health_expectations (a pinned-id migration of the
  // 0883 shape) mirrored in the contract, in the same commit.
  const watched = new Set(
    SEO_PROBE_CONTRACT.filter((r) => kindOf(r) !== 'body').map((r) => r.path),
  );
  const unwatched = new Map(SEO_PROBE_UNWATCHED.map((u) => [u.path, u]));

  for (const page of [...SEO_LANDING_PAGES, ...SEO_LISTICLE_PAGES]) {
    // A held page 404s in production on purpose (the template store), so a
    // 200 row for it would be red from the first run. It gets its rows the day
    // it is listed, and this test asks for them then.
    if (!LISTED.has(page.path)) continue;
    assert.ok(
      watched.has(page.path) || unwatched.has(page.path),
      `${page.path} has no row in seo_health_expectations: nothing watches it in production.\n`
      + '  Add a status row (200) and a title row in a migration that pins their ids (0883 is the shape),\n'
      + '  then mirror both in SEO_PROBE_CONTRACT (boards/src/lib/seoProbeContract.js).',
    );
  }

  for (const u of SEO_PROBE_UNWATCHED) {
    assert.ok(u.why?.trim(), `${u.path}: an unwatched page must say why`);
    assert.ok(LISTED.has(u.path), `${u.path} is declared unwatched but production does not list it — drop the entry`);
    assert.ok(!watched.has(u.path), `${u.path} is declared unwatched and has a row in the contract — drop the entry`);
  }
});

test('the thirteen pages of 0883 each carry a status row and a title row', () => {
  const added = SEO_PROBE_CONTRACT.filter((r) => r.id >= 86 && r.id <= 111);
  assert.equal(added.length, 26, '0883 pins ids 86 to 111');
  const byPath = new Map();
  for (const r of added) byPath.set(r.path, [...(byPath.get(r.path) || []), kindOf(r)]);
  assert.equal(byPath.size, 13);
  for (const [path, kinds] of byPath) {
    assert.deepEqual(kinds.sort(), ['status', 'title'], `${path}: one status row and one title row`);
  }
});

test('the contract and migration 0883 pin the same rows', () => {
  // The migration is what production gets; the contract is what this repo
  // checks. They are typed twice, so they are compared here.
  const sql = readFileSync(resolve(BOARDS, '../supabase/migrations/0883_seo_health_twelve_pages.sql'), 'utf8');
  const insert = sql.slice(sql.indexOf('from (values'), sql.indexOf(') as v(id, url, check_name, kind, expected)'));
  const pinned = [...insert.matchAll(/\(\s*(\d+),\s*'([^']+)',\s*'([^']+)',\s*'([^']+)',\s*'([^']+)'\)/g)]
    .map(([, id, url, check, kind, expected]) => ({ id: Number(id), url, check, kind, expected }));
  assert.equal(pinned.length, 26, 'could not read 26 rows out of 0883');
  for (const p of pinned) {
    const row = SEO_PROBE_CONTRACT.find((r) => r.id === p.id);
    assert.ok(row, `0883 pins id=${p.id} and the contract has no such row`);
    assert.deepEqual(
      { url: PROBE_ORIGIN + row.path, check: row.check, kind: kindOf(row), expected: row.expected },
      { url: p.url, check: p.check, kind: p.kind, expected: p.expected },
      `id=${p.id}: the contract and 0883 disagree`,
    );
  }
});

test('the unpinnable rows are documented rather than silently missing', () => {
  // These assert on `/c/` board content that lives only in Postgres. They are
  // listed so "not in the contract" reads as a decision, not an oversight.
  assert.ok(SEO_PROBE_UNPINNABLE.length > 0, 'no unpinnable rows declared');
  for (const u of SEO_PROBE_UNPINNABLE) {
    assert.ok(Number.isInteger(u.id), `bad unpinnable id: ${u.id}`);
    assert.ok(u.why?.trim(), `id=${u.id}: an unpinnable row must say why it cannot be pinned`);
  }
});
