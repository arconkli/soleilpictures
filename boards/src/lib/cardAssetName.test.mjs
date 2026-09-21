// assetFilename is the highest-value test in this change.
//
// The bug it exists to prevent: an audio card keeps its filename in `title`,
// which is user-editable. Rename the card to "Kick 1" and every download path
// that derived its name from the title produced a file called "Kick 1" — no
// extension, unopenable by the OS and by every DAW. The fix is a fallback
// chain ending at the R2 key's own suffix, which is what lets cards that
// predate the fileName field still download correctly with NO migration.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assetFilename, assetSrcFor, DOWNLOADABLE, zipNameFor } from './cardAssetName.js';

test('the original upload name always wins', () => {
  const card = { fileName: 'Kick_128_Amin.wav', title: 'Kick 1', ext: 'wav', src: 'r2:ws/b/x.wav' };
  assert.equal(assetFilename(card, 'audio'), 'Kick_128_Amin.wav');
});

test('a renamed card still downloads with its extension', () => {
  // No fileName (a card from before that field existed), title edited by hand.
  const card = { title: 'Kick 1', ext: 'wav', src: 'r2:ws/b/abc.wav' };
  assert.equal(assetFilename(card, 'audio'), 'Kick 1.wav');
});

test('with no ext and no mime, the R2 key supplies the extension', () => {
  // This is the no-migration path: every existing audio card looks like this.
  const card = { title: 'Old Loop', src: 'r2:ws/board/9f2a1c.wav' };
  assert.equal(assetFilename(card, 'audio'), 'Old Loop.wav');
  const flac = { title: 'Stab', src: 'r2:ws/board/9f2a1c.flac' };
  assert.equal(assetFilename(flac, 'audio'), 'Stab.flac');
});

test('mime supplies the extension when ext and key cannot', () => {
  const card = { title: 'Voice memo', mime: 'audio/mpeg', src: 'r2:ws/b/nokeysuffix' };
  assert.equal(assetFilename(card, 'audio'), 'Voice memo.mp3');
  const aiff = { title: 'Pad', mime: 'audio/x-aiff', src: 'r2:ws/b/k' };
  assert.equal(assetFilename(aiff, 'audio'), 'Pad.aiff');
});

test('an extension already present is not doubled', () => {
  assert.equal(assetFilename({ title: 'Loop.wav', ext: 'wav', src: 'r2:k.wav' }, 'audio'), 'Loop.wav');
  assert.equal(assetFilename({ title: 'Loop.WAV', ext: 'wav', src: 'r2:k.wav' }, 'audio'), 'Loop.WAV');
});

test('a dotted name that is not an extension is left alone', () => {
  // "Take 2.1" must not become "Take 2.wav".
  const card = { title: 'Take 2.1', ext: 'wav', src: 'r2:k.wav' };
  assert.equal(assetFilename(card, 'audio'), 'Take 2.1.wav');
});

test('path separators and illegal characters cannot survive', () => {
  const card = { title: '../../etc/passwd', ext: 'wav', src: 'r2:k.wav' };
  const out = assetFilename(card, 'audio');
  assert.ok(!out.includes('/'), out);
  assert.ok(!out.includes('..'), out);
  assert.equal(assetFilename({ title: 'a:b*c?d"e<f>g|h', ext: 'wav', src: 'r2:k.wav' }, 'audio'),
    'a-b-c-d-e-f-g-h.wav');
});

test('an empty or missing name falls back rather than producing ""', () => {
  assert.equal(assetFilename({ src: 'r2:k.wav' }, 'audio'), 'download.wav');
  assert.equal(assetFilename({ title: '   ' , src: 'r2:k.wav' }, 'audio'), 'download.wav');
  assert.equal(assetFilename({}, 'audio'), 'download');
  assert.equal(assetFilename(null, 'audio'), 'download');
  assert.equal(assetFilename({ src: 'r2:k.wav' }, 'audio', { fallback: 'loop-3' }), 'loop-3.wav');
});

test('names are capped so a pasted essay cannot become a filename', () => {
  const card = { title: 'x'.repeat(500), ext: 'wav', src: 'r2:k.wav' };
  const out = assetFilename(card, 'audio');
  assert.ok(out.length <= 85, `got ${out.length}`);
  assert.ok(out.endsWith('.wav'));
});

test('pdf gets a .pdf even with nothing else to go on', () => {
  assert.equal(assetFilename({ name: 'Treatment', pdfSrc: 'r2:k' }, 'pdf'), 'Treatment.pdf');
});

test('file cards keep using their own fields', () => {
  const card = { fileName: 'stems.zip', mime: 'application/zip', ext: 'zip', fileSrc: 'r2:k.zip' };
  assert.equal(assetFilename(card, 'file'), 'stems.zip');
});

test('assetSrcFor reads the right field per kind', () => {
  assert.equal(assetSrcFor({ src: 'r2:a' }, 'audio'), 'r2:a');
  assert.equal(assetSrcFor({ src: 'r2:a' }, 'video'), 'r2:a');
  assert.equal(assetSrcFor({ fileSrc: 'r2:f' }, 'file'), 'r2:f');
  // A pdf card's `src` is its page-1 THUMBNAIL; pdfSrc is the document.
  assert.equal(assetSrcFor({ pdfSrc: 'r2:doc', src: 'r2:thumb' }, 'pdf'), 'r2:doc');
  assert.equal(assetSrcFor({}, 'audio'), null);
  assert.equal(assetSrcFor(null, 'audio'), null);
});

test('DOWNLOADABLE covers exactly the kinds with bytes', () => {
  for (const k of ['image', 'pdf', 'video', 'audio', 'file']) assert.ok(DOWNLOADABLE.has(k), k);
  for (const k of ['note', 'link', 'doc', 'palette', 'shape', 'grid', 'board']) {
    assert.ok(!DOWNLOADABLE.has(k), k);
  }
});

test('zipNameFor', () => {
  assert.equal(zipNameFor('Loop Pack'), 'Loop Pack.zip');
  assert.equal(zipNameFor('a/b:c'), 'a-b-c.zip');
  assert.equal(zipNameFor(''), 'download.zip');
  assert.equal(zipNameFor(null), 'download.zip');
});
