// The pure half of audioAnalysis.js. computePeaks is fed a getChannel closure
// rather than an AudioBuffer precisely so it can be tested here with fabricated
// sample data and no DOM.
//
// What these pin is the thing the old fake waveform got wrong: that the drawn
// shape must correspond to the actual audio. A test that only checked "96 bytes
// came back" would have passed against the hash-of-the-filename implementation.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computePeaks, peaksToBase64, peaksFromBase64, peaksToPath, peaksPathWidth,
  analyzable, PEAK_COUNT,
} from './audioAnalysis.js';
import { AUDIO_ANALYZE_MAX_BYTES, AUDIO_ANALYZE_MAX_SECONDS } from './fileIngest.js';

// One channel of `len` samples produced by fn(i).
const chan = (len, fn) => {
  const a = new Float32Array(len);
  for (let i = 0; i < len; i++) a[i] = fn(i);
  return a;
};
const mono = (data) => (i) => (i === 0 ? data : null);

test('base64 round-trips exactly', () => {
  const u8 = new Uint8Array([0, 1, 127, 128, 254, 255]);
  const back = peaksFromBase64(peaksToBase64(u8));
  assert.deepEqual(Array.from(back), Array.from(u8));
});

test('a malformed or empty peaks field decodes to null, never throws', () => {
  // A card render must not be able to crash on a corrupt field.
  assert.equal(peaksFromBase64(null), null);
  assert.equal(peaksFromBase64(''), null);
  assert.equal(peaksFromBase64(123), null);
  assert.equal(peaksToBase64(new Uint8Array(0)), null);
});

test('a full-scale sine fills every bucket', () => {
  const data = chan(48000, (i) => Math.sin(i * 0.05));
  const peaks = computePeaks(mono(data), data.length, 1, 96);
  assert.equal(peaks.length, 96);
  for (const p of peaks) assert.ok(p > 240, `every bucket of a full-scale sine should be near max, got ${p}`);
});

test('a single transient shows up in ITS bucket and nowhere else', () => {
  // This is the assertion the hash-based fake waveform could never pass.
  const len = 9600;
  const spikeAt = Math.floor(len * (12 / 96)) + 5; // inside bucket 12
  const data = chan(len, (i) => (i === spikeAt ? 1 : 0));
  const peaks = computePeaks(mono(data), len, 1, 96);
  assert.equal(peaks[12], 255, 'the bucket containing the transient should be full height');
  for (let b = 0; b < 96; b++) {
    if (b === 12) continue;
    assert.equal(peaks[b], 0, `bucket ${b} has no signal and must be flat`);
  }
});

test('a quiet file is normalized up, but silence is NOT', () => {
  const quiet = chan(9600, (i) => Math.sin(i * 0.05) * 0.05);
  const qp = computePeaks(mono(quiet), 9600, 1, 32);
  assert.ok(Math.max(...qp) > 240, 'a quiet loop should still draw at full height');

  // Below the silence floor, normalizing would turn dither into a confident
  // waveform — exactly the lie the fake peaks told.
  const silent = chan(9600, () => 0.001);
  const sp = computePeaks(mono(silent), 9600, 1, 32);
  assert.ok(Math.max(...sp) < 5, `near-silence must stay flat, got ${Math.max(...sp)}`);
});

test('multi-channel takes the max across channels', () => {
  const len = 3200;
  const left = chan(len, () => 0.1);
  const right = chan(len, () => 0.9);
  const both = computePeaks((i) => (i === 0 ? left : right), len, 2, 16);
  const leftOnly = computePeaks(mono(left), len, 1, 16);
  // Both normalize to their own max, so compare the RATIO instead: a stereo
  // file whose right channel is loud must not be drawn from the left alone.
  assert.equal(Math.max(...both), 255);
  assert.equal(Math.max(...leftOnly), 255);
  // A half-loud right channel against a silent left still reads as signal.
  const silent = chan(len, () => 0);
  const oneSided = computePeaks((i) => (i === 0 ? silent : right), len, 2, 16);
  assert.ok(Math.max(...oneSided) > 240);
});

test('bucket count is respected and degenerate input is safe', () => {
  for (const n of [1, 8, 96, 200]) {
    assert.equal(computePeaks(mono(chan(1000, () => 0.5)), 1000, 1, n).length, n);
  }
  assert.equal(computePeaks(mono(new Float32Array(0)), 0, 1, 16).length, 16);
  assert.equal(computePeaks(() => null, 100, 0, 16).length, 16);
  assert.equal(Math.max(...computePeaks(() => null, 100, 1, 16)), 0);
});

test('fewer samples than buckets does not produce NaN or out-of-range bytes', () => {
  const data = chan(5, () => 1);
  const peaks = computePeaks(mono(data), 5, 1, 96);
  for (const p of peaks) {
    assert.ok(Number.isInteger(p) && p >= 0 && p <= 255, `byte out of range: ${p}`);
  }
});

test('peaksToPath emits one subpath per bucket and real numbers', () => {
  const peaks = new Uint8Array([0, 128, 255]);
  const d = peaksToPath(peaks, { height: 40 });
  assert.equal((d.match(/M/g) || []).length, 3);
  assert.ok(!/NaN|Infinity|undefined/.test(d), `path must be numeric: ${d}`);
  assert.equal(peaksToPath(null), '');
  assert.equal(peaksToPath(new Uint8Array(0)), '');
});

test('peaksPathWidth matches the geometry peaksToPath draws', () => {
  // 3px bars, 1px gaps, no trailing gap.
  assert.equal(peaksPathWidth(1), 3);
  assert.equal(peaksPathWidth(2), 7);
  assert.equal(peaksPathWidth(96), 96 * 4 - 1);
});

test('analyzable refuses what would take mobile Safari out', () => {
  assert.equal(analyzable({ sizeBytes: 1024 }), true);
  assert.equal(analyzable({ sizeBytes: AUDIO_ANALYZE_MAX_BYTES }), true);
  assert.equal(analyzable({ sizeBytes: AUDIO_ANALYZE_MAX_BYTES + 1 }), false);
  // Halved on a low-memory device.
  assert.equal(analyzable({ sizeBytes: AUDIO_ANALYZE_MAX_BYTES - 1, lowMemory: true }), false);
  assert.equal(analyzable({ sizeBytes: 1024, durationSec: AUDIO_ANALYZE_MAX_SECONDS + 1 }), false);
  // An unknown duration must not be treated as over the cap.
  assert.equal(analyzable({ sizeBytes: 1024, durationSec: null }), true);
  assert.equal(analyzable({ sizeBytes: 1024, durationSec: NaN }), true);
  // A typical loop.
  assert.equal(analyzable({ sizeBytes: 900 * 1024, durationSec: 2 }), true);
});

test('PEAK_COUNT is the default and is not baked into stored values', () => {
  assert.equal(computePeaks(mono(chan(100, () => 1)), 100, 1).length, PEAK_COUNT);
  // A stored waveform of a DIFFERENT length must still decode — the renderer
  // draws whatever it gets, so changing PEAK_COUNT later cannot break old cards.
  const legacy = new Uint8Array(56).fill(100);
  assert.equal(peaksFromBase64(peaksToBase64(legacy)).length, 56);
});
