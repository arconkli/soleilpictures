#!/usr/bin/env node
// gen-docs.mjs — compile boards/content/docs/**.md into everything the docs
// site needs. Runs as part of the `prebuild` hook, beside stamp-build.mjs.
//
// ONE SOURCE, FIVE CONSUMERS. The reason this script exists rather than a docs
// framework is that the same prose has to reach five places without drifting:
//
//   src/lib/docsiteIndex.js      light nav/meta — Worker, React, sitemap, tests
//   src/lib/docsiteContent.js    block AST      — the code-split React page
//   src/lib/docsiteCrawlable.js  escaped HTML   — the Worker's <main> injection
//   public/docs/**.md            raw markdown   — AI agents, curl
//   public/llms.txt + -full.txt  corpus index   — AI agents
//
// The Worker gets pre-rendered HTML instead of the AST so its bundle carries
// prose and nothing else; React gets the AST so it can render real components.
// Both derive from one parse, which is what makes server-rendered and hydrated
// text identical — the anti-cloaking property the whole registry design exists
// to protect (see the header of src/lib/seoLanding.js).
//
// OUTPUTS ARE COMMITTED. Cloudflare Workers Builds must never depend on this
// script succeeding, and a reviewer should see prose changes in the diff.
// `--check` asserts regeneration is a no-op, which is how docsite.test.mjs
// catches "edited the .md, forgot to regenerate".
//
// Usage:
//   node scripts/gen-docs.mjs                  write all artifacts
//   node scripts/gen-docs.mjs --check          exit 1 if anything would change
//   node scripts/gen-docs.mjs --accept-surface also re-snapshot the public surface

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { resolve, dirname, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseMarkdown, parseInline, inlineText, blocksToText, blockLinks, slugify } from './lib/markdown.mjs';
import {
  surfaceJson, apiFacts,
  apiCardKinds as apiCardKindsList,
  apiScopes as apiScopeList,
  mcpProtocol as mcpProtocolSurface,
  layoutAlgorithms as layoutAlgorithmList,
} from './lib/publicSurface.mjs';

import { DEMO_CARD_LIMIT, LEGACY_DEMO_CARD_LIMIT } from '../src/lib/demoCardCap.js';
import { PLAN_NAME, PRICING, CREATOR_FEATURES } from '../src/lib/billingCopy.js';
import { FREE_VIDEO_CAP, FREE_AUDIO_CAP, FREE_PDF_CAP } from '../src/lib/fileIngest.js';
import { MAX_IMPORT_ITEMS, IMPORT_TIMEOUT_MS, SOURCE_SCOPE } from '../src/lib/importManifest.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const BOARDS = resolve(HERE, '..');
const CONTENT = resolve(BOARDS, 'content/docs');
const SITE_ORIGIN = 'https://clusters.soleilpictures.com';

const CHECK = process.argv.includes('--check');
const ACCEPT_SURFACE = process.argv.includes('--accept-surface');

const changed = [];

// ── Facts ───────────────────────────────────────────────────────────────────
// Numbers docs are FORBIDDEN from retyping. `{{fact:demoCardLimit}}` in a
// markdown file is substituted here from the module that actually enforces the
// limit, so a doc physically cannot state a stale figure. billingCopy.js
// already carries the rule that every pricing claim name its enforcing code;
// this is that rule made mechanical.
const MB = 1024 * 1024;
const storageMatch = CREATOR_FEATURES.join(' ').match(/\*\*(\d+\s*GB)\*\*/i);
if (!storageMatch) {
  throw new Error('gen-docs: storage figure not found in CREATOR_FEATURES — update the extractor in gen-docs.mjs');
}
const api = apiFacts();

export const FACTS = {
  demoCardLimit: String(DEMO_CARD_LIMIT),
  // The cap accounts created before migration 0227 keep, permanently. The plans
  // page states the grandfather rule; both cohorts are real, so both numbers
  // have to come from code rather than being typed into the markdown.
  legacyDemoCardLimit: String(LEGACY_DEMO_CARD_LIMIT),
  planName: PLAN_NAME,
  priceMonthly: PRICING.monthly.billedLabel,
  priceAnnual: PRICING.annual.billedLabel,
  priceAnnualPerMonth: PRICING.annual.perMonthLabel,
  annualSavings: PRICING.annual.savings,
  creatorStorage: storageMatch[1].replace(/\s+/g, ''),
  freeVideoCap: `${FREE_VIDEO_CAP / MB} MB`,
  freeAudioCap: `${FREE_AUDIO_CAP / MB} MB`,
  freePdfCap: `${FREE_PDF_CAP / MB} MB`,
  maxCardsPerCall: String(api.maxCardsPerCall),
  maxBoardsPerCall: String(api.maxBoardsPerCall),
  maxPartsPerCall: String(api.maxPartsPerCall),
  rateLimitPerHour: String(api.rateLimitPerHour),
  serviceRateLimitPerHour: String(api.serviceRateLimitPerHour),
  maxServiceAccounts: String(api.maxServiceAccounts),
  maxWebhooks: String(api.maxWebhooks),
  maxIdentifiersPerObject: String(api.maxIdentifiersPerObject),
  maxPropsBytes: String(api.maxPropsBytes),
  maxPropKeys: String(api.maxPropKeys),
  maxTokensPerAccount: String(api.maxTokensPerAccount),
  maxConnectedApps: String(api.maxConnectedApps),
  oauthAccessTtl: `${api.oauthAccessTtlMinutes} minutes`,
  oauthRefreshDays: String(api.oauthRefreshDays),
  oauthCodeTtl: `${api.oauthCodeTtlSeconds} seconds`,
  oauthMaxRedirectUris: String(api.oauthMaxRedirectUris),
  tokenPrefix: api.tokenPrefix,
  maxPage: String(api.maxPage),
  defaultPage: String(api.defaultPage),
  maxUploadMb: `${api.maxUploadMb} MB`,
  cardTitleMax: String(api.titleMax),
  cardBodyMax: String(api.bodyMax),
  cardHtmlMax: String(api.htmlMax),
  cardUrlMax: String(api.urlMax),
  cardImageKeyMax: String(api.imageKeyMax),
  // Rendered from the union the Worker actually accepts, so a new kind shows up
  // in the docs the moment it is added rather than whenever someone remembers.
  apiCardKinds: apiCardKindsList().map((k) => `\`${k}\``).join(', '),
  apiScopes: apiScopeList().map((s) => `\`${s}\``).join(' · '),
  // Read out of the server's own SUPPORTED_PROTOCOL_VERSIONS. A version we
  // claim in the docs but do not accept is worse than one we never mention:
  // the client fails at connection time with nothing useful to read.
  mcpProtocolVersions: mcpProtocolSurface().versions.map((v) => `\`${v}\``).join(' · '),
  mcpProtocolLatest: mcpProtocolSurface().versions[0],
  maxImportItems: String(MAX_IMPORT_ITEMS),
  importTimeoutSeconds: String(IMPORT_TIMEOUT_MS / 1000),
  importSourceScope: SOURCE_SCOPE,
  layoutAlgorithms: layoutAlgorithmList().map((l) => `\`${l}\``).join(' · '),
  maxCardsPerArrange: String(api.maxCardsPerCall ?? 1000),
  siteOrigin: SITE_ORIGIN,
};

function resolveFacts(text, where) {
  return text.replace(/\{\{fact:([a-zA-Z][a-zA-Z0-9]*)\}\}/g, (_, key) => {
    if (!(key in FACTS)) {
      throw new Error(`${where}: unknown {{fact:${key}}} — add it to FACTS in scripts/gen-docs.mjs (sourced from real code, never typed by hand)`);
    }
    return FACTS[key];
  });
}

// ── Frontmatter ─────────────────────────────────────────────────────────────
// A strict, tiny YAML subset: `key: scalar`, `key:` + `- item` lists, and one
// nested form (`faq:` → `- q: …` / `a: …`). Strict on purpose — a real YAML
// parser would accept shapes the emitters below don't handle and fail later,
// further from the mistake.
function parseFrontmatter(raw, file) {
  if (!raw.startsWith('---\n')) throw new Error(`${file}: missing --- frontmatter block`);
  const end = raw.indexOf('\n---', 3);
  if (end === -1) throw new Error(`${file}: unterminated frontmatter`);
  const head = raw.slice(4, end);
  const body = raw.slice(raw.indexOf('\n', end + 1) + 1);

  const fm = {};
  let listKey = null;
  let faq = null;
  for (const line of head.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const item = line.match(/^\s+-\s+(.*)$/);
    if (item && listKey) {
      const qa = item[1].match(/^q:\s*(.*)$/);
      if (listKey === 'faq' && qa) { faq.push({ q: unquote(qa[1]), a: '' }); continue; }
      fm[listKey].push(unquote(item[1]));
      continue;
    }
    const cont = line.match(/^\s+a:\s*(.*)$/);
    if (cont && listKey === 'faq' && faq.length) { faq[faq.length - 1].a = unquote(cont[1]); continue; }

    const kv = line.match(/^([a-zA-Z][a-zA-Z0-9]*):\s*(.*)$/);
    if (!kv) throw new Error(`${file}: cannot parse frontmatter line: ${line}`);
    const [, key, val] = kv;
    if (val === '') {
      listKey = key;
      if (key === 'faq') { faq = []; fm.faq = faq; } else fm[key] = [];
    } else {
      listKey = null;
      fm[key] = unquote(val);
    }
  }
  return { fm, body };
}
const unquote = (s) => s.trim().replace(/^["'](.*)["']$/, '$1');

// ── Load ────────────────────────────────────────────────────────────────────
function walk(dir, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.name.endsWith('.md')) acc.push(p);
  }
  return acc;
}

// content/docs/index.md        -> /docs
// content/docs/canvas/index.md -> /docs/canvas
// content/docs/canvas/grids.md -> /docs/canvas/grids
function pathFor(file) {
  const rel = relative(CONTENT, file).replace(/\\/g, '/').replace(/\.md$/, '');
  if (rel === 'index') return '/docs';
  return '/docs/' + rel.replace(/\/index$/, '');
}

const SECTIONS_FILE = resolve(CONTENT, '_sections.json');

function loadPages() {
  if (!existsSync(CONTENT)) throw new Error(`gen-docs: no content directory at ${CONTENT}`);
  const sections = JSON.parse(readFileSync(SECTIONS_FILE, 'utf8'));
  const sectionIds = new Set(sections.map((s) => s.id));

  // Validation errors are COLLECTED, not thrown one at a time. Authoring a
  // batch of pages and being told about one over-long description per run is a
  // miserable loop; every problem in the corpus should surface in one pass.
  const problems = [];

  const pages = walk(CONTENT).sort().map((file) => {
    const label = relative(BOARDS, file);
    const raw = resolveFacts(readFileSync(file, 'utf8'), label);
    const { fm, body } = parseFrontmatter(raw, label);
    const bad = (msg) => problems.push(`${label}: ${msg}`);

    for (const req of ['title', 'metaDescription', 'h1', 'answer', 'section', 'updated']) {
      if (!fm[req]) bad(`frontmatter '${req}' is required`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fm.updated || '')) bad('updated must be YYYY-MM-DD');
    if (!sectionIds.has(fm.section)) bad(`section '${fm.section}' not in content/docs/_sections.json`);
    // Enforced so the generated <title>/description can't silently be truncated
    // by Google. Same ceilings seoListicles.test.mjs holds its registry to.
    if ((fm.title || '').length > 65) bad(`title ${fm.title.length} chars (max 65)`);
    if ((fm.metaDescription || '').length > 160) bad(`metaDescription ${fm.metaDescription.length} chars (max 160)`);

    const blocks = parseMarkdown(body);
    return {
      path: pathFor(file),
      file: label,
      title: fm.title,
      metaDescription: fm.metaDescription,
      h1: fm.h1,
      answer: fm.answer,
      section: fm.section,
      order: Number(fm.order || 0),
      updated: fm.updated,
      related: fm.related || [],
      faq: (fm.faq || []).filter((f) => f.q && f.a),
      navLabel: fm.navLabel || fm.h1,
      blocks,
      headings: blocks.filter((b) => b.type === 'heading' && b.depth === 2).map((b) => ({ id: b.id, text: b.text })),
      rawMarkdown: body.trim(),
    };
  });

  const seen = new Set();
  for (const p of pages) {
    if (seen.has(p.path)) problems.push(`duplicate docs path ${p.path}`);
    seen.add(p.path);
  }
  if (!seen.has('/docs')) problems.push('content/docs/index.md (the /docs hub) is required');

  if (problems.length) {
    throw new Error(`gen-docs: ${problems.length} content problem(s):\n  - ${problems.join('\n  - ')}`);
  }

  // Nav order: section order from _sections.json, then `order`, then title.
  const rank = new Map(sections.map((s, i) => [s.id, i]));
  pages.sort((a, b) =>
    (rank.get(a.section) - rank.get(b.section)) || (a.order - b.order) || a.title.localeCompare(b.title));

  return { pages, sections };
}

// ── Emit: HTML (Worker) ─────────────────────────────────────────────────────
// Mirrors buildLandingCrawlableHtml in worker.js: inline styles, because this
// HTML lands in the SPA shell before any stylesheet the docs page owns has
// loaded. Every interpolation is escaped — this string is injected with
// html:true and does NOT get escaped downstream.
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Recursive, so bold-wrapping-code and bold links render as the markup they
// are. Must stay in lockstep with the <Inline> component in DocsPage.jsx —
// docsite.test.mjs asserts the two produce the same text.
function inlineHtml(nodes) {
  return (nodes || []).map((n) => {
    const inner = n.children ? inlineHtml(n.children) : escapeHtml(n.v);
    if (n.t === 'code') return `<code>${escapeHtml(n.v)}</code>`;   // terminal
    if (n.t === 'strong') return `<b>${inner}</b>`;
    if (n.t === 'em') return `<i>${inner}</i>`;
    if (n.t === 'link') return `<a href="${escapeHtml(n.href)}" style="color:#FFA500;">${inner}</a>`;
    return escapeHtml(n.v);
  }).join('');
}

function crawlableHtml(page) {
  const H2 = 'font-size:1.35rem;font-weight:600;margin:1.4em 0 .4em;';
  const H3 = 'font-size:1.08rem;font-weight:600;margin:1.1em 0 .3em;';
  const out = [];
  out.push(`<h1 style="font-size:1.9rem;font-weight:650;margin:0 0 .4em;">${escapeHtml(page.h1)}</h1>`);
  // The extractable, self-contained answer: the block AI answer engines lift,
  // and the first thing a reader sees. A lead paragraph, matching what React
  // renders — no box, no emphasis it has not earned.
  out.push(`<p style="color:#d0d0d4;font-size:1.1rem;margin:0 0 1.2em;">${escapeHtml(page.answer)}</p>`);
  const pretty = new Date(page.updated + 'T00:00:00Z')
    .toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
  out.push(`<p style="color:#8a8a92;font-size:.85rem;"><time datetime="${escapeHtml(page.updated)}">Updated ${escapeHtml(pretty)}</time></p>`);

  for (const b of page.blocks) {
    if (b.type === 'heading') {
      const tag = b.depth === 2 ? 'h2' : 'h3';
      // inlineHtml, not escapeHtml(b.text): API headings are code spans, and the
      // crawlable copy has to match what React renders (parity), not a
      // backtick-littered plaintext version of it.
      out.push(`<${tag} id="${escapeHtml(b.id)}" style="${b.depth === 2 ? H2 : H3}">${inlineHtml(b.inline)}</${tag}>`);
    } else if (b.type === 'para') {
      out.push(`<p>${inlineHtml(b.inline)}</p>`);
    } else if (b.type === 'list') {
      const tag = b.ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${b.items.map((it) => `<li>${inlineHtml(it)}</li>`).join('')}</${tag}>`);
    } else if (b.type === 'code') {
      out.push(`<pre><code>${escapeHtml(b.code)}</code></pre>`);
    } else if (b.type === 'callout') {
      out.push(`<blockquote style="border-left:1px solid #3a3a40;padding-left:1em;margin:1.2em 0;color:#888890;">${inlineHtml(b.inline)}</blockquote>`);
    } else if (b.type === 'hr') {
      out.push('<hr>');
    } else if (b.type === 'table') {
      out.push('<table><thead><tr>'
        + b.head.map((c) => `<th>${inlineHtml(c)}</th>`).join('')
        + '</tr></thead><tbody>'
        + b.rows.map((r) => `<tr>${r.map((c) => `<td>${inlineHtml(c)}</td>`).join('')}</tr>`).join('')
        + '</tbody></table>');
    }
  }

  if (page.faq.length) {
    out.push(`<section><h2 style="${H2}">Frequently asked questions</h2>`);
    for (const f of page.faq) out.push(`<h3 style="${H3}">${escapeHtml(f.q)}</h3><p>${escapeHtml(f.a)}</p>`);
    out.push('</section>');
  }
  if (page.related.length) {
    out.push('<nav aria-label="Related pages" style="margin-top:1.6em;"><h2 style="font-size:1.1rem;">Related</h2><ul>');
    for (const r of page.related) out.push(`<li><a href="${escapeHtml(r)}" style="color:#FFA500;">${escapeHtml(r)}</a></li>`);
    out.push('</ul></nav>');
  }
  // Every page advertises its own machine-readable twin. This is the single
  // cheapest thing that makes the corpus usable by an agent that landed here
  // from a search result rather than from llms.txt.
  out.push(`<p style="color:#8a8a92;font-size:.85rem;margin-top:2em;">Machine-readable: <a href="${escapeHtml(page.path)}.md" style="color:#FFA500;">${escapeHtml(page.path)}.md</a> · <a href="/llms.txt" style="color:#FFA500;">/llms.txt</a></p>`);

  return `<div style="max-width:820px;margin:0 auto;padding:14vh 24px 24px;"><article>${out.join('')}</article></div>`;
}

// ── Emit: files ─────────────────────────────────────────────────────────────
const BANNER = (src) => `// GENERATED by scripts/gen-docs.mjs from ${src} — DO NOT EDIT BY HAND.\n`
  + `// Edit the markdown, then run: npm run docs:build\n`;

function write(absPath, content) {
  const prev = existsSync(absPath) ? readFileSync(absPath, 'utf8') : null;
  if (prev === content) return;
  changed.push(relative(BOARDS, absPath));
  if (!CHECK) {
    mkdirSync(dirname(absPath), { recursive: true });
    writeFileSync(absPath, content);
  }
}

function emit({ pages, sections }) {
  // 1. Light index — imported by the Worker (meta, sitemap, 404 decisions), the
  //    React nav, and the tests. Deliberately excludes prose so importing it
  //    never drags the corpus into a chunk. Same firewall as seoListicleIndex.js.
  write(resolve(BOARDS, 'src/lib/docsiteIndex.js'),
    BANNER('content/docs/**/*.md') + `
export const DOCS_SECTIONS = ${JSON.stringify(sections, null, 2)};

export const DOCS_PAGES = ${JSON.stringify(pages.map((p) => ({
      path: p.path, title: p.title, metaDescription: p.metaDescription, h1: p.h1,
      answer: p.answer, section: p.section, order: p.order, updated: p.updated,
      navLabel: p.navLabel, headings: p.headings, related: p.related,
      faq: p.faq,
    })), null, 2)};

export const DOCS_PATHS = DOCS_PAGES.map((p) => p.path);

// Lowercase + strip a trailing slash, matching worker.js normalizePath, so
// '/Docs/API/' resolves the same page as '/docs/api'.
export function getDocsPage(pathname) {
  let p = String(pathname || '').toLowerCase();
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return DOCS_PAGES.find((d) => d.path === p) || null;
}

// True for any path that LOOKS like a docs URL, so the Worker can serve a real
// 404 for /docs/nope instead of a soft-404 carrying homepage content.
export function isDocsPath(pathname) {
  return /^\\/docs(?:\\/|$)/i.test(String(pathname || ''));
}
`);

  // 2. Block AST — the code-split React page only.
  write(resolve(BOARDS, 'src/lib/docsiteContent.js'),
    BANNER('content/docs/**/*.md')
    + `\nexport const DOCS_CONTENT = ${JSON.stringify(Object.fromEntries(pages.map((p) => [p.path, p.blocks])), null, 1)};\n`);

  // 3. Pre-escaped HTML — the Worker only. Keeps its bundle at prose weight
  //    instead of prose + AST scaffolding.
  write(resolve(BOARDS, 'src/lib/docsiteCrawlable.js'),
    BANNER('content/docs/**/*.md')
    + `\nexport const DOCS_HTML = ${JSON.stringify(Object.fromEntries(pages.map((p) => [p.path, crawlableHtml(p)])), null, 1)};\n`);

  // 4. Raw markdown mirrors at /docs/<path>.md. Fetchable with curl, quotable
  //    by an agent, and identical to what the page renders.
  const pubDocs = resolve(BOARDS, 'public/docs');
  if (!CHECK && existsSync(pubDocs)) rmSync(pubDocs, { recursive: true, force: true });
  for (const p of pages) {
    const rel = p.path === '/docs' ? 'index' : p.path.replace(/^\/docs\//, '');
    write(resolve(pubDocs, `${rel}.md`),
      `# ${p.h1}\n\n> ${p.answer}\n\n_Source: ${SITE_ORIGIN}${p.path} · Updated ${p.updated}_\n\n${p.rawMarkdown}\n`);
  }

  // 5. llms.txt — the curated index (llmstxt.org shape): what this product is,
  //    then every page as a labelled link with a one-line description.
  const bySection = new Map(sections.map((s) => [s.id, []]));
  for (const p of pages) bySection.get(p.section).push(p);
  const llms = [
    '# Soleil Clusters',
    '',
    '> An infinite-canvas creative workspace for film, photo, design and brand teams.',
    '> Organize references, storyboards, shot lists, scripts and schedules on shared boards.',
    `> Read and write it from your own code with the ${SITE_ORIGIN}/api/v1 REST API or the MCP server.`,
    '',
    'Terminology: the product calls a board a **cluster**. The API and database call the same object a `board`.',
    '',
    `Every page below is also available as raw Markdown by appending \`.md\` (e.g. ${SITE_ORIGIN}/docs/api.md).`,
    `The full corpus in one file: ${SITE_ORIGIN}/llms-full.txt`,
    '',
  ];
  for (const s of sections) {
    const list = bySection.get(s.id);
    if (!list.length) continue;
    llms.push(`## ${s.label}`, '');
    for (const p of list) llms.push(`- [${p.h1}](${SITE_ORIGIN}${p.path}): ${p.metaDescription}`);
    llms.push('');
  }
  write(resolve(BOARDS, 'public/llms.txt'), llms.join('\n'));

  // 6. llms-full.txt — the whole corpus, one file, for context stuffing.
  const full = [
    '# Soleil Clusters — complete documentation',
    '',
    `Generated from ${SITE_ORIGIN}/docs. Terminology: a "cluster" in the UI is a "board" in the API and database.`,
    '',
  ];
  for (const p of pages) {
    full.push('', '='.repeat(72), `# ${p.h1}`, `URL: ${SITE_ORIGIN}${p.path}`, `Updated: ${p.updated}`, '',
      p.answer, '', blocksToText(p.blocks));
    if (p.faq.length) {
      full.push('', '## Frequently asked questions', '');
      for (const f of p.faq) full.push(`Q: ${f.q}`, `A: ${f.a}`, '');
    }
  }
  write(resolve(BOARDS, 'public/llms-full.txt'), full.join('\n') + '\n');

  // 7. The public-surface snapshot the docs are held to.
  const surfacePath = resolve(BOARDS, 'src/lib/docsiteSurface.json');
  if (ACCEPT_SURFACE || !existsSync(surfacePath)) write(surfacePath, surfaceJson());
}

// ── Run ─────────────────────────────────────────────────────────────────────
const loaded = loadPages();
emit(loaded);

if (CHECK && changed.length) {
  console.error(`✗ docs artifacts are stale (${changed.length} file(s) would change):`);
  for (const f of changed.slice(0, 20)) console.error(`    ${f}`);
  console.error('  Run: npm run docs:build');
  process.exit(1);
}
console.log(CHECK
  ? `✓ docs artifacts current (${loaded.pages.length} pages)`
  : `✓ docs generated: ${loaded.pages.length} pages, ${changed.length} file(s) written`);

export { loadPages, crawlableHtml, parseFrontmatter };
