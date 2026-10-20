// A busy thread stays light: bubbles re-render only when their own message
// changes, times move on by a shared clock, and a send costs no extra reads
// of the conversation list or the pinned list.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const bubble = read('../components/MessageBubble.jsx');
const thread = read('../components/MessageThread.jsx');

test('a bubble is memoized, and nothing it holds changes on every render', () => {
  assert.match(bubble, /export const MessageBubble = memo\(function MessageBubble\(\{/);
  assert.match(bubble, /const body = useMemo\(\(\) => renderMessageBody\(msg\.body, \{/);
  assert.match(bubble, /const mentionNames = useMemo\(\(\) => \{/);
  // The thread hands it the same functions every time.
  assert.match(thread, /const jumpTo = useCallback\(\(msgId\) => jumpToRef\.current\(msgId\), \[\]\);/);
  assert.match(thread, /const handleAttachmentDragStart = attachmentDragStart;/);
  assert.match(read('../components/MessagesPanel.jsx'), /conversation=\{threadConversation\}/);
});

test('hover is the stylesheet’s job, not a re-render per mouse move', () => {
  assert.doesNotMatch(bubble, /setHover|onMouseEnter=|onMouseLeave=/);
  const css = read('../styles.css');
  assert.match(css, /\.msg-bubble:hover \.msg-bubble-actions,\n\.msg-bubble:focus-within \.msg-bubble-actions \{ opacity: 1; \}/);
  assert.match(css, /\.msg-bubble\.is-editing \.msg-bubble-actions,\n\.msg-bubble--pending \.msg-bubble-actions \{ display: none; \}/);
});

test('times and the edit window move on by one shared clock', () => {
  assert.match(bubble, /<RelTime className="msg-bubble-time" iso=\{msg\.created_at\}/);
  assert.match(bubble, /useMinuteNow\(isMine && inEditWindow\);/);
  assert.doesNotMatch(bubble, /formatRelTime\(/);
});

test('a send re-reads neither the conversation list nor the pinned list', () => {
  const deliver = thread.slice(thread.indexOf('const deliverPending = useCallback'), thread.indexOf('const handleSend = useCallback'));
  assert.doesNotMatch(deliver, /onChanged\?\.\(\)/);
  assert.match(thread, /\}, \[conversationId, pinnedSig, pinTick, fixture\]\);/);
  const hook = read('../hooks/useMessageThread.js');
  assert.match(hook, /if \(payload\?\.changed === 'pin'\) setPinTick\(\(t\) => t \+ 1\);/);
});
