// Your own message stays editable for a while after you send it; ↑ in an
// empty composer edits the newest one that still is.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MESSAGE_EDIT_WINDOW_MIN, withinEditWindow, lastEditableMessage } from './messageEdit.js';

const NOW = Date.UTC(2026, 9, 20, 12, 0, 0);
const ago = (min) => new Date(NOW - min * 60 * 1000).toISOString();
const msg = (id, sender, min, extra = {}) => ({ id, sender_id: sender, kind: 'user', created_at: ago(min), ...extra });

test('the window is the documented number of minutes', () => {
  assert.equal(MESSAGE_EDIT_WINDOW_MIN, 15);
  assert.equal(withinEditWindow(ago(14.9), NOW), true);
  assert.equal(withinEditWindow(ago(15), NOW), false);
  assert.equal(withinEditWindow(null, NOW), false);
  assert.equal(withinEditWindow('not a date', NOW), false);
});

test('↑ finds your newest message, past others’ and past one still sending', () => {
  const rows = [msg('a', 'me', 10), msg('b', 'maya', 5), msg('c', 'me', 3), msg('d', 'maya', 2), msg('e', 'me', 0, { sendState: 'sending' })];
  assert.equal(lastEditableMessage(rows, 'me', NOW).id, 'c');
});

test('nothing to edit: none of yours, or your newest is past the window', () => {
  assert.equal(lastEditableMessage([msg('a', 'maya', 1)], 'me', NOW), null);
  assert.equal(lastEditableMessage([msg('a', 'me', 30), msg('b', 'me', 20), msg('c', 'maya', 1)], 'me', NOW), null, 'older ones are older still');
  assert.equal(lastEditableMessage([msg('a', 'me', 1, { kind: 'system' })], 'me', NOW), null);
  assert.equal(lastEditableMessage([], 'me', NOW), null);
});
