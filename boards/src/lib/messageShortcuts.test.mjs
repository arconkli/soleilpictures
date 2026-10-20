// COMMS-24: "Copy link" on a message gave no feedback either way, and the
// thread's advertised `e` (edit) shortcut dispatched an event nothing
// listened for.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

test('Copy link says it copied, or that it could not', () => {
  const src = read('../components/MessageThread.jsx');
  const fn = src.slice(src.indexOf('const handleCopyLink'), src.indexOf('const handleTyping'));
  assert.match(fn, /message: 'Link copied'/);
  assert.match(fn, /type: 'error'/);
  assert.doesNotMatch(fn, /catch \(_\) \{\}/);
});

test('the `e` shortcut has a listener: your own message, inside the edit window', () => {
  const thread = read('../components/MessageThread.jsx');
  assert.match(thread, /new CustomEvent\('soleil-msg-edit', \{ detail: \{ id: m\.id \}\}\)/);
  const bubble = read('../components/MessageBubble.jsx');
  assert.match(bubble, /document\.addEventListener\('soleil-msg-edit', onEditRequest\)/);
  assert.match(bubble, /const canEdit = isMine && inEditWindow && !sendState;/);
  assert.match(bubble, /const inEditWindow = withinEditWindow\(msg\.created_at\);/);
  assert.match(bubble, /if \(e\.detail\?\.id !== msg\.id\) return;/);
});
