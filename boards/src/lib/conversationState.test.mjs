// COMMS-11: a bare right-click on a conversation row left or hid it at once,
// with no confirmation and no undo. A hidden DM's later messages then went
// invisible while still lighting the badge. Now the row has a Hide / Leave
// menu (confirm for a group), the house Undo toast, a hidden DM comes back
// when the other person writes, and a hidden row counts for nothing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hiddenFromInbox, isDmConversation } from './conversationState.js';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const ME = 'me', PEER = 'peer';
const dmParts = (leftAt = null) => [
  { user_id: ME, left_at: leftAt },
  { user_id: PEER, left_at: null },
];

test('an active conversation shows; one that is not yours does not', () => {
  assert.equal(hiddenFromInbox({ conv: {}, me: { user_id: ME, left_at: null }, participants: dmParts() }), false);
  assert.equal(hiddenFromInbox({ conv: {}, me: null, participants: dmParts() }), true);
});

test('a hidden DM stays hidden until the OTHER person writes', () => {
  const left = '2026-10-01T10:00:00Z';
  const me = { user_id: ME, left_at: left };
  const parts = dmParts(left);
  assert.equal(hiddenFromInbox({ conv: { last_message_at: '2026-10-01T09:00:00Z', last_message_sender_id: PEER }, me, participants: parts }), true);
  assert.equal(hiddenFromInbox({ conv: { last_message_at: '2026-10-02T09:00:00Z', last_message_sender_id: ME }, me, participants: parts }), true);
  assert.equal(hiddenFromInbox({ conv: { last_message_at: '2026-10-02T09:00:00Z', last_message_sender_id: PEER }, me, participants: parts }), false);
});

test('a group you left stays gone', () => {
  const left = '2026-10-01T10:00:00Z';
  const parts = [...dmParts(left), { user_id: 'third', left_at: null }];
  assert.equal(hiddenFromInbox({
    conv: { last_message_at: '2026-10-02T09:00:00Z', last_message_sender_id: PEER },
    me: { user_id: ME, left_at: left }, participants: parts,
  }), true);
});

test('a DM is two participant ROWS, however many have left', () => {
  assert.equal(isDmConversation(dmParts('2026-10-01T10:00:00Z')), true);
  assert.equal(isDmConversation([...dmParts(), { user_id: 'x', left_at: '2026-10-01T10:00:00Z' }]), false);
  assert.equal(isDmConversation(null), false);
});

test('a hidden row counts for nothing in the badge', () => {
  const src = read('../hooks/useConversationList.js');
  assert.match(src, /unread\.set\(conv\.conversation_id, !hidden && typeof v === 'number' \? v : 0\)/);
});

test('the row opens a menu instead of leaving on a bare right-click, with confirm and undo', () => {
  const panel = read('../components/MessagesPanel.jsx');
  assert.doesNotMatch(panel, /onContextMenu=\{\(e\) => \{ e\.preventDefault\(\); onHide\(\); \}\}/);
  assert.match(panel, /onMenu\(x, y\)/);
  assert.match(panel, /function ConversationRowMenu/);
  assert.match(panel, /if \(isGroup\) \{\s*const ok = await feedback\.confirm\(/);
  assert.match(panel, /undoToast\(feedback, \{[\s\S]*?rejoinConversation\(/);
  // Leaving from the thread's ⋯ menu gets the same Undo.
  const thread = read('../components/MessageThread.jsx');
  assert.match(thread, /message: 'You left the conversation',\s*onUndo:[\s\S]*?rejoinConversation\(/);
});
