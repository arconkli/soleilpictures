// COMMS-15: a failed read is not an empty conversation or an empty inbox.
// A network blip used to blank the thread to "No messages yet" and the list
// to "No conversations yet", with the unread badge and title count at zero.
// The reads now resolve null on error, the hooks keep the last good read, and
// an empty screen after a failure says "Couldn't load" with a Retry.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

test('the list reads resolve null on error, not an empty result', () => {
  const src = read('./messages.js');
  for (const fn of ['listConversations', 'listMyConversationParticipants', 'getUnreadCounts']) {
    const body = src.slice(src.indexOf(`export async function ${fn}`));
    const errLine = body.match(/if \(error\) \{[^\n]*\}/)[0];
    assert.match(errLine, /return null;/, fn);
  }
});

test('the inbox keeps its last good read and reports the failure', () => {
  const src = read('../hooks/useConversationList.js');
  assert.match(src, /if \(convs\) setConversations\(convs\);/);
  assert.match(src, /if \(parts\) setParticipants\(parts\);/);
  assert.match(src, /if \(c\) setCounts\(c\);/);
  assert.doesNotMatch(src, /setCounts\(c \|\| \{\}\)/);
  assert.match(src, /setFailed\(!convs \|\| !parts\)/);
});

test('the panel says "Couldn\'t load" instead of the empty state after a failure', () => {
  const panel = read('../components/MessagesPanel.jsx');
  assert.match(panel, /loaded && failed &&/);
  assert.match(panel, /loaded && !failed && visibleConversations\.length === 0/);
  const thread = read('../components/MessageThread.jsx');
  assert.match(thread, /isEmpty && loadFailed \?/);
  const hook = read('../hooks/useMessageThread.js');
  assert.match(hook, /setFailed\(rows == null\)/);
});
