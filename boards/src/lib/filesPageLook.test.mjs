// filesPageLook.test.mjs — direction A's look for the full Files page stays
// behind its own hold, App alone decides it, and production's page carries
// none of it.
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

test('the hold needs the files sidebar and is closed on production', () => {
  const body = holdBody('filesPageLookAllowed');
  assert.match(body, /if \(!sidebarFilesAllowed\(\)\) return false;/);
  assert.match(body, /if \(!import\.meta\.env\.DEV\) return false;/);
  assert.doesNotMatch(body.trim(), /^return true;$/);
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
