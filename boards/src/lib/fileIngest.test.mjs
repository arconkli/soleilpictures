// classifyDropFile is the single routing table for BOTH ingest surfaces (the
// canvas drop pipeline and the list-view one), so a divergence here is a
// divergence between two user-visible behaviours that are supposed to be the
// same gesture. It is pure and synchronous, which makes it cheap to pin.
//
// The case that motivated this file: Safari reports an EMPTY File.type for
// .flac and some .aiff, so those fell past the `audio/` prefix test into the
// generic file route — which is paid-gated for a free owner. A producer
// dropping a sample pack got a silent partial refusal with no stated reason.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyDropFile, sizeBucket, fitImageDims,
  FREE_VIDEO_CAP, FREE_AUDIO_CAP, FREE_PDF_CAP, FALLBACK_DIMS,
} from './fileIngest.js';

// Minimal File stand-in — classifyDropFile only reads .type/.name/.size.
const f = (name, type, size = 1024) => ({ name, type, size });

test('audio mime types route to the audio card', () => {
  for (const type of ['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/flac',
                      'audio/mp4', 'audio/x-m4a', 'audio/ogg', 'audio/opus', 'audio/aiff']) {
    const c = classifyDropFile(f('loop.bin', type));
    assert.equal(c.route, 'audio', `${type} should route to audio`);
    assert.equal(c.kind, 'audio');
  }
});

test('audio with an EMPTY mime falls back to the extension', () => {
  // Safari does this for .flac; some pickers do it for .wav and .aiff.
  for (const name of ['Kick.wav', 'Pad.aiff', 'Pad.aif', 'Stab.flac', 'Vox.m4a',
                      'Perc.aac', 'Amb.ogg', 'Amb.opus', 'Bass.mp3', 'Memo.caf']) {
    const c = classifyDropFile(f(name, ''));
    assert.equal(c.route, 'audio', `${name} with no mime should still route to audio`);
  }
});

test('the extension fallback does NOT fire when a mime is present', () => {
  // A file genuinely typed as something else must not be hijacked by its name.
  const c = classifyDropFile(f('notes.wav.zip', 'application/zip'));
  assert.equal(c.route, 'file');
});

test('a non-audio empty-mime file is still a file card', () => {
  assert.equal(classifyDropFile(f('archive.zip', '')).route, 'file');
  assert.equal(classifyDropFile(f('README', '')).route, 'file');
});

test('over-cap audio goes to multipart, and is refused for a free owner', () => {
  const big = f('stem.wav', 'audio/wav', FREE_AUDIO_CAP + 1);
  assert.equal(classifyDropFile(big, { canAttemptFiles: true }).route, 'largeMedia');
  assert.equal(classifyDropFile(big, { canAttemptFiles: true }).kind, 'audio',
    'an over-cap loop is still an AUDIO card, not a generic file');
  assert.equal(classifyDropFile(big, { canAttemptFiles: false }).route, 'blocked');
});

test('at exactly the cap the free inline route still applies', () => {
  assert.equal(classifyDropFile(f('a.wav', 'audio/wav', FREE_AUDIO_CAP)).route, 'audio');
  assert.equal(classifyDropFile(f('v.mp4', 'video/mp4', FREE_VIDEO_CAP)).route, 'video');
  assert.equal(classifyDropFile(f('d.pdf', 'application/pdf', FREE_PDF_CAP)).route, 'pdf');
});

test('images, video and pdf keep their existing routes', () => {
  assert.equal(classifyDropFile(f('a.png', 'image/png')).route, 'image');
  assert.equal(classifyDropFile(f('a.HEIC', '')).route, 'image');
  assert.equal(classifyDropFile(f('a.mp4', 'video/mp4')).route, 'video');
  assert.equal(classifyDropFile(f('a.pdf', '')).route, 'pdf');
});

test('an image is never blocked, even for a free owner', () => {
  // The paid gate is about "upload anything", not about photographs.
  assert.equal(classifyDropFile(f('a.jpg', 'image/jpeg'), { canAttemptFiles: false }).route, 'image');
});

test('every route carries usable fallback dims', () => {
  for (const c of [classifyDropFile(f('a.png', 'image/png')),
                   classifyDropFile(f('a.mp4', 'video/mp4')),
                   classifyDropFile(f('a.wav', 'audio/wav')),
                   classifyDropFile(f('a.pdf', 'application/pdf')),
                   classifyDropFile(f('a.zip', 'application/zip'))]) {
    assert.ok(c.w > 0 && c.h > 0, `${c.route} needs fallback dims to lay out before upload`);
  }
  assert.deepEqual(
    { w: classifyDropFile(f('a.wav', 'audio/wav')).w, h: classifyDropFile(f('a.wav', 'audio/wav')).h },
    FALLBACK_DIMS.audio);
});

test('sizeBucket stays low-cardinality and never leaks raw bytes', () => {
  const MB = 1024 * 1024;
  assert.equal(sizeBucket(0), 'lt_10mb');
  assert.equal(sizeBucket(9 * MB), 'lt_10mb');
  assert.equal(sizeBucket(11 * MB), '10_50mb');
  assert.equal(sizeBucket(60 * MB), '50_200mb');
  assert.equal(sizeBucket(300 * MB), '200mb_1gb');
  assert.equal(sizeBucket(2048 * MB), 'gt_1gb');
});

test('fitImageDims preserves aspect while clamping', () => {
  const big = fitImageDims(4000, 2000);
  assert.equal(Math.max(big.w, big.h), 1200);
  assert.equal(big.w / big.h, 2);
  const small = fitImageDims(10, 5);
  assert.equal(Math.min(small.w, small.h), 80);
});
