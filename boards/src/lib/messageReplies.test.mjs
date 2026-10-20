// Replies are inline: a reply sits in the conversation quoting what it
// answers. There is no separate thread view, and no "N replies" badge.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const thread = read('../components/MessageThread.jsx');

test('no thread mode is left', () => {
  assert.doesNotMatch(thread, /replyParent|fetchReplies|replyCounts|'THREAD'|REPLYING TO/);
  const lib = read('./messages.js');
  assert.doesNotMatch(lib, /export async function (fetchReplies|replyCountsFor)/);
  assert.doesNotMatch(read('../components/MessageBubble.jsx'), /replyMeta|msg-bubble-replies/);
  assert.doesNotMatch(read('../styles.css'), /\.msg-bubble-replies|\.msg-thread-header/);
});

test('a send answers what the composer says it’s replying to, then lets it go', () => {
  const send = thread.slice(thread.indexOf('const handleSend'), thread.indexOf('const retryPending'));
  assert.match(send, /parent_id: replyTo\?\.id \|\| null,/);
  assert.match(send, /setReplyTo\(null\);/);
  assert.match(thread, /replyTo=\{replyTo\}/);
});

test('a quote whose original isn’t loaded is read by id; a deleted one says so', () => {
  assert.match(thread, /fetchMessagesByIds\(\{ conversationId, ids: want \}\)/);
  assert.match(thread, /r\.deleted_at \? \{ id, unavailable: 'deleted' \} : r/);
  assert.match(thread, /onJumpToMessage=\{jumpTo\}/, 'clicking a quote pages back to an old original');
  const bubble = read('../components/MessageBubble.jsx');
  assert.match(bubble, /'Original message deleted' : 'Original message unavailable'/);
});

test('Escape in the composer lets a reply go before it closes anything', () => {
  const composer = read('../components/MessageComposer.jsx');
  assert.match(composer, /if \(e\.key === 'Escape' && replyTo && !mention\) \{ e\.preventDefault\(\); onCancelReply\?\.\(\); return; \}/);
});
