// seoLanding.test.mjs — structural validation of the landing-page registry.
//
//   node --test src/lib/seoLanding.test.mjs
//
// The sibling registry (/best/* listicles) has had tests since it shipped; this
// one — older, larger, and the source for /tools/*, /vs/* and the hub — had
// none. Written after an edit dropped a `{ heading, body }` section object into
// a compare table's `rows` array, where JavaScript accepted it happily and it
// would have rendered as a blank row on a page that already ranks. The file
// parsed, the app built, and nothing failed. That is the class of mistake these
// tests exist to make loud.
//
// Three renderers read this registry and must stay in parity — the React page,
// the Worker's crawlable HTML, and the Worker's JSON-LD. A malformed entry
// breaks them in different ways, sometimes only one, which is the worst version
// because it becomes a cloaking discrepancy rather than a visible bug.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SEO_LANDING_PAGES, SEO_LANDING_PATHS, getLandingSpec } from './seoLanding.js';
import { SEO_LISTICLE_PAGES } from './seoListicles.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const words = (s) => String(s || '').trim().split(/\s+/).filter(Boolean).length;

// The limits documented in the spec-shape comment at the top of seoLanding.js.
// Kept here as constants so a failure names the rule rather than a magic number.
const TITLE_MAX = 60;
const META_MAX = 155;
const ANSWER_MIN = 40;
const ANSWER_MAX = 60;

test('registry basics: unique paths, resolvable, correctly shaped', () => {
  const paths = SEO_LANDING_PAGES.map((p) => p.path);
  assert.equal(new Set(paths).size, paths.length, 'duplicate path in the registry');
  for (const p of SEO_LANDING_PAGES) {
    // Two shapes: a namespaced page (/tools/*, /vs/*) or a single-segment hub.
    // The hub list is explicit rather than a wildcard so a typo'd path can't
    // quietly claim a top-level URL. The template STORE's items are not here —
    // they live in their own generated registry (src/lib/templateIndex.js) and
    // are gated by src/lib/templates.test.mjs.
    assert.match(p.path, /^\/(tools|vs)\/[a-z0-9-]+$|^\/(use-cases|scout|templates)$/, `${p.path}: bad path shape`);
    assert.ok(['tool', 'compare', 'hub'].includes(p.kind), `${p.path}: unknown kind ${p.kind}`);
    // Resolution must survive the shapes the Worker actually receives.
    assert.equal(getLandingSpec(p.path), p, `${p.path}: does not resolve`);
    assert.equal(getLandingSpec(`${p.path}/`), p, `${p.path}: trailing slash does not resolve`);
  }
  assert.deepEqual([...SEO_LANDING_PATHS].sort(), paths.slice().sort(), 'PATHS out of step with PAGES');
});

// docsLinks exists instead of putting /docs/* into `related`, and the reason is
// a cloaking bug rather than tidiness: the Worker's related renderer falls back
// to the raw path as anchor text and would render a docs link, while React
// filters related to its TITLE_BY_PATH map and would silently drop it. Two
// renderers, two different documents. Keep them apart.
test('docsLinks point at real docs paths and carry their own labels', () => {
  for (const p of SEO_LANDING_PAGES) {
    for (const d of p.docsLinks || []) {
      assert.match(d.path, /^\/docs\/[a-z0-9/-]+$/, `${p.path}: docsLinks path ${d.path} is not a docs path`);
      assert.ok(d.label && d.label.length > 2, `${p.path}: docsLinks ${d.path} has no label`);
    }
    for (const r of p.related || []) {
      assert.ok(!r.startsWith('/docs/'),
        `${p.path}: ${r} belongs in docsLinks — related is rendered differently by the two renderers`);
    }
  }
});

test('every page: meta within the limits the file documents', () => {
  for (const p of SEO_LANDING_PAGES) {
    assert.ok(p.title.length <= TITLE_MAX, `${p.path}: title ${p.title.length} > ${TITLE_MAX}`);
    assert.ok(p.metaDescription.length <= META_MAX,
      `${p.path}: metaDescription ${p.metaDescription.length} > ${META_MAX}`);
    assert.ok(p.h1 && p.subhead, `${p.path}: needs an h1 and a subhead`);
    // The answer block is what AI answer engines lift verbatim. Too short is
    // not self-contained; too long stops being extractable.
    const n = words(p.answer);
    assert.ok(n >= ANSWER_MIN && n <= ANSWER_MAX,
      `${p.path}: answer is ${n} words, want ${ANSWER_MIN}-${ANSWER_MAX}`);
  }
});

test('every page: an honest ISO date, not in the future', () => {
  // Fake freshness trains Google to ignore the field, and `updated` drives
  // sitemap lastmod and JSON-LD dateModified, so a future date is a lie told
  // in three places.
  const today = new Date().toISOString().slice(0, 10);
  for (const p of SEO_LANDING_PAGES) {
    assert.match(p.updated, DATE_RE, `${p.path}: updated is not ISO`);
    assert.ok(p.updated <= today, `${p.path}: updated ${p.updated} is in the future`);
  }
});

test('sections are whole: every one has a heading and a body', () => {
  for (const p of SEO_LANDING_PAGES) {
    assert.ok(Array.isArray(p.sections) && p.sections.length >= 3,
      `${p.path}: wants at least 3 sections, has ${p.sections?.length}`);
    for (const [i, s] of p.sections.entries()) {
      assert.ok(s.heading && typeof s.heading === 'string', `${p.path}: section ${i} has no heading`);
      assert.ok(s.body && typeof s.body === 'string', `${p.path}: section ${i} has no body`);
      if (s.bullets !== undefined) {
        assert.ok(Array.isArray(s.bullets), `${p.path}: section ${i} bullets is not an array`);
        for (const b of s.bullets) {
          assert.equal(typeof b, 'string', `${p.path}: section ${i} has a non-string bullet`);
        }
      }
      // The exact shape confusion that motivated this file: a section is not a
      // compare row and a compare row is not a section.
      assert.ok(!('feature' in s), `${p.path}: section ${i} looks like a compare row`);
    }
  }
});

test('compare tables: every row is {feature, us, them} and nothing else', () => {
  // THE regression. A section object spliced into rows parses fine, builds
  // fine, and renders a blank row on a live page.
  for (const p of SEO_LANDING_PAGES) {
    if (!p.compare) {
      assert.notEqual(p.kind, 'compare', `${p.path}: kind is compare but has no compare block`);
      continue;
    }
    assert.ok(p.compare.competitor, `${p.path}: compare block names no competitor`);
    assert.ok(Array.isArray(p.compare.rows) && p.compare.rows.length, `${p.path}: no compare rows`);
    for (const [i, r] of p.compare.rows.entries()) {
      assert.ok(r.feature && typeof r.feature === 'string', `${p.path}: compare row ${i} has no feature`);
      assert.ok(r.us && typeof r.us === 'string', `${p.path}: compare row ${i} has no 'us'`);
      assert.ok(r.them && typeof r.them === 'string', `${p.path}: compare row ${i} has no 'them'`);
      assert.ok(!('heading' in r) && !('body' in r),
        `${p.path}: compare row ${i} is a section, not a row`);
    }
  }
});

test('FAQ and steps are whole', () => {
  for (const p of SEO_LANDING_PAGES) {
    assert.ok(Array.isArray(p.faq) && p.faq.length >= 3, `${p.path}: wants at least 3 FAQ entries`);
    for (const [i, f] of p.faq.entries()) {
      assert.ok(f.q && typeof f.q === 'string', `${p.path}: faq ${i} has no question`);
      assert.ok(f.a && typeof f.a === 'string', `${p.path}: faq ${i} has no answer`);
      assert.ok(f.q.trim().endsWith('?'), `${p.path}: faq ${i} question does not end in '?'`);
    }
    for (const [i, s] of (p.steps || []).entries()) {
      assert.ok(s.t && s.d, `${p.path}: step ${i} needs both t and d`);
    }
    if (p.steps?.length) {
      assert.ok(p.stepsHeading, `${p.path}: has steps but no stepsHeading`);
    }
  }
});

test('every related link points somewhere real', () => {
  // A dead internal link is worse than no link: it spends crawl budget and
  // renders as a spoke to a 404.
  const known = new Set([
    ...SEO_LANDING_PAGES.map((p) => p.path),
    ...SEO_LISTICLE_PAGES.map((p) => p.path),
  ]);
  for (const p of SEO_LANDING_PAGES) {
    for (const r of p.related || []) {
      assert.ok(known.has(r), `${p.path}: related '${r}' resolves to nothing`);
      assert.notEqual(r, p.path, `${p.path}: links to itself`);
    }
  }
});

test('every page has a call to action', () => {
  for (const p of SEO_LANDING_PAGES) {
    assert.ok(p.cta?.label, `${p.path}: no cta.label`);
  }
});

test('the assistant page tells the truth about not generating images', () => {
  // The single claim this page turns on, and the one most likely to get
  // "improved" into a lie by someone optimising for the head term. If the
  // product ever does generate images, delete this test deliberately.
  const p = getLandingSpec('/tools/ai-mood-board-maker');
  assert.ok(p, 'the AI mood board page is missing');
  const prose = [p.answer, ...p.sections.map((s) => s.body), ...p.faq.map((f) => f.a)].join(' ');
  assert.match(prose, /does not (invent|generate)/i,
    'the page must say plainly that it does not generate images');
  const generates = /\b(we|clusters) (generates?|creates?) (the )?images\b/i;
  assert.ok(!generates.test(prose), 'the page must not claim to generate images');
});
