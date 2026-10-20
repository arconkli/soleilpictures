// A peer's broadcast names a message; the thread re-reads that row from the
// database instead of re-reading 200 (or trusting the payload), and going
// back to a conversation paints its last rows at once.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getCachedThread, putCachedThread, clearThreadCache, THREAD_CACHE_MAX } from './threadCache.js';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

test('a nudge re-reads the named rows, deleted ones included, and says when the read failed', () => {
  const lib = read('./messages.js');
  const fn = lib.slice(lib.indexOf('export async function fetchMessagesByIds'));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  assert.match(body, /\.eq\('conversation_id', conversationId\)/);
  assert.match(body, /\.in\('id', list\)/);
  assert.doesNotMatch(body, /deleted_at/, 'a delete has to come back so the row can leave the screen');
  assert.match(body, /if \(error\) \{[^\n]*return null; \}/);
});

test('the thread never paints a broadcast payload; it re-reads by id', () => {
  const src = read('../hooks/useMessageThread.js');
  const effect = src.slice(src.indexOf('// Realtime subscribe.'));
  assert.doesNotMatch(effect, /const onMessage = \(\) => refetch\(\)/, 'no 200-row read per peer event');
  assert.match(effect, /const rows = await fetchMessagesByIds\(\{ conversationId, ids \}\);/);
  assert.match(effect, /if \(payload\?\.changed === 'participants'\) \{ resync\.kick\(\); return; \}/);
  assert.match(effect, /nudge\(payload\?\.id\);/);
  assert.doesNotMatch(effect, /payload\.body|payload\?\.body/, 'content comes from the database, never the payload');
});

test('a peer’s message clears their typing indicator', () => {
  const src = read('../hooks/useMessageThread.js');
  assert.match(src, /if \(payload\?\.sender_id\) clearTyping\(payload\.sender_id\);/);
});

test('the thread is keyed by conversation, so nothing carries over on a switch', () => {
  const panel = read('../components/MessagesPanel.jsx');
  assert.match(panel, /<MessageThread\s+(?:\/\/[^\n]*\n\s*)*key=\{openConversationId\}/);
});

test('the revisit cache keeps the last few conversations for one user', () => {
  clearThreadCache();
  const entry = (n) => ({ rows: [{ id: `m${n}` }], hasOlder: false });
  for (let i = 0; i < THREAD_CACHE_MAX + 2; i += 1) putCachedThread('me', `c${i}`, entry(i));
  assert.equal(getCachedThread('me', 'c0'), null, 'the oldest fell out');
  assert.deepEqual(getCachedThread('me', 'c9').rows, [{ id: 'm9' }]);
  assert.equal(getCachedThread('someone-else', 'c9'), null, 'never another user’s rows');
  putCachedThread('someone-else', 'x', entry(1));
  assert.equal(getCachedThread('me', 'c9'), null, 'a new user starts empty');
  clearThreadCache();
});

test('the cache holds server rows only, never sends in flight or optimistic changes', () => {
  const src = read('../hooks/useMessageThread.js');
  assert.match(src, /putCachedThread\(userId, conversationId, \{\s*rows: messagesRef\.current\.filter/);
});
