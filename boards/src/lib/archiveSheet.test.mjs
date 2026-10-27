import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SHEET_TILES, LIST_ROWS, isJunk, cleanEntries, rootOf, levelOf, summaryOf, sheetTiles, listRows } from './archiveSheet.js';

const f = (path, size = 100) => ({ path, dir: false, size });
const scouts = () => [
  ...[1, 2, 3].map((i) => f(`Location scouts/Dock/d${i}.jpg`)),
  ...[1, 2].map((i) => f(`Location scouts/House/h${i}.jpg`)),
  ...[10, 2, 1, 3, 4, 5, 6, 7].map((i) => f(`Location scouts/IMG_${i}.jpg`)),
  f('Location scouts/notes.pdf'),
  f('__MACOSX/Location scouts/._x.jpg'),
  f('Location scouts/._x.jpg'),
  f('Location scouts/.DS_Store'),
];

test('a zip holding one folder shows inside it, folders first, then photos by numeric name, then files', () => {
  const e = scouts();
  assert.equal(rootOf(e), 'Location scouts/');
  const tiles = sheetTiles(e);
  assert.equal(tiles.length, 11);
  assert.equal(tiles.at(-1).name, 'notes.pdf');
  assert.deepEqual(tiles.slice(0, 2).map((t) => [t.kind, t.name, t.count]), [['folder', 'Dock', 3], ['folder', 'House', 2]]);
  assert.deepEqual(tiles.slice(2, 5).map((t) => t.name), ['IMG_1.jpg', 'IMG_2.jpg', 'IMG_3.jpg']);
  assert.ok(tiles.slice(2, 10).every((t) => t.kind === 'photo'));
  assert.ok(tiles.findIndex((t) => t.name === 'IMG_10.jpg') > tiles.findIndex((t) => t.name === 'IMG_2.jpg'));
  assert.ok(!tiles.some((t) => /DS_Store|\._|MACOSX/.test(t.path)));
});

test('the tiles are cut at 12', () => {
  const e = [f('A/x.txt'), ...Array.from({ length: 20 }, (_, i) => f(`p${i}.png`)), f('z.pdf')];
  const tiles = sheetTiles(e);
  assert.equal(tiles.length, SHEET_TILES);
  assert.equal(tiles[0].kind, 'folder');
});

test('the summary counts files, folders (the root too) and bytes, without junk', () => {
  assert.deepEqual(summaryOf(scouts()), { files: 14, folders: 3, bytes: 1400 });
});

test('junk is named', () => {
  for (const p of ['__MACOSX/a', 'x/.DS_Store', 'x/._a.jpg', 'Thumbs.db', 'a/desktop.ini']) assert.ok(isJunk(p), p);
  assert.ok(!isJunk('a/b.jpg'));
});

test('a long flat list shows 6 rows and how many more', () => {
  const e = Array.from({ length: 120 }, (_, i) => f(`file${i}.txt`, 5));
  const { rows, more } = listRows(e);
  assert.equal(rows.length, LIST_ROWS);
  assert.equal(more, 114);
});

test('paths are cleaned: a leading ./ and / go, ".." paths are dropped, prefix folders appear', () => {
  const out = cleanEntries([f('../evil.txt'), f('/abs.txt'), f('./a/b.txt'), f('x/../y.txt')]);
  assert.deepEqual(out.map((e) => e.path), ['abs.txt', 'a/', 'a/b.txt']);
  assert.equal(out[1].dir, true);
});

test('levelOf lists direct children only, with each folder\'s count', () => {
  const e = [f('a/b/c.txt'), f('a/d.txt'), f('e.txt')];
  const top = levelOf(e, '');
  assert.deepEqual(top.folders, [{ name: 'a', path: 'a/', count: 2 }]);
  assert.deepEqual(top.files.map((x) => x.name), ['e.txt']);
  assert.equal(rootOf(e), '');
});
