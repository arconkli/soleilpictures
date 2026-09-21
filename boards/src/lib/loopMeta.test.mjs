// Built from real pack naming conventions (Splice, Cymatics, Loopmasters,
// Output, Ableton exports) plus the cases that must DECLINE.
//
// The declines are the point. A parser that guesses is worse than no parser,
// because a wrong BPM gets trusted and time-stretched to. Every ambiguous
// input here must come back null.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseBpm, parseKey, canonicalKey, formatKey, keyOrder, parseLoopMeta,
  formatDuration, formatLabel, audioMetaLine, extensionOf,
} from './loopMeta.js';

test('explicit BPM in the filename', () => {
  assert.equal(parseBpm('Cymatics - Orchid Kick 3 - 140 BPM.wav'), 140);
  assert.equal(parseBpm('loop_128bpm.wav'), 128);
  assert.equal(parseBpm('LOOP 90 Bpm.aiff'), 90);
  assert.equal(parseBpm('bpm174_dnb.wav'), 174);
  assert.equal(parseBpm('drums-bpm-100.wav'), 100);
});

test('a single standalone number in range', () => {
  assert.equal(parseBpm('SFL_120_Gmin_Loop_Piano.wav'), 120);
  assert.equal(parseBpm('Kick 174 Neuro.wav'), 174);
  assert.equal(parseBpm('808_Sub_140_Fmin.wav'), 140);
});

test('declines rather than guesses', () => {
  // Two candidates — which one is the tempo?
  assert.equal(parseBpm('Loop_120_140.wav'), null);
  // Nothing in range.
  assert.equal(parseBpm('Kick_08_12.wav'), null);
  assert.equal(parseBpm('Vocal Chop.wav'), null);
  assert.equal(parseBpm('Take 2.wav'), null);
  // No number at all.
  assert.equal(parseBpm('Ambience.wav'), null);
  assert.equal(parseBpm(''), null);
  assert.equal(parseBpm(null), null);
});

test('sample rates, bit depths and years are not tempos', () => {
  assert.equal(parseBpm('Pad_96k_stuff.wav'), null, '96kHz must not read as 96 BPM');
  assert.equal(parseBpm('Pad_96kHz.wav'), null);
  assert.equal(parseBpm('Master_24bit.wav'), null);
  assert.equal(parseBpm('Master_16bit_44100.wav'), null);
  assert.equal(parseBpm('render_48k.wav'), null);
  // A 4-digit year is not a candidate, so the real tempo beside it still wins.
  assert.equal(parseBpm('Serum_2024_128.wav'), 128);
});

test('musical key from the filename', () => {
  assert.equal(parseKey('SFL_120_Gmin_Loop_Piano.wav'), 'Gmin');
  assert.equal(parseKey('Chord_Amin_128.wav'), 'Amin');
  assert.equal(parseKey('Lead_F#m_140.wav'), 'F#min');
  assert.equal(parseKey('Pluck Bbmaj.wav'), 'Bbmaj');
  assert.equal(parseKey('Keys_C#min.wav'), 'C#min');
  assert.equal(parseKey('Bass_Am.wav'), 'Amin');
  assert.equal(parseKey('Stab_Ebm.wav'), 'Ebmin');
  // An accidental alone is a key without a stated mode — store the tonic, do
  // not invent "minor".
  assert.equal(parseKey('Riser_F#.wav'), 'F#');
  // Separator split the tonic from the mode.
  assert.equal(parseKey('Piano A min 120.wav'), 'Amin');
  assert.equal(parseKey('Piano D major.wav'), 'Dmaj');
});

test('a bare note letter is REFUSED', () => {
  // These are the false positives that would fill a Key column with noise.
  assert.equal(parseKey('Drum A.wav'), null);
  assert.equal(parseKey('Take C 03.wav'), null);
  assert.equal(parseKey('B Section.wav'), null);
  assert.equal(parseKey('i am here.wav'), null, '"am" is a word, not A minor');
  assert.equal(parseKey('Ambient Pad.wav'), null);
  assert.equal(parseKey('Bass Hit.wav'), null);
  assert.equal(parseKey('Guitar.wav'), null);
  assert.equal(parseKey('Master.wav'), null);
  assert.equal(parseKey('Dry Mix.wav'), null);
});

test('canonicalKey folds what a person types', () => {
  assert.equal(canonicalKey('am'), 'Amin');
  assert.equal(canonicalKey('A min'), 'Amin');
  assert.equal(canonicalKey('Amin'), 'Amin');
  assert.equal(canonicalKey('AMIN'), 'Amin');
  assert.equal(canonicalKey('f#m'), 'F#min');
  assert.equal(canonicalKey('Bb maj'), 'Bbmaj');
  assert.equal(canonicalKey('A♭ minor'), 'Abmin');
  // A typed bare tonic IS meaningful — unlike one found in a filename, the
  // user chose to type it.
  assert.equal(canonicalKey('C'), 'C');
  assert.equal(canonicalKey(''), null);
  assert.equal(canonicalKey('   '), null);
  assert.equal(canonicalKey('nonsense'), null);
});

test('formatKey uses real accidental glyphs', () => {
  assert.equal(formatKey('Amin'), 'A min');
  assert.equal(formatKey('F#min'), 'F♯ min');
  assert.equal(formatKey('Bbmaj'), 'B♭ maj');
  assert.equal(formatKey('C'), 'C');
  assert.equal(formatKey(null), '');
  assert.equal(formatKey('garbage'), '');
});

test('keys sort by the circle of fifths, not the alphabet', () => {
  const sorted = ['Cmin', 'Amin', 'Emin', 'Fmin', 'Dmin']
    .sort((a, b) => keyOrder(a) - keyOrder(b))
    .map(k => k);
  // C, G, D, A, E … is the axis; F sits at the far end. Alphabetical would
  // have given A, C, D, E, F — which puts nothing useful next to anything.
  assert.deepEqual(sorted, ['Cmin', 'Dmin', 'Amin', 'Emin', 'Fmin']);
  // Enharmonics land in the same place.
  assert.equal(keyOrder('C#min'), keyOrder('Dbmin'));
  // Same tonic: unknown mode, then major, then minor — stable and grouped.
  assert.ok(keyOrder('A') < keyOrder('Amaj'));
  assert.ok(keyOrder('Amaj') < keyOrder('Amin'));
  assert.equal(keyOrder(null), null);
  assert.equal(keyOrder('nope'), null);
});

test('parseLoopMeta only claims a source when it found something', () => {
  assert.deepEqual(parseLoopMeta('SFL_120_Gmin_Loop.wav'),
    { bpm: 120, musicalKey: 'Gmin', metaSource: 'name' });
  assert.deepEqual(parseLoopMeta('Cymatics - Kick - 140 BPM.wav'),
    { bpm: 140, musicalKey: null, metaSource: 'name' });
  assert.deepEqual(parseLoopMeta('Ambience.wav'),
    { bpm: null, musicalKey: null, metaSource: null });
});

test('formatDuration', () => {
  assert.equal(formatDuration(0), '0:00');
  assert.equal(formatDuration(2), '0:02');
  assert.equal(formatDuration(65.9), '1:05');
  assert.equal(formatDuration(600), '10:00');
  assert.equal(formatDuration(null), '');
  assert.equal(formatDuration(-1), '');
  assert.equal(formatDuration(NaN), '');
});

test('formatLabel falls back ext → mime → the R2 key', () => {
  assert.equal(formatLabel({ ext: 'wav' }), 'WAV');
  assert.equal(formatLabel({ mime: 'audio/mpeg' }), 'MP3');
  assert.equal(formatLabel({ mime: 'audio/x-aiff' }), 'AIFF');
  assert.equal(formatLabel({ mime: 'audio/flac' }), 'FLAC');
  // The whole reason this chain exists: cards uploaded before ext/fileName
  // existed still have to show a format.
  assert.equal(formatLabel({ src: 'r2:ws/board/abc123.wav' }), 'WAV');
  assert.equal(formatLabel({}), '');
});

test('extensionOf', () => {
  assert.equal(extensionOf('a/b/c.WAV'), 'wav');
  assert.equal(extensionOf('no-extension'), null);
  assert.equal(extensionOf(null), null);
});

test('audioMetaLine drops the parts it does not know', () => {
  assert.equal(
    audioMetaLine({ duration: 2, bpm: 128, musicalKey: 'A#min', format: 'WAV' }),
    '0:02 · 128 · A♯ min · WAV');
  assert.equal(audioMetaLine({ duration: 2, format: 'WAV' }), '0:02 · WAV');
  assert.equal(audioMetaLine({ bpm: 140 }), '140');
  assert.equal(audioMetaLine({}), '');
});
