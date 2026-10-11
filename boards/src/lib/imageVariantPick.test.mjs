// imageVariantPick — the stored thumbnail and the hover prefetch fetch the
// smallest image tier that covers the draw, never the original when a
// preview exists (PERF-01, PERF-06).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pickVariantKey, pickVariantSrc } from './imageVariantPick.js';

const here = dirname(fileURLToPath(import.meta.url));
const META = {
  previewKey: 'ws/b/a.preview.webp', previewW: 1280, previewH: 853,
  previewSmKey: 'ws/b/a.preview-sm.webp', previewSmW: 640, previewSmH: 427,
  w: 4032, h: 2688,
};

test('the small preview when it covers the draw, else the large one', () => {
  assert.equal(pickVariantKey('ws/b/a.jpg', META, 300), META.previewSmKey);
  assert.equal(pickVariantKey('ws/b/a.jpg', META, 640), META.previewSmKey);
  assert.equal(pickVariantKey('ws/b/a.jpg', META, 641), META.previewKey);
  // Bigger than any preview: still the preview, never the 12 MP original.
  assert.equal(pickVariantKey('ws/b/a.jpg', META, 3000), META.previewKey);
  assert.equal(pickVariantKey('ws/b/a.jpg', META), META.previewKey);
});

test('the original only when there is nothing smaller', () => {
  assert.equal(pickVariantKey('ws/b/a.jpg', null, 300), 'ws/b/a.jpg');
  assert.equal(pickVariantKey('ws/b/a.gif', { blur: 'x', previewKey: null, previewSmKey: null }, 300), 'ws/b/a.gif');
  assert.equal(pickVariantKey('ws/b/a.jpg', { previewSmKey: 'sm', previewSmW: 640, previewSmH: 400 }, 900), 'sm');
  assert.equal(pickVariantKey(null, META), null);
});

test('pickVariantSrc keeps the r2: sentinel and leaves other srcs alone', () => {
  const get = (k) => (k === 'ws/b/a.jpg' ? META : null);
  assert.equal(pickVariantSrc('r2:ws/b/a.jpg', get, 200), `r2:${META.previewSmKey}`);
  assert.equal(pickVariantSrc('r2:ws/b/other.jpg', get, 200), 'r2:ws/b/other.jpg');
  assert.equal(pickVariantSrc('https://example.com/x.png', get, 200), 'https://example.com/x.png');
  assert.equal(pickVariantSrc('r2:ws/b/a.jpg', () => { throw new Error('boom'); }, 200), 'r2:ws/b/a.jpg');
});

test('the thumbnail renderer and the hover prefetch both go through it', () => {
  const thumb = readFileSync(join(here, 'renderThumbnail.js'), 'utf8');
  assert.match(thumb, /pickVariantSrc\(/, 'renderThumbnail picks a variant for image cards');
  assert.match(thumb, /\.decode\(\)/, 'renderThumbnail decodes before the synchronous draw loop');
  const kinds = readFileSync(join(here, 'prefetchKinds.js'), 'utf8');
  assert.match(kinds, /pickVariantKey\(/, 'the hover warm-up warms a variant');
  assert.doesNotMatch(kinds, /Y\.applyUpdate\(/, 'the hover warm-up decodes the snapshot off the main thread');
});
