import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sheetSvg, listSvg, esc } from '../src/sheet.js';

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

test('the listing says how many more', () => {
  const svg = listSvg([{ kind: 'folder', name: 'a' }, { kind: 'file', name: 'b.pdf', size: 12345 }], 114);
  assert.ok(svg.includes('and 114 more'));
  assert.ok(svg.includes('12.3 KB'));
  assert.ok(!listSvg([{ kind: 'file', name: 'b', size: 1 }], 0).includes(' more'));
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
