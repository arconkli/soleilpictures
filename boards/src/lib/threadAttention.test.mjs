// COMMS-03: a reply in the conversation you were in still reaches you once
// you've closed the panel or looked away.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { showingConversation, tabIsAttended, isWatchingConversation } from './threadAttention.js';

const doc = (visibilityState, focused) => ({ visibilityState, hasFocus: () => focused });
const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

test('quiet only while the thread is on screen in a visible, focused tab', () => {
  const release = showingConversation('c1');
  assert.equal(isWatchingConversation('c1', doc('visible', true)), true);
  assert.equal(isWatchingConversation('c1', doc('hidden', false)), false, 'tab hidden');
  assert.equal(isWatchingConversation('c1', doc('visible', false)), false, 'another app in front');
  assert.equal(isWatchingConversation('c2', doc('visible', true)), false, 'a different conversation');
  release();
  assert.equal(isWatchingConversation('c1', doc('visible', true)), false, 'panel closed / back to list');
});

test('two mounts of one conversation release independently, and a release is idempotent', () => {
  const a = showingConversation('c3');
  const b = showingConversation('c3');
  a(); a();
  assert.equal(isWatchingConversation('c3', doc('visible', true)), true);
  b();
  assert.equal(isWatchingConversation('c3', doc('visible', true)), false);
  assert.equal(tabIsAttended(null), true);
});

test('the inbox asks the thread, not the last-opened id', () => {
  const src = read('../hooks/useInboxLive.js');
  assert.match(src, /isWatchingConversation\(payload\.conversation_id\)/);
  assert.doesNotMatch(src, /payload\.conversation_id === openConvRef\.current/);
  const thread = read('../components/MessageThread.jsx');
  assert.match(thread, /showingConversation\(conversationId\)/);
});

test('a hidden or unfocused thread does not mark itself read', () => {
  const src = read('../hooks/useMessageThread.js');
  assert.match(src, /tabIsAttended\(\)/);
  assert.match(src, /visibilitychange/);
  const effect = src.slice(src.indexOf('markRead({ conversationId, userId') - 400);
  assert.match(effect, /if \(!userId \|\| !conversationId \|\| !attended\) return;/);
  // …and not before the newest message has been on screen.
  assert.match(effect, /if \(!readGate\) return;/);
});
