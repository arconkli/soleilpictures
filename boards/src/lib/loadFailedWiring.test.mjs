// A list that failed to load must not read as an empty one. Same rule as
// Messages (messageLoadFailed.test.mjs): the read reports the failure (null or
// a throw) instead of [], the surface keeps the last good data, and a screen
// with nothing to show says "Couldn’t load …" with a Retry. The empty words
// ("No results", "No files…", "Just you so far") are for a real empty answer.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

test('the shared pieces: one line, a Retry, role alert; a retry counter with an online bump', () => {
  const c = read('../components/LoadFailed.jsx');
  assert.match(c, /role="alert"/);
  assert.match(c, /Couldn’t load \{what\}/);
  assert.match(c, /ArrowClockwise/);
  assert.match(c, /Retry/);
  const h = read('../hooks/useRetry.js');
  assert.match(h, /return \[tick, retry\];/);
  assert.match(h, /addEventListener\('online'/);
  assert.doesNotMatch(read('../components/loadFailed.css'), /--soleil/);
});

test('sidebar files: a failed read is an error row with Retry, never the empty row', () => {
  const hook = read('../hooks/useSidebarFiles.js');
  assert.match(hook, /failed: entry\.status === 'error' && !items\.length/);
  assert.match(hook, /setRecentFailed\(!rows\)/);
  assert.match(hook, /setStarredFailed\(!rows\)/);
  assert.match(hook, /if \(!rows\) \{ setMoreFailed/);
  assert.doesNotMatch(hook, /catch \(_\) \{ rows = \[\]; \}/);
  assert.match(hook, /failed: rows == null/);
  const rows = read('./sidebarRows.js');
  assert.match(rows, /push\('error'/);
  const shelves = read('../components/sidebar/ClusterShelves.jsx');
  assert.match(shelves, /Couldn’t load your files/);
  assert.match(shelves, /Couldn’t load more · Retry/);
  assert.match(shelves, /onRetry\?\.\(row\.boardId\)/);
  const bar = read('../components/sidebar/ClusterSidebar.jsx');
  assert.match(bar, /Couldn’t load search results/);
  assert.match(bar, /Couldn’t load your files/);
  assert.match(bar, /onRetry=\{files\.ensure\}/);
});

test('search reads return null on error, and every caller tells that from no results', () => {
  const src = read('./entitySearch.js');
  assert.doesNotMatch(src, /warn\('entity search failed', error\); return \[\]/);
  assert.match(src, /warn\('entity search failed', error\); return null;/);
  assert.match(src, /warn\('doc page search failed', error\); return null;/);
  const palette = read('../components/CommandPalette.jsx');
  assert.match(palette, /const failed = rows == null \|\| pages == null;/);
  assert.match(palette, /!searchedRef\.current && !failed/);
  assert.match(palette, /what="search results"/);
  assert.match(palette, /showEmpty = !!q && !hasResults && !loading && !searchFailed/);
  assert.doesNotMatch(palette, /searchDocPages\([^\n]*\.catch\(\(\) => \[\]\)/);
  const picker = read('../components/EntityPicker.jsx');
  assert.match(picker, /setSearchFailed\(rows == null\)/);
  assert.match(picker, /what="search results"/);
  const list = read('../components/ListSurface.jsx');
  assert.match(list, /setDescFailed\(rows == null\)/);
  assert.match(list, /descFailed && <LoadFailed compact what="search results"/);
});

test('files dock: a snapshot that fails to read is marked failed, kept briefly, and offered a Retry', () => {
  const hook = read('../hooks/useBoardPreview.js');
  assert.match(hook, /docText: '', failed: true/);
  assert.match(hook, /const FAILED_TTL = 5000;/);
  const dock = read('../components/FilesDock.jsx');
  assert.match(dock, /failed: !cardsFor && !!preview\?\.failed/);
  assert.match(dock, /invalidateBoardPreview\(browseId\)/);
  const list = read('../components/ListSurface.jsx');
  const fails = list.match(/<LoadFailed what="this cluster’s files" onRetry=\{onRetry\} \/>/g) || [];
  assert.equal(fails.length, 2, 'both the fp-* and the list-* branch');
});

test('version history: neither list swallows its error into []', () => {
  const api = read('./boardsApi.js');
  const fn = api.slice(api.indexOf('export async function listBoardMetaHistory'));
  assert.match(fn.slice(0, fn.indexOf('\n}\n')), /return null;/);
  const modal = read('../components/VersionHistoryModal.jsx');
  assert.doesNotMatch(modal, /listBoardVersions\(boardId\)\.catch\(\(\) => \[\]\)/);
  assert.doesNotMatch(modal, /listBoardMetaHistory\(boardId\)\.catch\(\(\) => \[\]\)/);
  assert.match(modal, /setVersionsFailed\(v == null\)/);
  assert.match(modal, /setMetaFailed\(m == null\)/);
  const says = modal.match(/Couldn’t load version history/g) || [];
  assert.equal(says.length, 2, 'both tabs');
  assert.match(modal, /onClick=\{retryLoad\}/);
});

test('share list: a failed load is said, not "Just you so far"', () => {
  const src = read('../components/ShareModal.jsx');
  assert.match(src, /Couldn’t load who has access/);
  assert.match(src, /setSharesFailed\(true\)/);
  assert.match(src, /sharesTick\]\);/);
  assert.ok(src.indexOf('Couldn’t load who has access') < src.indexOf('Just you so far. Anyone'));
  assert.equal((src.match(/Who has access · /g) || []).length, 1);
});

test('home: assembleGraph throws on a read error and the map says so instead of the invitation', () => {
  const graph = read('./graphData.js');
  for (const e of ['boardsError', 'cardsError', 'blsError']) {
    assert.match(graph, new RegExp(`if \\(${e}\\) throw ${e};`));
  }
  const home = read('../components/HomeGraph.jsx');
  assert.match(home, /setLoadFailed\(true\)/);
  assert.match(home, /<HomeEmptyState failed onRetry=/);
  const empty = read('../components/HomeEmptyState.jsx');
  assert.match(empty, /Couldn’t load your workspace map/);
  assert.doesNotMatch(empty, /^import /m, 'nothing new in the lazy 3D chunk');
});
