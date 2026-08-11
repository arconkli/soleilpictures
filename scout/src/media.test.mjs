// EXIF reading and attachment routing.
//
// Lives beside the service rather than under boards/src/lib because it imports
// sharp — but it is run by the same `node --test` invocation, wired through the
// root test script, because the EXIF path is exactly the kind of code that fails
// silently: a mirrored hemisphere or a swallowed capture date looks like data
// right up until somebody drives to the wrong place.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';

import { readExif, classifyAttachment, imageSize, isImage, normalizeImage } from './media.js';

// Build a real JPEG carrying real EXIF, so this exercises the actual parser
// rather than a fixture somebody hand-wrote to match the code.
//
// GPS goes in IFD3 — that is sharp's name for the GPS IFD, and it is the only
// one exif-reader surfaces as `GPSInfo`. Writing the same tags into IFD2 (the
// Exif IFD) produces a file where they are present, parseable and in the wrong
// place, which is a good reminder of why this test builds real bytes: a fixture
// written to match the code would have agreed with itself and proved nothing.
async function jpegWithExif(exif) {
  return sharp({ create: { width: 8, height: 8, channels: 3, background: '#334455' } })
    .withExif(exif)
    .jpeg()
    .toBuffer();
}

test('capture time and coordinates are read off a real JPEG', async () => {
  const bytes = await jpegWithExif({
    IFD0: { DateTime: '2026:08:11 09:14:02' },
    IFD3: {
      GPSLatitude: '34/1 5/1 53/1',
      GPSLatitudeRef: 'N',
      GPSLongitude: '118/1 19/1 44/1',
      GPSLongitudeRef: 'W',
    },
  });
  const meta = await sharp(bytes).metadata();
  const { shotAt, geo } = readExif(meta.exif);

  assert.equal(shotAt, '2026-08-11T09:14:02.000Z');
  assert.ok(Array.isArray(geo), 'coordinates should parse');
  // 34°05'53"N → +34.098; 118°19'44"W → −118.329. The WESTERN sign is the
  // point: without applying GPSLongitudeRef this comes out in China.
  assert.ok(Math.abs(geo[0] - 34.09806) < 0.001, `lat ${geo[0]}`);
  assert.ok(geo[1] < 0, `lon ${geo[1]} must be negative for a W reference`);
  assert.ok(Math.abs(geo[1] + 118.32889) < 0.001, `lon ${geo[1]}`);
});

test('a southern/eastern reference flips the sign the other way', async () => {
  const bytes = await jpegWithExif({
    IFD3: {
      GPSLatitude: '33/1 51/1 54/1', GPSLatitudeRef: 'S',
      GPSLongitude: '151/1 12/1 34/1', GPSLongitudeRef: 'E',
    },
  });
  const { geo } = readExif((await sharp(bytes).metadata()).exif);
  assert.ok(geo[0] < 0 && geo[1] > 0, `Sydney should be (−,+), got ${geo}`);
});

test('a photo with no EXIF is completely normal, not an error', async () => {
  const bytes = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#000' } })
    .jpeg().toBuffer();
  assert.deepEqual(readExif((await sharp(bytes).metadata()).exif), { shotAt: null, geo: null });
  assert.deepEqual(readExif(undefined), { shotAt: null, geo: null });
  // Malformed EXIF must not throw — it is not a broken photo.
  assert.deepEqual(readExif(Buffer.from('not exif at all')), { shotAt: null, geo: null });
});

test('a dead camera clock and a no-fix GPS are discarded, not stored', async () => {
  const bytes = await jpegWithExif({
    IFD0: { DateTime: '1970:01:01 00:00:00' },
    IFD3: {
      GPSLatitude: '0/1 0/1 0/1', GPSLatitudeRef: 'N',
      GPSLongitude: '0/1 0/1 0/1', GPSLongitudeRef: 'E',
    },
  });
  const { shotAt, geo } = readExif((await sharp(bytes).metadata()).exif);
  assert.equal(shotAt, null, 'a 1970 capture date is a dead clock, not data');
  assert.equal(geo, null, '(0,0) is in the Atlantic — nobody scouts there');
});

// ── Routing ─────────────────────────────────────────────────────────────────

test('routing is the app\'s own, so a texted file and a dragged file agree', () => {
  const of = (mimeType, name, size) => classifyAttachment(
    { mimeType, name, bytes: { length: size } }, { canAttemptFiles: false },
  );
  assert.equal(of('image/jpeg', 'a.jpg', 2e6).kind, 'image');
  assert.equal(of('image/heic', 'a.heic', 3e6).kind, 'image');
  // iOS reports HEIC with an EMPTY mime type through some pickers; the router
  // falls back to the extension, which only works if it gets the filename.
  assert.equal(of('', 'IMG_0001.HEIC', 3e6).kind, 'image');
  assert.equal(of('video/quicktime', 'a.mov', 10e6).kind, 'video');
  assert.equal(of('audio/mp4', 'a.m4a', 1e6).kind, 'audio');
  assert.equal(of('application/pdf', 'a.pdf', 1e6).kind, 'pdf');
});

test('the free tier really does take video, audio and PDFs', () => {
  // The bot used to tell people "video and audio files need a Creator plan",
  // which was simply false and talked them out of the product for a reason that
  // does not exist.
  const free = (mimeType, name, size) => classifyAttachment(
    { mimeType, name, bytes: { length: size } }, { canAttemptFiles: false },
  ).route;
  assert.equal(free('video/mp4', 'a.mp4', 20 * 1024 * 1024), 'video');
  assert.equal(free('audio/mpeg', 'a.mp3', 40 * 1024 * 1024), 'audio');
  assert.equal(free('application/pdf', 'a.pdf', 40 * 1024 * 1024), 'pdf');
  // Over the inline caps, and any other type, is where the paywall starts.
  assert.equal(free('video/mp4', 'a.mp4', 200 * 1024 * 1024), 'blocked');
  assert.equal(free('application/zip', 'a.zip', 1e6), 'blocked');
});

test('a paid owner is refused nothing', () => {
  const paid = (mimeType, name, size) => classifyAttachment(
    { mimeType, name, bytes: { length: size } }, { canAttemptFiles: true },
  );
  assert.equal(paid('video/mp4', 'a.mp4', 900 * 1024 * 1024).route, 'largeMedia');
  assert.equal(paid('application/zip', 'a.zip', 1e6).route, 'file');
});

// ── Dimensions and conversion ───────────────────────────────────────────────

test('dimensions are probed from header bytes for the formats a phone sends', async () => {
  for (const fmt of ['jpeg', 'png', 'webp', 'gif']) {
    const bytes = await sharp({ create: { width: 37, height: 21, channels: 3, background: '#123' } })
      [fmt]().toBuffer();
    assert.deepEqual(imageSize(bytes), { width: 37, height: 21 }, fmt);
  }
  assert.deepEqual(imageSize(Buffer.from('garbage')), { width: null, height: null });
});

test('a JPEG is passed through untouched — re-encoding is loss for nothing', async () => {
  const bytes = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#000' } })
    .jpeg().toBuffer();
  const out = await normalizeImage(bytes, 'image/jpeg', 'a.jpg');
  assert.equal(out.bytes, bytes, 'the same buffer, not a re-encode');
  assert.equal(out.ext, 'jpg');
});

test('a PORTRAIT photo gets portrait dimensions', async () => {
  // The regression this exists for: `sharp(bytes).rotate().metadata()` reports
  // the dimensions of the INPUT, not of the rotated output, so a portrait iPhone
  // frame — stored landscape with an orientation tag — was recorded as
  // landscape. Every one of them got a landscape card and a wrongly-shaped hole
  // in the moodboard. media.js's own comment predicted exactly this failure and
  // the code walked into it.
  //
  // 200×100 tagged orientation 6 displays as 100×200.
  const bytes = await sharp({ create: { width: 200, height: 100, channels: 3, background: '#345' } })
    .withMetadata({ orientation: 6 }).jpeg().toBuffer();

  const naive = await sharp(bytes).rotate().metadata();
  assert.equal(naive.width, 200, 'metadata() still reports the unrotated width');

  // What the pixels really are, and therefore what the card must say.
  const real = await sharp(await sharp(bytes).rotate().jpeg().toBuffer()).metadata();
  assert.deepEqual([real.width, real.height], [100, 200]);

  const { width, height } = await analyzeImageDims(bytes);
  assert.deepEqual([width, height], [100, 200], 'the ingest path must agree with the pixels');
});

// analyzeImage is internal; exercise the orientation decision through the
// public upload contract's shape without needing R2 or Supabase.
async function analyzeImageDims(bytes) {
  const meta = await sharp(Buffer.from(bytes), { failOn: 'none' }).rotate().metadata();
  const { orientedSize } = await import('./media.js');
  return orientedSize(meta);
}

test('isImage is a mime test, not a guess', () => {
  assert.ok(isImage('image/heic'));
  assert.ok(!isImage('video/quicktime'));
  assert.ok(!isImage(''));
  assert.ok(!isImage(null));
});
