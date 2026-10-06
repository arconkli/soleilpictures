// hints.test.mjs — the gate for failure-triggered hints.
//
//   node --test src/lib/hints.test.mjs
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  HINT_KINDS, canShowHint, claimHint, releaseHint, hintUp, __resetHints,
  isDefaultClusterName, tourShowing, hintSeen, NAME_CLUSTER_AFTER_MS,
} from './hints.js';

beforeEach(() => __resetHints());

test('a default cluster name is any of the names the app hands out, or nothing', () => {
  for (const n of ['Untitled cluster', 'untitled cluster ', 'Untitled list', 'New cluster', 'Untitled', '', null, undefined]) {
    assert.ok(isDefaultClusterName(n), `${JSON.stringify(n)} is a default name`);
  }
  for (const n of ['Moodboard', 'Untitled poem', 'Scene 4', 'references']) {
    assert.ok(!isDefaultClusterName(n), `${JSON.stringify(n)} is a real name`);
  }
});

test('the gate refuses an unknown kind, a seen kind, and anything while the tour shows', () => {
  const never = () => false;
  assert.equal(canShowHint('paste', { seen: never, tour: never }), true);
  assert.equal(canShowHint('name_cluster', { seen: never, tour: never }), true);
  assert.equal(canShowHint('place', { seen: never, tour: never }), false, 'place is not a hint kind: the canvas already says where to click');
  assert.equal(canShowHint('paste', { seen: () => true, tour: never }), false);
  assert.equal(canShowHint('paste', { seen: never, tour: () => true }), false);
});

test('without storage a hint reads as already seen, so a broken browser never nags', () => {
  // No localStorage in node: the read fails closed.
  assert.equal(hintSeen('paste'), true);
  assert.equal(canShowHint('paste', { tour: () => false }), false);
});

test('one hint on screen: a second kind cannot claim until the first releases', () => {
  assert.equal(claimHint('paste'), true);
  assert.equal(hintUp(), 'paste');
  assert.equal(claimHint('name_cluster'), false);
  assert.equal(claimHint('paste'), true, 'the holder may re-claim');
  releaseHint('name_cluster');
  assert.equal(hintUp(), 'paste', 'only the holder releases');
  releaseHint('paste');
  assert.equal(hintUp(), null);
  assert.equal(claimHint('name_cluster'), true);
  assert.equal(claimHint('nonsense'), false);
});

test('the tour stamp on the body is what counts as the tour showing', () => {
  assert.equal(tourShowing(null), false);
  assert.equal(tourShowing({ body: { dataset: {} } }), false);
  assert.equal(tourShowing({ body: { dataset: { tourActive: '1' } } }), true);
  assert.equal(tourShowing({ body: { dataset: { tourVariant: 'project_first' } } }), true);
});

test('the kinds and the naming delay are what the surfaces expect', () => {
  assert.deepEqual([...HINT_KINDS], ['paste', 'name_cluster']);
  assert.ok(NAME_CLUSTER_AFTER_MS >= 30_000 && NAME_CLUSTER_AFTER_MS <= 120_000, 'a minute, give or take');
});
