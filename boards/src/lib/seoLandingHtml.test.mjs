import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SEO_LANDING_PAGES, getLandingSpec } from './seoLanding.js';
import { TEMPLATE_ITEMS } from './templateIndex.js';

// The Worker's server-rendered half of every landing page had no test at all.
//
// That is the half a crawler reads. React's half is covered by
// tests/templates-page.spec.js, but the two are separate renderers walking one
// registry, and the whole design rests on them producing the same document — so
// the server side going quietly wrong (a section that stops emitting, an empty
// <ol>, a JSON-LD node that references a page that does not exist) is invisible
// until something is already indexed.
//
// worker.js imports cleanly under plain node — it touches no Workers global at
// module scope — which is how changelog.test.mjs already reaches
// buildChangelogJsonLd. Same door.
const { buildLandingCrawlableHtml, buildLandingJsonLd } = await import('../worker.js');

const ORIGIN = 'https://clusters.soleilpictures.com';
const nodesOf = (spec) => buildLandingJsonLd(spec, `${ORIGIN}${spec.path}`)['@graph'];
// Mirrors worker.js escapeHtml. Prose here contains quotes and apostrophes, so
// a raw includes() would report a correctly-escaped heading as missing.
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const typed = (spec, t) => nodesOf(spec).find((n) => n['@type'] === t);

test('every landing page renders its prose into the crawlable body', () => {
  assert.ok(SEO_LANDING_PAGES.length >= 13, 'registry failed to load');
  for (const spec of SEO_LANDING_PAGES) {
    const html = buildLandingCrawlableHtml(spec);
    assert.ok(html.includes(`<h1`), `${spec.path}: no h1`);
    assert.ok(html.includes(esc(spec.h1)), `${spec.path}: h1 text missing`);
    // Every section heading must actually land. A renderer that silently drops
    // a block is the failure mode the .md mirror test was written for; the
    // server-rendered twin deserves the same floor.
    for (const s of spec.sections || []) {
      assert.ok(html.includes(esc(s.heading)), `${spec.path}: section "${s.heading}" not rendered`);
    }
    for (const f of spec.faq || []) {
      assert.ok(html.includes(esc(f.q)), `${spec.path}: FAQ "${f.q}" not rendered`);
    }
    for (const leak of ['undefined', '[object Object]', 'NaN']) {
      assert.ok(!html.includes(leak), `${spec.path}: leaked "${leak}" into the crawlable body`);
    }
  }
});

// docsLinks exists because `related` is rendered by two different rules: the
// Worker falls back to the raw path as anchor text, React filters against
// TITLE_BY_PATH and drops what it cannot label. A /docs/* path in `related`
// therefore appears in one document and not the other. Both renderers must emit
// a docsLink, with the same words.
test('docsLinks reach the crawlable body with their own label', () => {
  const withDocs = SEO_LANDING_PAGES.filter((p) => (p.docsLinks || []).length);
  // Floor was 4 while the template items were landing specs. They moved to
  // their own registry (templateCrawlable.js renders their docs link directly),
  // leaving /templates as the one landing page that uses the field. This is an
  // anti-vacuous floor, not a target: it exists so a docsLinks that stopped
  // rendering entirely cannot pass by having nothing to render.
  assert.ok(withDocs.length >= 1, `docsLinks is no longer used by any landing page (${withDocs.length})`);
  for (const spec of withDocs) {
    const html = buildLandingCrawlableHtml(spec);
    for (const d of spec.docsLinks) {
      assert.ok(html.includes(`href="${d.path}"`), `${spec.path}: no link to ${d.path}`);
      assert.ok(html.includes(esc(d.label)), `${spec.path}: ${d.path} rendered without its label`);
    }
  }
});

// Nothing in the landing registry is nested any more — the template store's
// items moved to their own registry — so every breadcrumb here is two rungs. The
// `parent` machinery stays because the store's item pages use it, and asserting
// the landing side is flat is what would catch a spec quietly growing a parent.
test('landing breadcrumbs are two rungs, because nothing here is nested', () => {
  for (const spec of SEO_LANDING_PAGES) {
    assert.equal(typed(spec, 'BreadcrumbList').itemListElement.length, 2, `${spec.path}: unexpected rung`);
  }
});

// The store front declares its shelf. Every url has to be a real, indexable
// page — an ItemList pointing at URLs the page does not actually offer is
// markup asserting something untrue, which is worse than no markup.
test('the store front lists its items, and every one of them resolves', () => {
  const hub = getLandingSpec('/templates');
  const list = typed(hub, 'ItemList');
  assert.ok(list, '/templates should declare an ItemList of its templates');
  assert.equal(list.itemListElement.length, TEMPLATE_ITEMS.length);
  const byPath = new Map(TEMPLATE_ITEMS.map((t) => [t.path, t]));
  for (const item of list.itemListElement) {
    const path = item.url.replace(ORIGIN, '');
    const t = byPath.get(path);
    assert.ok(t, `ItemList points at ${path}, which is not in the template registry`);
    assert.equal(item.name, t.h1);
  }
  // A page with no items must not emit an empty list.
  assert.equal(typed(getLandingSpec('/vs/miro'), 'ItemList'), undefined);
});

test('the JSON-LD graph is serializable and self-consistent', () => {
  for (const spec of SEO_LANDING_PAGES) {
    const url = `${ORIGIN}${spec.path}`;
    const graph = buildLandingJsonLd(spec, url);
    const json = JSON.stringify(graph);
    assert.ok(!json.includes('undefined'), `${spec.path}: undefined in the graph`);
    assert.ok(!json.includes('</script'), `${spec.path}: unescaped script close`);
    assert.equal(graph['@context'], 'https://schema.org');
    assert.equal(typed(spec, 'WebPage').url, url);
  }
});
