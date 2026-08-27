import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SEO_LANDING_PAGES, getLandingSpec } from './seoLanding.js';

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
const templatePages = SEO_LANDING_PAGES.filter((p) => p.kind === 'template');
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
  assert.ok(withDocs.length >= 4, `expected the templates family to carry docs links, got ${withDocs.length}`);
  for (const spec of withDocs) {
    const html = buildLandingCrawlableHtml(spec);
    for (const d of spec.docsLinks) {
      assert.ok(html.includes(`href="${d.path}"`), `${spec.path}: no link to ${d.path}`);
      assert.ok(html.includes(esc(d.label)), `${spec.path}: ${d.path} rendered without its label`);
    }
  }
});

test('a template page states its real shape, derived not typed', () => {
  assert.ok(templatePages.length >= 3, `expected the curated pages, got ${templatePages.length}`);
  for (const spec of templatePages) {
    const html = buildLandingCrawlableHtml(spec);
    assert.ok(html.includes('The layout'), `${spec.path}: no layout section`);
    for (const h of spec.template.hints || []) {
      assert.ok(html.includes(`<li>${esc(h)}</li>`), `${spec.path}: label "${h}" not in the crawlable list`);
    }
    // An empty <ol> would mean the hints array vanished between the spec and
    // the renderer — visible to nobody, since the page still looks fine.
    assert.ok(!html.includes('<ol></ol>'), `${spec.path}: empty label list`);
  }
});

// A page nested under /templates that claims a two-rung trail is telling Google
// something false about the site's shape, and the breadcrumb is one of the very
// few parts of this graph a SERP still renders.
test('breadcrumbs gain a rung for a nested page and only for a nested page', () => {
  for (const spec of templatePages) {
    const crumbs = typed(spec, 'BreadcrumbList').itemListElement;
    assert.equal(crumbs.length, 3, `${spec.path}: expected Home → parent → self`);
    assert.deepEqual(crumbs.map((c) => c.position), [1, 2, 3], `${spec.path}: positions out of order`);
    assert.equal(crumbs[1].item, `${ORIGIN}${spec.parent}`);
    assert.equal(crumbs[1].name, getLandingSpec(spec.parent).h1);
    assert.equal(crumbs[2].item, `${ORIGIN}${spec.path}`);
  }
  // Everything without a parent keeps the two-rung trail it has always had.
  for (const spec of SEO_LANDING_PAGES.filter((p) => !p.parent)) {
    assert.equal(typed(spec, 'BreadcrumbList').itemListElement.length, 2, `${spec.path}: unexpected rung`);
  }
});

// The hub declares its spokes. Every url in the list has to be a real,
// indexable page in the registry — an ItemList pointing at URLs the page does
// not actually offer is markup asserting something untrue, which is worse than
// no markup.
test('the hub lists its children, and every one of them resolves', () => {
  const hub = getLandingSpec('/templates');
  const list = typed(hub, 'ItemList');
  assert.ok(list, '/templates should declare an ItemList of its curated children');
  assert.equal(list.itemListElement.length, templatePages.length);
  for (const item of list.itemListElement) {
    const path = item.url.replace(ORIGIN, '');
    const child = getLandingSpec(path);
    assert.ok(child, `ItemList points at ${path}, which is not in the registry`);
    assert.equal(child.parent, '/templates', `${path} is listed but does not claim /templates as parent`);
    assert.equal(item.name, child.h1);
  }
  // And a page with no children must not emit an empty list.
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
