// Board · Files switch helpers (lib/viewSwitch.js): the count on the Files
// side, the F key test, and the label/value split (the interface says Board
// and Files; boards.view keeps 'canvas' and 'list').

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VIEW_LABELS, nextView, filesCountOf, formatFilesCount, isViewSwitchKey } from './viewSwitch.js';

test('the interface names the stored views Board and Files', () => {
  assert.equal(VIEW_LABELS.canvas, 'Board');
  assert.equal(VIEW_LABELS.list, 'Files');
});

test('nextView flips list and canvas, and treats anything else as the board', () => {
  assert.equal(nextView('canvas'), 'list');
  assert.equal(nextView('list'), 'canvas');
  assert.equal(nextView('doc'), 'list');
  assert.equal(nextView(undefined), 'list');
});

test('the Files count leaves out sub-cluster mirrors, which Files lists as folders', () => {
  const cards = [
    { id: '1', kind: 'image' }, { id: '2', kind: 'note' }, { id: '3', kind: 'board' },
    { id: '4', kind: 'boardlink' }, { id: '5', kind: 'audio' }, null,
  ];
  assert.equal(filesCountOf(cards), 3);
  assert.equal(filesCountOf([]), 0);
  assert.equal(filesCountOf(null), 0);
});

test('the badge is hidden at zero and capped at 999+', () => {
  assert.equal(formatFilesCount(0), '');
  assert.equal(formatFilesCount(-1), '');
  assert.equal(formatFilesCount(NaN), '');
  assert.equal(formatFilesCount(7), '7');
  assert.equal(formatFilesCount(999), '999');
  assert.equal(formatFilesCount(1000), '999+');
});

test('F switches only bare, and never on key repeat', () => {
  assert.equal(isViewSwitchKey({ key: 'f' }), true);
  assert.equal(isViewSwitchKey({ key: 'F' }), true);
  for (const mod of ['metaKey', 'ctrlKey', 'altKey', 'shiftKey', 'repeat']) {
    assert.equal(isViewSwitchKey({ key: 'f', [mod]: true }), false, mod);
  }
  assert.equal(isViewSwitchKey({ key: 'g' }), false);
  assert.equal(isViewSwitchKey(null), false);
});
