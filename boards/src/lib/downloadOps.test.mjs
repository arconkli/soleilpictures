// downloadOps.test.mjs — the download helpers, pinned by source.
//
//   node --test src/lib/downloadOps.test.mjs
//
// downloadOps imports cardDownload, which reaches r2.js and import.meta.env,
// so it cannot load under node. These read the source instead: both callers go
// through the helpers, and the helpers carry the codes and the guard.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const ops = read('./downloadOps.js');
const list = read('../components/ListSurface.jsx');
const side = read('../components/sidebar/ClusterSidebar.jsx');

test('helper carries the guard, the cancel return and the left-out warnings', () => {
  const many = ops.slice(ops.indexOf('export async function downloadManyTracked'));
  assert.ok(many.indexOf('bulkDownloadSupported()') < many.indexOf('trackOp('), 'guard comes before the tray row');
  assert.match(many, /Download files one at a time in the app\./);
  assert.match(many, /if \(!out\) return;/);
  assert.match(many, /cancellable: true/);
  assert.match(many, /0\.9 \* /);
  assert.match(many, /had no file/);
  assert.match(many, /could not be read from storage/);
  assert.match(many, /Nothing there could be downloaded\./);
});

test('helper carries the three zip codes and the single-file code', () => {
  for (const code of ['zip_too_large', 'zip_storage_blocked', 'zip_download_failed', 'file_download_failed']) {
    assert.match(ops, new RegExp(`code: '${code}'`), code);
  }
  assert.match(ops, /toast\?\./, 'a missing toast is tolerated');
});

test('single file is a tray row keyed by the card', () => {
  assert.match(ops, /key = `download:\$\{card\.id\}`/);
  assert.match(ops, /Download started/);
});

test('ListSurface goes through the helpers', () => {
  assert.match(list, /downloadOneTracked\(/);
  assert.match(list, /downloadManyTracked\(/);
  assert.doesNotMatch(list, /downloadCardAssets?\(/);
  assert.doesNotMatch(list, /zip_download_failed/);
});

test('the sidebar Files menu goes through the helpers', () => {
  const item = side.slice(side.indexOf("{ id: 'download'"), side.indexOf("...(shareable"));
  assert.match(item, /downloadOneTracked\(/);
  assert.match(item, /downloadManyTracked\(/);
  assert.match(item, /zipName: 'files\.zip'/);
  assert.doesNotMatch(item, /downloadCardAssets?\(/);
  assert.doesNotMatch(side, /downloadCardAssets\b/);
});

test('a caller can name the tray key, defaulting to the card', () => {
  assert.match(ops, /key = `download:\$\{card\.id\}`/);
  assert.match(ops, /\n\s+key,\n/);
});

test('Quick look in the sidebar downloads through the tray', () => {
  assert.match(side, /onDownload=\{\(it\) => downloadOneTracked\(/);
  assert.doesNotMatch(side, /downloadCardAsset\(/);
});

test('the Files page detail panel downloads through the tray, version included', () => {
  const dp = read('../components/clusterBrowser/DetailPanel.jsx');
  assert.match(dp, /const doDownload = \(\) => downloadOneTracked\(/);
  assert.match(dp, /key: `download:\$\{card\.id\}:\$\{v\.id\}`/);
  assert.doesNotMatch(dp, /downloadCardAsset\(/);
  assert.doesNotMatch(dp, /\.catch\(\(\) => \{\}\)/);
});
