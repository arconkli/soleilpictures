// seoListicleHtml.test.mjs — parity + schema-policy tests for the listicle
// server renderers.
//
//   node --test src/lib/seoListicleHtml.test.mjs
//
// Anti-cloaking parity is enforced structurally: every ranked tool, heading,
// TOC id, and FAQ from the spec must appear in the crawlable HTML. The JSON-LD
// policy test is the guardrail against someone "helpfully" adding Review /
// AggregateRating markup later (self-serving review markup = manual-action
// risk — ratings stay visible-copy only).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SEO_LISTICLE_PAGES, listicleToc, listicleTrustChips, formatRating } from './seoListicles.js';
import { buildListicleCrawlableHtml, buildListicleJsonLd } from './seoListicleHtml.js';

const ORIGIN = 'https://clusters.soleilpictures.com';

test('crawlable HTML contains every tool, section id, and FAQ', () => {
  for (const spec of SEO_LISTICLE_PAGES) {
    const html = buildListicleCrawlableHtml(spec);
    assert.ok(html.includes(`<h1`), `${spec.path}: h1`);
    assert.ok(html.includes(spec.h1.replace(/&/g, '&amp;')), `${spec.path}: h1 text`);
    for (const it of spec.items) {
      assert.ok(html.includes(`id="${it.anchor}"`), `${spec.path}: item section id ${it.anchor}`);
      assert.ok(html.includes(`${it.rank}. ${it.name.replace(/&/g, '&amp;')}`), `${spec.path}: heading for ${it.name}`);
      assert.ok(html.includes(`as of ${it.pricing.asOf}`), `${spec.path}/${it.name}: pricing asOf visible`);
      // The React review card shows a score meter; the fallback must show the
      // same number, formatted identically ("8.0/10", never "8/10").
      assert.ok(html.includes(`${formatRating(it.rating)}/10`), `${spec.path}/${it.name}: score visible`);
    }
    // Hero credibility chips are derived, so parity is by construction — assert
    // it anyway, since they are the page's trust claim.
    for (const chip of listicleTrustChips(spec)) {
      assert.ok(html.includes(escapeLite(chip)), `${spec.path}: trust chip "${chip}"`);
    }
    for (const t of listicleToc(spec)) {
      assert.ok(html.includes(`href="#${t.id}"`), `${spec.path}: toc link #${t.id}`);
      assert.ok(html.includes(`id="${t.id}"`), `${spec.path}: toc target #${t.id}`);
    }
    for (const f of spec.faq) {
      assert.ok(html.includes(escapeLite(f.q)), `${spec.path}: faq q`);
    }
    assert.ok(html.includes(spec.author.name), `${spec.path}: author byline`);
    assert.ok(html.includes(`datetime="${spec.published}"`), `${spec.path}: published time`);
    // Our entry's CTA present exactly once (per-item CTA only on isUs).
    const ctaCount = html.split(spec.cta.href.replace(/&/g, '&amp;')).length - 1;
    assert.equal(ctaCount, 1, `${spec.path}: expected exactly 1 in-item CTA, got ${ctaCount}`);
  }
});

test('crawlable HTML escapes interpolations (no raw angle brackets from data)', () => {
  const spec = {
    ...SEO_LISTICLE_PAGES[0],
    subhead: 'x <script>alert(1)</script> y',
  };
  const html = buildListicleCrawlableHtml(spec);
  assert.ok(!html.includes('<script>alert'), 'unescaped script tag leaked');
  assert.ok(html.includes('&lt;script&gt;'), 'escaped form present');
});

test('JSON-LD: Article+ItemList+Breadcrumb+FAQ; author is Organization; no Review types', () => {
  for (const spec of SEO_LISTICLE_PAGES) {
    const url = `${ORIGIN}${spec.path}`;
    const ld = buildListicleJsonLd(spec, url, `${ORIGIN}/og/x.png`);
    const json = JSON.stringify(ld);
    assert.ok(!/"(Review|AggregateRating|Rating)"/.test(json), `${spec.path}: review markup leaked`);
    assert.ok(!/"ratingValue"/.test(json), `${spec.path}: ratingValue leaked`);
    const types = ld['@graph'].map((g) => g['@type']);
    for (const t of ['WebPage', 'Article', 'ItemList', 'BreadcrumbList', 'FAQPage']) {
      assert.ok(types.includes(t), `${spec.path}: missing ${t}`);
    }
    const article = ld['@graph'].find((g) => g['@type'] === 'Article');
    assert.equal(article.author['@type'], 'Organization', `${spec.path}: author must be Organization`);
    assert.equal(article.datePublished, spec.published);
    assert.equal(article.dateModified, spec.updated);
    const list = ld['@graph'].find((g) => g['@type'] === 'ItemList');
    assert.equal(list.itemListElement.length, spec.items.length);
    list.itemListElement.forEach((li, i) => {
      assert.equal(li.position, spec.items[i].rank);
      assert.equal(li.name, spec.items[i].name);
    });
    // Round-trip: must survive JSON parse (worker embeds via jsonLdSafe).
    assert.deepEqual(JSON.parse(json), ld);
  }
});

function escapeLite(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
