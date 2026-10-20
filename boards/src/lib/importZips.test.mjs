// importZips.test.mjs — which files are zips, Takeout parts joined into one
// tree, a ".zip" that isn't one handed back, and the inflate ceiling.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isZipFile, zipGroups, readZips } from './importZips.js';
import { treeFromZip, IMPORT_LIMITS, importLimitsFor, LOW_MEMORY_INFLATE_BYTES } from './importTree.js';
import { storedZip } from './zipFixture.mjs';

const names = (node) => node.files.map((f) => f.name);

test('a zip is known by its name or its type', () => {
  assert.equal(isZipFile({ name: 'Lookbook.ZIP', type: '' }), true);
  assert.equal(isZipFile({ name: 'export', type: 'application/x-zip-compressed' }), true);
  assert.equal(isZipFile({ name: 'a.jpg', type: 'image/jpeg' }), false);
  assert.equal(isZipFile({ name: 'a.tar.gz', type: 'application/gzip' }), false);
  assert.equal(isZipFile(null), false);
});

test('two Takeout parts become one "Google Drive" tree; their files open', async () => {
  const p1 = storedZip([
    { path: 'Takeout/Drive/Night/a.jpg', bytes: 'AAA' },
    { path: 'Takeout/Drive/Night/Stills/c.jpg', bytes: 'CCC' },
  ], 'takeout-20261019T091522Z-001.zip');
  const p2 = storedZip([
    { path: 'Takeout/Drive/Night/b.jpg', bytes: 'BBB' },
    { path: 'Takeout/Drive/Day/d.jpg', bytes: 'DDD' },
  ], 'takeout-20261019T091522Z-002.zip');
  assert.deepEqual(zipGroups([p1, p2]), [[0, 1]]);
  const seen = [];
  const out = await readZips([p1, p2], { onProgress: (p) => seen.push(p) });
  assert.equal(out.trees.length, 1);
  assert.equal(out.notZips.length, 0);
  const top = out.trees[0].root.dirs[0];
  assert.equal(top.name, 'Google Drive');
  assert.deepEqual(top.dirs.map((d) => d.name), ['Day', 'Night']);
  const night = top.dirs[1];
  assert.deepEqual(names(night), ['a.jpg', 'b.jpg']);
  assert.deepEqual(night.dirs.map((d) => d.name), ['Stills']);
  assert.equal(night.files[0].relPath, 'Google Drive/Night/a.jpg');
  const file = await night.files[1].open();
  assert.equal(await file.text(), 'BBB', 'the second part\'s file reads from the second zip');
  assert.equal(file.name, 'b.jpg');
  // While reading, a folder is counted once a file is seen in it (the tree's
  // exact cluster count follows once it is built).
  assert.deepEqual(seen.at(-1), { files: 4, folders: 3, bytes: 12 });
});

test('unrelated zips stay apart, and a ".zip" that isn\'t one comes back to be added as a file', async () => {
  const look = storedZip([{ path: 'a.jpg', bytes: 'a' }, { path: 'b.jpg', bytes: 'b' }], 'Lookbook.zip');
  const refs = storedZip([{ path: 'Refs/x.jpg', bytes: 'x' }], 'Refs.zip');
  const fake = new File(['not a zip at all, just words'], 'Notes.zip', { type: 'application/zip' });
  const out = await readZips([look, fake, refs]);
  assert.deepEqual(out.notZips.map((f) => f.name), ['Notes.zip']);
  assert.equal(out.zips, 2);
  assert.deepEqual(out.trees.map((t) => t.root.dirs[0].name), ['Lookbook', 'Refs']);
  assert.deepEqual(names(out.trees[0].root.dirs[0]), ['a.jpg', 'b.jpg']);
});

test('a compressed file over the inflate ceiling fails with a reason; a stored one never does', async () => {
  const merged = {
    rootName: 'Shoot', dirs: [], dropped: {},
    files: [
      { relPath: 'big.mov', size: 100, lastModified: 1, zip: 0, entry: { method: 8 } },
      { relPath: 'flat.mov', size: 100, lastModified: 1, zip: 0, entry: { method: 0 } },
    ],
  };
  const opened = [];
  const { root } = treeFromZip(merged, [{}], {
    limits: { ...IMPORT_LIMITS, maxInflateBytes: 10 },
    open: async (blob, entry) => { opened.push(entry.method); return new Blob(['x']); },
  });
  const [big, flat] = root.dirs[0].files;
  await assert.rejects(big.open(), /Too large to unpack here/);
  assert.equal((await flat.open()).name, 'flat.mov');
  assert.deepEqual(opened, [0], 'the big one is never inflated');
  assert.ok(IMPORT_LIMITS.maxInflateBytes >= 1024 ** 3);
});

test('a phone unpacks far less: a compressed file over 256 MiB fails there and opens elsewhere', async () => {
  assert.equal(importLimitsFor(), IMPORT_LIMITS);
  const low = importLimitsFor({ lowMemory: true });
  assert.equal(LOW_MEMORY_INFLATE_BYTES, 256 * 1024 ** 2);
  assert.equal(low.maxInflateBytes, LOW_MEMORY_INFLATE_BYTES);
  assert.deepEqual({ ...low, maxInflateBytes: 0 }, { ...IMPORT_LIMITS, maxInflateBytes: 0 }, 'nothing else changes');
  const merged = {
    rootName: 'Takeout', dirs: [], dropped: {},
    files: [
      { relPath: 'clip.mov', size: 300 * 1024 ** 2, lastModified: 1, zip: 0, entry: { method: 8 } },
      { relPath: 'flat.mov', size: 300 * 1024 ** 2, lastModified: 1, zip: 0, entry: { method: 0 } },
    ],
  };
  const open = async () => new Blob(['x']);
  const phone = treeFromZip(merged, [{}], { limits: low, open }).root.dirs[0].files;
  const desk = treeFromZip(merged, [{}], { open }).root.dirs[0].files;
  await assert.rejects(phone[0].open(), /Too large to unpack here/);
  assert.equal((await phone[1].open()).name, 'flat.mov', 'a stored file is a slice, on a phone too');
  assert.equal((await desk[0].open()).name, 'clip.mov');
  // What the job reads to let one big inflated file up at a time.
  assert.deepEqual(phone.map((f) => f.inflates), [true, false]);
});
