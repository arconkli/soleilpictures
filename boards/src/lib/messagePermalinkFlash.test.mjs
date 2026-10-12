// COMMS-09: a permalinked message was re-scrolled to and flashed on EVERY new
// message (the effect keyed on messages.length), yanking the reader up from
// the bottom and closing any open search — and the pending jump outlived its
// conversation. It now flashes once, when its page is on screen, and is then
// consumed; a jump only ever applies to its own conversation.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

test('the flash keys on the target being loaded, not on the message count', () => {
  const src = read('../components/MessageThread.jsx');
  assert.doesNotMatch(src, /\}, \[jumpToMessageId, messages\.length\]\);/);
  assert.match(src, /\}, \[jumpToMessageId, jumpTargetLoaded, conversationId\]\);/);
  assert.match(src, /jumpDoneRef\.current = key;\s*flashMessage\(jumpToMessageId\);\s*onJumpConsumed\?\.\(\);/);
});

test('the panel consumes the jump and scopes it to its conversation', () => {
  const src = read('../components/MessagesPanel.jsx');
  assert.match(src, /jumpToMessageId=\{pendingJump\?\.convId === openConversationId \? pendingJump\.messageId : null\}/);
  assert.match(src, /onJumpConsumed=\{\(\) => setPendingJump\(null\)\}/);
});
