// coverMosaic.test.mjs — what an empty board's cover is made of, and where
// each picture sits.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mosaicPicks, mosaicCells, docLabel, hasCoverContent, setCoverMosaics, coverMosaicsOn } from './coverMosaic.js';

const img = (id, extra = {}) => ({ id, kind: 'image', src: `r2:${id}`, unplaced: true, ...extra });

test('the first three finished pictures, in order; a video lends its poster', () => {
  const cards = [
    img('a', { pending: true, src: null }),
    { id: 'p', kind: 'pdf', unplaced: true, src: 'r2:p' },
    img('b'),
    { id: 'v', kind: 'video', unplaced: true, src: 'r2:v.mov', poster: 'r2:v.jpg' },
    img('c'),
    img('d'),
  ];
  assert.deepEqual(mosaicPicks(cards), { pics: [{ id: 'b', src: 'r2:b' }, { id: 'v', src: 'r2:v.jpg' }, { id: 'c', src: 'r2:c' }] });
});

test('anything on the board means the board is the cover; nothing at all is no cover', () => {
  assert.equal(mosaicPicks([img('a', { unplaced: false })]), null);
  assert.equal(mosaicPicks([]), null);
  assert.equal(mosaicPicks(null), null);
});

test('files with no picture become up to three labelled tiles', () => {
  const cards = [
    { id: '1', kind: 'pdf', unplaced: true },
    { id: '2', kind: 'file', unplaced: true, fileName: 'Budget v3.xlsx' },
    { id: '3', kind: 'file', unplaced: true, fileName: 'README' },
    { id: '4', kind: 'audio', unplaced: true, ext: 'wav' },
  ];
  assert.deepEqual(mosaicPicks(cards), { docs: ['PDF', 'XLSX', 'FILE'] });
  assert.equal(docLabel({ kind: 'audio' }), 'AUDIO');
  assert.equal(docLabel({ kind: 'file', fileName: 'cut.prproj' }), 'FILE', 'an extension too long to read is just a file');
});

test('cells: one fills the frame, two split two thirds to one, three stack on the right', () => {
  assert.deepEqual(mosaicCells(1, 1200, 675, 8), [[0, 0, 1200, 675]]);
  const [a, b] = mosaicCells(2, 1200, 675, 8);
  assert.deepEqual(a, [0, 0, 795, 675]);
  assert.deepEqual(b, [803, 0, 397, 675]);
  const three = mosaicCells(3, 1200, 675, 8);
  assert.equal(three.length, 3);
  assert.deepEqual(three[1], [803, 0, 397, 334]);
  assert.deepEqual(three[2], [803, 342, 397, 333]);
  for (const [x, y, w, h] of three) assert.ok(x + w <= 1200 && y + h <= 675, 'inside the frame');
});

test('hasCoverContent: the board itself always; files in Files only once mosaics are on', () => {
  const onBoard = [img('a', { unplaced: false })];
  const inFiles = [img('b')];
  assert.equal(coverMosaicsOn(), false, 'off until App turns it on');
  assert.equal(hasCoverContent(onBoard, []), true);
  assert.equal(hasCoverContent([], [{ points: [[0, 0]] }]), true, 'a drawing is content');
  assert.equal(hasCoverContent(inFiles, []), false);
  assert.equal(hasCoverContent(inFiles, [], { mosaic: true }), true);
  assert.equal(hasCoverContent([img('p', { pending: true, src: null })], [], { mosaic: true }), false, 'nothing finished yet');
  setCoverMosaics(true);
  try {
    assert.equal(hasCoverContent(inFiles, []), true);
    assert.equal(hasCoverContent([], []), false);
  } finally {
    setCoverMosaics(false);
  }
});
