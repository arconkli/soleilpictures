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

test('related nav anchor text is the target page h1 — the same label React renders', async () => {
  // SeoListiclePage.jsx labels each related spoke with the target's h1
  // (relatedLabel). The crawlable HTML rendered the raw path instead, so the
  // two documents disagreed on 16 internal links across the four highest-
  // impression pages — and the crawler's copy carried zero keyword anchor text.
  const { getLandingSpec } = await import('./seoLanding.js');
  const { SEO_LISTICLE_INDEX } = await import('./seoListicleIndex.js');
  const label = (p) => getLandingSpec(p)?.h1 || SEO_LISTICLE_INDEX.find((x) => x.path === p)?.h1 || p;
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/'/g, '&#39;');
  for (const spec of SEO_LISTICLE_PAGES) {
    const full = buildListicleCrawlableHtml(spec);
    // Scope to the footer nav: a spotlight or a matchup may link the same path
    // earlier with its own label, and that is not the link under test.
    const navStart = full.indexOf('<nav aria-label="Related pages"');
    assert.ok(navStart > -1, `${spec.path}: related nav missing`);
    const html = full.slice(navStart);
    for (const p of spec.related || []) {
      const want = `href="${p}"`;
      const i = html.indexOf(want);
      assert.ok(i > -1, `${spec.path}: related link ${p} missing`);
      const anchor = html.slice(i, html.indexOf('</a>', i));
      assert.ok(anchor.endsWith(`>${esc(label(p))}`), `${spec.path}: related ${p} anchor text should be "${label(p)}", got: ${anchor.slice(-120)}`);
    }
  }
});

test('spotlights render in the crawlable HTML: section id, h2 = heading, every para and link', () => {
  const base = SEO_LISTICLE_PAGES[0];
  const spot = {
    id: 'film-production-teams',
    heading: 'Best mood board app for film production teams',
    intro: 'The intro names the picks.',
    paras: ['Body paragraph one.', 'Body paragraph two.'],
    links: [{ path: '/tools/shot-list-maker', label: 'Shot list maker' }, { path: '/best/storyboard-software', label: 'Storyboard software' }],
  };
  const html = buildListicleCrawlableHtml({ ...base, spotlights: [spot] });
  const i = html.indexOf('<section id="film-production-teams">');
  assert.ok(i > -1, 'spotlight section id');
  const section = html.slice(i, html.indexOf('</section>', i));
  assert.ok(section.includes(`<h2 style=`) && section.includes(`>${spot.heading}</h2>`), 'h2 is the heading');
  assert.ok(section.includes(spot.intro), 'intro');
  for (const p of spot.paras) assert.ok(section.includes(p), `para: ${p}`);
  for (const l of spot.links) assert.ok(section.includes(`href="${l.path}"`) && section.includes(`>${l.label}</a>`), `link ${l.path}`);
  // Ordered after platforms/head-to-head and before thesis, like the TOC says.
  assert.ok(i < html.indexOf('<section id="thesis">'), 'before thesis');
  assert.ok(i > html.indexOf('<section id="table">'), 'after the comparison table');
  // The TOC nav links it.
  assert.ok(html.includes(`href="#film-production-teams"`), 'TOC link');
  // A page without the field is byte-identical to before.
  assert.equal(buildListicleCrawlableHtml({ ...base, spotlights: undefined }), buildListicleCrawlableHtml(base));
});
