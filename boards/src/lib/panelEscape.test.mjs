// COMMS-10: Escape inside a control in the Messages panel (edit box, rename,
// link field, ⋯ menu, emoji palette) closed that control AND the whole panel.
// Escape now closes the nearest layer only: a control that handled the key
// claims it with preventDefault, and the panel steps aside.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { escapeClosesPanel } from './panelEscape.js';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

function target({ inPanel = true, tagName = 'BUTTON', value, isContentEditable = false } = {}) {
  return { tagName, value, isContentEditable, closest: (sel) => (inPanel && sel === '.msg-panel' ? {} : null) };
}
const esc = (t, extra = {}) => ({ key: 'Escape', target: t, defaultPrevented: false, isComposing: false, ...extra });

test('an unclaimed Escape with focus in the panel closes it', () => {
  assert.equal(escapeClosesPanel(esc(target()), '.msg-panel'), true);
  assert.equal(escapeClosesPanel(esc(target({ tagName: 'TEXTAREA', value: '' })), '.msg-panel'), true);
});

test('an Escape a nested control claimed does not', () => {
  assert.equal(escapeClosesPanel(esc(target(), { defaultPrevented: true }), '.msg-panel'), false);
  assert.equal(escapeClosesPanel(esc(target(), { isComposing: true }), '.msg-panel'), false);
});

test('a field holding words keeps the panel open', () => {
  assert.equal(escapeClosesPanel(esc(target({ tagName: 'TEXTAREA', value: 'half a reply' })), '.msg-panel'), false);
  assert.equal(escapeClosesPanel(esc(target({ tagName: 'INPUT', value: '  ' })), '.msg-panel'), true);
});

test('a press outside the panel is not the panel\'s', () => {
  assert.equal(escapeClosesPanel(esc(target({ inPanel: false })), '.msg-panel'), false);
  assert.equal(escapeClosesPanel({ key: 'Enter', target: target() }, '.msg-panel'), false);
});

// COMMS-22: "Close (Esc)" was advertised on the Notifications panel and the
// Messages list, and Escape did nothing on either.
test('the Notifications panel and the Messages list close on Escape, and take focus to receive it', () => {
  const ntf = read('../components/NotificationsPanel.jsx');
  assert.match(ntf, /escapeClosesPanel\(e, '\.ntf-panel'\)\) onCloseRef\.current\?\.\(\)/);
  assert.match(ntf, /<div className="ntf-panel" ref=\{rootRef\} tabIndex=\{-1\}>/);
  assert.match(ntf, /rootRef\.current\?\.focus\(\{ preventScroll: true \}\)/);
  const panel = read('../components/MessagesPanel.jsx');
  assert.match(panel, /if \(openConversationId\) return;[\s\S]*?escapeClosesPanel\(e, '\.msg-panel'\)\) onCloseRef\.current\?\.\(\)/);
  // One root for the list and the conversations, focused when the list shows.
  assert.match(panel, /<div className="msg-panel" ref=\{rootRef\} tabIndex=\{-1\} /);
  assert.match(panel, /rootRef\.current\?\.focus\(\{ preventScroll: true \}\)/);
});

test('the nested controls claim Escape', () => {
  const thread = read('../components/MessageThread.jsx');
  assert.match(thread, /if \(e\.key === 'Escape'\) \{ e\.preventDefault\(\); setRenaming\(false\); \}/, 'rename');
  // GroupChatMenu and AddParticipantsPicker
  assert.equal((thread.match(/if \(e\.key === 'Escape'\) \{ e\.preventDefault\(\); onClose\?\.\(\); \}/g) || []).length, 2);
  assert.match(thread, /if \(e\.defaultPrevented \|\| e\.isComposing\) return;/);
  assert.match(thread, /escapeClosesPanel\(e, '\.msg-panel'\)/);
  assert.match(read('../components/EmojiPalette.jsx'), /if \(e\.key === 'Escape'\) \{ e\.preventDefault\(\); onClose\?\.\(\); \}/);
  assert.match(read('../components/NewConversationPicker.jsx'), /if \(e\.key === 'Escape'\) \{ e\.preventDefault\(\); onClose\?\.\(\); \}/);
  assert.match(read('../components/MessageBubble.jsx'), /if \(e\.key === 'Escape'\) \{ e\.preventDefault\(\); setEditing\(false\); return; \}/);
  assert.match(read('../components/MessageComposer.jsx'), /if \(e\.key === 'Escape'\) \{ e\.preventDefault\(\); cancelLink\(\); \}/);
});
