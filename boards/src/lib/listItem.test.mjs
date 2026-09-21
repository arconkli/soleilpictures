// listItem.js is the ONE shape both list modes render from (table and
// gallery), and its sort/filter/search are pure — so the loop-browser columns
// are testable without a DOM. It had no test file before this.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toListItem, sortItems, filterItems, matchItems, typeBucket, TYPE_LABELS } from './listItem.js';

const audio = (over = {}) => toListItem({
  id: over.id || 'a1', kind: 'audio', title: 'Kick', duration: 2, bpm: 128,
  musicalKey: 'Amin', ext: 'wav', sizeBytes: 900 * 1024, src: 'r2:k.wav', ...over,
});

test('an audio card carries everything the loop columns need', () => {
  const it = audio();
  assert.equal(it.kind, 'audio');
  assert.equal(it.typeLabel, 'Audio');
  assert.equal(it.typeBucket, 'audio');
  assert.equal(it.durationSec, 2);
  assert.equal(it.bpm, 128);
  assert.equal(it.musicalKey, 'Amin');
  assert.equal(it.format, 'WAV');
  assert.equal(it.sizeBytes, 900 * 1024);
});

test('the sub line assembles what is known and drops what is not', () => {
  assert.equal(audio().sub, '0:02 · 128 · A min · WAV');
  assert.equal(audio({ bpm: null, musicalKey: null }).sub, '0:02 · WAV');
  assert.equal(audio({ duration: null, bpm: null, musicalKey: null, ext: null, src: 'r2:k' }).sub, '');
});

test('format falls back to the R2 key for cards with no ext or mime', () => {
  // Every audio card uploaded before the ext/fileName fields existed.
  assert.equal(audio({ ext: null, mime: null, src: 'r2:ws/b/9f2a.flac' }).format, 'FLAC');
});

test('size prefers the card field, falls back to the images table', () => {
  assert.equal(audio({ sizeBytes: 123 }).sizeBytes, 123);
  const legacy = toListItem(
    { id: 'x', kind: 'audio', title: 'Old', src: 'r2:key.wav' },
    { getMeta: (k) => (k === 'key.wav' ? { sizeBytes: 4242 } : null) });
  assert.equal(legacy.sizeBytes, 4242);
});

test('sorting by tempo, duration and format, blanks always last', () => {
  const items = [audio({ id: 'b', bpm: 140 }), audio({ id: 'a', bpm: 90 }), audio({ id: 'n', bpm: null })];
  assert.deepEqual(sortItems(items, 'bpm', 'asc').map(i => i.id), ['a', 'b', 'n']);
  // Blanks stay last in BOTH directions — that is the missLast contract.
  assert.deepEqual(sortItems(items, 'bpm', 'desc').map(i => i.id), ['b', 'a', 'n']);

  const durs = [audio({ id: 'l', duration: 8 }), audio({ id: 's', duration: 1 })];
  assert.deepEqual(sortItems(durs, 'duration', 'asc').map(i => i.id), ['s', 'l']);

  const fmts = [audio({ id: 'w', ext: 'wav' }), audio({ id: 'm', ext: 'aiff' })];
  assert.deepEqual(sortItems(fmts, 'format', 'asc').map(i => i.id), ['m', 'w']);
});

test('sorting by key follows the circle of fifths', () => {
  const ks = ['Fmin', 'Emin', 'Cmin', 'Amin', 'Dmin']
    .map((k, i) => audio({ id: k, musicalKey: k }));
  // C, D, A, E … F — harmonically adjacent, not A, C, D, E, F.
  assert.deepEqual(sortItems(ks, 'key', 'asc').map(i => i.id),
    ['Cmin', 'Dmin', 'Amin', 'Emin', 'Fmin']);
  const withBlank = [...ks, audio({ id: 'none', musicalKey: null })];
  assert.equal(sortItems(withBlank, 'key', 'asc').at(-1).id, 'none');
  assert.equal(sortItems(withBlank, 'key', 'desc').at(-1).id, 'none');
});

test('search reaches tempo, key and format through the sub line', () => {
  const items = [audio({ id: 'a' }), audio({ id: 'b', bpm: 90, musicalKey: 'Gmaj', ext: 'aiff' })];
  assert.deepEqual(matchItems(items, '128').map(i => i.id), ['a']);
  assert.deepEqual(matchItems(items, 'a min').map(i => i.id), ['a']);
  assert.deepEqual(matchItems(items, 'aiff').map(i => i.id), ['b']);
  assert.equal(matchItems(items, '').length, 2);
  assert.equal(matchItems(items, 'nothing').length, 0);
});

test('the audio type filter still works', () => {
  const mixed = [audio(), toListItem({ id: 'n', kind: 'note', html: '<p>hi</p>' })];
  assert.deepEqual(filterItems(mixed, ['audio']).map(i => i.id), ['a1']);
  assert.equal(filterItems(mixed, []).length, 2);
});

test('non-audio kinds gain no audio fields', () => {
  const note = toListItem({ id: 'n', kind: 'note', html: '<p>hello</p>' });
  assert.equal(note.bpm, undefined);
  assert.equal(note.durationSec, undefined);
  assert.equal(note.format, undefined);
  assert.equal(typeBucket('note'), 'note');
  assert.equal(TYPE_LABELS.audio, 'Audio');
});

test('a degenerate card does not throw', () => {
  assert.equal(toListItem(null), null);
  assert.equal(toListItem({}), null);
  const bare = toListItem({ id: 'z', kind: 'audio' });
  assert.equal(bare.name, 'Audio');
  assert.equal(bare.bpm, null);
  assert.equal(bare.sub, '');
});
