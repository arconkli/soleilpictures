// clusterOpen — what App says when asked to open a cluster that isn't in the
// live boards map.

import test from 'node:test';
import assert from 'node:assert/strict';
import { unopenableClusterNotice } from './clusterOpen.js';

test('a trashed cluster in this workspace says so and offers the Trash', () => {
  const n = unopenableClusterNotice({ workspace_id: 'w1', deleted_at: '2026-10-01T00:00:00Z' }, 'w1');
  assert.equal(n.message, 'That cluster is in the Trash.');
  assert.equal(n.openTrash, true);
});

test("a trashed cluster in another workspace says so, without a Trash button that would show this workspace's", () => {
  const n = unopenableClusterNotice({ workspace_id: 'w2', deleted_at: '2026-10-01T00:00:00Z' }, 'w1');
  assert.equal(n.message, 'That cluster is in the Trash.');
  assert.equal(n.openTrash, false);
});

test('no row (gone, or not yours to read) is "not available"', () => {
  const n = unopenableClusterNotice(null, 'w1');
  assert.match(n.message, /isn't available/);
  assert.equal(n.openTrash, false);
});

test('a live row the map does not hold is not called trashed', () => {
  const n = unopenableClusterNotice({ workspace_id: 'w1', deleted_at: null }, 'w1');
  assert.doesNotMatch(n.message, /Trash/);
});
