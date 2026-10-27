import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setFileActions, canPutFiles, putFiles, canUnpackZip, unpackZip } from './fileActions.js';

test('a page asks the board through what it registered; an old unregister leaves a newer one in place', () => {
  assert.equal(canPutFiles('b1'), false);
  assert.equal(putFiles('b1', []), undefined);
  const calls = [];
  const off1 = setFileActions('b1', { putFiles: (f) => calls.push(['one', f.length]) });
  assert.equal(canPutFiles('b1'), true);
  assert.equal(canPutFiles('b2'), false);
  assert.equal(canUnpackZip('b1'), false);
  putFiles('b1', [1, 2]);
  const off2 = setFileActions('b1', { putFiles: (f) => calls.push(['two', f.length]), unpackZip: (f) => calls.push(['zip', f]) });
  off1();
  assert.equal(canPutFiles('b1'), true);
  putFiles('b1', [1]);
  unpackZip('b1', 'z');
  off2();
  assert.equal(canPutFiles('b1'), false);
  assert.deepEqual(calls, [['one', 2], ['two', 1], ['zip', 'z']]);
});
