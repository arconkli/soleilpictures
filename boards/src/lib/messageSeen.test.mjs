// "Seen" in a DM: a reader says they've read with a nudge; the other side
// reads everyone's position again from the database, never the payload.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const hook = read('../hooks/useMessageThread.js');

test('marking read tells the others, after the write succeeded', () => {
  assert.match(hook, /if \(ok\) \{\s*onMarkedReadRef\.current\?\.\(\);\s*broadcastConversationRead\(\{ conversationId, userId \}\);/);
  const rt = read('./messageRealtime.js');
  assert.match(rt, /channel\.on\('broadcast', \{ event: 'chat-read'\s*\}, \(\{ payload \}\) => onRead\?\.\(payload\)\);/);
  assert.match(rt, /event: 'chat-read', payload: \{ user_id: userId \}/);
});

test('the receiver reads positions again, from the database, and on every resync', () => {
  assert.match(hook, /const onRead = \(payload\) => \{ if \(payload\?\.user_id !== userId\) refreshReadState\(\); \};/);
  assert.match(hook, /const rows = await fetchReadState\(\{ conversationId \}\);/);
  assert.match(hook, /watchForResync\(\(\) => \{ refetch\(\); refreshReadState\(\); \}\)/);
  const lib = read('./messages.js');
  const fn = lib.slice(lib.indexOf('export async function fetchReadState'));
  assert.match(fn.slice(0, fn.indexOf('\n}\n')), /\.select\('user_id, last_read_at, left_at'\)/);
});

test('Seen is chosen by the feed rules, in a DM only, and drawn under that one message', () => {
  const thread = read('../components/MessageThread.jsx');
  assert.match(thread, /selectSeenMessageId\(messages, \{ selfId: userId, isDm, peerId, peerLastReadAt \}\)/);
  assert.match(thread, /seen=\{g\.msg\.id === seenId\}/);
  const bubble = read('../components/MessageBubble.jsx');
  assert.match(bubble, /\{seen && <div className="msg-bubble-seen">Seen<\/div>\}/);
});
