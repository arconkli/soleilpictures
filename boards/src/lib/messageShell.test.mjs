// One Messages panel for the list and every conversation. Opening one used to
// swap the panel's root for the thread's own, remounting it and replaying its
// entrance on every switch; closing just cut. Now the conversation is a pane
// over the list, the list stays mounted (inert) under it, and closing plays
// an exit.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const panel = read('../components/MessagesPanel.jsx');
const thread = read('../components/MessageThread.jsx');

test('the panel has one root; the list is a pane that stays, inert, under an open conversation', () => {
  assert.doesNotMatch(panel, /if \(openConversationId\) \{\s*return \(/, 'no separate root for a thread');
  assert.match(panel, /<div className="msg-pane msg-pane-list" inert=\{threadOpen \? '' : undefined\}>/);
  assert.match(panel, /\{thread\}/);
  assert.match(thread, /<div className="msg-pane msg-pane-thread"/);
  assert.equal((thread.match(/className="msg-panel"/g) || []).length, 0, 'the thread is not a second panel');
  const css = read('../styles.css');
  assert.match(css, /\.msg-pane-list\[inert\] \{ visibility: hidden; \}/, 'hidden, not display:none, so its scroll is kept');
});

test('closing plays an exit, at once under reduced motion', () => {
  const presence = read('../components/MessagesPresence.jsx');
  assert.match(presence, /if \(!open && \(!mounted \|\| reducedMotion\(\)\)\) return null;/);
  assert.match(presence, /export const PANEL_EXIT_MS = 180;/);
  assert.match(panel, /data-state=\{presence\}/);
  const css = read('../styles.css');
  assert.match(css, /\.msg-panel\[data-state="closing"\] \{\s*animation: msg-panel-out 160ms/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.msg-panel\[data-state="closing"\] \{ animation: none; \}/);
  for (const host of ['../App.jsx', '../local/MessagesQaHarness.jsx']) {
    assert.match(read(host), /<MessagesPresence open=\{[^}]+\}>\{\(\) => createPortal\(\(/, host);
  }
});

test('a conversation playing the exit no longer counts as on screen (its toasts come back)', () => {
  assert.match(thread, /useEffect\(\(\) => \(closing \? undefined : showingConversation\(conversationId\)\), \[conversationId, closing\]\);/);
});
