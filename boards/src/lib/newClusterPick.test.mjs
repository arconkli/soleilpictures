// newClusterPick.test.mjs — the top bar's count follows the pane it describes,
// and a re-render only happens when the pick really changed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publishNewClusterPick, readNewClusterPick, subscribeNewClusterPick } from './newClusterPick.js';

test('a pick is read back for its own pane and cluster only', () => {
  publishNewClusterPick('main', { boardId: 'b1', count: 3, suggestion: 'Kitchen' });
  assert.deepEqual(readNewClusterPick('main', 'b1'), { boardId: 'b1', count: 3, suggestion: 'Kitchen' });
  assert.equal(readNewClusterPick('main', 'b2').count, 0, 'the pane has moved on to another cluster');
  assert.equal(readNewClusterPick('split', 'b1').count, 0, 'another pane picked nothing');
  assert.equal(readNewClusterPick('main', null).count, 0);
  publishNewClusterPick('main', null);
  assert.equal(readNewClusterPick('main', 'b1').count, 0, 'a surface that goes away takes its pick along');
});

test('subscribers hear a change, and only a change', () => {
  let calls = 0;
  const off = subscribeNewClusterPick(() => { calls += 1; });
  publishNewClusterPick('main', { boardId: 'b1', count: 2, suggestion: null });
  const first = readNewClusterPick('main', 'b1');
  publishNewClusterPick('main', { boardId: 'b1', count: 2, suggestion: null });
  assert.equal(calls, 1, 'the same pick again is not news');
  assert.equal(readNewClusterPick('main', 'b1'), first, 'and reads back as the same object');
  publishNewClusterPick('main', { boardId: 'b1', count: 0 });
  publishNewClusterPick('main', null);
  assert.equal(calls, 2, 'nothing picked is one state, however it is said');
  off();
  publishNewClusterPick('main', { boardId: 'b1', count: 5 });
  assert.equal(calls, 2, 'unsubscribed');
  publishNewClusterPick('main', null);
});
