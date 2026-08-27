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
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SEO_PROBE_CONTRACT, SEO_PROBE_UNPINNABLE, PROBE_ORIGIN } from './seoProbeContract.js';
import { CHANGELOG_HTML } from './changelogCrawlable.js';
import { DOCS_HTML } from './docsiteCrawlable.js';
import { buildListicleCrawlableHtml } from './seoListicleHtml.js';
import { getListicleSpec, SEO_LISTICLE_PATHS } from './seoListicles.js';
import { SEO_LANDING_PATHS } from './seoLanding.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const BOARDS = resolve(HERE, '../..');
const read = (p) => readFileSync(resolve(BOARDS, p), 'utf8');

// Every route the sitemap is expected to carry. `/changelog` is not in either
// registry — it is a hand-written branch in worker.js — so it is added here.
const ROUTES = [...SEO_LANDING_PATHS, ...SEO_LISTICLE_PATHS, '/changelog'];

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
      const html = DOCS_HTML[source.path];
      assert.ok(html, `no DOCS_HTML entry for ${source.path} — the page itself is gone`);
      return { text: html, what: `the crawlable HTML for ${source.path}` };
    }
    case 'file':
      return { text: read(source.path), what: `boards/${source.path}` };
    case 'route':
      return { text: ROUTES.join('\n'), what: 'the landing/listicle route registries' };
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
    assert.ok(row.expected.length >= 8, `id=${row.id}: ${JSON.stringify(row.expected)} is too short to prove anything`);
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
