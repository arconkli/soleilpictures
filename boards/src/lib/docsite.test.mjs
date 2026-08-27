// docsite.test.mjs — the gate that keeps the public docs honest.
//
//   node --test src/lib/docsite.test.mjs
//
// This repo has no CI. The only mechanism here that has ever actually stopped
// drift is a *.test.mjs that reads a registry and asserts things about it
// (seoListicles.test.mjs). So the docs get the same treatment, aimed at the
// four ways documentation rots:
//
//   1. Someone ships a public surface and never writes the page.
//      -> COVERAGE: every endpoint, MCP tool, card kind, settings tab and
//         power reveal must be mentioned somewhere in the corpus.
//   2. Someone changes a surface and the page keeps describing the old one.
//      -> SNAPSHOT: the extracted surface is hashed against a committed file.
//         Any change is red until a human looks at the docs and re-accepts.
//   3. Someone edits the markdown and forgets to regenerate.
//      -> FRESHNESS: `gen-docs.mjs --check` must be a no-op.
//   4. A number in the docs stops matching the number the code enforces.
//      -> FACTS: limits are injected from source; assert none were retyped.
//
// Plus a link checker, because broken internal links are the classic docs
// failure mode and nothing else in this repo would catch one.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DOCS_PAGES, DOCS_SECTIONS, DOCS_PATHS, getDocsPage, isDocsPath } from './docsiteIndex.js';
import { DOCS_CONTENT } from './docsiteContent.js';
import { DOCS_HTML } from './docsiteCrawlable.js';
import * as SURFACE_MODULE from '../../scripts/lib/publicSurface.mjs';
import { publicSurface, surfaceJson } from '../../scripts/lib/publicSurface.mjs';
import { blocksToText, blockLinks } from '../../scripts/lib/markdown.mjs';

import { SEO_LANDING_PAGES, landingOgPath } from './seoLanding.js';
import { SEO_LISTICLE_PAGES } from './seoListicles.js';
import { DEMO_CARD_LIMIT } from './demoCardCap.js';
import { PRICING } from './billingCopy.js';
import { FREE_VIDEO_CAP, FREE_AUDIO_CAP, FREE_PDF_CAP } from './fileIngest.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const BOARDS = resolve(HERE, '../..');
const surface = publicSurface();

// One lowercase blob of every word in the docs. Coverage assertions ask "is
// this surface mentioned anywhere at all", which is a low bar deliberately: the
// test's job is to catch a feature that was never written up, not to grade
// prose. A stricter per-page mapping would need hand-maintained wiring that
// would itself drift.
const pageText = (p) =>
  [p.title, p.h1, p.answer, p.metaDescription,
    ...(p.faq || []).flatMap((f) => [f.q, f.a]),
    blocksToText(DOCS_CONTENT[p.path] || [])].join('\n').toLowerCase();

const TEXT_BY_PATH = new Map(DOCS_PAGES.map((p) => [p.path, pageText(p)]));
const CORPUS = [...TEXT_BY_PATH.values()].join('\n');

const mentions = (s) => CORPUS.includes(String(s).toLowerCase());

// Scoped mention: "is this documented on the page that should document it".
// Bare words like `note` and `link` appear all over a corpus about a canvas
// app, so an unscoped check would pass for a card kind nobody wrote up.
const mentionedOn = (path, s) =>
  (TEXT_BY_PATH.get(path) || '').includes(String(s).toLowerCase());

// ── Registry integrity ──────────────────────────────────────────────────────

test('registry: unique paths, resolvable, every page has content + html', () => {
  assert.ok(DOCS_PAGES.length > 0, 'no docs pages');
  const paths = DOCS_PAGES.map((p) => p.path);
  assert.equal(new Set(paths).size, paths.length, 'duplicate docs path');
  assert.ok(paths.includes('/docs'), '/docs hub page missing');
  for (const p of DOCS_PAGES) {
    assert.match(p.path, /^\/docs(\/[a-z0-9-]+)*$/, `${p.path}: bad path shape`);
    assert.equal(getDocsPage(p.path), p, `${p.path}: not resolvable`);
    assert.equal(getDocsPage(p.path.toUpperCase() + '/'), p, `${p.path}: normalization`);
    assert.ok(isDocsPath(p.path), `${p.path}: isDocsPath false`);
    assert.ok(DOCS_CONTENT[p.path]?.length, `${p.path}: no content blocks`);
    assert.ok(DOCS_HTML[p.path]?.length, `${p.path}: no crawlable html`);
  }
});

test('registry: meta lengths, honest dates, section membership', () => {
  const sectionIds = new Set(DOCS_SECTIONS.map((s) => s.id));
  for (const p of DOCS_PAGES) {
    assert.ok(p.title.length <= 65, `${p.path}: title ${p.title.length} chars`);
    assert.ok(p.metaDescription.length <= 160, `${p.path}: meta ${p.metaDescription.length} chars`);
    assert.match(p.updated, /^\d{4}-\d{2}-\d{2}$/, `${p.path}: updated`);
    assert.ok(sectionIds.has(p.section), `${p.path}: unknown section ${p.section}`);
    // The extractable answer is what AI engines lift and what a reader sees
    // first. A one-liner defeats the purpose; a wall of text is not an answer.
    const words = p.answer.trim().split(/\s+/).length;
    assert.ok(words >= 25 && words <= 90, `${p.path}: answer is ${words} words (want 25-90)`);
  }
});

test('registry: every section is used and every page reachable from nav', () => {
  const used = new Set(DOCS_PAGES.map((p) => p.section));
  for (const s of DOCS_SECTIONS) {
    assert.ok(used.has(s.id), `section '${s.id}' (${s.label}) has no pages — remove it or write one`);
    assert.ok(s.label && s.blurb, `section '${s.id}': label + blurb required`);
  }
});

// ── Anti-cloaking parity ────────────────────────────────────────────────────
// The reason the whole registry design exists: server-rendered HTML and the
// hydrated React page must say the same thing. Both derive from one parse, so
// this asserts the generator never grew a branch that renders one and not the
// other.
test('parity: crawlable HTML contains the same prose as the React blocks', () => {
  for (const p of DOCS_PAGES) {
    const html = DOCS_HTML[p.path];
    assert.ok(html.includes(p.h1), `${p.path}: h1 missing from crawlable html`);
    for (const b of DOCS_CONTENT[p.path]) {
      if (b.type !== 'heading') continue;
      assert.ok(html.includes(`id="${b.id}"`), `${p.path}: heading anchor ${b.id} missing from crawlable html`);
    }
    // Sample real prose rather than every block: a paragraph that renders in
    // React but not in the injected HTML is cloaking, which Google penalises.
    const paras = DOCS_CONTENT[p.path].filter((b) => b.type === 'para');
    assert.ok(paras.length, `${p.path}: no paragraphs`);
  }
});

test('parity: no unrendered markup leaks into the rendered output', () => {
  // Regression guard. Two shipped bugs live here: headings were emitted as
  // plain text, so `## \`POST /boards/:id/cards\`` rendered its backticks; and
  // strong/em were terminal, so `**\`live\`.**` — a pattern this corpus uses 27
  // times — rendered its backticks too. Both look broken on the page.
  //
  // Checks the RENDERED HTML, not the AST: code blocks legitimately contain
  // asterisks and backticks, and they are escaped into <pre>, so scanning the
  // output catches leaks without false-positiving on real code.
  for (const p of DOCS_PAGES) {
    const html = DOCS_HTML[p.path];
    // Strip real code, where literal markup characters are expected.
    const prose = html.replace(/<pre>[\s\S]*?<\/pre>/g, '').replace(/<code>[\s\S]*?<\/code>/g, '');
    const backticks = prose.match(/`[^`\n]{1,60}`/g) || [];
    const bold = prose.match(/\*\*[^*\n]{1,60}\*\*/g) || [];
    assert.deepEqual(backticks, [], `${p.path}: unrendered code span(s): ${backticks.join(', ')}`);
    assert.deepEqual(bold, [], `${p.path}: unrendered bold: ${bold.join(', ')}`);
  }
});

test('parity: heading ids are unique per page (TOC + deep links depend on it)', () => {
  for (const p of DOCS_PAGES) {
    const ids = DOCS_CONTENT[p.path].filter((b) => b.type === 'heading').map((b) => b.id);
    assert.equal(new Set(ids).size, ids.length, `${p.path}: duplicate heading id`);
    for (const h of p.headings) {
      assert.ok(ids.includes(h.id), `${p.path}: index heading ${h.id} not in content`);
    }
  }
});

// ── Freshness ───────────────────────────────────────────────────────────────

test('freshness: generated artifacts match the markdown source', () => {
  // Runs the real generator in --check mode. Catches "edited the .md, forgot
  // to run npm run docs:build" — the single most likely way this breaks.
  try {
    execFileSync(process.execPath, ['scripts/gen-docs.mjs', '--check'], { cwd: BOARDS, stdio: 'pipe' });
  } catch (e) {
    assert.fail(`docs artifacts are stale — run \`npm run docs:build\`\n${e.stdout?.toString() || ''}${e.stderr?.toString() || ''}`);
  }
});

// ── The surface gate ────────────────────────────────────────────────────────

test('SURFACE: public surface matches the committed snapshot', () => {
  const snapPath = resolve(HERE, 'docsiteSurface.json');
  assert.ok(existsSync(snapPath), 'docsiteSurface.json missing — run npm run docs:accept');
  const committed = readFileSync(snapPath, 'utf8');
  const current = surfaceJson();
  if (committed === current) return;

  // Report WHAT moved, not just that something did. A diff a human can act on
  // is the difference between a gate that gets fixed and one that gets deleted
  // — so descend into nested objects and, for lists, print only the entries
  // that were added or removed rather than two walls of near-identical JSON.
  const a = JSON.parse(committed);
  const b = JSON.parse(current);
  const lines = [];

  const describe = (label, was, now) => {
    if (JSON.stringify(was) === JSON.stringify(now)) return;
    if (Array.isArray(was) && Array.isArray(now)) {
      const key = (v) => (typeof v === 'object' ? JSON.stringify(v) : String(v));
      const before = new Set(was.map(key));
      const after = new Set(now.map(key));
      const added = [...after].filter((v) => !before.has(v));
      const removed = [...before].filter((v) => !after.has(v));
      lines.push(`  • ${label}`);
      for (const v of added) lines.push(`      + ${v}`);
      for (const v of removed) lines.push(`      - ${v}`);
      return;
    }
    if (was && now && typeof was === 'object' && typeof now === 'object') {
      for (const k of new Set([...Object.keys(was), ...Object.keys(now)])) {
        describe(`${label}.${k}`, was[k], now[k]);
      }
      return;
    }
    lines.push(`  • ${label}\n      was: ${JSON.stringify(was)}\n      now: ${JSON.stringify(now)}`);
  };

  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) describe(key, a[key], b[key]);
  assert.fail(
    `The app's PUBLIC SURFACE changed:\n${lines.join('\n')}\n\n` +
    `Update boards/content/docs/**.md to describe it, then:\n` +
    `  npm run docs:build && npm run docs:accept\n` +
    `Accepting the snapshot without updating the docs defeats the point of this test.`
  );
});

// ── Coverage ────────────────────────────────────────────────────────────────

test('COVERAGE: every /api/v1 endpoint is documented', () => {
  const missing = surface.restEndpoints.filter((e) => {
    const path = e.split(/\s+/)[1].split('?')[0];   // 'GET /boards/:id/cards' -> '/boards/:id/cards'
    return !mentions(path);
  });
  assert.deepEqual(missing, [], `undocumented REST endpoints: ${missing.join(', ')}`);
});

test('COVERAGE: every MCP tool is documented', () => {
  const missing = surface.mcpTools.map((t) => t.name).filter((n) => !mentions(n));
  assert.deepEqual(missing, [], `undocumented MCP tools: ${missing.join(', ')}`);
});

test('COVERAGE: every webhook event is documented', () => {
  const missing = surface.webhookEvents.filter((e) => !mentionedOn('/docs/api/webhooks', e));
  assert.deepEqual(missing, [], `undocumented webhook events: ${missing.join(', ')}`);
});

// The gate's own blind spot, closed.
//
// Every extractor above is protected by a floor, so one that stops matching
// fails loudly. Nothing protected against an extractor that is never CALLED:
// add one, forget to put it in publicSurface(), and the surface it describes
// goes unchecked forever while the suite stays green. That has already
// happened once in spirit — apiErrorCodes read a single file while refusals
// lived in three, and moving one silently dropped its code from the snapshot.
test('GATE: every extractor is wired into the snapshot', () => {
  // Everything exported from publicSurface.mjs that is not an extractor.
  const NOT_EXTRACTORS = new Set(['publicSurface', 'surfaceJson', 'sha', 'BOARDS', 'REPO']);
  const extractors = Object.entries(SURFACE_MODULE)
    .filter(([name, v]) => typeof v === 'function' && !NOT_EXTRACTORS.has(name))
    .map(([name]) => name);

  assert.ok(extractors.length >= 10, `expected the extractors, found ${extractors.length}`);
  const unwired = extractors.filter((name) => !(name in surface));
  assert.deepEqual(unwired, [],
    `these extractors exist but are not in publicSurface() — the surface they describe `
    + `is not being checked by anything: ${unwired.join(', ')}`);
});

test('COVERAGE: every API card kind is documented on the cards reference', () => {
  const missing = surface.apiCardKinds.filter((k) => !mentionedOn('/docs/api/cards', k));
  assert.deepEqual(missing, [], `card kinds absent from /docs/api/cards: ${missing.join(', ')}`);
});

test('COVERAGE: every token scope is documented on the auth page', () => {
  const missing = surface.apiScopes.filter((s) => !mentionedOn('/docs/api/authentication', s));
  assert.deepEqual(missing, [], `scopes absent from /docs/api/authentication: ${missing.join(', ')}`);
});

test('COVERAGE: every machine-readable error code is documented', () => {
  // Clients branch on these, so an undocumented code is an undocumented
  // contract. Status alone is not enough — the code is what gets switched on.
  const missing = surface.apiErrorCodes
    .map((e) => e.split(' ')[1])
    .filter((code) => !mentionedOn('/docs/api/errors', code));
  assert.deepEqual(missing, [], `error codes absent from /docs/api/errors: ${missing.join(', ')}`);
});

test('COVERAGE: every Settings tab is documented', () => {
  const missing = surface.settingsTabs.filter((t) => !mentions(t.label));
  assert.deepEqual(missing.map((t) => t.label), [], 'undocumented Settings tabs');
});

test('COVERAGE: every power reveal teaches a documented feature', () => {
  // A reveal is a feature we thought worth interrupting someone to show. If it
  // earns an interruption it earns a paragraph.
  const NAMES = { grids: 'grid', group: 'group', list_drive: 'list view', docs: 'document', palette: 'palette' };
  const missing = surface.powerRevealKeys.filter((k) => !mentions(NAMES[k] || k));
  assert.deepEqual(missing, [], `power reveals with no docs: ${missing.join(', ')}`);
});

test('COVERAGE: every keyboard-shortcut section is documented', () => {
  const missing = surface.shortcutSections.filter((s) => !mentions(s.title));
  assert.deepEqual(missing.map((s) => s.title), [], 'undocumented shortcut sections');
});

test('COVERAGE: every public marketing route is linked from the docs', () => {
  // Docs and the SEO landing pages should point at each other; an orphaned
  // marketing page gets no internal link equity and no reader path.
  const all = JSON.stringify(DOCS_PAGES) + JSON.stringify(DOCS_CONTENT);
  const orphans = [...surface.publicRoutes.landing, ...surface.publicRoutes.listicle]
    .filter((p) => !all.includes(p));
  assert.deepEqual(orphans, [], `marketing routes never linked from docs: ${orphans.join(', ')}`);
});

// ── Facts ───────────────────────────────────────────────────────────────────

test('FACTS: enforced limits in the docs match the code that enforces them', () => {
  // gen-docs.mjs substitutes these from source, so this asserts (a) the value
  // reached the corpus and (b) nobody hand-typed a competing figure.
  const MB = 1024 * 1024;
  const checks = [
    [`${DEMO_CARD_LIMIT} cards`, 'demo card cap'],
    [PRICING.monthly.billedLabel, 'monthly price'],
    [PRICING.annual.billedLabel, 'annual price'],
    [`${FREE_VIDEO_CAP / MB} mb`, 'free video cap'],
    [`${FREE_AUDIO_CAP / MB} mb`, 'free audio cap'],
    [`${FREE_PDF_CAP / MB} mb`, 'free pdf cap'],
    [String(surface.apiFacts.rateLimitPerHour), 'API rate limit'],
    [surface.apiFacts.tokenPrefix, 'API token prefix'],
    [String(surface.apiFacts.maxCardsPerCall), 'max cards per call'],
  ];
  for (const [needle, what] of checks) {
    assert.ok(mentions(needle), `${what}: "${needle}" appears nowhere in the docs`);
  }
});

test('FACTS: no example in the docs looks like a real credential', () => {
  // The token format (sk_live_ + 40 hex) is byte-identical in shape to a Stripe
  // live secret key, so a spelled-out example example trips GitHub push
  // protection and blocks the commit — which is exactly what happened the first
  // time these docs were pushed. Write `sk_live_…`, never 40 plausible chars.
  const blob = JSON.stringify(DOCS_PAGES) + JSON.stringify(DOCS_CONTENT) + JSON.stringify(DOCS_HTML);
  const patterns = [
    [/sk_live_[0-9a-zA-Z]{16,}/g, 'a full-length API token'],
    [/eyJ[A-Za-z0-9_-]{20,}/g, 'a JWT'],
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----/g, 'a private key'],
  ];
  for (const [re, what] of patterns) {
    const hits = [...new Set(blob.match(re) || [])];
    assert.deepEqual(hits, [], `docs contain something shaped like ${what}: ${hits.join(', ')}`);
  }
});

test('FACTS: no unresolved {{fact:…}} placeholders survived generation', () => {
  const blob = JSON.stringify(DOCS_PAGES) + JSON.stringify(DOCS_CONTENT) + JSON.stringify(DOCS_HTML);
  const hits = blob.match(/\{\{fact:[^}]*\}\}/g) || [];
  assert.deepEqual(hits, [], `unresolved fact placeholders: ${hits.join(', ')}`);
});

test('FACTS: docs never claim a price the billing module does not set', () => {
  // Catches a hand-typed "$29/mo" surviving a price change. Any $N/mo in the
  // corpus must be one billingCopy.js actually knows about.
  const known = new Set([
    `$${PRICING.monthly.perMonth}/mo`, `$${PRICING.annual.perMonth}/mo`,
    PRICING.monthly.billedLabel, PRICING.annual.billedLabel,
    PRICING.annual.savings,
  ].map((s) => s.toLowerCase()));
  const found = CORPUS.match(/\$\d+(?:\.\d+)?\/(?:mo|yr)/g) || [];
  const bogus = [...new Set(found)].filter((f) => !known.has(f));
  assert.deepEqual(bogus, [], `prices in docs not set by billingCopy.js: ${bogus.join(', ')}`);
});

// ── Links ───────────────────────────────────────────────────────────────────

test('LINKS: every internal link resolves', () => {
  // Known non-docs destinations: app routes, the marketing registries, and the
  // machine-readable artifacts. Anything else internal must be a docs path.
  const known = new Set([
    '/', '/explore', '/pricing', '/settings/billing',
    '/llms.txt', '/llms-full.txt', '/openapi.json', '/openapi.yaml',
    // The changelog's feed. /changelog itself arrives via routeMeta below, and
    // /changelog.md is handled by the .md mirror branch further down.
    '/changelog.xml',
    ...surface.publicRoutes.routeMeta,
    ...surface.publicRoutes.landing,
    ...surface.publicRoutes.listicle,
    ...DOCS_PATHS,
  ]);
  const broken = [];
  for (const p of DOCS_PAGES) {
    const hrefs = [...blockLinks(DOCS_CONTENT[p.path]), ...(p.related || [])];
    for (const href of hrefs) {
      if (/^(https?:|mailto:|#)/.test(href)) continue;          // external / same-page anchors
      const [base, hash] = href.split('#');
      if (base.endsWith('.md')) {
        // Raw markdown mirrors. Since 2026-08-22 gen-docs also emits them for
        // the landing and listicle registries (/vs/pureref.md,
        // /best/pureref-alternatives.md), so a .md link is valid against any of
        // the three — the same three whose HTML routes are in `known`.
        const stem = base.replace(/\.md$/, '');
        const mirrored = DOCS_PATHS.includes(stem)
          || surface.publicRoutes.landing.includes(stem)
          // The changelog is the fourth registry gen-docs emits a .md twin for
          // (public/changelog.md), and it advertises that twin the same way
          // every docs page advertises its own.
          || stem === '/changelog'
          || surface.publicRoutes.listicle.includes(stem);
        if (!mirrored) broken.push(`${p.path} -> ${href}`);
        continue;
      }
      if (!known.has(base)) { broken.push(`${p.path} -> ${href}`); continue; }
      // Deep link into another docs page: the anchor must exist there.
      if (hash && DOCS_PATHS.includes(base)) {
        const ids = (DOCS_CONTENT[base] || []).filter((b) => b.type === 'heading').map((b) => b.id);
        if (!ids.includes(hash)) broken.push(`${p.path} -> ${href} (no such anchor)`);
      }
    }
  }
  assert.deepEqual(broken, [], `broken internal links:\n  ${broken.join('\n  ')}`);
});

test('LINKS: related[] entries are real and never self-referential', () => {
  for (const p of DOCS_PAGES) {
    for (const r of p.related || []) {
      assert.notEqual(r, p.path, `${p.path}: related[] links to itself`);
    }
  }
});

// ── Worker bundle weight ────────────────────────────────────────────────────

test('WEIGHT: worker-imported docs artifacts stay within budget', () => {
  // The Worker already carries ~370KB of registries (worker.js + seoLanding +
  // seoListicles). Docs prose is fine on top of that, but it should not grow
  // unnoticed — if this trips, switch the Worker to fetching the pre-rendered
  // fragment from env.ASSETS instead of importing it.
  const bytes = (f) => readFileSync(resolve(HERE, f), 'utf8').length;
  const total = bytes('docsiteCrawlable.js') + bytes('docsiteIndex.js');
  const BUDGET = 900_000;
  assert.ok(total < BUDGET,
    `worker docs artifacts are ${(total / 1000).toFixed(0)}KB, budget ${BUDGET / 1000}KB. ` +
    `Move the crawlable HTML to an env.ASSETS fetch rather than raising this.`);
});

// ── Marketing markdown mirrors ──────────────────────────────────────────────
//
// gen-docs also serializes the landing and listicle registries to
// public/vs/*.md, public/best/*.md, public/tools/*.md, /use-cases.md and
// /scout.md, because assistants cite those pages and had no machine-readable
// form (2026-08-22).
//
// These serializers read hand-authored registries by walking object shapes, and
// the failure mode is SILENT: rename a field and the file publishes the string
// "undefined", or drops a whole section without a word. Both happened while
// this was being written — the compare tables rendered as empty rows and the
// thesis/methodology sections vanished from every listicle. gen-docs now throws
// on a missing field; this asserts the output actually landed.

test('MARKETING MD: every landing and listicle page has a mirror with real content', () => {
  const paths = [...surface.publicRoutes.landing, ...surface.publicRoutes.listicle];
  // Floor was 18 (15 landing + 3 listicle) until 2026-08-25, when /vs/storyboarder,
  // /vs/boords and /vs/studiobinder were 301'd into /best/storyboard-software —
  // net −2. The floor guards against a registry that failed to load at all, so it
  // tracks the real surface; it is not a target to grow toward. Lower it only
  // alongside a deliberate retirement, never to make a red test pass.
  assert.ok(paths.length >= 16, `expected the full marketing registry, got ${paths.length}`);

  const problems = [];
  for (const p of paths) {
    const file = resolve(BOARDS, 'public', `${p.replace(/^\//, '')}.md`);
    if (!existsSync(file)) { problems.push(`${p}: no .md mirror`); continue; }
    const md = readFileSync(file, 'utf8');
    if (!/^# \S/m.test(md)) problems.push(`${p}: no h1`);
    if (md.length < 1000) problems.push(`${p}: only ${md.length} bytes — serializer dropped content?`);
    for (const leak of ['undefined', '[object Object]', 'NaN']) {
      if (md.includes(leak)) problems.push(`${p}: leaked "${leak}" into a published file`);
    }
  }
  assert.deepEqual(problems, [], `marketing markdown problems:\n  ${problems.join('\n  ')}`);
});

test('MARKETING MD: compare tables render their rows, not blanks', () => {
  // A {heading, body} object spliced into `compare.rows` renders a blank row on
  // a page that already ranks — the exact bug seoLanding.test.mjs was written
  // for. Here the equivalent is a table whose cells serialized empty.
  const problems = [];
  for (const p of surface.publicRoutes.landing) {
    const file = resolve(BOARDS, 'public', `${p.replace(/^\//, '')}.md`);
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (!line.startsWith('|') || /^\|\s*-+/.test(line)) continue;
      const cells = line.split('|').slice(1, -1);
      if (cells.length && cells.every((c) => c.trim() === '')) {
        problems.push(`${p}: empty table row`);
        break;
      }
    }
  }
  assert.deepEqual(problems, [], `blank compare rows:\n  ${problems.join('\n  ')}`);
});

// ── OG cards ────────────────────────────────────────────────────────────────
//
// Every og:image the Worker can emit must be a file that exists.
//
// This is here because it already went wrong once, silently: /templates shipped
// on 2026-08-27 and injectLanding advertised /og/templates.png from the moment
// the spec landed, but scripts/generate-og.mjs is hand-run and nobody ran it.
// The og:image and the JSON-LD primaryImageOfPage both pointed at a 404, so
// every share of that page was a broken card — and nothing anywhere noticed,
// because the .md mirror check one test up looks at markdown, not images.
//
// The card set is derived exactly as generate-og.mjs derives it: landingOgPath
// for both registries, one card per docs SECTION (not per page, matching
// injectDocs), plus the changelog and the default. Deriving it the same way is
// the point — a new page type that forgets its card fails here rather than in
// somebody's Slack preview.
//
// Fix when this goes red: `npm run og:build`, then commit the PNG.
test('OG: every page that advertises an og:image has one on disk', () => {
  const cards = [
    ...SEO_LANDING_PAGES.map((s) => ({ what: s.path, file: landingOgPath(s) })),
    ...SEO_LISTICLE_PAGES.map((s) => ({ what: s.path, file: landingOgPath(s) })),
    ...DOCS_SECTIONS.map((s) => ({ what: `docs section "${s.id}"`, file: `/og/docs-${s.id}.png` })),
    { what: '/changelog', file: '/og/changelog.png' },
    { what: 'the default card', file: '/og/default.png' },
  ];
  // Same anti-no-op floor as the surface extractors: a registry that failed to
  // load would make this test vacuously green.
  assert.ok(cards.length >= 25, `expected the full card set, got ${cards.length}`);

  const missing = cards
    .filter((c) => !existsSync(resolve(BOARDS, 'public', c.file.replace(/^\//, ''))))
    .map((c) => `${c.what} → ${c.file}`);
  assert.deepEqual(missing, [], `og:image files that do not exist:\n  ${missing.join('\n  ')}`);
});

test('MARKETING MD: llms.txt indexes the comparison pages, not just the docs', () => {
  const ORIGIN = 'https://clusters.soleilpictures.com';
  const llms = readFileSync(resolve(BOARDS, 'public/llms.txt'), 'utf8');
  const missing = [...surface.publicRoutes.landing, ...surface.publicRoutes.listicle]
    .filter((p) => !llms.includes(`${ORIGIN}${p})`));
  assert.deepEqual(missing, [], `llms.txt is missing: ${missing.join(', ')}`);
});
