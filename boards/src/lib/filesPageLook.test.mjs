// filesPageLook.test.mjs — direction A's look for the full Files page has one
// switch (lifted for the sidebar release), App alone decides it from that
// switch, and a page that isn't handed the look (LocalBoardsApp,
// PublicBoardView) carries none of it.
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
const holdBody = (name) => read('lib/appHost.js').match(new RegExp(`export function ${name}\\(\\)\\s*\\{([\\s\\S]*?)\\n\\}`))?.[1] || '';

test('the hold is lifted, and stays the one switch in the feature-flag list', () => {
  // Lifted for the sidebar release (2026-10-21) as the holds beside it were:
  // by becoming `return true;`, never by deleting the function App reads.
  assert.equal(holdBody('filesPageLookAllowed').trim(), 'return true;');
  assert.match(read('lib/appHost.js'), /^\s*filesPageLook: filesPageLookAllowed,$/m);
});

test('App alone decides the look, from the hold', () => {
  const app = read('App.jsx');
  assert.match(app, /const filesLook = filesSidebar && filesPageLookAllowed\(\) \? 'sb' : null;/);
  assert.match(app, /<FilesLookContext\.Provider value=\{filesLook\}>/);
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
