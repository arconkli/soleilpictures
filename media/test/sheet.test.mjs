import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sheetSvg, listSvg, esc, fitText } from '../src/sheet.js';

const THUMB = 'data:image/png;base64,iVBORw0KGgo=';
const tiles = [
  { kind: 'folder', name: 'Dock', path: 'Dock/', count: 3 },
  { kind: 'photo', name: 'IMG_1.jpg', path: 'IMG_1.jpg', ext: 'jpg', size: 10 },
  { kind: 'file', name: 'Q&A <draft>.txt', path: 'Q&A <draft>.txt', ext: 'txt', size: 5 },
];

test('the sheet has a rect per tile, escapes names, has no link or script, and embeds the thumbnail', () => {
  const svg = sheetSvg(tiles, new Map([['IMG_1.jpg', THUMB]]));
  assert.equal((svg.match(/<rect/g) || []).length, 3);
  assert.ok(svg.includes('Q&amp;A &lt;draft&gt;.txt'));
  assert.ok(!svg.includes('Q&A <draft>'));
  assert.ok(!/http(?!:\/\/www\.w3\.org)/.test(svg), 'only the SVG namespace');
  assert.ok(!svg.includes('<script'));
  assert.ok(svg.includes(THUMB));
  assert.ok(svg.includes('width="1440"') && svg.includes('height="880"'));
});

test('the sheet names a folder and a file inside their tiles, counts what a folder holds, and leaves a photo to its picture', () => {
  const svg = sheetSvg(tiles, new Map([['IMG_1.jpg', THUMB]]));
  assert.ok(svg.includes('>Dock</text>'));
  assert.ok(svg.includes('>3 items</text>'));
  assert.ok(!svg.includes('>IMG_1.jpg</text>'), 'a photo with its picture has no caption');
  assert.ok(sheetSvg([{ kind: 'folder', name: 'One', path: 'One/', count: 1 }]).includes('>1 item</text>'));
  // A photo that wouldn't thumbnail comes as a file's tile, named.
  assert.ok(sheetSvg([{ ...tiles[1], kind: 'file' }]).includes('>IMG_1.jpg</text>'));
  // Three rows of tiles stop above the card's name strip.
  const twelve = Array.from({ length: 12 }, (_, i) => ({ kind: 'file', name: `f${i}.txt`, path: `f${i}.txt`, ext: 'txt' }));
  const ys = [...sheetSvg(twelve).matchAll(/<rect x="\d+" y="(\d+)" width="\d+" height="(\d+)"/g)].map((m) => Number(m[1]) + Number(m[2]));
  assert.equal(ys.length, 12);
  assert.ok(Math.max(...ys) <= 740, `tiles end at ${Math.max(...ys)}`);
});

test('a name too long for its tile is cut with an ellipsis, wide letters sooner', () => {
  assert.equal(fitText('Dock', 9), 'Dock');
  const cut = fitText('Location scouting day four selects.jpg', 9.4);
  assert.ok(cut.endsWith('…') && cut.length < 20, cut);
  const wide = fitText('東京ロケハン写真フォルダ二〇二六年', 9.4);
  assert.ok(wide.endsWith('…') && [...wide].length <= 9, wide);
});

test('the listing gives a folder its count and a file its size, as the app writes them, under rules', () => {
  const svg = listSvg([{ kind: 'folder', name: 'a', count: 40 }, { kind: 'file', name: 'b.pdf', size: 12345 }]);
  assert.ok(svg.includes('>40 items</text>'));
  assert.ok(svg.includes('>12 KB</text>'));
  assert.ok(listSvg([{ kind: 'file', name: 'c.txt', size: 3008 }]).includes('>2.9 KB</text>'));
  assert.equal((svg.match(/stroke="#ececef"/g) || []).length, 2);
  assert.ok(!svg.includes(' more'));
});

test('esc drops control characters', () => {
  assert.equal(esc('a\u0000b\u001Fc&"\''), 'abc&amp;&quot;&apos;');
});

test('the sheet renders to 1440x880 with vips', (t) => {
  if (spawnSync('vips', ['--version']).error) return t.skip('vips is not on PATH');
  const dir = mkdtempSync(join(tmpdir(), 'sheet-'));
  try {
    writeFileSync(join(dir, 'in.svg'), sheetSvg(tiles));
    execFileSync('vips', ['copy', join(dir, 'in.svg'), join(dir, 'out.png')]);
    const png = readFileSync(join(dir, 'out.png'));
    assert.equal(png.readUInt32BE(16), 1440);
    assert.equal(png.readUInt32BE(20), 880);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
