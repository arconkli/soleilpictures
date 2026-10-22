// docFrame.test.mjs — what the open doc's header and its surface share in the
// doc look: the surface publishes its page list and side panel, the header
// hears only real changes; and the side panel is remembered for the reader.
//
//   node --test src/lib/docFrame.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDocFrame, readDocPanel, writeDocPanel } from './docFrame.js';

test('a new frame has nothing to switch until the surface publishes', () => {
  const f = createDocFrame();
  assert.equal(f.get().ready, false);
  assert.equal(f.get().railOpen, false);
  assert.equal(f.get().panelOpen, false);
});

test('publishing tells the listeners, once per real change', () => {
  const f = createDocFrame();
  let heard = 0;
  const off = f.subscribe(() => { heard += 1; });
  f.publish({ railOpen: true, panelOpen: false, openComments: 2 });
  assert.equal(heard, 1);
  assert.deepEqual(
    { ready: f.get().ready, railOpen: f.get().railOpen, openComments: f.get().openComments },
    { ready: true, railOpen: true, openComments: 2 });
  const before = f.get();
  f.publish({ railOpen: true, openComments: 2 });
  assert.equal(heard, 1, 'the same state again is no change');
  assert.equal(f.get(), before, 'and keeps the same snapshot');
  f.publish({ panelOpen: true });
  assert.equal(heard, 2);
  off();
  f.publish({ panelOpen: false });
  assert.equal(heard, 2, 'a listener that left hears nothing');
});

test('a surface that goes away leaves the header nothing to switch', () => {
  const f = createDocFrame();
  let heard = 0;
  f.subscribe(() => { heard += 1; });
  f.publish({ railOpen: true });
  f.reset();
  assert.equal(f.get().ready, false);
  assert.equal(heard, 2);
  f.reset();
  assert.equal(heard, 2, 'resetting twice is one change');
});

test('the header asks the surface through what the surface set', () => {
  const f = createDocFrame();
  assert.doesNotThrow(() => { f.act.toggleRail(); f.act.togglePanel('find'); });
  let asked = null;
  f.act.togglePanel = (tab) => { asked = tab; };
  f.act.togglePanel('find');
  assert.equal(asked, 'find');
});

function memoryStorage(initial = {}) {
  const m = new Map(Object.entries(initial));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); } };
}

test('the side panel starts closed on Comments, and reads what was stored', () => {
  assert.deepEqual(readDocPanel(memoryStorage()), { open: false, tab: 'comments' });
  const s = memoryStorage({ 'soleil.boards.docPanel': '{"open":true,"tab":"find"}' });
  assert.deepEqual(readDocPanel(s), { open: true, tab: 'find' });
});

test('anything else stored reads as the default', () => {
  for (const raw of ['nope', '{"open":"yes","tab":"outline"}', 'null', '[]']) {
    assert.deepEqual(readDocPanel(memoryStorage({ 'soleil.boards.docPanel': raw })), { open: false, tab: 'comments' }, raw);
  }
  assert.deepEqual(readDocPanel(null), { open: false, tab: 'comments' });
  const throwing = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.deepEqual(readDocPanel(throwing), { open: false, tab: 'comments' });
  assert.doesNotThrow(() => writeDocPanel({ open: true, tab: 'find' }, throwing));
});

test('what is written is what is read back', () => {
  const s = memoryStorage();
  writeDocPanel({ open: true, tab: 'elements' }, s);
  assert.deepEqual(readDocPanel(s), { open: true, tab: 'elements' });
});
