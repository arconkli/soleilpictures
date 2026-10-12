// toastGroup — identical toasts merge into one with a count (MEDIA-10).

import test from 'node:test';
import assert from 'node:assert/strict';
import { placeGroupedToast, releaseToastGroup } from './toastGroup.js';

const upload = (msg) => ({
  group: 'upload-failed',
  message: `Upload failed: ${msg}`,
  groupMessage: (n) => `${n} uploads failed`,
});

test('the first toast of a group is an ordinary toast with its own message', () => {
  const g = new Map();
  const p = placeGroupedToast(g, upload('Upload network error'), 1);
  assert.deepEqual(p, { id: 1, count: 1, message: 'Upload failed: Upload network error', merged: false });
});

test('the next ones join it: same id, a count, the group message', () => {
  const g = new Map();
  placeGroupedToast(g, upload('a'), 1);
  const p2 = placeGroupedToast(g, upload('b'), 2);
  const p3 = placeGroupedToast(g, upload('c'), 3);
  assert.equal(p2.id, 1);
  assert.equal(p2.merged, true);
  assert.equal(p2.message, '2 uploads failed');
  assert.equal(p3.id, 1);
  assert.equal(p3.message, '3 uploads failed');
});

test('a toast with no group never merges', () => {
  const g = new Map();
  const a = placeGroupedToast(g, { message: 'Saved' }, 1);
  const b = placeGroupedToast(g, { message: 'Saved' }, 2);
  assert.equal(a.id, 1);
  assert.equal(b.id, 2);
  assert.equal(g.size, 0);
});

test('different groups stay apart', () => {
  const g = new Map();
  placeGroupedToast(g, upload('a'), 1);
  const other = placeGroupedToast(g, { group: 'other', message: 'x' }, 2);
  assert.equal(other.id, 2);
  assert.equal(other.merged, false);
});

test('once the toast is leaving, the next failure starts a new toast', () => {
  const g = new Map();
  placeGroupedToast(g, upload('a'), 1);
  placeGroupedToast(g, upload('b'), 2);
  releaseToastGroup(g, 1);
  const p = placeGroupedToast(g, upload('c'), 3);
  assert.equal(p.id, 3);
  assert.equal(p.count, 1);
  assert.equal(p.message, 'Upload failed: c');
});

test('without groupMessage a merge keeps the newest message', () => {
  const g = new Map();
  placeGroupedToast(g, { group: 'k', message: 'one' }, 1);
  assert.equal(placeGroupedToast(g, { group: 'k', message: 'two' }, 2).message, 'two');
});
