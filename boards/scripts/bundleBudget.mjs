#!/usr/bin/env node
// Bundle budget: what a signed-in open has to download before the canvas can
// paint, measured from a built dist/ and held under ceilings.
//
// Every figure is brotli at quality 5, close to what Cloudflare's edge sends
// for these files:
//   entry JS  — index.html's module script and everything it imports statically
//   entry CSS — index.html's own stylesheets (Typekit's is not ours to count)
//   app JS / app CSS — what Vite loads when the entry imports AppShell: the
//               __vite__mapDeps list on that import() call, minus the entry's
//               own files. lib/appPreloadList.mjs preloads the same list,
//               and the run fails when the list it wrote into index.html
//               is missing or differs: a file only Vite fetches arrives late,
//               and one only the preload fetches is a wasted download.
//
// It also fails when the app closure has pulled in something only a later click
// needs. Each name in NEVER_IN_APP and LAZY_IN_APP was split out on purpose,
// and one static import is enough to put it back on every open.
//
// Usage: node scripts/bundleBudget.mjs [distDir] [--report]
// The build must be one where Supabase is configured (real .env.local, or the
// fake pair the CI step sets), or the signed-in app is dead-code-eliminated and
// every number here is meaningless; a missing AppShell import fails the run.

import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants } from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const DIST = resolve(args.find((a) => !a.startsWith('--')) || join(HERE, '..', 'dist'));
const REPORT = args.includes('--report');

// Ceilings in bytes (brotli q5), each about 3% over what main measured on
// 2026-10-20, so ordinary growth fits and a new heavy import does not. Lower
// them as the speed work lands; never raise one to make a change fit without
// saying why in the commit.
export const CEILINGS = {
  // 2026-10-25: +0.5 KB for the Team plan's links (?teamjoin=, ?teaminvite=;
  // held by teamsAllowed). The sign-in page only checks the address and the
  // stash; capturing, claiming, the card and the note load later
  // (components/TeamJoinCard.jsx). Most of the growth is that import's list
  // of chunks to preload.
  // 2026-10-27: +0.5 KB for a draft's keep page (/keep/<token>, about 0.2 KB):
  // the route, its import's list of chunks to preload, and the first touch's
  // keep-link redaction (lib/linkTokens.js). The page itself loads later
  // (pages/KeepPage.jsx).
  // The Team launch's nine events (every event name is in the entry,
  // analyticsEvents.js) and the Talk to us page's route fit under it: CI's
  // build read 165.7 KB on 2026-10-27. The page itself loads only on
  // /pricing/talk-to-us.
  entryJs: 166_000,
  entryCss: 96_000,
  // 2026-10-21: the panels, pages and players only a click opens left the app
  // (LAZY_IN_APP), from 861 KB of JS and 42 KB of CSS; then the icons only
  // they draw (vite.config.js iconSplit), from 687 KB.
  // 2026-10-24: +1.0 KB for DOMPurify 3.4.17, the security patch for
  // GHSA-cg2g-xh64-v4q7 and GHSA-c6gr-qvv4-5v3f (about +0.5 KB brotli; notes
  // sanitize as they render, so it stays in the closure).
  // 2026-10-24: +2 KB for playable copies (lib/playCopy.js). Every video and
  // audio card plays the copy its card names and notices a file its browser
  // can't play; finding, asking for and waiting on a copy load later
  // (playCopyWork).
  // 2026-10-24: +1 KB for photo views (lib/fileView.js). A picture whose file
  // the browser can't draw waits for the file's view and shows it, and an
  // editor's cluster asks views for its photos; asking for and waiting on a
  // view load later (fileViewWork).
  // 2026-10-25: +1 KB for tags where people work: Tag… on a group and on the
  // cluster, Tag selection… in a document, `#name` in Cmd-K, one tag count,
  // the workspace AI switch (the retired emergent-theme code paid for part).
  // 2026-10-25: +1 KB for the Team plan in the app (held by teamsAllowed):
  // the person's teams and the team's workspaces in the workspace menu, and
  // reading a landing on /team. The page, its data, and verifying a return
  // from Stripe load later (TeamPageLive, teamsApi, teamReturnRun).
  // 2026-10-26: +0.5 KB, no new feature. CI's bundle job measured 691.2 KB on
  // db870a75, over a ceiling set from a local build that read low: a worktree
  // that symlinks the shared checkout's node_modules builds dompurify 3.4.16
  // and nanoid 3.3.12, where the lockfile (and CI, and Cloudflare) has 3.4.17
  // and 3.3.20, about 0.6 KB less. Take the figure from CI's run, or from a
  // worktree with its own `npm ci`.
  // 2026-10-26: +1.5 KB for the tag spotlight (a chip lights its tag's cards
  // up in place, with the pill), suggested chips on cards, and chips on group
  // labels: the owner's direction A, all in CanvasSurface's closure. Sized
  // for CI's build (a worktree on the shared node_modules reads ~0.6 KB low,
  // as above): about +1.3 KB measured.
  // 2026-10-26: +1 KB for tagging several cards at once: the selection bar's
  // Tag and its state in CanvasSurface (the tri-state picker and its writes,
  // TagManyPicker + tagCardsBatch, load on demand). Sized for CI, as above.
  // 2026-10-27: −7 KB, banked. The old canvas toolbars went (29c1d7c6,
  // fcbf8b7c), and CI measured 686.4 KB on 1a4c29ed, so the ceiling comes
  // down to that plus 0.6 rather than leaving 7.6 KB that anything could grow
  // into unseen.
  // 2026-10-27: +2.8 KB for the document card (the owner's direction A): a
  // Word, PowerPoint or Excel file's card shows its first page, its glyph
  // until then (R2Image's placeholder), and its page count, and Files and the
  // sidebar show the page. Most of it is the family glyphs a board draws at
  // once (Excel's, PowerPoint's, a deck's): every Phosphor icon carries all
  // six weights. CI measured 685.7 KB on 80e02093, this change 689.2.
  // 2026-10-27: +0.2 KB for a text file's page: FileCard names the file's
  // family (lib/fileView.js fileFamily, which also sizes a new drop) and
  // loads the page itself later (FamilyFace.jsx), and the old small-text
  // preview it replaces is gone. Measured as CI builds: 689.8 KB on c7ae42ee,
  // this change 690.03.
  appJs: 690_100,
  appCss: 21_000,
};

// Chunks that must never be in the app's critical closure. Matched against the
// chunk's file name prefix (the part before the content hash).
// three.js has its own chunk (vite.config.js), so it is named on its own.
export const NEVER_IN_APP = [
  'vendor-graph3d', 'vendor-three', 'vendor-cosmograph', 'vendor-charts', 'vendor-icons-lazy',
  'AdminPage', 'DocsPage', 'jspdf', 'html2canvas', 'pdf',
];

// What the app imports lazily, by chunk name: each must be a chunk of its own,
// outside the closure. A static import anywhere in the app folds the module
// into a closure chunk instead, so its own chunk disappearing fails too.
export const LAZY_IN_APP = [
  // App.jsx
  'ListSurface', 'MessagesPanel', 'SettingsPanel', 'ShareModal', 'CommandPalette', 'TagDetailView',
  'TrashModal', 'VersionHistoryModal', 'WorkspaceRecoveryModal', 'EntityBacklinksPanel', 'importStart', 'TeamPage', 'TeamPageLive', 'NewWorkspaceDialog',
  // TierRouter.jsx: one route's page each
  'PricingPage', 'TeamPlanCard', 'TeamDomainNote', 'TeamSetup', 'PricingSuccess', 'WelcomePage', 'WaitlistConfirm',
  // the canvas: cards.jsx, CanvasSurface.jsx, info/InfoHost.jsx
  'FilmPlayer', 'ScheduleCard', 'SketchPadOverlay', 'GridTemplatePanel', 'SaveTemplateDialog', 'DetailPanel', 'TagManyPicker',
  // FileCard.jsx: a text file's page
  'FamilyFace',
  // ToolOptionsBar.jsx: the note bar and the draw, shape, line and arrow bars in the toolbar look
  'NoteBarA', 'CanvasBarsA',
  // CanvasSurface.jsx: the selection's bar in the toolbar look
  'SelectionBarA',
  // SidebarTags.jsx (and the lazy TagDetailView): a tag's or an item's actions
  // under a finger
  'TagActionSheet',
  // FloatingChrome.jsx: ⋯'s menu in the top islands in the toolbar look
  'ChromeMoreA',
  // DocSurface.jsx: the doc look's frame, its bars, side panel and footer
  'DocFrameA',
  // usePlayCopy.js, usePlayCopyBackfill.js: finding, asking for and waiting on
  // a playable copy, and writing it onto cards
  'playCopyWork',
  // R2Image.jsx, useFileViewBackfill.js: asking for and waiting on a photo's
  // view, and writing it onto cards
  'fileViewWork',
];

const br = (buf) => brotliCompressSync(buf, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } }).length;

// "assets/CanvasSurface-DiqxAXy4.js" → "CanvasSurface". The hash is Vite's 8
// characters, which can hold a "-" themselves ("SaveTemplateDialog-C-QHNrt0").
export function chunkName(file) {
  const base = file.split('/').pop().replace(/\.(js|css)$/, '');
  const m = /^(.+)-[A-Za-z0-9_-]{8}$/.exec(base);
  return m ? m[1] : base;
}

// Static import edges of one minified chunk: `import{a as b}from"./x.js"` and
// `import"./x.js"`. Dynamic `import("./x.js")` is not an edge.
export function staticImports(src) {
  const out = new Set();
  for (const m of src.matchAll(/(?:^|[;\n}])\s*import\s*(?:[\w*{}\s,$]+from\s*)?["']\.\/([^"']+\.js)["']/g)) out.add(`assets/${m[1]}`);
  return out;
}

// The deps Vite preloads for `import("./<name>-<hash>.js")` in `src`: the index
// list passed to __vite__mapDeps right after that import, mapped through the
// chunk's dep table. Returns null when the import is not there.
export function preloadDepsFor(src, name) {
  const table = src.match(/m\.f=(\[[^\]]*\])/);
  if (!table) return null;
  const files = JSON.parse(table[1]);
  const at = src.search(new RegExp(`import\\(["']\\./${name}-[\\w-]+\\.js["']\\)`));
  if (at < 0) return null;
  const call = src.slice(at).match(/__vite__mapDeps\(\[([\d,\s]*)\]\)/);
  if (!call) return null;
  const own = src.slice(at).match(new RegExp(`\\./(${name}-[\\w-]+\\.js)`))[1];
  const deps = call[1].split(',').map((s) => s.trim()).filter(Boolean).map((i) => files[Number(i)]);
  return [...new Set([`assets/${own}`, ...deps])];
}

// The lists the inline script in index.html preloads (vite.config.js
// appPreload), or null when the build wrote none.
export function inlinePreloadLists(html) {
  const m = html.match(/__soleilAppPreload[\s\S]*?\}\)\((\{[\s\S]*?\})\s*,\s*\[/);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch (_) { return null; }
}

function closure(roots, read) {
  const seen = new Set();
  const stack = [...roots];
  while (stack.length) {
    const f = stack.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    let src;
    try { src = read(f); } catch (_) { continue; }
    for (const d of staticImports(src)) stack.push(d);
  }
  return seen;
}

// LAZY_IN_APP names that are in the closure, or that have no chunk of their own.
export function lazyMisses(dist, inClosure) {
  const chunks = readdirSync(join(dist, 'assets')).filter((f) => f.endsWith('.js')).map((f) => `assets/${f}`);
  const misses = [];
  for (const name of LAZY_IN_APP) {
    const own = chunks.filter((f) => chunkName(f) === name);
    if (!own.length) misses.push(`${name} (no chunk of its own)`);
    else if (own.some(inClosure)) misses.push(`${name} (in the closure)`);
  }
  return misses;
}

export function measure(dist) {
  const read = (f) => readFileSync(join(dist, f), 'utf8');
  const html = read('index.html');
  const entry = [...html.matchAll(/<script type="module"[^>]*src="\/(assets\/[^"]+\.js)"/g)].map((m) => m[1]);
  const pre = [...html.matchAll(/<link rel="modulepreload"[^>]*href="\/(assets\/[^"]+\.js)"/g)].map((m) => m[1]);
  const css = [...html.matchAll(/<link rel="stylesheet"[^>]*href="\/(assets\/[^"]+\.css)"/g)].map((m) => m[1]);
  if (!entry.length) throw new Error(`no module entry in ${dist}/index.html`);
  const entryClosure = closure([...entry, ...pre], read);

  let appDeps = null;
  for (const e of entry) { appDeps = preloadDepsFor(read(e), 'AppShell'); if (appDeps) break; }
  if (!appDeps) throw new Error('the entry has no import() of AppShell: was the build made without Supabase configured?');
  const app = appDeps.filter((f) => !entryClosure.has(f) && !css.includes(f));
  const lists = inlinePreloadLists(html);
  const preloaded = lists?.app ? [...lists.app.js, ...lists.app.css].map((h) => h.replace(/^\//, '')) : null;

  const size = (f) => br(readFileSync(join(dist, f)));
  const rows = (list) => list.map((f) => ({ file: f, br: size(f) })).sort((a, b) => b.br - a.br);
  const appJsRows = rows(app.filter((f) => f.endsWith('.js')));
  const appCssRows = rows(app.filter((f) => f.endsWith('.css')));
  const entryJsRows = rows([...entryClosure]);
  const entryCssRows = rows(css);
  const sum = (r) => r.reduce((n, x) => n + x.br, 0);
  return {
    entryJs: sum(entryJsRows), entryCss: sum(entryCssRows),
    appJs: sum(appJsRows), appCss: sum(appCssRows),
    rows: { entryJs: entryJsRows, entryCss: entryCssRows, appJs: appJsRows, appCss: appCssRows },
    forbidden: app.filter((f) => NEVER_IN_APP.includes(chunkName(f))),
    lazy: lazyMisses(dist, (f) => app.includes(f) || entryClosure.has(f)),
    preload: preloaded && {
      missing: app.filter((f) => !preloaded.includes(f)),
      extra: preloaded.filter((f) => !app.includes(f)),
    },
    files: readdirSync(join(dist, 'assets')).length,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const m = measure(DIST);
  const kb = (n) => `${(n / 1000).toFixed(1)} KB`;
  let failed = false;
  for (const [k, cap] of Object.entries(CEILINGS)) {
    const over = m[k] > cap;
    if (over) failed = true;
    console.log(`${over ? 'OVER' : 'ok  '}  ${k.padEnd(8)} ${kb(m[k]).padStart(10)}  (ceiling ${kb(cap)}, ${m.rows[k].length} files)`);
  }
  if (m.forbidden.length) {
    failed = true;
    console.log(`\nIn the app's critical closure but split out on purpose: ${m.forbidden.join(', ')}`);
    console.log('Something now imports them statically. Find it and make it lazyWithReload().');
  }
  if (m.lazy.length) {
    failed = true;
    console.log(`\nImported lazily on purpose, but now: ${m.lazy.join(', ')}`);
    console.log('Something imports them statically. Find it and import them lazily again (LAZY_IN_APP says where they live).');
  }
  if (!m.preload) {
    failed = true;
    console.log('\nindex.html has no app preload list: vite.config.js appPreload wrote nothing.');
  } else if (m.preload.missing.length || m.preload.extra.length) {
    failed = true;
    console.log('\nThe preload list in index.html is not what Vite loads for AppShell.');
    if (m.preload.missing.length) console.log(`  Vite loads, never preloaded: ${m.preload.missing.join(', ')}`);
    if (m.preload.extra.length) console.log(`  preloaded, never loaded by Vite: ${m.preload.extra.join(', ')}`);
  }
  if (REPORT) {
    for (const k of Object.keys(CEILINGS)) {
      console.log(`\n${k}:`);
      for (const r of m.rows[k]) console.log(`  ${kb(r.br).padStart(10)}  ${r.file}`);
    }
  }
  if (failed) process.exit(1);
}
