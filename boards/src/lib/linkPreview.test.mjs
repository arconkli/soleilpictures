// The async link preview only fills in what the user hasn't changed since the
// card or cell was created (CARDS-14).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { previewPatch, fetchLinkPreview, isPreviewPending, subscribePreviewPending } from './linkPreview.js';

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

// A link card says "Getting preview…" only while its fetch is in flight.
test('a fetch is pending from start to settle, by normalised URL, success or not', async () => {
  const realFetch = globalThis.fetch;
  let release;
  const gate = new Promise((r) => { release = r; });
  globalThis.fetch = async () => { await gate; throw new Error('offline'); };
  let calls = 0;
  const off = subscribePreviewPending(() => { calls += 1; });
  try {
    const run = fetchLinkPreview('example.com/page');
    assert.equal(isPreviewPending('https://example.com/page'), true);
    assert.equal(isPreviewPending('example.com/page'), true);
    assert.equal(isPreviewPending('example.com/other'), false);
    release();
    assert.equal(await run, null);
    assert.equal(isPreviewPending('example.com/page'), false);
    assert.equal(calls, 2);
  } finally {
    off();
    globalThis.fetch = realFetch;
  }
});

test('two fetches of one URL stay pending until both settle', async () => {
  const realFetch = globalThis.fetch;
  // Call 1 is b's first request and waits; every other request fails at once.
  let release;
  const held = new Promise((_, reject) => { release = reject; });
  let n = 0;
  globalThis.fetch = () => (n++ === 1 ? held : Promise.reject(new Error('x')));
  try {
    const a = fetchLinkPreview('https://two.example');
    const b = fetchLinkPreview('two.example');
    await a;
    assert.equal(isPreviewPending('two.example'), true);
    release(new Error('x'));
    await b;
    assert.equal(isPreviewPending('two.example'), false);
  } finally {
    globalThis.fetch = realFetch;
  }
});
