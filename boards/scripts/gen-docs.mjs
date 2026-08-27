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

import { SEO_LANDING_PAGES } from '../src/lib/seoLanding.js';
// The layout engine, so a template page's cell count and label order are read
// off the geometry rather than typed beside it.
import { presetById, computeCellRects, readingOrder } from '../src/lib/gridLayout.js';
import { SEO_LISTICLE_PAGES } from '../src/lib/seoListicles.js';

import { DEMO_CARD_LIMIT, LEGACY_DEMO_CARD_LIMIT } from '../src/lib/demoCardCap.js';
import { PLAN_NAME, PRICING, CREATOR_FEATURES, CREATOR_STORAGE_LABEL } from '../src/lib/billingCopy.js';
import { FREE_VIDEO_CAP, FREE_AUDIO_CAP, FREE_PDF_CAP } from '../src/lib/fileIngest.js';
import { MAX_IMPORT_ITEMS, IMPORT_TIMEOUT_MS, SOURCE_SCOPE } from '../src/lib/importManifest.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const BOARDS = resolve(HERE, '..');
const CONTENT = resolve(BOARDS, 'content/docs');
const CHANGELOG = resolve(BOARDS, 'content/changelog');
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
// The storage label must equal the ENFORCED default quota — app_config
// 'storage_quota_bytes' seeded in migration 0154 and read by
// _storage_quota_bytes(). The quota is runtime-tunable via app_config, so the
// migration literal is the default (same mirror caveat billingCopy documents
// for the Stripe env prices), but marketing may never diverge from it silently.
const quotaSql = readFileSync(resolve(BOARDS, '../supabase/migrations/0154_storage_quota.sql'), 'utf8');
const quotaMatch = quotaSql.match(/'storage_quota_bytes',\s*jsonb_build_object\('bytes',\s*(\d+)/);
if (!quotaMatch) {
  throw new Error('gen-docs: storage_quota_bytes default not found in migration 0154 — update the extractor');
}
const quotaGb = Number(quotaMatch[1]) / (1024 ** 3);
if (`${quotaGb}GB` !== CREATOR_STORAGE_LABEL || storageMatch[1].replace(/\s+/g, '') !== CREATOR_STORAGE_LABEL) {
  throw new Error(
    `gen-docs: storage figures disagree — CREATOR_STORAGE_LABEL '${CREATOR_STORAGE_LABEL}', ` +
    `CREATOR_FEATURES '${storageMatch[1]}', migration default ${quotaGb}GB`,
  );
}
const api = apiFacts();

export const FACTS = {
  demoCardLimit: String(DEMO_CARD_LIMIT),
  // The cap accounts created before migration 0229 keep, permanently. The plans
  // page states the grandfather rule; both cohorts are real, so both numbers
  // have to come from code rather than being typed into the markdown.
  legacyDemoCardLimit: String(LEGACY_DEMO_CARD_LIMIT),
  planName: PLAN_NAME,
  priceMonthly: PRICING.monthly.billedLabel,
  priceAnnual: PRICING.annual.billedLabel,
  priceAnnualPerMonth: PRICING.annual.perMonthLabel,
  annualSavings: PRICING.annual.savings,
  creatorStorage: CREATOR_STORAGE_LABEL,
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

// ── Load: the changelog ─────────────────────────────────────────────────────
// content/changelog/YYYY-MM-DD.md, one file per weekly entry, newest first.
//
// WHY THIS LIVES IN THE DOCS GENERATOR rather than a script of its own: the
// changelog has to appear in public/llms.txt and llms-full.txt, and those are
// emitted below. Two scripts writing one file is a race waiting to be committed.
// It rides along the same way the marketing corpus already does.
//
// The page it produces is NOT a search play — ranking first for a query nobody
// types returns nothing, which the /docs corpus already demonstrates. It exists
// so an assistant asked "does Clusters do X yet" can retrieve a dated answer
// rather than repeat whatever its training data last saw, and so a reader
// checking whether this is a maintained product finds evidence either way.
const CHANGELOG_TITLE = 'Changelog — Soleil Clusters';
const CHANGELOG_DESCRIPTION =
  'Every user-visible change to Soleil Clusters, newest first, with dates. Updated weekly.';
const CHANGELOG_H1 = 'Changelog';
const CHANGELOG_ANSWER = 'Soleil Clusters ships continuously; this page lists every user-visible change, newest first, with the date it went live. Each entry covers one week. Fixes and additions are described in the same list rather than split apart, because the distinction rarely matters to the person reading.';

function loadChangelog() {
  if (!existsSync(CHANGELOG)) throw new Error(`gen-docs: no changelog directory at ${CHANGELOG}`);
  const problems = [];

  const entries = readdirSync(CHANGELOG)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .reverse()                       // newest first; filenames are ISO dates
    .map((name) => {
      const file = resolve(CHANGELOG, name);
      const label = relative(BOARDS, file);
      const raw = resolveFacts(readFileSync(file, 'utf8'), label);
      const { fm, body } = parseFrontmatter(raw, label);
      const bad = (msg) => problems.push(`${label}: ${msg}`);

      for (const req of ['date', 'title', 'summary']) if (!fm[req]) bad(`frontmatter '${req}' is required`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fm.date || '')) bad('date must be YYYY-MM-DD');
      // The filename IS the date. One obvious name per entry, and the directory
      // listing sorts chronologically without reading a single file.
      if (name !== `${fm.date}.md`) bad(`filename should be ${fm.date}.md to match its date`);
      if ((fm.title || '').length > 90) bad(`title ${fm.title.length} chars (max 90)`);
      if ((fm.summary || '').length > 220) bad(`summary ${fm.summary.length} chars (max 220)`);

      const blocks = parseMarkdown(body);
      // Heading ids are page-unique, not entry-unique: every entry renders onto
      // ONE page, and parseMarkdown only dedupes within its own call — two
      // entries with a "Canvas" section would otherwise both claim #canvas and
      // the second deep link would scroll to the wrong year.
      for (const b of blocks) if (b.type === 'heading') b.id = `${fm.date}-${b.id}`;

      return {
        date: fm.date,
        anchor: fm.date,             // the entry's deep link: /changelog#2026-08-26
        title: fm.title,
        summary: fm.summary,
        file: label,
        blocks,
        rawMarkdown: body.trim(),
      };
    });

  if (!entries.length) problems.push('content/changelog is empty — at least one entry is required');
  const seen = new Set();
  for (const e of entries) {
    if (seen.has(e.date)) problems.push(`duplicate changelog date ${e.date}`);
    seen.add(e.date);
  }
  if (problems.length) {
    throw new Error(`gen-docs: ${problems.length} changelog problem(s):\n  - ${problems.join('\n  - ')}`);
  }
  return entries;
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
function inlineHtml(nodes, bare = false) {
  return (nodes || []).map((n) => {
    const inner = n.children ? inlineHtml(n.children, bare) : escapeHtml(n.v);
    if (n.t === 'code') return `<code>${escapeHtml(n.v)}</code>`;   // terminal
    if (n.t === 'strong') return `<b>${inner}</b>`;
    if (n.t === 'em') return `<i>${inner}</i>`;
    if (n.t === 'link') {
      // A feed item travels to somebody else's reader, where a root-relative
      // href resolves against THEIR origin and 404s. Absolute in bare mode.
      const href = bare && n.href.startsWith('/') ? `${SITE_ORIGIN}${n.href}` : n.href;
      return `<a href="${escapeHtml(href)}"${bare ? '' : ' style="color:#FFA500;"'}>${inner}</a>`;
    }
    return escapeHtml(n.v);
  }).join('');
}

const H2 = 'font-size:1.35rem;font-weight:600;margin:1.4em 0 .4em;';
const H3 = 'font-size:1.08rem;font-weight:600;margin:1.1em 0 .3em;';

// Every block type parseMarkdown can emit, rendered once. Shared by the docs
// pages and the changelog so a construct can never render on one and silently
// vanish on the other — the same reason DocsPage and ChangelogPage share their
// block components on the React side.
//
// `bare` drops the inline styles and heading ids. Those exist because the
// crawlable HTML lands in the SPA shell before any stylesheet has loaded, and
// because deep links need anchors — neither is true inside an RSS
// <content:encoded>, where they are clutter an agent has to read past and an
// id that resolves to nothing.
function blocksToHtml(blocks, { bare = false } = {}) {
  const attr = (style, id) => (bare ? ''
    : `${id ? ` id="${escapeHtml(id)}"` : ''}${style ? ` style="${style}"` : ''}`);
  const out = [];
  for (const b of blocks) {
    if (b.type === 'heading') {
      const tag = b.depth === 2 ? 'h2' : 'h3';
      // inlineHtml, not escapeHtml(b.text): API headings are code spans, and the
      // crawlable copy has to match what React renders (parity), not a
      // backtick-littered plaintext version of it.
      out.push(`<${tag}${attr(b.depth === 2 ? H2 : H3, b.id)}>${inlineHtml(b.inline, bare)}</${tag}>`);
    } else if (b.type === 'para') {
      out.push(`<p>${inlineHtml(b.inline, bare)}</p>`);
    } else if (b.type === 'list') {
      const tag = b.ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${b.items.map((it) => `<li>${inlineHtml(it, bare)}</li>`).join('')}</${tag}>`);
    } else if (b.type === 'code') {
      out.push(`<pre><code>${escapeHtml(b.code)}</code></pre>`);
    } else if (b.type === 'callout') {
      out.push(`<blockquote${attr('border-left:1px solid #3a3a40;padding-left:1em;margin:1.2em 0;color:#888890;')}>${inlineHtml(b.inline, bare)}</blockquote>`);
    } else if (b.type === 'hr') {
      out.push('<hr>');
    } else if (b.type === 'table') {
      out.push('<table><thead><tr>'
        + b.head.map((c) => `<th>${inlineHtml(c, bare)}</th>`).join('')
        + '</tr></thead><tbody>'
        + b.rows.map((r) => `<tr>${r.map((c) => `<td>${inlineHtml(c, bare)}</td>`).join('')}</tr>`).join('')
        + '</tbody></table>');
    }
  }
  return out;
}

const prettyDate = (iso) => new Date(iso + 'T00:00:00Z')
  .toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });

function crawlableHtml(page) {
  const out = [];
  out.push(`<h1 style="font-size:1.9rem;font-weight:650;margin:0 0 .4em;">${escapeHtml(page.h1)}</h1>`);
  // The extractable, self-contained answer: the block AI answer engines lift,
  // and the first thing a reader sees. A lead paragraph, matching what React
  // renders — no box, no emphasis it has not earned.
  out.push(`<p style="color:#d0d0d4;font-size:1.1rem;margin:0 0 1.2em;">${escapeHtml(page.answer)}</p>`);
  out.push(`<p style="color:#8a8a92;font-size:.85rem;"><time datetime="${escapeHtml(page.updated)}">Updated ${escapeHtml(prettyDate(page.updated))}</time></p>`);

  out.push(...blocksToHtml(page.blocks));

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
  // The changelog rides in the same line, and it is here — in the SERVER-rendered
  // copy — rather than only in the React footer, because the crawlers this whole
  // registry exists for do not run JavaScript. A docs page reached from a search
  // result is the most common entry point into the corpus; without this it is a
  // dead end for the one question the docs deliberately never answer.
  out.push(`<p style="color:#8a8a92;font-size:.85rem;margin-top:2em;">Machine-readable: <a href="${escapeHtml(page.path)}.md" style="color:#FFA500;">${escapeHtml(page.path)}.md</a> · <a href="/llms.txt" style="color:#FFA500;">/llms.txt</a><br>What changed and when: <a href="/changelog" style="color:#FFA500;">/changelog</a></p>`);

  return `<div style="max-width:820px;margin:0 auto;padding:14vh 24px 24px;"><article>${out.join('')}</article></div>`;
}

// ── Emit: the changelog ─────────────────────────────────────────────────────
// One page, every entry, newest first, each anchored at #YYYY-MM-DD. Not one
// route per entry: a week of changes is a thin page on its own, and an
// assistant that fetches this URL should get the whole recency picture in a
// single request rather than having to crawl N of them to find out whether a
// feature exists yet.

function changelogCrawlableHtml(entries) {
  const out = [];
  out.push(`<h1 style="font-size:1.9rem;font-weight:650;margin:0 0 .4em;">${escapeHtml(CHANGELOG_H1)}</h1>`);
  out.push(`<p style="color:#d0d0d4;font-size:1.1rem;margin:0 0 1.2em;">${escapeHtml(CHANGELOG_ANSWER)}</p>`);
  for (const e of entries) {
    out.push(`<article id="${escapeHtml(e.anchor)}" style="margin:2.4em 0;">`);
    out.push(`<p style="color:#8a8a92;font-size:.85rem;margin:0 0 .2em;"><time datetime="${escapeHtml(e.date)}">${escapeHtml(prettyDate(e.date))}</time></p>`);
    out.push(`<h2 style="${H2}margin-top:.1em;">${escapeHtml(e.title)}</h2>`);
    out.push(`<p style="color:#d0d0d4;">${escapeHtml(e.summary)}</p>`);
    out.push(...blocksToHtml(e.blocks));
    out.push('</article>');
  }
  // Same closing line every docs page carries: point machines at the twins.
  out.push(`<p style="color:#8a8a92;font-size:.85rem;margin-top:2em;">Machine-readable: <a href="/changelog.md" style="color:#FFA500;">/changelog.md</a> · <a href="/changelog.xml" style="color:#FFA500;">RSS</a> · <a href="/llms.txt" style="color:#FFA500;">/llms.txt</a></p>`);
  return `<div style="max-width:820px;margin:0 auto;padding:14vh 24px 24px;">${out.join('')}</div>`;
}

function changelogMarkdown(entries) {
  const out = [`# ${CHANGELOG_H1}`, '', `> ${CHANGELOG_ANSWER}`, '',
    `_Source: ${SITE_ORIGIN}/changelog · Feed: ${SITE_ORIGIN}/changelog.xml_`, ''];
  for (const e of entries) {
    out.push(`## ${e.date} — ${e.title}`, '', e.summary, '', e.rawMarkdown, '');
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
}

// RSS 2.0. This is the half of the changelog that directories, feed readers and
// polling agents actually consume — a page they have to re-fetch and diff is a
// worse contract than a feed that tells them what is new.
const rssDate = (iso) => new Date(iso + 'T00:00:00Z').toUTCString();
// `]]>` inside a CDATA section terminates it early and corrupts the rest of the
// feed. Split the sequence across two sections rather than escaping it away.
const cdata = (s) => `<![CDATA[${String(s).replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;

function changelogRss(entries) {
  const items = entries.map((e) => {
    const link = `${SITE_ORIGIN}/changelog#${e.date}`;
    return '    <item>\n'
      + `      <title>${escapeHtml(e.title)}</title>\n`
      + `      <link>${escapeHtml(link)}</link>\n`
      // Anchors differ only by fragment, which some readers collapse — the date
      // is what actually identifies an entry, so it is the guid.
      + `      <guid isPermaLink="false">${escapeHtml(`clusters-changelog-${e.date}`)}</guid>\n`
      + `      <pubDate>${rssDate(e.date)}</pubDate>\n`
      + `      <description>${escapeHtml(e.summary)}</description>\n`
      + `      <content:encoded>${cdata(blocksToHtml(e.blocks, { bare: true }).join(''))}</content:encoded>\n`
      + '    </item>';
  });
  return '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">\n'
    + '  <channel>\n'
    + `    <title>${escapeHtml(CHANGELOG_H1)} — Soleil Clusters</title>\n`
    + `    <link>${SITE_ORIGIN}/changelog</link>\n`
    + `    <description>${escapeHtml(CHANGELOG_DESCRIPTION)}</description>\n`
    + '    <language>en</language>\n'
    + `    <lastBuildDate>${rssDate(entries[0].date)}</lastBuildDate>\n`
    + `    <atom:link href="${SITE_ORIGIN}/changelog.xml" rel="self" type="application/rss+xml"/>\n`
    + items.join('\n') + '\n'
    + '  </channel>\n</rss>\n';
}

// ── Emit: files ─────────────────────────────────────────────────────────────
const BANNER = (src) => `// GENERATED by scripts/gen-docs.mjs from ${src} — DO NOT EDIT BY HAND.\n`
  + `// Edit the markdown, then run: npm run docs:build\n`;

// ── Marketing corpus as Markdown (2026-08-22) ───────────────────────────────
// /docs has shipped raw .md mirrors + llms.txt since 2026-08-08, but the
// comparison and buying-guide pages never did — and those are the ones AI
// assistants actually cite. Over 90 days, ChatGPT and Perplexity referrals
// landed on /best/mood-board-apps and /best/pureref-alternatives and converted
// at 72.7% activation, the highest of any channel, while /best/*.md and
// /vs/*.md both returned 404 and llms.txt named neither.
//
// No worker change is needed: these land in public/ → dist/, and env.ASSETS
// serves a real file long before the landing-shaped-404 guard runs (same route
// the /docs/**.md mirrors already take).

// Fail the build rather than emit "undefined" into a public file. These
// serializers read registries authored by hand, and the failure mode that
// matters is SILENT: a renamed field yields `undefined` in a page an assistant
// will quote, or drops a whole section without a word. Both happened on the
// first draft of this code.
function req(value, path, field) {
  if (value == null || value === '') {
    throw new Error(`gen-docs: ${path} is missing ${field} — registry shape changed?`);
  }
  return value;
}

// A landing spec ('/tools/*', '/vs/*', '/use-cases', '/scout') → Markdown.
function landingMarkdown(spec) {
  const out = [`# ${spec.h1}`, ''];
  if (spec.answer) out.push(`> ${spec.answer}`, '');
  out.push(`_Source: ${SITE_ORIGIN}${spec.path} · Updated ${spec.updated}_`, '');
  if (spec.subhead) out.push(spec.subhead, '');
  // The shape a curated template page is about, as a table an assistant can
  // quote. Cell count and label order are DERIVED from the preset — the same
  // call the page and the Worker make — so the mirror cannot describe a
  // different grid from the one the page hands you.
  if (spec.template?.preset) {
    const preset = req(presetById(spec.template.preset), spec.path, `a real preset (${spec.template.preset})`);
    const cells = readingOrder(computeCellRects(preset.tree, { x: 0, y: 0, w: 900, h: 600 }));
    out.push('## The layout', '', `${preset.label} — ${cells.length} boxes.`, '');
    const hints = spec.template.hints || [];
    if (hints.length) {
      out.push('| # | Label |', '| --- | --- |');
      hints.forEach((h, i) => out.push(`| ${i + 1} | ${h} |`));
      out.push('', 'Each label shows only while its box is empty, and is never written into the box.', '');
    }
  }
  for (const s of spec.sections || []) {
    out.push(`## ${s.heading}`, '');
    if (s.body) out.push(s.body, '');
    for (const b of s.bullets || []) out.push(`- ${b}`);
    if (s.bullets?.length) out.push('');
  }
  if (spec.steps?.length) {
    out.push(`## ${spec.stepsHeading || 'How it works'}`, '');
    spec.steps.forEach((s, i) => out.push(`${i + 1}. **${s.t}** — ${s.d}`));
    out.push('');
  }
  if (spec.compare?.rows?.length) {
    out.push(`## Soleil Clusters vs ${spec.compare.competitor}`, '');
    if (spec.compare.intro) out.push(spec.compare.intro, '');
    out.push(`| | Soleil Clusters | ${spec.compare.competitor} |`, '| --- | --- | --- |');
    for (const r of spec.compare.rows) {
      // Rows are {feature, us, them}. THROW rather than emit a blank row: a
      // silently empty compare table is exactly the failure seoLanding.test.mjs
      // was written to catch (a {heading, body} object spliced into `rows`
      // renders blank on a page that already ranks).
      const cells = [r?.feature, r?.us, r?.them];
      if (cells.some((c) => c == null || c === '')) {
        throw new Error(
          `compare row on ${spec.path} is missing feature/us/them: ${JSON.stringify(r)}`);
      }
      out.push(`| ${cells.map((c) => String(c).replace(/\|/g, '\\|')).join(' | ')} |`);
    }
    out.push('');
  }
  if (spec.faq?.length) {
    out.push('## Frequently asked questions', '');
    for (const f of spec.faq) out.push(`### ${f.q}`, '', f.a, '');
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
}

// A listicle spec ('/best/*') → Markdown. Ratings stay visible copy only; they
// are deliberately never emitted as Review/AggregateRating markup anywhere.
function listicleMarkdown(spec) {
  const out = [`# ${spec.h1}`, ''];
  if (spec.answer) out.push(`> ${spec.answer}`, '');
  out.push(`_Source: ${SITE_ORIGIN}${spec.path} · Published ${spec.published} · Updated ${spec.updated}_`, '');
  if (spec.subhead) out.push(spec.subhead, '');
  if (spec.disclosure) out.push(`**Disclosure:** ${spec.disclosure}`, '');
  if (spec.thesis) {
    out.push(`## ${req(spec.thesis.heading, spec.path, 'thesis.heading')}`, '');
    for (const p of spec.thesis.paras || []) out.push(p, '');
  }
  if (spec.methodology) {
    out.push(`## ${req(spec.methodology.heading, spec.path, 'methodology.heading')}`, '');
    if (spec.methodology.intro) out.push(spec.methodology.intro, '');
    for (const c of spec.methodology.criteria || []) {
      out.push(`- **${req(c.name, spec.path, 'criteria.name')}** — ${req(c.why, spec.path, 'criteria.why')}`);
    }
    out.push('');
  }
  // Head-to-head + platform matrix (both optional). These carry the answers to
  // the "X vs Y" and "does it run on Z" queries, which are exactly what an
  // assistant asked to compare two tools needs to read — so they belong in the
  // .md twin, not just the rendered page.
  if (spec.headToHead) {
    out.push(`## ${req(spec.headToHead.heading, spec.path, 'headToHead.heading')}`, '');
    if (spec.headToHead.intro) out.push(spec.headToHead.intro, '');
    for (const m of spec.headToHead.matchups || []) {
      out.push(`### ${req(m.heading, spec.path, 'matchup.heading')}`, '');
      out.push(`**${req(m.verdict, spec.path, 'matchup.verdict')}**`, '');
      for (const p of m.paras || []) out.push(p, '');
      if (m.rows?.length) {
        out.push(`| | ${m.left} | ${m.right} |`, '| --- | --- | --- |');
        for (const r of m.rows) {
          const cells = [r?.feature, r?.left, r?.right];
          if (cells.some((c) => c == null || c === '')) {
            throw new Error(`head-to-head row on ${spec.path}/${m.slug} is missing feature/left/right: ${JSON.stringify(r)}`);
          }
          out.push(`| ${cells.map((c) => String(c).replace(/\|/g, '\\|')).join(' | ')} |`);
        }
        out.push('');
      }
    }
  }
  if (spec.platforms) {
    out.push(`## ${req(spec.platforms.heading, spec.path, 'platforms.heading')}`, '');
    if (spec.platforms.intro) out.push(spec.platforms.intro, '');
    out.push(`| Tool | ${spec.platforms.columns.join(' | ')} |`,
      `| --- | ${spec.platforms.columns.map(() => '---').join(' | ')} |`);
    for (const r of spec.platforms.rows || []) {
      if (r.cells.length !== spec.platforms.columns.length) {
        throw new Error(`platform row '${r.name}' on ${spec.path} has ${r.cells.length} cells vs ${spec.platforms.columns.length} columns`);
      }
      out.push(`| ${[r.name, ...r.cells].map((c) => String(c).replace(/\|/g, '\\|')).join(' | ')} |`);
    }
    out.push('');
    for (const n of spec.platforms.notes || []) {
      out.push(`**${req(n.lead, spec.path, 'platforms.note.lead')}.** ${req(n.body, spec.path, 'platforms.note.body')}`, '');
    }
  }
  out.push(`## ${req(spec.itemsHeading, spec.path, 'itemsHeading')}`, '');
  for (const it of spec.items || []) {
    out.push(`### ${it.rank}. ${req(it.name, spec.path, 'item.name')}${it.isUs ? ' (that’s us)' : ''}`, '');
    if (it.bestFor) out.push(`**Best for:** ${it.bestFor}`, '');
    if (it.rating != null) out.push(`**Rating:** ${it.rating}/10`, '');
    // pricing is {summary, asOf} — the asOf date is load-bearing: every price
    // on these pages is a dated claim, and dropping the date makes it a
    // timeless one we cannot stand behind.
    if (it.pricing) {
      out.push(`**Pricing:** ${req(it.pricing.summary, spec.path, 'pricing.summary')}`
        + (it.pricing.asOf ? ` _(as of ${it.pricing.asOf})_` : ''), '');
    }
    if (it.verdict) out.push(it.verdict, '');
    for (const p of it.paras || []) out.push(p, '');
    for (const f of it.features || []) out.push(`- ${f}`);
    if (it.features?.length) out.push('');
    if (it.pros?.length) out.push('**Pros:** ' + it.pros.join('; '), '');
    if (it.cons?.length) out.push('**Cons:** ' + it.cons.join('; '), '');
  }
  if (spec.personas?.length) {
    out.push('## Which one is for you', '');
    for (const p of spec.personas) {
      out.push(`- **${req(p.who, spec.path, 'persona.who')}** → ${req(p.pick, spec.path, 'persona.pick')}: ${req(p.why, spec.path, 'persona.why')}`);
    }
    out.push('');
  }
  if (spec.honorableMentions?.length) {
    out.push('## Also considered', '');
    for (const m of spec.honorableMentions) {
      out.push(`- **${req(m.name, spec.path, 'mention.name')}** — ${req(m.note, spec.path, 'mention.note')}`);
    }
    out.push('');
  }
  if (spec.honestAccounting) {
    out.push(`## ${req(spec.honestAccounting.heading, spec.path, 'honestAccounting.heading')}`, '');
    for (const p of spec.honestAccounting.paras || []) out.push(p, '');
    for (const pt of spec.honestAccounting.points || []) out.push(`- ${pt}`);
    if (spec.honestAccounting.points?.length) out.push('');
  }
  if (spec.faq?.length) {
    out.push('## Frequently asked questions', '');
    for (const f of spec.faq) out.push(`### ${f.q}`, '', f.a, '');
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
}

// '/vs/pureref' → 'vs/pureref'; '/use-cases' → 'use-cases'.
function marketingMdRel(path) {
  return path.replace(/^\//, '');
}

function write(absPath, content) {
  const prev = existsSync(absPath) ? readFileSync(absPath, 'utf8') : null;
  if (prev === content) return;
  changed.push(relative(BOARDS, absPath));
  if (!CHECK) {
    mkdirSync(dirname(absPath), { recursive: true });
    writeFileSync(absPath, content);
  }
}

function emit({ pages, sections, changelog }) {
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

  // 4b. Raw markdown mirrors for the MARKETING pages at /vs/<x>.md,
  //     /best/<x>.md, /tools/<x>.md, /use-cases.md, /scout.md. Same contract as
  //     the /docs mirrors above; see landingMarkdown/listicleMarkdown for why
  //     these exist (AI assistants cite the comparison pages, not the docs).
  const marketing = [
    ...SEO_LANDING_PAGES.map((s) => ({ spec: s, md: landingMarkdown(s) })),
    ...SEO_LISTICLE_PAGES.map((s) => ({ spec: s, md: listicleMarkdown(s) })),
  ];
  for (const { spec, md } of marketing) {
    write(resolve(BOARDS, 'public', `${marketingMdRel(spec.path)}.md`), md);
  }

  // 4d. The curated grid templates, as a LIGHT index.
  //
  //     App.jsx has to turn ?remix=k_<slug> into an actual saved template after
  //     signup, which means it needs the preset id and the labels — but it must
  //     never import seoLanding.js to get them, because that would pull several
  //     thousand words of marketing prose into the app chunk. Same split, same
  //     reason, as seoListicleIndex.js and docsiteIndex.js.
  //
  //     Generated rather than hand-written so the template a page describes and
  //     the template its button places cannot drift apart: there is one spec,
  //     and this is a projection of it.
  const curated = SEO_LANDING_PAGES.filter((s) => s.kind === 'template');
  write(resolve(BOARDS, 'src/lib/gridTemplateIndex.js'),
    BANNER('src/lib/seoLanding.js') + `
export const CURATED_TEMPLATES = ${JSON.stringify(Object.fromEntries(curated.map((s) => {
      const slug = s.path.split('/').pop();
      const t = s.template || {};
      return [slug, {
        path: s.path,
        name: req(s.h1, s.path, 'h1'),
        preset: req(t.preset, s.path, 'template.preset'),
        ...(t.hints ? { hints: t.hints } : {}),
      }];
    })), null, 1)};
`);

  // 4c. The changelog — the same light-index / AST / pre-rendered-HTML split the
  //     docs use, for the same reason: main.jsx and the Worker must never pull
  //     the prose into their bundles, and both renderers must walk one parse.
  write(resolve(BOARDS, 'src/lib/changelogIndex.js'),
    BANNER('content/changelog/*.md') + `
export const CHANGELOG_META = ${JSON.stringify({
      path: '/changelog',
      title: CHANGELOG_TITLE,
      description: CHANGELOG_DESCRIPTION,
      h1: CHANGELOG_H1,
      answer: CHANGELOG_ANSWER,
    }, null, 2)};

export const CHANGELOG_ENTRIES = ${JSON.stringify(changelog.map((e) => ({
      date: e.date, anchor: e.anchor, title: e.title, summary: e.summary,
      headings: e.blocks.filter((b) => b.type === 'heading' && b.depth === 2)
        .map((b) => ({ id: b.id, text: b.text })),
    })), null, 2)};

// The newest entry's date. The sitemap's lastmod for /changelog and the RSS
// lastBuildDate both read this — it is the one page on the site whose lastmod
// is unambiguously honest, since the date IS the content.
export const CHANGELOG_LATEST = CHANGELOG_ENTRIES[0]?.date || null;

// True for anything shaped like a changelog URL, so the Worker can serve a real
// 404 for /changelog/nope rather than a soft-404 carrying homepage content.
// Does NOT match /changelog.md or /changelog.xml — those are static assets that
// env.ASSETS answers long before this is consulted.
export function isChangelogPath(pathname) {
  return /^\\/changelog(?:\\/|$)/i.test(String(pathname || ''));
}
`);

  write(resolve(BOARDS, 'src/lib/changelogContent.js'),
    BANNER('content/changelog/*.md')
    + `\nexport const CHANGELOG_CONTENT = ${JSON.stringify(
      Object.fromEntries(changelog.map((e) => [e.date, e.blocks])), null, 1)};\n`);

  write(resolve(BOARDS, 'src/lib/changelogCrawlable.js'),
    BANNER('content/changelog/*.md')
    + `\nexport const CHANGELOG_HTML = ${JSON.stringify(changelogCrawlableHtml(changelog))};\n`);

  write(resolve(BOARDS, 'public/changelog.md'), changelogMarkdown(changelog));
  write(resolve(BOARDS, 'public/changelog.xml'), changelogRss(changelog));

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
    // Listed FIRST, and with its date stated, because the single most common way
    // to be wrong about this product is to describe a version of it that shipped
    // months ago. An assistant that reads one line here should read the right one.
    '## Changelog',
    '',
    `- [Changelog](${SITE_ORIGIN}/changelog): ${CHANGELOG_DESCRIPTION} Most recent entry: ${changelog[0].date}. Raw Markdown at ${SITE_ORIGIN}/changelog.md, RSS at ${SITE_ORIGIN}/changelog.xml.`,
    '',
  ];
  for (const s of sections) {
    const list = bySection.get(s.id);
    if (!list.length) continue;
    llms.push(`## ${s.label}`, '');
    for (const p of list) llms.push(`- [${p.h1}](${SITE_ORIGIN}${p.path}): ${p.metaDescription}`);
    llms.push('');
  }
  // The comparison and buying-guide pages. Listed last because they are
  // marketing rather than reference, but listed at all because these are the
  // pages assistants actually cite when asked to recommend a tool.
  llms.push('## Buying guides', '');
  for (const s of SEO_LISTICLE_PAGES) {
    llms.push(`- [${s.h1}](${SITE_ORIGIN}${s.path}): ${s.metaDescription}`);
  }
  llms.push('', '## Comparisons and tool pages', '');
  for (const s of SEO_LANDING_PAGES) {
    llms.push(`- [${s.h1}](${SITE_ORIGIN}${s.path}): ${s.metaDescription}`);
  }
  llms.push('');
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
  // The marketing corpus rides along in the same file — an assistant asked to
  // compare tools should be able to read our actual comparison, not infer it
  // from the feature docs.
  for (const { spec, md } of marketing) {
    full.push('', '='.repeat(72), `URL: ${SITE_ORIGIN}${spec.path}`, `Updated: ${spec.updated}`, '', md);
  }
  // The changelog goes LAST in the corpus but is the first thing worth checking:
  // everything above describes the product as documented, this says when each
  // part of it arrived.
  full.push('', '='.repeat(72), `URL: ${SITE_ORIGIN}/changelog`, `Updated: ${changelog[0].date}`, '',
    changelogMarkdown(changelog));
  write(resolve(BOARDS, 'public/llms-full.txt'), full.join('\n') + '\n');

  // 7. The public-surface snapshot the docs are held to.
  const surfacePath = resolve(BOARDS, 'src/lib/docsiteSurface.json');
  if (ACCEPT_SURFACE || !existsSync(surfacePath)) write(surfacePath, surfaceJson());
}

// ── Run ─────────────────────────────────────────────────────────────────────
const loaded = loadPages();
const changelog = loadChangelog();
emit({ ...loaded, changelog });

if (CHECK && changed.length) {
  console.error(`✗ docs artifacts are stale (${changed.length} file(s) would change):`);
  for (const f of changed.slice(0, 20)) console.error(`    ${f}`);
  console.error('  Run: npm run docs:build');
  process.exit(1);
}
console.log(CHECK
  ? `✓ docs artifacts current (${loaded.pages.length} pages, ${changelog.length} changelog entries)`
  : `✓ docs generated: ${loaded.pages.length} pages, ${changelog.length} changelog entries, ${changed.length} file(s) written`);

export { loadPages, loadChangelog, crawlableHtml, changelogCrawlableHtml, parseFrontmatter };
