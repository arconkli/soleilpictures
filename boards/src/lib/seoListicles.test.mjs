// seoListicles.test.mjs — structural validation of the listicle registry.
//
//   node --test src/lib/seoListicles.test.mjs
//
// The registry is consumed by THREE renderers (React page, worker crawlable
// HTML, worker JSON-LD) that must stay in parity; these tests catch the data
// mistakes that would silently break one of them (missing anchors, table rows
// keyed to nothing, a second isUs, a related[] path no renderer can label).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SEO_LISTICLE_PAGES, getListicleSpec, listicleToc } from './seoListicles.js';
import { SEO_LISTICLE_INDEX } from './seoListicleIndex.js';
import { SEO_LANDING_PATHS } from './seoLanding.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

test('registry basics: unique /best/ paths, resolvable specs', () => {
  const paths = SEO_LISTICLE_PAGES.map((p) => p.path);
  assert.equal(new Set(paths).size, paths.length, 'duplicate path');
  for (const p of SEO_LISTICLE_PAGES) {
    assert.match(p.path, /^\/best\/[a-z0-9-]+$/, `${p.path}: bad path shape`);
    assert.equal(p.kind, 'listicle');
    assert.equal(getListicleSpec(p.path), p);
    assert.equal(getListicleSpec(p.path.toUpperCase() + '/'), p, 'normalization');
  }
});

test('every page: meta lengths, dates, author, cta href attached', () => {
  for (const p of SEO_LISTICLE_PAGES) {
    assert.ok(p.title.length <= 65, `${p.path}: title ${p.title.length} chars`);
    assert.ok(p.metaDescription.length <= 160, `${p.path}: meta ${p.metaDescription.length} chars`);
    assert.match(p.published, DATE_RE, `${p.path}: published`);
    assert.match(p.updated, DATE_RE, `${p.path}: updated`);
    assert.ok(p.updated >= p.published, `${p.path}: updated before published`);
    assert.ok(p.author?.name && p.author?.bio, `${p.path}: author`);
    assert.match(p.cta.href, /^\/\?utm_source=seo&utm_medium=listicle/, `${p.path}: cta href`);
    assert.ok(Array.isArray(p.exampleSlugs) && p.exampleSlugs.length >= 2, `${p.path}: exampleSlugs`);
  }
});

test('items: contiguous ranks from 1, unique anchors, exactly one isUs, pricing.asOf', () => {
  for (const p of SEO_LISTICLE_PAGES) {
    const anchors = p.items.map((it) => it.anchor);
    assert.equal(new Set(anchors).size, anchors.length, `${p.path}: duplicate anchor`);
    p.items.forEach((it, i) => {
      assert.equal(it.rank, i + 1, `${p.path}: rank not contiguous at ${it.name}`);
      assert.match(it.anchor, /^[a-z0-9-]+$/, `${p.path}/${it.name}: anchor shape`);
      assert.ok(it.bestFor && it.verdict, `${p.path}/${it.name}: bestFor/verdict`);
      assert.ok(Array.isArray(it.paras) && it.paras.length >= 1, `${p.path}/${it.name}: paras`);
      assert.ok(it.pricing?.summary && it.pricing?.asOf, `${p.path}/${it.name}: pricing.asOf required`);
      assert.ok(it.pros?.length >= 1 && it.cons?.length >= 1, `${p.path}/${it.name}: pros/cons`);
    });
    assert.equal(p.items.filter((it) => it.isUs).length, 1, `${p.path}: exactly one isUs`);
    assert.equal(p.items.find((it) => it.isUs)?.rank, 1, `${p.path}: our entry must be rank 1 (disclosed)`);
  }
});

test('comparison table: one row per item, cells aligned to columns', () => {
  for (const p of SEO_LISTICLE_PAGES) {
    for (const it of p.items) {
      const row = p.tableCells[it.anchor];
      assert.ok(Array.isArray(row), `${p.path}: tableCells missing ${it.anchor}`);
      assert.equal(row.length, p.columns.length, `${p.path}/${it.anchor}: ${row.length} cells vs ${p.columns.length} columns`);
    }
    for (const key of Object.keys(p.tableCells)) {
      assert.ok(p.items.some((it) => it.anchor === key), `${p.path}: tableCells orphan key ${key}`);
    }
  }
});

test('toc derives cleanly and ids are unique', () => {
  for (const p of SEO_LISTICLE_PAGES) {
    const toc = listicleToc(p);
    const ids = toc.map((t) => t.id);
    assert.equal(new Set(ids).size, ids.length, `${p.path}: duplicate toc id`);
    for (const t of toc) assert.ok(t.label, `${p.path}: toc ${t.id} lacks label`);
    // item anchors must not collide with fixed section ids
    for (const it of p.items) assert.ok(!ids.includes(it.anchor), `${p.path}: ${it.anchor} collides with section id`);
  }
});

test('related[] resolves to real landing/listicle pages', () => {
  const known = new Set([...SEO_LANDING_PATHS, ...SEO_LISTICLE_PAGES.map((p) => p.path)]);
  for (const p of SEO_LISTICLE_PAGES) {
    for (const r of p.related) assert.ok(known.has(r), `${p.path}: related ${r} unknown`);
  }
});

test('index module matches registry (chunk-weight firewall cannot drift)', () => {
  assert.equal(SEO_LISTICLE_INDEX.length, SEO_LISTICLE_PAGES.length);
  for (const entry of SEO_LISTICLE_INDEX) {
    const spec = getListicleSpec(entry.path);
    assert.ok(spec, `index entry ${entry.path} not in registry`);
    assert.equal(entry.h1, spec.h1, `${entry.path}: index h1 drifted`);
    assert.ok(entry.navLabel, `${entry.path}: navLabel`);
  }
});

// Content-integration gate: red until the authoring pass replaces every
// skeleton field. Structural tests above stay green on the skeleton.
test('no PLACEHOLDER content remains (content pass complete)', () => {
  const json = JSON.stringify(SEO_LISTICLE_PAGES);
  const hits = (json.match(/PLACEHOLDER/g) || []).length;
  assert.equal(hits, 0, `${hits} PLACEHOLDER fields remain`);
});

// Sanity on the editorial rules the renderers assume.
test('editorial invariants: our entry has real cons; ratings only used in-table', () => {
  for (const p of SEO_LISTICLE_PAGES) {
    const us = p.items.find((it) => it.isUs);
    assert.ok(us.cons.length >= 2, `${p.path}: our entry needs ≥2 real cons`);
  }
});

// The "N Best" number in title/h1/itemsHeading must equal the actual roster
// size — a roster edit that forgets the headline number ships a lying title.
test('headline counts match items.length', () => {
  for (const p of SEO_LISTICLE_PAGES) {
    const n = p.items.length;
    for (const [field, text] of [['title', p.title], ['h1', p.h1], ['itemsHeading', p.itemsHeading]]) {
      const m = text.match(/\d+/);
      assert.ok(m, `${p.path}: ${field} carries no count`);
      assert.equal(Number(m[0]), n, `${p.path}: ${field} says ${m[0]}, roster has ${n}`);
    }
  }
});
