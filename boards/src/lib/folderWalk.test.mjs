// folderWalk.test.mjs — a dropped folder becomes a tree, the way Chrome hands
// it over: entries read in batches, junk and packages left out, limits kept.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  captureDropEntries, captureDropHandles, entryOfHandle, hasDirectory, walkEntries, treeFromRelativePaths, classifyEntryName, FOLDER_LIMITS,
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

test('onProgress fires on every 250th file and once at the end', async () => {
  const kids = Array.from({ length: 600 }, (_, i) => fileEntry(`f${i}.jpg`));
  const seen = [];
  const r = await walkEntries([dirEntry('Big', kids)], { onProgress: (p) => seen.push(p), limits: { ...FOLDER_LIMITS, maxFiles: 1000 } });
  assert.equal(r.files, 600);
  assert.deepEqual(seen, [
    { files: 250, clusters: 1 }, { files: 500, clusters: 1 }, { files: 600, clusters: 1 },
  ]);

  const picked = Array.from({ length: 250 }, (_, i) => ({ name: `p${i}.jpg`, webkitRelativePath: `Pick/p${i}.jpg` }));
  const seen2 = [];
  treeFromRelativePaths(picked, { onProgress: (p) => seen2.push(p), limits: { ...FOLDER_LIMITS, maxFiles: 1000 } });
  assert.deepEqual(seen2, [{ files: 250, clusters: 1 }, { files: 250, clusters: 1 }]);
});

test('a file whose folder merged upward keeps its own path in origins', async () => {
  const limits = { ...FOLDER_LIMITS, maxDepth: 2 };
  const own = ['Card/DCIM/100CANON/IMG_0001.JPG', 'Card/DCIM/101CANON/IMG_0001.JPG'];
  const walk = await walkEntries([dirEntry('Card', [
    fileEntry('IMG_0001.JPG'),
    dirEntry('DCIM', [dirEntry('100CANON', [fileEntry('IMG_0001.JPG')]), dirEntry('101CANON', [fileEntry('IMG_0001.JPG')])]),
  ])], { limits });
  const dcim = walk.root.dirs[0].dirs[0];
  assert.equal(dcim.dirs.length, 0);
  assert.deepEqual(names(dcim), ['IMG_0001.JPG', 'IMG_0001.JPG']);
  assert.deepEqual(dcim.files.map((f) => walk.origins.get(f)).sort(), own);
  assert.equal(walk.origins.get(walk.root.dirs[0].files[0]), undefined, 'a file in its own folder needs no origin');

  const f = (p) => ({ name: p.split('/').pop(), webkitRelativePath: p });
  const picked = treeFromRelativePaths([f(own[0]), f(own[1]), f('Card/IMG_0001.JPG')], { limits });
  const dcim2 = picked.root.dirs[0].dirs[0];
  assert.deepEqual(dcim2.files.map((x) => picked.origins.get(x)).sort(), own);
  assert.equal(picked.origins.get(picked.root.dirs[0].files[0]), undefined);
  assert.equal(picked.clusters, 2);
});

// Chromium's FileSystemHandles: kind, name, getFile(), and an async iterator.
const fileHandle = (name) => ({ kind: 'file', name, getFile: async () => ({ name, size: 10, type: '' }) });
const dirHandle = (name, children) => ({
  kind: 'directory', name,
  values() { let i = 0; return { next: async () => (i < children.length ? { done: false, value: children[i++] } : { done: true }) }; },
});

test('captureDropHandles asks every file item for its handle during the drop, and none fails the drop', async () => {
  const h = dirHandle('Shoot', []);
  const dt = { items: [
    { kind: 'file', getAsFileSystemHandle: () => Promise.resolve(h) },
    { kind: 'string', getAsFileSystemHandle: () => Promise.resolve(null) },
    { kind: 'file', getAsFileSystemHandle: () => Promise.reject(new Error('gone')) },
    { kind: 'file' },   // not Chromium
  ] };
  const got = captureDropHandles(dt);
  assert.equal(got.length, 2);
  assert.deepEqual(await Promise.all(got), [h, null]);
  assert.deepEqual(captureDropHandles(null), []);
});

test('a stored handle walks like the drop it came from: past the 100-entry batch, junk left out', async () => {
  const many = Array.from({ length: 150 }, (_, i) => fileHandle(`frame_${i + 1}.jpg`));
  const top = dirHandle('Diner', [dirHandle('Day 2', [fileHandle('a.jpg')]), fileHandle('.DS_Store'), ...many]);
  const { root, files, clusters, skipped } = await walkEntries([entryOfHandle(top)], { limits: { ...FOLDER_LIMITS, maxFiles: 1000 } });
  assert.equal(root.dirs[0].name, 'Diner');
  assert.equal(root.dirs[0].files.length, 150);
  assert.deepEqual(root.dirs[0].dirs.map((d) => [d.name, names(d)]), [['Day 2', ['a.jpg']]]);
  assert.equal(files, 151);
  assert.equal(clusters, 2);
  assert.equal(skipped.junk, 1);
  assert.equal(entryOfHandle(null), null);
});
