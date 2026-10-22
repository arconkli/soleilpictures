// appPreloadList — the files the signed-in app needs, read off the built
// bundle, and the small script that starts fetching them early.
//
// A signed-in open used to fetch the app in series: the entry ran, AuthGate
// restored (often refreshed) the session, and only then did import() of
// AppShell start a ~1 MB download. The build now writes the AppShell closure
// into index.html, and a script at the top of <head> preloads it while the
// HTML is still parsing, so the download overlaps the entry and the session.
// The sign-in form calls the same lists when a code is sent, so a new account
// has the app on hand by the time the code is typed (lib/preloadApp.js).
//
// It only preloads; it never imports. Evaluating the app before there is a
// session would run its module side effects (auth subscriptions, global
// listeners, window.perf) for a visitor who may never sign in. Someone on the
// code step has asked for a code, and the step runs the app itself
// (AuthGate's warmApp, 2026-10-22).
//
// The hrefs are the literal `/assets/…` paths, because Vite's preload helper
// skips a dependency only when `link[href="<that path>"]` is already in the
// document; any other spelling and every chunk downloads twice. Stylesheets
// are `rel=preload as=style` and never `rel=stylesheet`: applying the app's
// CSS on the sign-in page would restyle it. Both carry crossorigin="", as the
// helper's own links do, so the browser can reuse what was preloaded.
//
// Pure apart from preloadRuntime, which runs in the page; vite.config.js
// serialises it into the HTML, and appPreloadList.test.mjs runs both in node.

// The paths a signed-in visitor opens the app on: `/` and the pages TierRouter
// serves itself. Every other path is a public page that never needs the app.
export const APP_PRELOAD_PATHS = ['/', '/pricing', '/pricing/success', '/admin', '/welcome', '/waitlist', '/waitlist/status'];

export const APP_SHELL_MODULE = '/src/AppShell.jsx';
export const WORKSPACE_SETUP_MODULE = '/src/components/setup/WorkspaceSetup.jsx';

function staticClosure(bundle, fileName, into) {
  if (into.has(fileName)) return into;
  const chunk = bundle[fileName];
  if (!chunk || chunk.type !== 'chunk') return into;
  into.add(fileName);
  for (const dep of chunk.imports || []) staticClosure(bundle, dep, into);
  return into;
}

function cssOf(bundle, fileName) {
  return [...(bundle[fileName]?.viteMetadata?.importedCss || [])];
}

// The chunk a module was bundled into. Not by facadeModuleId: AppShell's chunk
// also exports code other chunks share, and Rollup leaves such a chunk with no
// facade. A module is in exactly one chunk, so moduleIds names it exactly.
function chunkHolding(chunks, moduleSuffix) {
  const is = (id) => typeof id === 'string' && id.replace(/\\/g, '/').endsWith(moduleSuffix);
  return chunks.find((c) => is(c.facadeModuleId) || (c.moduleIds || []).some(is)) || null;
}

// { js, css } for the chunk holding `moduleSuffix` and everything it imports
// statically, minus what the entry already loads; null when no chunk holds it
// (a build without the signed-in app).
export function appPreloadList(bundle, moduleSuffix = APP_SHELL_MODULE, { base = '/' } = {}) {
  const chunks = Object.values(bundle).filter((c) => c && c.type === 'chunk');
  const target = chunkHolding(chunks, moduleSuffix);
  if (!target) return null;
  const entry = new Set();
  for (const c of chunks) if (c.isEntry) staticClosure(bundle, c.fileName, entry);
  const entryCss = new Set([...entry].flatMap((f) => cssOf(bundle, f)));
  const files = [...staticClosure(bundle, target.fileName, new Set())];
  const js = files.filter((f) => !entry.has(f));
  const css = [...new Set(files.flatMap((f) => cssOf(bundle, f)))].filter((f) => !entryCss.has(f));
  return { js: js.map((f) => base + f), css: css.map((f) => base + f) };
}

// What `list` adds over `already`.
export function withoutList(list, already) {
  if (!list) return null;
  const has = new Set([...(already?.js || []), ...(already?.css || [])]);
  return { js: list.js.filter((h) => !has.has(h)), css: list.css.filter((h) => !has.has(h)) };
}

// Runs in the page, from an inline script at the top of <head>. Keep it
// self-contained ES5 with no comments inside: it is serialised with
// toString(), and index.html is scanned for public claims.
export function preloadRuntime(lists, paths) {
  var d = document;
  var nonce = (d.currentScript && d.currentScript.nonce) || '';
  var seen = {};
  function add(href, css, low) {
    if (seen[href]) return;
    seen[href] = 1;
    if (d.querySelector('link[href="' + href + '"]')) return;
    var l = d.createElement('link');
    if (css) { l.rel = 'preload'; l.as = 'style'; } else { l.rel = 'modulepreload'; }
    l.crossOrigin = '';
    l.href = href;
    if (nonce) l.nonce = nonce;
    if (low) l.fetchPriority = 'low';
    d.head.appendChild(l);
  }
  function run(name, low) {
    var list = lists[name];
    if (!list) return;
    for (var i = 0; i < list.css.length; i++) add(list.css[i], true, low);
    for (var j = 0; j < list.js.length; j++) add(list.js[j], false, low);
  }
  window.__soleilAppPreload = { run: function (name) { run(name, false); } };
  try {
    var p = (location.pathname.replace(/\/+$/, '') || '/').toLowerCase();
    if (paths.indexOf(p) < 0) return;
    for (var k = 0; k < localStorage.length; k++) {
      var key = localStorage.key(k);
      if (key && key.indexOf('sb-') === 0 && key.indexOf('auth-token') > 0) { run('app', true); return; }
    }
  } catch (e) {}
}

// The inline script's text. Parse-time preloads go at low priority, so on a
// slow link the entry's own JS and CSS arrive first: the entry is what starts
// the session and the boot queries.
export function preloadScript(lists, paths = APP_PRELOAD_PATHS) {
  return `(${preloadRuntime.toString()})(${JSON.stringify(lists)},${JSON.stringify(paths)});`;
}
