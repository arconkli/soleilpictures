// appPreloadList: the signed-in app's files, read off a bundle, and the script
// that preloads them. Run: node --test src/lib/appPreloadList.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  appPreloadList, withoutList, preloadScript, APP_PRELOAD_PATHS, WORKSPACE_SETUP_MODULE,
} from './appPreloadList.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const chunk = (fileName, { imports = [], css = [], entry = false, facade = null, modules = [] } = {}) => ({
  type: 'chunk', fileName, imports, isEntry: entry, facadeModuleId: facade,
  moduleIds: [...(facade ? [facade] : []), ...modules],
  viteMetadata: { importedCss: new Set(css), importedAssets: new Set() },
});
const bundleOf = (...chunks) => Object.fromEntries(chunks.map((c) => [c.fileName, c]));

const BUNDLE = bundleOf(
  chunk('assets/index-a.js', { entry: true, imports: ['assets/vendor-react-b.js'], css: ['assets/index-x.css'], facade: '/repo/boards/index.html' }),
  chunk('assets/vendor-react-b.js'),
  // As Rollup builds it: AppShell's chunk also exports code other chunks
  // share, so it has no facade, only the module among its own.
  chunk('assets/AppShell-c.js', {
    modules: ['/repo/boards/src/lib/shared.js', '/repo/boards/src/AppShell.jsx'],
    imports: ['assets/vendor-react-b.js', 'assets/CanvasSurface-d.js', 'assets/shared-e.js'],
    css: ['assets/AppShell-y.css'],
  }),
  chunk('assets/CanvasSurface-d.js', { imports: ['assets/vendor-yjs-f.js'], css: ['assets/CanvasSurface-z.css'] }),
  chunk('assets/vendor-yjs-f.js'),
  chunk('assets/shared-e.js', { css: ['assets/index-x.css'] }),
  chunk('assets/Lazy-g.js', { facade: '/repo/boards/src/components/Lazy.jsx' }),
  chunk('assets/WorkspaceSetup-h.js', {
    facade: '/repo/boards/src/components/setup/WorkspaceSetup.jsx',
    imports: ['assets/vendor-react-b.js', 'assets/shared-e.js', 'assets/setupOnly-i.js'],
    css: ['assets/WorkspaceSetup-w.css'],
  }),
  chunk('assets/setupOnly-i.js'),
  { type: 'asset', fileName: 'assets/logo.svg' },
);

test('the list is the AppShell closure, minus what the entry already loads', () => {
  assert.deepEqual(appPreloadList(BUNDLE), {
    js: ['/assets/AppShell-c.js', '/assets/CanvasSurface-d.js', '/assets/vendor-yjs-f.js', '/assets/shared-e.js'],
    css: ['/assets/AppShell-y.css', '/assets/CanvasSurface-z.css'],
  });
});

test('a lazy chunk is not in it, and nothing is listed for a bundle without AppShell', () => {
  assert.ok(!appPreloadList(BUNDLE).js.some((h) => h.includes('Lazy')));
  const noShell = { ...BUNDLE };
  delete noShell['assets/AppShell-c.js'];
  assert.equal(appPreloadList(noShell), null);
});

test('the setup list is only what setup adds on top of the app', () => {
  const app = appPreloadList(BUNDLE);
  const setup = withoutList(appPreloadList(BUNDLE, WORKSPACE_SETUP_MODULE), app);
  assert.deepEqual(setup, { js: ['/assets/WorkspaceSetup-h.js', '/assets/setupOnly-i.js'], css: ['/assets/WorkspaceSetup-w.css'] });
  assert.equal(withoutList(null, app), null);
});

// A page the script can run in: what it reads and the links it adds.
function page({ path = '/', keys = [], existing = [], nonce = 'n0nce', storageThrows = false } = {}) {
  const head = [];
  const all = () => [...existing, ...head];
  const document = {
    currentScript: { nonce },
    head: { appendChild: (el) => head.push(el) },
    createElement: (tag) => ({ tag }),
    querySelector: (sel) => {
      const m = /^link\[href="(.*)"\]$/.exec(sel);
      return (m && all().find((l) => l.href === m[1])) || null;
    },
  };
  const localStorage = storageThrows
    ? { get length() { throw new Error('denied'); }, key() { throw new Error('denied'); } }
    : { length: keys.length, key: (i) => keys[i] ?? null };
  const window = {};
  return { head, window, globals: [document, window, { pathname: path }, localStorage] };
}

const LISTS = { app: appPreloadList(BUNDLE), setup: { js: ['/assets/WorkspaceSetup-h.js'], css: ['/assets/WorkspaceSetup-w.css'] } };
const SIGNED_IN = ['soleil.theme', 'sb-abcdefgh-auth-token'];

// Runs the script exactly as the build writes it into index.html.
function boot(p, lists = LISTS) {
  new Function('document', 'window', 'location', 'localStorage', preloadScript(lists))(...p.globals);
  return p;
}

test('a signed-in open of / preloads the app during parse, stylesheets first, at low priority', () => {
  const p = boot(page({ keys: SIGNED_IN }));
  assert.deepEqual(p.head.map((l) => l.href), [...LISTS.app.css, ...LISTS.app.js]);
  for (const l of p.head) {
    assert.equal(l.tag, 'link');
    assert.equal(l.crossOrigin, '');
    assert.equal(l.nonce, 'n0nce');
    assert.equal(l.fetchPriority, 'low');
  }
  const css = p.head.filter((l) => l.href.endsWith('.css'));
  assert.ok(css.every((l) => l.rel === 'preload' && l.as === 'style'), 'never rel=stylesheet: the sign-in page would be restyled');
  assert.ok(p.head.filter((l) => l.href.endsWith('.js')).every((l) => l.rel === 'modulepreload'));
});

test('every app path is covered, with or without a trailing slash, in any case', () => {
  for (const path of [...APP_PRELOAD_PATHS, '/pricing/', '/Admin', '/waitlist/status/']) {
    assert.ok(boot(page({ path, keys: SIGNED_IN })).head.length > 0, path);
  }
});

test('signed out, or on a public page, nothing is fetched until the code step asks', () => {
  assert.equal(boot(page({ keys: ['soleil.theme'] })).head.length, 0);
  for (const path of ['/docs', '/c/some-cluster', '/share/0a2b', '/vs/pureref', '/explore']) {
    assert.equal(boot(page({ path, keys: SIGNED_IN })).head.length, 0, path);
  }
  const p = boot(page({ keys: [] }));
  p.window.__soleilAppPreload.run('app');
  assert.deepEqual(p.head.map((l) => l.href), [...LISTS.app.css, ...LISTS.app.js]);
  assert.ok(p.head.every((l) => l.fetchPriority === undefined), 'the code step fetches at normal priority');
});

test('nothing is fetched twice', () => {
  const p = boot(page({ keys: SIGNED_IN, existing: [{ href: '/assets/AppShell-c.js' }] }));
  assert.ok(!p.head.some((l) => l.href === '/assets/AppShell-c.js'), 'already in the document');
  const before = p.head.length;
  p.window.__soleilAppPreload.run('app');
  assert.equal(p.head.length, before);
  p.window.__soleilAppPreload.run('setup');
  p.window.__soleilAppPreload.run('setup');
  p.window.__soleilAppPreload.run('nope');
  assert.equal(p.head.length, before + 2);
});

test('storage that throws costs the head start, never the page', () => {
  const p = boot(page({ storageThrows: true }));
  assert.equal(p.head.length, 0);
  assert.equal(typeof p.window.__soleilAppPreload.run, 'function');
});

// The paths main.jsx routes to a public page before AuthGate. /pricing is the
// one exception: main.jsx serves the public page only without a stored
// session, and the script preloads only with one.
test('no app path is a public page in main.jsx', () => {
  const src = readFileSync(resolve(HERE, '../main.jsx'), 'utf8');
  const matchers = [];
  for (const line of src.split('\n')) {
    const name = /^const (\w+Match) = /.exec(line)?.[1];
    if (!name || !line.includes('window.location.pathname')) continue;
    const lit = /(\/\^.*\/)([a-z]*)(?=\)|\.test)/.exec(line);
    assert.ok(lit, `could not read the regex of ${name}`);
    matchers.push([name, new RegExp(lit[1].slice(1, -1), lit[2])]);
  }
  assert.ok(matchers.length >= 10, `found only ${matchers.length} route matchers in main.jsx`);
  for (const path of APP_PRELOAD_PATHS) {
    for (const [name, re] of matchers) {
      if (name === 'pricingMatch' && path === '/pricing') continue;
      assert.ok(!re.test(path), `${path} is a public page (${name}); preloading the app there wastes a visitor's download`);
    }
  }
});

test('the preload helper the entry calls stays free of imports', () => {
  const src = readFileSync(resolve(HERE, 'preloadApp.js'), 'utf8');
  assert.ok(!/^\s*import\s/m.test(src), 'preloadApp.js is in the entry chunk');
  const gate = readFileSync(resolve(HERE, '../auth/AuthGate.jsx'), 'utf8');
  assert.match(gate, /if \(!resending\) preloadSignedInApp\(\{ setup: workspaceSetupAllowed\(\) \}\);[\s\S]*?signInWithOtp/,
    'sendCode preloads before the code is requested');
});

test('the code step runs the app it preloaded, through the warm that never reloads', () => {
  const main = readFileSync(resolve(HERE, '../main.jsx'), 'utf8');
  assert.match(main, / warmApp=\{AppShell\.warm\}>\s*<AppShell \/>/,
    'main.jsx hands AuthGate the warm of the AppShell it renders');
  const gate = readFileSync(resolve(HERE, '../auth/AuthGate.jsx'), 'utf8');
  assert.match(gate, /<SignIn warmApp=\{warmApp\} \/>/);
  const effect = gate.match(/const onCodeStep = stage === 'code';\n\s*useEffect\(\(\) => \{[\s\S]*?\}, \[onCodeStep, warmApp\]\);/)?.[0];
  assert.ok(effect, 'SignIn warms the app from an effect on the code step');
  assert.match(effect, /if \(!onCodeStep \|\| !warmApp \|\| import\.meta\.env\.DEV\) return undefined;/);
  assert.match(effect, /requestIdleCallback\(\(\) => warmApp\(\)/, 'on idle, after the step has drawn');
  // The import itself, and importWithReload's stale-chunk reload, would take
  // the page out from under someone typing their code.
  assert.ok(!/import\(['"]\.\.\/AppShell/.test(gate), 'AuthGate never imports AppShell itself');
  assert.ok(!/importWithReload/.test(gate));
  const lazy = readFileSync(resolve(HERE, 'lazyWithReload.js'), 'utf8');
  assert.match(lazy, /Lazy\.warm = \(\) => \{ factory\(\)\.catch\(\(\) => \{\}\); \};/, 'a failed warm is swallowed');
});

test('an app run before sign-in keeps the image links a past session signed', () => {
  // r2.js runs on the code step now; a signed-out start must not throw away
  // what the person signing back in would reuse. hydrate() drops another uid's.
  const r2 = readFileSync(resolve(HERE, 'r2.js'), 'utf8');
  const listener = r2.match(/supabase\.auth\.onAuthStateChange\(\(event, session\) => \{[\s\S]*?\n  \}\);/)?.[0];
  assert.ok(listener);
  assert.match(listener, /if \(event === 'SIGNED_OUT'\) \{ clearPersisted\(\); return; \}/);
  assert.match(listener, /if \(!uid\) return;/);
  assert.match(r2, /if \(!parsed \|\| parsed\.uid !== uid\) \{ localStorage\.removeItem\(LS_KEY\); return; \}/);
});
