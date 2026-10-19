// importTree.test.mjs — one tree shape for a dropped folder and a zip alike.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IMPORT_LIMITS, mimeFromName, treeFromWalk, treeFromZip, combineTrees } from './importTree.js';

const F = (name, o = {}) => ({ name, size: 10, type: '', lastModified: 5, ...o });
const names = (n) => n.files.map((f) => f.name);

test('mimeFromName: known extensions, any case, and unknown', () => {
  assert.equal(mimeFromName('a.JPG'), 'image/jpeg');
  assert.equal(mimeFromName('a.jpeg'), 'image/jpeg');
  assert.equal(mimeFromName('clip.MOV'), 'video/quicktime');
  assert.equal(mimeFromName('a.mp3'), 'audio/mpeg');
  assert.equal(mimeFromName('a.m4a'), 'audio/mp4');
  assert.equal(mimeFromName('a.pdf'), 'application/pdf');
  assert.equal(mimeFromName('a.zip'), 'application/zip');
  assert.equal(mimeFromName('a.xyz'), '');
  assert.equal(mimeFromName('noext'), '');
  assert.equal(mimeFromName(''), '');
  for (const e of ['heic', 'heif', 'avif', 'svg', 'tif', 'tiff', 'bmp', 'png', 'gif', 'webp', 'm4v', 'webm', 'avi', 'mkv',
    'wav', 'aac', 'flac', 'ogg', 'aif', 'aiff', 'txt', 'md', 'csv', 'json', 'rtf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx']) {
    assert.notEqual(mimeFromName(`x.${e}`), '', e);
  }
});

test('treeFromWalk converts a walk: relPaths, open() gives the same File, type falls back', async () => {
  const a = F('a.jpg', { type: 'image/jpeg' });
  const b = F('b.mov');
  const loose = F('loose.txt');
  const walk = {
    root: { name: null, files: [loose], dirs: [
      { name: 'Shoot', files: [a], dirs: [{ name: 'Day 2', files: [b], dirs: [] }] },
    ] },
    files: 3, clusters: 2, truncated: true, flattened: false, skipped: { junk: 1, packages: 2, icloud: 3 },
  };
  const { root, stats } = treeFromWalk(walk);
  assert.equal(root.name, null);
  assert.equal(root.relPath, '');
  assert.equal(root.files[0].relPath, 'loose.txt');
  const shoot = root.dirs[0];
  assert.equal(shoot.relPath, 'Shoot');
  assert.equal(shoot.files[0].relPath, 'Shoot/a.jpg');
  assert.equal(shoot.dirs[0].relPath, 'Shoot/Day 2');
  assert.equal(shoot.dirs[0].files[0].relPath, 'Shoot/Day 2/b.mov');
  assert.equal(shoot.files[0].type, 'image/jpeg');
  assert.equal(shoot.dirs[0].files[0].type, 'video/quicktime');
  assert.equal(await shoot.files[0].open(), a);
  assert.deepEqual(stats, { files: 3, clusters: 2, truncated: true, flattened: false, skipped: { junk: 1, packages: 2, icloud: 3 } });
});

const merged = (files, dirs = [], extra = {}) => ({
  rootName: 'Export',
  files: files.map((p, i) => ({ relPath: p, size: i + 1, lastModified: 1000 + i, zip: 0, entry: { path: p } })),
  dirs,
  dropped: { macosx: 0, sidecars: 0, junk: 0, duplicates: 0 },
  ...extra,
});

test('treeFromZip nests under one top folder, keeps empty folders, sorts naturally', () => {
  const m = merged(['b10.jpg', 'b2.jpg', 'Sub/x.png', 'Sub/Deep/y.png'], ['Sub', 'Sub/Deep', 'Empty', 'Sub/Deep/Nothing']);
  const { root, stats } = treeFromZip(m, [{}]);
  assert.equal(root.name, null);
  assert.equal(root.files.length, 0);
  assert.equal(root.dirs.length, 1);
  const top = root.dirs[0];
  assert.equal(top.name, 'Export');
  assert.equal(top.relPath, 'Export');
  assert.deepEqual(names(top), ['b2.jpg', 'b10.jpg']);
  assert.deepEqual(top.dirs.map((d) => d.name), ['Empty', 'Sub']);
  const sub = top.dirs[1];
  assert.equal(sub.relPath, 'Export/Sub');
  assert.equal(sub.files[0].relPath, 'Export/Sub/x.png');
  assert.equal(sub.dirs[0].relPath, 'Export/Sub/Deep');
  assert.equal(sub.dirs[0].dirs[0].relPath, 'Export/Sub/Deep/Nothing');
  assert.equal(stats.files, 4);
  assert.equal(stats.clusters, 5);
  assert.equal(stats.truncated, false);
  assert.equal(stats.flattened, false);
  assert.deepEqual(stats.dropped, m.dropped);
});

test('treeFromZip skips packages, hidden folders, junk files and iCloud placeholders, counted', () => {
  const m = merged([
    'keep.jpg', 'Song.logicx/Alternatives/a.wav', 'Song.logicx/b.wav', '.hidden/c.jpg', '._x', '.foo.jpg.icloud', 'Ok/d.jpg',
  ], ['Song.logicx', 'Song.logicx/Alternatives', '.hidden']);
  const { root, stats } = treeFromZip(m, [{}]);
  const top = root.dirs[0];
  assert.deepEqual(names(top), ['keep.jpg']);
  assert.deepEqual(top.dirs.map((d) => d.name), ['Ok']);
  assert.deepEqual(stats.skipped, { junk: 2, packages: 1, icloud: 1 });
  assert.equal(stats.files, 2);
});

test('treeFromZip { maxDepth: 2 } merges deeper folders upward and says flattened', () => {
  const m = merged(['A/a.jpg', 'A/B/b.jpg', 'A/B/C/c.jpg'], ['A', 'A/B', 'A/B/C']);
  const { root, stats } = treeFromZip(m, [{}], { limits: { ...IMPORT_LIMITS, maxDepth: 2 } });
  const a = root.dirs[0].dirs[0];
  assert.equal(a.name, 'A');
  assert.equal(a.dirs.length, 0);
  assert.deepEqual(names(a), ['a.jpg', 'b.jpg', 'c.jpg']);
  assert.equal(stats.flattened, true);
  assert.equal(stats.clusters, 2);
});

test('treeFromZip { maxClusters: 2 } merges further folders into their parent', () => {
  const m = merged(['A/a.jpg', 'B/b.jpg'], ['A', 'B']);
  const { root, stats } = treeFromZip(m, [{}], { limits: { ...IMPORT_LIMITS, maxClusters: 2 } });
  const top = root.dirs[0];
  assert.deepEqual(top.dirs.map((d) => d.name), ['A']);
  assert.deepEqual(names(top), ['b.jpg']);
  assert.equal(stats.clusters, 2);
  assert.equal(stats.flattened, true);
});

test('treeFromZip { maxFiles: 3 } drops the rest and says truncated', () => {
  const m = merged(['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg', 'e.jpg']);
  const { root, stats } = treeFromZip(m, [{}], { limits: { ...IMPORT_LIMITS, maxFiles: 3 } });
  assert.equal(root.dirs[0].files.length, 3);
  assert.equal(stats.files, 3);
  assert.equal(stats.truncated, true);
});

test('treeFromZip open() builds a File from the injected opener', async () => {
  const calls = [];
  const zips = [{ id: 'blob0' }, { id: 'blob1' }];
  const m = merged(['Sub/clip.MOV']);
  m.files[0].zip = 1;
  const open = async (blob, entry) => { calls.push([blob, entry]); return new Blob(['hello']); };
  const { root } = treeFromZip(m, zips, { open });
  const d = root.dirs[0].dirs[0].files[0];
  assert.equal(d.type, 'video/quicktime');
  assert.equal(d.size, 1);
  assert.equal(d.lastModified, 1000);
  const f = await d.open();
  assert.equal(f.name, 'clip.MOV');
  assert.equal(f.type, 'video/quicktime');
  assert.equal(f.lastModified, 1000);
  assert.equal(f.size, 5);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], zips[1]);
  assert.equal(calls[0][1], m.files[0].entry);
});

test('a merged folder keeps each file on its own relPath, so none collide', () => {
  const x = F('IMG_0001.JPG');
  const y = F('IMG_0001.JPG');
  const walk = {
    root: { name: null, files: [], dirs: [{ name: 'Card', files: [x, y], dirs: [] }] },
    origins: new Map([[x, 'Card/100CANON/IMG_0001.JPG'], [y, 'Card/101CANON/IMG_0001.JPG']]),
    files: 2, clusters: 1, truncated: false, flattened: true, skipped: { junk: 0, packages: 0, icloud: 0 },
  };
  assert.deepEqual(treeFromWalk(walk).root.dirs[0].files.map((f) => f.relPath),
    ['Card/100CANON/IMG_0001.JPG', 'Card/101CANON/IMG_0001.JPG']);

  const m = merged(['DCIM/100CANON/IMG_0001.JPG', 'DCIM/101CANON/IMG_0001.JPG', 'DCIM/a.jpg']);
  const dcim = treeFromZip(m, [{}], { limits: { ...IMPORT_LIMITS, maxDepth: 2 } }).root.dirs[0].dirs[0];
  assert.equal(dcim.dirs.length, 0);
  assert.deepEqual(dcim.files.map((f) => f.relPath),
    ['Export/DCIM/a.jpg', 'Export/DCIM/100CANON/IMG_0001.JPG', 'Export/DCIM/101CANON/IMG_0001.JPG']);
});

test('combineTrees: one root; a taken top name gets " (2)" and everything in it moves', () => {
  const a = treeFromZip(merged(['Day 1/a.jpg']), [{}]);
  const b = treeFromZip(merged(['Sub/b.jpg']), [{}]);
  const loose = {
    root: { name: null, relPath: '', files: [{ name: 'x.txt', relPath: 'x.txt' }], dirs: [] },
    stats: { files: 1, clusters: 0, truncated: true, skipped: { junk: 2, packages: 0, icloud: 0 } },
  };
  const { root, stats } = combineTrees([a, b, loose]);
  assert.deepEqual(root.dirs.map((d) => d.name), ['Export', 'Export (2)']);
  assert.equal(root.dirs[0].dirs[0].files[0].relPath, 'Export/Day 1/a.jpg', 'the first keeps its paths');
  const two = root.dirs[1];
  assert.equal(two.relPath, 'Export (2)');
  assert.equal(two.dirs[0].name, 'Sub');
  assert.equal(two.dirs[0].relPath, 'Export (2)/Sub');
  assert.equal(two.dirs[0].files[0].relPath, 'Export (2)/Sub/b.jpg');
  assert.equal(typeof two.dirs[0].files[0].open, 'function');
  assert.equal(b.root.dirs[0].relPath, 'Export', 'the input is not changed');
  assert.deepEqual(root.files.map((f) => f.relPath), ['x.txt']);
  assert.equal(stats.files, 3);
  assert.equal(stats.clusters, 4);
  assert.equal(stats.truncated, true);
  assert.equal(stats.skipped.junk, 2);
  assert.deepEqual(stats.dropped, { macosx: 0, sidecars: 0, junk: 0, duplicates: 0 });

  const t = (name) => ({ root: { name: null, relPath: '', files: [], dirs: [{ name, relPath: name, files: [], dirs: [] }] } });
  assert.deepEqual(combineTrees([t('P'), t('P'), t('P (2)')]).root.dirs.map((d) => d.name), ['P', 'P (2)', 'P (2) (2)']);
  assert.deepEqual(combineTrees([]).root.dirs, []);
});
