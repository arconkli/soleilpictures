import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { TEMPLATE_ITEMS, getTemplateSpec, isTemplatePath } from './templateIndex.js';
import { TEMPLATE_CARDS, TEMPLATE_CATEGORIES } from './templateCards.js';
import { templateHtml } from './templateCrawlable.js';
import { SEO_LANDING_PAGES } from './seoLanding.js';
import { SEO_LISTICLE_INDEX } from './seoListicleIndex.js';
import { presetById, computeCellRects, readingOrder } from './gridLayout.js';
import { HINT_LIMITS } from './gridLayoutLibrary.js';

const HERE = dirname(fileURLToPath(import.meta.url));

// The template store's gate.
//
// THERE IS DELIBERATELY NO MINIMUM LENGTH ANYWHERE IN THIS FILE.
//
// An item page is a diagram, its labels, one paragraph saying what it is for,
// and a button. A word-count floor would force padding — invented prose written
// to satisfy a number — which is precisely what makes a template store read as
// filler. Length is free here.
//
// What is NOT free is sameness. Forty pages that differ only in the name of the
// same grid are the thin-doorway pattern seoLanding.js's header forbids, and
// that penalty lands site-wide, including on /vs/pureref which is the only page
// on this site actually earning impressions. So the gate measures DISTINCTNESS:
// near-duplicate prose, reused sentences, colliding queries, and the specific
// failure of shipping one geometry twice under two names.
//
// Every check carries an anti-vacuous floor first — a registry that failed to
// load must never make this file quietly green.

const FLOOR = 3;
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

// ALL the prose a template carries: its `answer` and its store line. There is no
// body — an item page is a product page, and gen-docs treats body prose in a
// template file as an error rather than dropping it silently. So the duplicate
// check runs over the two sentences that exist, which is exactly right: on lean
// pages those two sentences ARE the differentiation, and they are the part most
// at risk of being copy-pasted between templates.
function proseOf(item) {
  return norm(`${item.answer} ${item.blurb}`);
}

// Word 5-grams. Jaccard over these is the standard cheap near-duplicate measure
// and needs no dependency: 15 items is 105 pairs, milliseconds.
function shingles(text, n = 5) {
  const w = text.split(' ').filter(Boolean);
  const out = new Set();
  for (let i = 0; i + n <= w.length; i += 1) out.add(w.slice(i, i + n).join(' '));
  return out;
}
function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const s of a) if (b.has(s)) inter += 1;
  return inter / (a.size + b.size - inter);
}

test('registry loads, resolves, and every item is reachable', () => {
  assert.ok(TEMPLATE_ITEMS.length >= FLOOR, `expected the template store, got ${TEMPLATE_ITEMS.length}`);
  assert.equal(TEMPLATE_CARDS.length, TEMPLATE_ITEMS.length, 'cards and index out of step');
  assert.ok(TEMPLATE_CATEGORIES.length >= 2, 'expected real categories');

  const seen = new Set();
  for (const it of TEMPLATE_ITEMS) {
    assert.ok(!seen.has(it.path), `duplicate path ${it.path}`);
    seen.add(it.path);
    // Flat, one segment. A second slash would mean a category URL, which this
    // store deliberately does not mint — categories are a ?category= facet so
    // they cannot compete with /tools/* and /best/* for the same intent.
    assert.match(it.path, /^\/templates\/[a-z0-9-]+$/, `${it.path}: bad path shape`);
    assert.equal(getTemplateSpec(it.path), it, `${it.path}: does not resolve`);
    assert.equal(getTemplateSpec(`${it.path.toUpperCase()}/`), it, `${it.path}: case/slash does not normalize`);
    assert.ok(isTemplatePath(it.path), `${it.path}: not recognised as a template path`);
    assert.ok(templateHtml(it.path).length > 200, `${it.path}: no crawlable HTML`);
    assert.ok(TEMPLATE_CATEGORIES.some((c) => c.id === it.category), `${it.path}: unknown category`);
  }
  // /templates itself is the store, not an item.
  assert.equal(isTemplatePath('/templates'), false);
});

// The centrepiece. Calibrated, not guessed: measured across the live landing
// corpus the maximum pairwise 5-gram overlap between two genuinely different
// pages is 0.0088. A name-swap clone scores ~0.80; a page with half its
// sentences rewritten scores ~0.24. 0.10 is an order of magnitude above real
// prose and still catches a lazy clone eightfold.
test('no two templates are near-duplicates of each other', () => {
  assert.ok(TEMPLATE_ITEMS.length >= FLOOR);
  const shing = TEMPLATE_ITEMS.map((it) => ({ it, s: shingles(proseOf(it)) }));
  const problems = [];
  for (let i = 0; i < shing.length; i += 1) {
    for (let j = i + 1; j < shing.length; j += 1) {
      const score = jaccard(shing[i].s, shing[j].s);
      if (score >= 0.10) {
        const overlap = [...shing[i].s].filter((s) => shing[j].s.has(s)).slice(0, 3);
        problems.push(`${shing[i].it.path} ~ ${shing[j].it.path}: ${score.toFixed(3)} — e.g. "${overlap.join('" / "')}"`);
      }
    }
  }
  assert.deepEqual(problems, [], `near-duplicate template prose:\n  ${problems.join('\n  ')}`);
});

// Verbatim reuse is the other half: two pages can score low on shingles overall
// and still share a whole paragraph. Scoped to template prose so the {{fact:…}}
// pricing boilerplate — which is SUPPOSED to be identical everywhere — needs no
// allowlist to be exempt.
test('no sentence is reused verbatim between templates', () => {
  assert.ok(TEMPLATE_ITEMS.length >= FLOOR);
  const seen = new Map();
  const problems = [];
  for (const it of TEMPLATE_ITEMS) {
    for (const raw of proseOf(it).split(/(?<=[.!?])\s+|\n+/)) {
      const s = raw.trim();
      if (s.split(' ').length < 12) continue;
      if (seen.has(s) && seen.get(s) !== it.path) {
        problems.push(`${seen.get(s)} and ${it.path} share: "${s.slice(0, 70)}…"`);
      }
      seen.set(s, it.path);
    }
  }
  assert.deepEqual(problems, [], `verbatim reuse:\n  ${problems.join('\n  ')}`);
});

// Two templates chasing one query cannibalise each other, and a template
// chasing a page we already run cannibalises that. Fold a trailing plural so
// "storyboard template" and "storyboard templates" collide as they should.
test('every template owns a distinct query, and says it on the page', () => {
  assert.ok(TEMPLATE_ITEMS.length >= FLOOR);
  const key = (s) => norm(s).replace(/s$/, '');
  const taken = new Map();
  for (const p of [...SEO_LANDING_PAGES, ...SEO_LISTICLE_INDEX]) taken.set(key(p.h1), p.path);

  const problems = [];
  for (const it of TEMPLATE_ITEMS) {
    const k = key(it.targetQuery);
    if (taken.has(k)) problems.push(`${it.path}: targetQuery "${it.targetQuery}" already served by ${taken.get(k)}`);
    taken.set(k, it.path);
    // The page has to actually address the query it claims.
    const surface = norm(`${it.h1} ${it.title} ${it.answer}`);
    if (!surface.includes(norm(it.targetQuery))) {
      problems.push(`${it.path}: targetQuery "${it.targetQuery}" appears in neither h1, title nor answer`);
    }
  }
  assert.deepEqual(problems, [], `query collisions:\n  ${problems.join('\n  ')}`);
});

test('blurb, metaDescription and answer are each unique', () => {
  assert.ok(TEMPLATE_ITEMS.length >= FLOOR);
  for (const field of ['blurb', 'metaDescription', 'answer']) {
    const seen = new Map();
    for (const it of TEMPLATE_ITEMS) {
      const v = norm(it[field]);
      assert.ok(!seen.has(v), `${it.path} and ${seen.get(v)} share a ${field}`);
      seen.set(v, it.path);
    }
  }
});

// THE RULE THAT ENCODES THE WHOLE PREMISE OF THE STORE.
//
// Geometry is not the product — the labelled use-case is. One 3×3 grid is a
// contact sheet, a casting board or a posting grid depending on its name and its
// labels. That is what makes fifteen templates on seven shapes honest rather
// than a clone farm. But it only holds if two templates sharing a shape actually
// differ in BOTH: same preset with the same labels is one product with two names.
test('two templates on the same shape differ in labels and in purpose', () => {
  assert.ok(TEMPLATE_ITEMS.length >= FLOOR);
  const problems = [];
  const byPreset = new Map();
  for (const it of TEMPLATE_ITEMS) {
    const peers = byPreset.get(it.preset) || [];
    for (const peer of peers) {
      if (JSON.stringify(peer.hints) === JSON.stringify(it.hints)) {
        problems.push(`${peer.path} and ${it.path} are ${it.preset} with identical labels`);
      }
      if (norm(peer.useCase) === norm(it.useCase)) {
        problems.push(`${peer.path} and ${it.path} are ${it.preset} for the same use case`);
      }
    }
    peers.push(it);
    byPreset.set(it.preset, peers);
  }
  // Past six honest use-cases for one geometry you are inventing them.
  for (const [preset, items] of byPreset) {
    if (items.length > 6) problems.push(`${preset} carries ${items.length} templates — past six you are inventing use-cases`);
  }
  // useCase must be globally unique, not merely unique per shape.
  const uses = new Map();
  for (const it of TEMPLATE_ITEMS) {
    const u = norm(it.useCase);
    if (uses.has(u)) problems.push(`${uses.get(u)} and ${it.path} claim the same use case "${it.useCase}"`);
    uses.set(u, it.path);
  }
  assert.deepEqual(problems, [], `shape/purpose collisions:\n  ${problems.join('\n  ')}`);
});

// Correctness, moved here verbatim from seoLanding.test.mjs when the items left
// that registry. Both failures are SILENT: presetTree falls back to a single
// cell for an unknown id, and sanitizeHints drops a surplus label. Neither
// throws — you would simply ship the wrong template.
test('every template names a real shape, with labels that fit it', () => {
  assert.ok(TEMPLATE_ITEMS.length >= FLOOR);
  for (const it of TEMPLATE_ITEMS) {
    const preset = presetById(it.preset);
    assert.ok(preset, `${it.path}: unknown preset "${it.preset}"`);
    const cells = readingOrder(computeCellRects(preset.tree, { x: 0, y: 0, w: 900, h: 600 })).length;
    assert.equal(it.cells, cells, `${it.path}: cached cell count is stale`);
    assert.equal(it.presetLabel, preset.label, `${it.path}: cached preset label is stale`);
    if (!it.hints) continue;
    assert.ok(it.hints.length <= cells,
      `${it.path}: ${it.hints.length} labels for ${cells} boxes — the surplus is silently dropped`);
    for (const h of it.hints) {
      assert.ok(h.trim(), `${it.path}: empty label`);
      // The same ceiling migration 0269's CHECK enforces, so a page can never
      // advertise a label the app would refuse to store.
      assert.ok(h.length <= HINT_LIMITS.MAX_LEN,
        `${it.path}: label "${h}" is ${h.length} chars, over the ${HINT_LIMITS.MAX_LEN} the column allows`);
    }
  }
});

test('related links resolve to real pages', () => {
  assert.ok(TEMPLATE_ITEMS.length >= FLOOR);
  const known = new Set([
    ...TEMPLATE_ITEMS.map((t) => t.path),
    ...SEO_LANDING_PAGES.map((p) => p.path),
    ...SEO_LISTICLE_INDEX.map((p) => p.path),
  ]);
  const problems = [];
  for (const it of TEMPLATE_ITEMS) {
    for (const r of it.related) {
      if (r === it.path) problems.push(`${it.path} links to itself`);
      // /docs/* is validated by docsite.test.mjs's own link checker.
      if (r.startsWith('/docs/')) continue;
      if (!known.has(r)) problems.push(`${it.path} → ${r} does not resolve`);
    }
  }
  assert.deepEqual(problems, [], `broken related links:\n  ${problems.join('\n  ')}`);
});

// The Worker imports three of the four artifacts. This is its own ceiling rather
// than a share of the docs budget — folding template weight into the docs
// allowance at docsite.test.mjs:430 would launder it, and the two corpora grow
// for unrelated reasons.
test('WEIGHT: worker-imported template artifacts stay within budget', () => {
  const bytes = (f) => readFileSync(resolve(HERE, f), 'utf8').length;
  const total = bytes('templateCrawlable.js') + bytes('templateIndex.js') + bytes('templateCards.js');
  const BUDGET = 250_000;
  assert.ok(total < BUDGET,
    `worker template artifacts are ${(total / 1000).toFixed(0)}KB, budget ${BUDGET / 1000}KB. `
    + 'Move the crawlable HTML to an env.ASSETS fetch rather than raising this.');
});

// ── The item page's structured data ─────────────────────────────────────────
// worker.js imports cleanly under plain node — it touches no Workers global at
// module scope — which is how changelog.test.mjs already reaches
// buildChangelogJsonLd. Same door.
const { buildTemplateJsonLd } = await import('../worker.js');
const ORIGIN = 'https://clusters.soleilpictures.com';
const graphOf = (it) => buildTemplateJsonLd(it, `${ORIGIN}${it.path}`, `${ORIGIN}/og/template-${it.category}.png`);

test('an item page claims only what it can defend', () => {
  assert.ok(TEMPLATE_ITEMS.length >= FLOOR);
  for (const it of TEMPLATE_ITEMS) {
    const graph = graphOf(it)['@graph'];
    const typed = (t) => graph.find((n) => n['@type'] === t);

    const page = typed('WebPage');
    assert.ok(page, `${it.path}: no WebPage`);
    assert.equal(page.url, `${ORIGIN}${it.path}`);
    // The one line that earns its place: where the entity graph learns this page
    // is about casting rather than about a 3×3 grid.
    assert.deepEqual(page.about, { '@type': 'Thing', name: it.useCase }, `${it.path}: about is not the use case`);

    // Home → Grid templates → item. Flat URLs, so exactly three rungs, always.
    const crumbs = typed('BreadcrumbList').itemListElement;
    assert.equal(crumbs.length, 3, `${it.path}: expected Home → store → item`);
    assert.equal(crumbs[1].item, `${ORIGIN}/templates`);
    assert.equal(crumbs[2].item, `${ORIGIN}${it.path}`);

    // No FAQPage. An item page has no FAQ — declaring one would be markup
    // asserting content the page does not contain.
    assert.equal(typed('FAQPage'), undefined, `${it.path}: item pages have no FAQ to declare`);
  }
});

// A store-shaped surface is exactly where someone reaches for Product markup
// next year. Google's product guidelines want price, availability and reviews;
// these pages sell nothing, and ratings markup is banned repo-wide. Making the
// prohibition mechanical here is cheaper than catching it in review.
test('no commerce or review markup, ever', () => {
  assert.ok(TEMPLATE_ITEMS.length >= FLOOR);
  for (const it of TEMPLATE_ITEMS) {
    const json = JSON.stringify(graphOf(it));
    assert.ok(!/"(Review|AggregateRating|Rating|Product|Offer)"/.test(json),
      `${it.path}: commerce/review markup leaked into the graph`);
    assert.ok(!json.includes('undefined'), `${it.path}: undefined in the graph`);
    assert.ok(!json.includes('</script'), `${it.path}: unescaped script close`);
  }
});

// Both renderers must show the same catalogue. The Worker's list is the only
// thing a crawler sees, so a JS-only gap here stays invisible until it is
// indexed — assert the COUNT against the registry rather than spot-checking, so
// a silently truncated or capped list fails.
test('the crawlable store front lists every item', async () => {
  assert.ok(TEMPLATE_CARDS.length >= FLOOR);
  const { buildLandingCrawlableHtml } = await import('../worker.js');
  const { getLandingSpec } = await import('./seoLanding.js');
  const html = buildLandingCrawlableHtml(getLandingSpec('/templates'));
  const linked = [...html.matchAll(/href="(\/templates\/[a-z0-9-]+)"/g)].map((m) => m[1]);
  assert.deepEqual(linked.sort(), TEMPLATE_CARDS.map((t) => t.path).sort(),
    'the crawlable store front and the registry disagree about the catalogue');
  // And every category the chips offer must have members, or the crawler is
  // handed a filter that returns nothing.
  for (const c of TEMPLATE_CATEGORIES) {
    const n = TEMPLATE_CARDS.filter((t) => t.category === c.id).length;
    assert.ok(n > 0, `category "${c.id}" is offered but empty`);
    assert.ok(html.includes(`/templates?category=${c.id}`), `category "${c.id}" is not linked`);
  }
});
