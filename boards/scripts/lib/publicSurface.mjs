// publicSurface.mjs — extract the app's PUBLIC surface from source, so the
// docs can be held to it mechanically.
//
// The problem this solves: documentation rots silently. Someone adds a card
// kind, an /api/v1 endpoint, or a Settings tab, and the docs keep describing
// the world as it was. There is no CI in this repo to catch it and no human
// process that has ever survived contact with a busy week.
//
// The fix is to notice that every one of those surfaces is ALREADY an
// enumeration maintained in code — `TABS`, the `endpoints:` array, the `kind`
// union, `registerTool(...)` calls. This module reads those enumerations out of
// the source text and hashes them. docsite.test.mjs diffs that hash against a
// committed snapshot (src/lib/docsiteSurface.json). Change the surface without
// touching the docs and the test goes red with a list of exactly what moved.
//
// WHY TEXT EXTRACTION AND NOT IMPORTS: most of these live in modules that pull
// in React, the Workers runtime, or supabase-js and cannot be imported by a
// plain `node --test` process. Regex over source is the only option that works
// for all of them, so it is used for all of them — one mechanism, not two.
//
// EVERY EXTRACTOR MUST FAIL LOUDLY ON ZERO MATCHES. A regex that silently
// returns [] because someone reformatted the file would turn this entire gate
// into a no-op that still reports green — the worst possible outcome for a
// test whose whole job is catching drift. `expect()` below enforces a floor.

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const BOARDS = resolve(HERE, '../..');      // <repo>/boards
export const REPO = resolve(BOARDS, '..');         // <repo>

const read = (p) => readFileSync(resolve(REPO, p), 'utf8');

// A extractor that finds nothing is a broken extractor, not an empty surface.
function expect(list, min, what, file) {
  if (!Array.isArray(list) || list.length < min) {
    throw new Error(
      `publicSurface: extracted ${list?.length ?? 0} ${what} from ${file}, expected >= ${min}. ` +
      `The source shape probably changed — fix the extractor in scripts/lib/publicSurface.mjs. ` +
      `Do NOT lower the floor to make this pass.`
    );
  }
  return list;
}

// Pull the contents of a bracketed literal that follows `anchor`, balancing
// brackets so nested arrays/objects don't truncate the capture.
function sliceLiteral(src, anchor, open = '[', close = ']') {
  const at = src.indexOf(anchor);
  if (at === -1) return null;
  const start = src.indexOf(open, at);
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    if (src[i] === open) depth++;
    else if (src[i] === close) { depth--; if (depth === 0) return src.slice(start + 1, i); }
  }
  return null;
}

// ── REST: the endpoint list the API already publishes at GET /api/v1 ────────
// worker-api.js maintains this array so `curl /api/v1` answers with the routes.
// That makes it the canonical, already-kept-current list — reuse it rather
// than inventing a second one that could disagree with it.
export function restEndpoints() {
  const file = 'boards/src/worker-api.js';
  const body = sliceLiteral(read(file), 'endpoints: [') ?? '';
  const found = [...body.matchAll(/'([A-Z]+\s+\/[^']*)'/g)]
    .map((m) => m[1].replace(/\s+/g, ' ').trim());
  return expect(found, 8, 'REST endpoints', file).sort();
}

// ── MCP: tool names + their input schema shape ──────────────────────────────
// The schema text is hashed, not stored, so a changed zod shape (a new optional
// field on update_card, say) trips the gate without bloating the snapshot with
// unreadable serialized zod.
export function mcpTools() {
  const file = 'mcp/src/index.js';
  let src;
  try { src = read(file); } catch { return []; }   // MCP is a sibling package; tolerate its absence
  const found = [...src.matchAll(/registerTool\(\s*'([a-z_]+)'/g)].map((m) => {
    const name = m[1];
    const after = src.slice(m.index);
    const schema = sliceLiteral(after, 'inputSchema:', '{', '}') ?? '';
    return { name, schema: sha(schema.replace(/\s+/g, ' ').trim()).slice(0, 12) };
  });
  return expect(found, 5, 'MCP tools', file).sort((a, b) => a.name.localeCompare(b.name));
}

// ── Card kinds the API accepts ──────────────────────────────────────────────
// Narrower than the kinds the canvas renders — this is specifically the wire
// contract, which is what an API/MCP consumer needs documented.
export function apiCardKinds() {
  const file = 'boards/src/worker-api.js';
  const m = read(file).match(/const CARD_KINDS = \[([^\]]+)\]/);
  if (!m) throw new Error(`publicSurface: CARD_KINDS not found in ${file}`);
  const found = [...m[1].matchAll(/'([a-z]+)'/g)].map((x) => x[1]);
  return expect(found, 3, 'API card kinds', file).sort();
}

// ── Settings tabs ───────────────────────────────────────────────────────────
export function settingsTabs() {
  const file = 'boards/src/components/SettingsPanel.jsx';
  const body = sliceLiteral(read(file), 'const TABS =') ?? '';
  const found = [...body.matchAll(/\{\s*id:\s*'([a-z]+)'\s*,\s*label:\s*'([^']+)'/g)]
    .map((m) => ({ id: m[1], label: m[2] }));
  return expect(found, 6, 'settings tabs', file).sort((a, b) => a.id.localeCompare(b.id));
}

// ── Just-in-time power reveals ──────────────────────────────────────────────
// Each reveal teaches one feature. A new reveal means a feature we decided was
// worth interrupting someone for — which is exactly a feature worth a doc page.
export function powerRevealKeys() {
  const file = 'boards/src/lib/powerReveals.js';
  const found = [...read(file).matchAll(/^\s*key:\s*'([a-z_]+)'/gm)].map((m) => m[1]);
  return expect(found, 4, 'power reveals', file).sort();
}

// ── Keyboard shortcuts ──────────────────────────────────────────────────────
// Section titles + a per-section row count. Row COUNT rather than row content
// keeps the snapshot readable while still tripping when a shortcut is added or
// removed — the docs page mirrors this modal and must move with it.
//
// Rows are `[['V'], 'Select / move']` but ALSO `[[`${CMD}K`, '/'], '…']`, so
// counting quote-opened rows undercounts every template-literal section. Split
// on the title boundaries and count row-opening `[[` instead, which is the one
// token every row shape shares. A section that counts zero rows is a broken
// extractor, not an empty section — assert it.
export function shortcutSections() {
  const file = 'boards/src/components/ShortcutsOverlay.jsx';
  const body = sliceLiteral(read(file), 'const SECTIONS =') ?? '';
  const chunks = body.split(/title:\s*'([^']+)'/).slice(1);   // [title, rest, title, rest, …]
  const found = [];
  for (let i = 0; i < chunks.length; i += 2) {
    found.push({ title: chunks[i], rows: (chunks[i + 1].match(/\[\s*\[/g) || []).length });
  }
  expect(found, 4, 'shortcut sections', file);
  const empty = found.filter((s) => s.rows === 0).map((s) => s.title);
  if (empty.length) {
    throw new Error(`publicSurface: shortcut sections with zero rows (${empty.join(', ')}) — extractor is broken, not the source`);
  }
  return found;
}

// ── Public (signed-out reachable) routes ────────────────────────────────────
// Three registries plus the hand-rolled router's own shape-matches. Together
// these are every URL a logged-out visitor or crawler can land on.
export function publicRoutes() {
  const wf = 'boards/src/worker.js';
  const worker = read(wf);
  const meta = [...(sliceLiteral(worker, 'const ROUTE_META =', '{', '}') ?? '')
    .matchAll(/^\s{2}'([^']+)':/gm)].map((m) => m[1]);
  expect(meta, 4, 'ROUTE_META entries', wf);

  const landing = [...read('boards/src/lib/seoLanding.js')
    .matchAll(/^\s{4}path:\s*'(\/[^']+)'/gm)].map((m) => m[1]);
  expect(landing, 8, 'landing paths', 'boards/src/lib/seoLanding.js');

  const listicle = [...read('boards/src/lib/seoListicleIndex.js')
    .matchAll(/path:\s*'(\/best\/[^']+)'/g)].map((m) => m[1]);
  expect(listicle, 2, 'listicle paths', 'boards/src/lib/seoListicleIndex.js');

  // Router branches in main.jsx that render BEFORE AuthGate. The whole
  // right-hand side is captured verbatim: WIDENING a match is as much a public
  // surface change as adding a route, and only the literal text catches that.
  const router = [...read('boards/src/main.jsx')
    .matchAll(/^const (\w*[Mm]atch\w*)\s*=\s*(.+?);\s*$/gm)]
    .map((m) => `${m[1]} = ${m[2].replace(/window\.location\.pathname/g, 'PATH')}`);
  expect(router, 5, 'router branches', 'boards/src/main.jsx');

  return { routeMeta: meta.sort(), landing: landing.sort(), listicle: listicle.sort(), router: router.sort() };
}

// ── Token scopes ────────────────────────────────────────────────────────────
// The DB check constraint is the real definition — the Worker's scope gate can
// only ever enforce a subset of it, so this is the honest source.
export function apiScopes() {
  const file = 'supabase/migrations/0220_api_scopes_usage_log.sql';
  const src = read(file);
  const m = src.match(/check \(scopes <@ array\[([^\]]+)\]\)/);
  if (!m) throw new Error(`publicSurface: scope constraint not found in ${file}`);
  const found = [...m[1].matchAll(/'([a-z]+)'/g)].map((x) => x[1]);
  return expect(found, 2, 'API scopes', file).sort();
}

// ── Machine-readable error codes ────────────────────────────────────────────
// Every `fail(status, 'code', …)` in the Worker. These are part of the public
// contract — a client branches on them — so a new one is a documentation event.
export function apiErrorCodes() {
  const file = 'boards/src/worker-api.js';
  const found = [...new Set([...read(file).matchAll(/fail\((\d{3}),\s*'([a-z_]+)'/g)]
    .map((m) => `${m[1]} ${m[2]}`))];
  return expect(found, 6, 'API error codes', file).sort();
}

// ── Numeric/string facts docs are forbidden from retyping ───────────────────
// Extracted here rather than imported because worker-api.js cannot be imported
// outside the Workers runtime. gen-docs.mjs substitutes these into `{{fact:*}}`
// placeholders so a doc physically cannot state a stale number.
//
// Field-cap patterns match on the SOURCE field (`c.title`) rather than the
// destination (`out.title`): the destination is now computed for some fields
// (`out[textFieldFor(kind)]`), and matching it silently broke this extractor
// the moment that landed. The source name is the wire contract and is what a
// caller actually sends.
export function apiFacts() {
  const file = 'boards/src/worker-api.js';
  const src = read(file);
  const pick = (re, what) => {
    const m = src.match(re);
    if (!m) throw new Error(`publicSurface: ${what} not found in ${file} — fix the extractor, do not delete the fact`);
    return m[1];
  };
  const cap = (field) => Number(pick(new RegExp(`str\\(c\\.${field},\\s*(\\d+)\\)`), `${field} cap`));

  const sql = read('supabase/migrations/0215_api_tokens.sql');
  const rate = sql.match(/if t\.req_count > (\d+) then/);
  const prefix = sql.match(/v_token\s*:=\s*'([a-z_]+)'/);
  if (!rate || !prefix) throw new Error('publicSurface: rate limit / token prefix not found in 0215_api_tokens.sql');

  return {
    maxCardsPerCall: Number(pick(/const MAX_CARDS_PER_CALL = (\d+)/, 'MAX_CARDS_PER_CALL')),
    titleMax: cap('title'),
    bodyMax: cap('body'),
    htmlMax: cap('html'),
    urlMax: cap('url'),
    imageKeyMax: cap('image_key'),
    maxPage: Number(pick(/const MAX_PAGE = (\d+)/, 'MAX_PAGE')),
    defaultPage: Number(pick(/const DEFAULT_PAGE = (\d+)/, 'DEFAULT_PAGE')),
    maxUploadMb: Number(pick(/const MAX_UPLOAD_BYTES = (\d+) \* 1024 \* 1024/, 'MAX_UPLOAD_BYTES')),
    rateLimitPerHour: Number(rate[1]),
    tokenPrefix: prefix[1],
  };
}

export function sha(s) {
  return createHash('sha256').update(s).digest('hex');
}

// The full snapshot. Key order is fixed and every list is sorted, so the JSON
// is stable across machines and the diff on failure is readable.
export function publicSurface() {
  return {
    restEndpoints: restEndpoints(),
    mcpTools: mcpTools(),
    apiCardKinds: apiCardKinds(),
    apiScopes: apiScopes(),
    apiErrorCodes: apiErrorCodes(),
    apiFacts: apiFacts(),
    settingsTabs: settingsTabs(),
    powerRevealKeys: powerRevealKeys(),
    shortcutSections: shortcutSections(),
    publicRoutes: publicRoutes(),
  };
}

export function surfaceJson() {
  return JSON.stringify(publicSurface(), null, 2) + '\n';
}
