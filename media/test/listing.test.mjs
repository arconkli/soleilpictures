import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBsdtarListing } from '../src/listing.js';
import { sheetTiles } from '../../boards/src/lib/archiveSheet.js';

// Captured from `bsdtar -tvf` on a tar of a folder, a symlink and a name with spaces.
const SAMPLE = `drwxr-xr-x  0 andrewconklin wheel       0 Oct 27 08:57 ./
drwxr-xr-x  0 andrewconklin wheel       0 Oct 27 08:57 ./Shot Folder/
lrwxr-xr-x  0 andrewconklin wheel       0 Oct 27 08:57 ./link.txt -> readme.txt
-rw-r--r--  0 andrewconklin wheel       3 Jan  2  2020 ./readme.txt
-rw-r--r--  0 andrewconklin wheel       3 Oct 27 08:57 ./Shot Folder/my photo 1.jpg
bsdtar: Error exit delayed from previous errors.
`;

test('a bsdtar listing gives folders, files with sizes, symlinks without their targets, names with spaces', () => {
  assert.deepEqual(parseBsdtarListing(SAMPLE), [
    { path: './', dir: true, size: 0 },
    { path: './Shot Folder/', dir: true, size: 0 },
    { path: './link.txt', dir: false, size: 0 },
    { path: './readme.txt', dir: false, size: 3 },
    { path: './Shot Folder/my photo 1.jpg', dir: false, size: 3 },
  ]);
});

test('a listing feeds the sheet: the dot folder is cleaned away', () => {
  const tiles = sheetTiles(parseBsdtarListing(SAMPLE));
  assert.deepEqual(tiles.map((t) => [t.kind, t.name]), [['folder', 'Shot Folder'], ['file', 'link.txt'], ['file', 'readme.txt']]);
});

test('lines that are not entries are skipped', () => {
  assert.deepEqual(parseBsdtarListing(''), []);
  assert.deepEqual(parseBsdtarListing('garbage\n\n'), []);
});
