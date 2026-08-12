// Reading image dimensions out of header bytes, at the edge.
//
// /api/v1/uploads writes straight to R2 from the Worker, and Workers have no
// image decoder — but the `images` row and the card both want width and height,
// and an image card without them renders at the generic 280x180 default.
//
// The real verification for this ran against the repo's own 178 images
// (png/jpg/webp/gif, including every WebP sub-format) and matched macOS `sips`
// exactly on all of them. What is pinned here are the properties that corpus
// cannot pin: that a bad answer is never returned as a good one.

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { imageDimensions, extensionFor } from '../src/lib/imageDims.js';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');
// Read from public/, NOT dist/. Vite copies public/ into the build verbatim, so
// the bytes are identical — but dist/ only exists after `npm run build`, and
// these three tests failed with ENOENT on any tree that had not been built. A
// fresh worktree is exactly where a promotion runs its gate, so the suite has to
// work without a prior build.
const read = (p) => new Uint8Array(readFileSync(join(repo, p)));

test('real files of each format report their real size', () => {
  // Ground truth from `sips -g pixelWidth -g pixelHeight`.
  expect(imageDimensions(read('boards/public/favicon.png'))).toEqual({ width: 512, height: 512 });
  expect(imageDimensions(read('boards/public/grain.gif'))).toEqual({ width: 480, height: 360 });
});

test('a JPEG is found behind its metadata', () => {
  // The SOF can sit behind any amount of EXIF, ICC or an embedded thumbnail,
  // which is exactly what a phone photo has a lot of — so this walks the
  // segment chain rather than reading a fixed offset.
  expect(imageDimensions(read('assets/deepdiveweb1.jpg'))).toEqual({ width: 564, height: 540 });
});

test('a truncated file is unknown, never a guess', () => {
  const png = read('boards/public/favicon.png');
  expect(imageDimensions(png.subarray(0, 8))).toBeNull();
  expect(imageDimensions(png.subarray(0, 20))).toBeNull();
});

test('garbage is unknown rather than zero', () => {
  // Null means "no answer" and the caller stores null. A zero-width card would
  // be invisible, so a wrong answer is worse than no answer here.
  expect(imageDimensions(new Uint8Array(0))).toBeNull();
  expect(imageDimensions(new Uint8Array(64))).toBeNull();
  expect(imageDimensions(new TextEncoder().encode('<svg width="10"></svg>'))).toBeNull();
  expect(imageDimensions(null)).toBeNull();
});

test('a header that parses to nothing is rejected', () => {
  // A PNG signature with a zeroed IHDR parses cleanly and means 0x0. That is a
  // failed parse, not an empty image.
  const b = new Uint8Array(32);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  b.set(new TextEncoder().encode('IHDR'), 12);
  expect(imageDimensions(b)).toBeNull();
});

test('only the head is needed', () => {
  // Callers may hand over the first few KB of a stream rather than the whole
  // file, so nothing may depend on reading to the end.
  const png = read('boards/public/favicon.png');
  expect(imageDimensions(png.subarray(0, 64))).toEqual({ width: 512, height: 512 });
});

test('the accepted content types are a closed list', () => {
  expect(extensionFor('image/jpeg')).toBe('jpg');
  expect(extensionFor('image/png; charset=binary')).toBe('png');
  expect(extensionFor('IMAGE/WEBP')).toBe('webp');
  expect(extensionFor('image/heic')).toBe('heic');
  // The extension becomes part of the R2 object key, so letting a caller name
  // it is how a .js ends up in a bucket other things serve from. SVG is
  // deliberately absent: it is a document that can carry script.
  expect(extensionFor('image/svg+xml')).toBeNull();
  expect(extensionFor('text/html')).toBeNull();
  expect(extensionFor('application/javascript')).toBeNull();
  expect(extensionFor('')).toBeNull();
  expect(extensionFor(undefined)).toBeNull();
});
