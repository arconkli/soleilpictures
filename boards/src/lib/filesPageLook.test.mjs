// filesPageLook.test.mjs — direction A's look for the full Files page has one
// switch (lifted for the sidebar release), App and a shared link
// (PublicBoardView) decide it from that switch, a page that isn't handed the
// look (LocalBoardsApp) carries none of it, and nothing in the look leans on
// App's shell, so the shared link gets all of it.
//
//   node --test src/lib/filesPageLook.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, '..');
const read = (p) => readFileSync(path.join(src, p), 'utf8');
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(path.join(dir, e.name)) : /\.(jsx?|mjs)$/.test(e.name) ? [path.join(dir, e.name)] : []);
const holdBody = (name) => read('lib/appHost.js').match(new RegExp(`export function ${name}\\(\\)\\s*\\{([\\s\\S]*?)\\n\\}`))?.[1] || '';

test('the hold is lifted, and stays the one switch in the feature-flag list', () => {
  // Lifted for the sidebar release (2026-10-21) as the holds beside it were:
  // by becoming `return true;`, never by deleting the function App reads.
  assert.equal(holdBody('filesPageLookAllowed').trim(), 'return true;');
  assert.match(read('lib/appHost.js'), /^\s*filesPageLook: filesPageLookAllowed,$/m);
});

test('App and a shared link decide the look, from the one hold', () => {
  const app = read('App.jsx');
  assert.match(app, /const filesLook = filesSidebar && filesPageLookAllowed\(\) \? 'sb' : null;/);
  assert.match(app, /<FilesLookContext\.Provider value=\{filesLook\}>/);
  // A cluster set to open in Files opens as the page on its shared and
  // published links too: hold the switch and they go back with App.
  const pub = read('components/PublicBoardView.jsx');
  assert.match(pub, /const filesLook = isListView && filesPageLookAllowed\(\) \? 'sb' : null;/);
  assert.match(pub, /<FilesLookContext\.Provider value=\{filesLook\}>/);
  assert.doesNotMatch(read('local/LocalBoardsApp.jsx'), /FilesLookContext/);
});

test('a shared link gets the whole look without App around it', () => {
  // Its phone rules follow ListSurface's own shell, not App's classes.
  assert.doesNotMatch(read('components/clusterBrowser/filesPage.css'), /\.app\.sb-files:not\(\.is-floating-chrome\)/);
  assert.match(read('components/ListSurface.jsx'), /data-shell=\{sb && phoneShell \? 'mobile' : undefined\}/);
  // The sidebar's controls and materials load with the page, from a sheet of
  // the link's own: an import of clusterSidebar.css from outside the app
  // splits it out of the app's stylesheet, a second file every signed-in open
  // downloads (scripts/bundleBudget.mjs, appCss). The dark materials stand on
  // a page committed to the dark, whatever the theme.
  assert.match(read('components/clusterBrowser/filesPagePublic.css'), /^@import '\.\.\/sidebar\/clusterSidebar\.css';$/m);
  assert.match(read('components/PublicBoardView.jsx'), /filesPageLookAllowed\(\) \? import\('\.\/clusterBrowser\/filesPagePublic\.css'\) : null,\n\s*import\('\.\/ListSurface\.jsx'\),/);
  for (const f of walk(src)) {
    if (f.endsWith('.test.mjs') || f.includes(`${path.sep}local${path.sep}`)) continue;
    const imports = /import\s*(?:\(\s*)?'[^']*\/clusterSidebar\.css'/.test(readFileSync(f, 'utf8'));
    assert.equal(imports, f.endsWith(path.join('sidebar', 'ClusterSidebar.jsx')), `${path.relative(src, f)} imports clusterSidebar.css`);
  }
  assert.match(read('components/sidebar/clusterSidebar.css'), /^\.app\.sb-files, body\[data-sb-files\], \.public-dark \{$/m);
  assert.doesNotMatch(read('components/sidebar/clusterSidebar.css'), /\[data-theme='light'\][^{]*\.public-dark/);
  // Its menu opens in that page, and its title switches nothing: a visitor
  // has no workspace to switch through.
  assert.match(read('components/sidebar/FilesShowMenu.jsx'), /btnRef\.current\?\.closest\('\.public-dark'\) \|\| document\.body/);
  assert.match(read('components/PublicBoardView.jsx'), /clusterSwitch=\{false\}/);
});

test('nothing under App asks a hold for the look', () => {
  const files = ['components/ListSurface.jsx',
    ...readdirSync(path.join(src, 'components/clusterBrowser')).filter((f) => /\.jsx?$/.test(f)).map((f) => `components/clusterBrowser/${f}`)];
  for (const f of files) assert.doesNotMatch(read(f), /filesPageLookAllowed|sidebarFilesAllowed/, `${f} reads a hold`);
});

test('without the look the page and Quick look carry no data-look', () => {
  assert.match(read('components/ListSurface.jsx'), /data-look=\{sb \? look : undefined\}/);
  assert.match(read('components/clusterBrowser/QuickLook.jsx'), /data-look=\{sb \? look : undefined\}/);
});
