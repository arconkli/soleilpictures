// folderWalk.test.mjs — a dropped folder becomes a tree, the way Chrome hands
// it over: entries read in batches, junk and packages left out, limits kept.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  captureDropEntries, hasDirectory, walkEntries, treeFromRelativePaths, classifyEntryName, FOLDER_LIMITS,
} from './folderWalk.js';

// Fakes with Chrome's behaviour: readEntries hands back at most 100 entries a
// call, and the list only ends with an empty batch.
const fileEntry = (name) => ({ isFile: true, isDirectory: false, name, file: (ok) => ok({ name, size: 10, type: '' }) });
const dirEntry = (name, children) => ({
  isFile: false, isDirectory: true, name,
  createReader() {
    let i = 0;
    return { readEntries(ok) { const b = children.slice(i, i + 100); i += b.length; ok(b); } };
  },
});
const names = (node) => node.files.map((f) => f.name);

test('captureDropEntries takes the entries synchronously and skips what is not a file', () => {
  const a = fileEntry('a.jpg');
  const d = dirEntry('Shoot', []);
  const dt = { items: [
    { kind: 'file', webkitGetAsEntry: () => a },
    { kind: 'string', webkitGetAsEntry: () => null },
    { kind: 'file', webkitGetAsEntry: () => d },
    { kind: 'file' },   // a browser without the API
  ] };
  const got = captureDropEntries(dt);
  assert.deepEqual(got, [a, d]);
  assert.equal(hasDirectory(got), true);
  assert.equal(hasDirectory([a]), false);
  assert.deepEqual(captureDropEntries(null), []);
});

test('a folder becomes a tree, in natural order, read past the 100-entry batch', async () => {
  const many = Array.from({ length: 230 }, (_, i) => fileEntry(`frame_${i + 1}.jpg`));
  const drop = [dirEntry('Diner', [
    dirEntry('Day 10', [fileEntry('b.jpg')]),
    dirEntry('Day 2', [fileEntry('a.jpg')]),
    ...many,
  ])];
  const { root, files, clusters, truncated } = await walkEntries(drop);
  assert.equal(root.dirs.length, 1);
  const diner = root.dirs[0];
  assert.equal(diner.name, 'Diner');
  assert.equal(diner.files.length, 230, 'every batch is read, not just the first hundred');
  assert.equal(names(diner)[1], 'frame_2.jpg', 'natural order: frame_2 before frame_10');
  assert.deepEqual(diner.dirs.map((d) => d.name), ['Day 2', 'Day 10']);
  assert.equal(files, 232);
  assert.equal(clusters, 3);
  assert.equal(truncated, false);
});

test('junk, packages and iCloud placeholders are left out, and counted', async () => {
  const drop = [dirEntry('Refs', [
    fileEntry('.DS_Store'), fileEntry('Thumbs.db'), fileEntry('._a.jpg'), fileEntry('.b.jpg.icloud'),
    fileEntry('keep.jpg'),
    dirEntry('Score.logicx', [fileEntry('ProjectData')]),
    dirEntry('__MACOSX', [fileEntry('x')]),
    dirEntry('.git', [fileEntry('HEAD')]),
  ])];
  const { root, skipped } = await walkEntries(drop);
  assert.deepEqual(names(root.dirs[0]), ['keep.jpg']);
  assert.equal(root.dirs[0].dirs.length, 0);
  assert.deepEqual(skipped, { junk: 5, packages: 1, icloud: 1 });
  assert.equal(classifyEntryName('Photos Library.photoslibrary', true), 'package');
  assert.equal(classifyEntryName('Day 2', true), 'keep');
});

test('past the depth limit folders merge upward; past the file limit the import is partial', async () => {
  let deep = [fileEntry('bottom.jpg')];
  for (let i = 8; i >= 1; i--) deep = [dirEntry(`L${i}`, deep)];
  const limits = { ...FOLDER_LIMITS, maxDepth: 3 };
  const { root, flattened, clusters } = await walkEntries(deep, { limits });
  assert.equal(flattened, true);
  assert.equal(clusters, 3);
  const l3 = root.dirs[0].dirs[0].dirs[0];
  assert.equal(l3.name, 'L3');
  assert.deepEqual(names(l3), ['bottom.jpg'], 'the file is kept, in the deepest folder allowed');

  const big = [dirEntry('Big', Array.from({ length: 12 }, (_, i) => fileEntry(`${i}.jpg`)))];
  const part = await walkEntries(big, { limits: { ...FOLDER_LIMITS, maxFiles: 5 } });
  assert.equal(part.files, 5);
  assert.equal(part.truncated, true);
});

test('a picker folder (webkitRelativePath) gives the same tree', () => {
  const f = (p) => ({ name: p.split('/').pop(), webkitRelativePath: p });
  const { root, files, clusters, skipped } = treeFromRelativePaths([
    f('Shoot/Day 2/b.jpg'), f('Shoot/a.jpg'), f('Shoot/Day 10/c.jpg'),
    f('Shoot/.DS_Store'), f('Shoot/Mix.logicx/Alternatives/000/Project.data'),
  ]);
  assert.equal(root.dirs[0].name, 'Shoot');
  assert.deepEqual(names(root.dirs[0]), ['a.jpg']);
  assert.deepEqual(root.dirs[0].dirs.map((d) => d.name), ['Day 2', 'Day 10']);
  assert.equal(files, 3);
  assert.equal(clusters, 3);
  assert.deepEqual(skipped, { junk: 1, packages: 1, icloud: 0 });
});

test('a cancelled walk stops reading', async () => {
  const ctrl = new AbortController();
  ctrl.abort();
  const { files } = await walkEntries([dirEntry('X', [fileEntry('a.jpg')])], { signal: ctrl.signal });
  assert.equal(files, 0);
});
