// Keeping a thread where its reader is: when it counts as "at the bottom",
// and how far to scroll to hold a message in place.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isStuck, distanceFromBottom, pickAnchor, anchorCorrection, STICK_THRESHOLD_PX } from './stickToBottom.js';

test('within the threshold of the bottom counts as at the bottom', () => {
  assert.equal(STICK_THRESHOLD_PX, 48);
  assert.equal(distanceFromBottom({ scrollHeight: 1000, scrollTop: 600, clientHeight: 400 }), 0);
  assert.equal(isStuck({ scrollHeight: 1000, scrollTop: 552, clientHeight: 400 }), true);
  assert.equal(isStuck({ scrollHeight: 1000, scrollTop: 551, clientHeight: 400 }), false);
});

test('the anchor is the first message still showing at the top of the view', () => {
  const items = [{ id: 'a', top: -80, bottom: -10 }, { id: 'b', top: -10, bottom: 40 }, { id: 'c', top: 40, bottom: 90 }];
  assert.deepEqual(pickAnchor(items, 0), { id: 'b', offset: -10 }, 'one straddling the edge counts');
  assert.equal(pickAnchor([], 0), null);
});

test('history landing above moves the anchor down; the correction scrolls by that much', () => {
  const anchor = { id: 'b', offset: 12 };
  assert.equal(anchorCorrection(anchor, 100 + 512, 100), 500, 'a 500px page landed above');
  assert.equal(anchorCorrection(anchor, 112, 100), 0, 'nothing moved');
  assert.equal(anchorCorrection(null, 500, 100), 0);
});
