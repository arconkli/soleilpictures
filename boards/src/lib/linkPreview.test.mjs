// The async link preview only fills in what the user hasn't changed since the
// card or cell was created (CARDS-14).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { previewPatch } from './linkPreview.js';

const created = { source: 'https://a.com/x', title: 'a.com', w: 280, h: 110 };
const p = { title: 'A — the page', image: 'https://a.com/og.jpg', description: 'About A', favicon: 'https://a.com/f.ico' };
const grow = { w: 280, h: 290 };

test('an untouched card takes the whole preview and grows to fit the image', () => {
  assert.deepEqual(previewPatch(p, { ...created }, created, { grow }), {
    title: 'A — the page', image: p.image, description: 'About A', favicon: p.favicon, w: 280, h: 290,
  });
});

test('a title the user typed meanwhile is kept', () => {
  const out = previewPatch(p, { ...created, title: 'My ref' }, created, { grow });
  assert.equal('title' in out, false);
  assert.equal(out.image, p.image);
});

test('a card the user resized meanwhile keeps its size', () => {
  const out = previewPatch(p, { ...created, w: 400, h: 300 }, created, { grow });
  assert.equal('w' in out, false);
  assert.equal('h' in out, false);
});

test('a deleted card, an edited URL or a replaced cell gets nothing', () => {
  assert.deepEqual(previewPatch(p, null, created), {});
  assert.deepEqual(previewPatch(p, { ...created, source: 'https://b.com' }, created), {});
  const cell = { type: 'link', source: created.source, title: 'a.com' };
  assert.deepEqual(previewPatch(p, { type: 'image', src: 'x.jpg' }, cell), {});
  assert.equal(previewPatch(p, { ...cell }, cell).title, 'A — the page');
});

test('no preview, no patch', () => {
  assert.deepEqual(previewPatch(null, { ...created }, created), {});
});
