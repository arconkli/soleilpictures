// Messages under a finger: there's no hover, so a message's actions are a
// press and hold away (a sheet, a finger's size), a conversation's menu too,
// the panel ends above the on-screen keyboard, and its fields are big enough
// that iOS doesn't zoom in on them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const thread = read('../components/MessageThread.jsx');
const panel = read('../components/MessagesPanel.jsx');
const sheet = read('../components/MessageActionSheet.jsx');

test('holding a message opens its actions; the click the hold ends with is eaten; Android’s menu is turned away', () => {
  assert.match(thread, /useLongPress\(scrollRef, \(x, y, e\) => \{/);
  assert.match(thread, /\}, \{ ms: 480, tolerance: 8, pointerType: 'touch' \}\);/);
  assert.match(thread, /swallowNextClick\(\{ held: true \}\);\s*setSheetId\(id\);/);
  assert.match(thread, /if \(!m \|\| m\.sendState \|\| m\.kind === 'system'\) return;/);
  assert.match(thread, /onContextMenu=\{onThreadContextMenu\}/);
  assert.match(thread, /const onThreadContextMenu = \(e\) => \{ if \(Date\.now\(\) - heldAtRef\.current < 1500\) e\.preventDefault\(\); \};/);
});

test('the sheet: reactions, then Reply, Copy text, Copy link, Pin, and Edit and Delete only for your own', () => {
  assert.match(sheet, /QUICK_EMOJIS\.map\(/);
  assert.match(sheet, /const editable = isMine && withinEditWindow\(msg\.created_at\) && !msg\.sendState;/);
  assert.match(sheet, /\{editable && <button/);
  assert.match(sheet, /\{isMine && onDelete && \(/);
  // Sized to what's in it (half the screen hid Edit and Delete on a landscape tablet).
  assert.match(sheet, /<Sheet open onClose=\{onClose\} className="msg-sheet">/);
  assert.match(read('../styles.css'), /\.sheet-root\.msg-sheet \.sheet-panel \{ width: 100%; max-width: 480px; \}/);
});

test('holding a conversation opens its menu, without opening the conversation too', () => {
  assert.match(panel, /useLongPress\(rowRef, \(x, y\) => \{\s*heldAtRef\.current = Date\.now\(\);\s*swallowNextClick\(\{ held: true \}\);\s*onMenu\(x, y\);/);
  assert.match(panel, /if \(Date\.now\(\) - heldAtRef\.current < 1500\) return;/);
});

test('the panel ends above the on-screen keyboard', () => {
  assert.match(panel, /const keyboard = useKeyboardInset\(presence === 'open' && touchKeyboard\(\)\);/);
  assert.match(panel, /style=\{keyboard > 0 \? \{ bottom: keyboard \+ 8 \} : undefined\}/);
});

test('the stylesheets: no hover chip under a finger, no stray selector, and 16px fields', () => {
  const css = read('../styles.css');
  const touch = css.slice(css.indexOf('@media (hover: none) and (pointer: coarse) {', css.indexOf('Hover-reveal affordances') - 2000));
  assert.match(touch, /\.msg-bubble-actions \{ display: none !important; \}/);
  assert.doesNotMatch(css, /\.msg-row-actions/, 'that selector matched nothing');
  // WebKit inherits user-select: the edit box inside a bubble has to take it back.
  assert.match(touch, /\.msg-bubble textarea \{ -webkit-touch-callout: default; -webkit-user-select: text; user-select: text; \}/);
  assert.match(css, /@media \(pointer: coarse\) \{\s*\.msg-composer-input,\s*\.msg-search-input,/);
  const card = read('../components/messagesCard.css');
  assert.match(card, /@media \(pointer: coarse\) \{\s*\.msg-find input, body\[data-sb-files\] \.msg-search-input \{ font-size: 16px; \}/);
  // After the card's own 13.5px for the box, or that one wins.
  const sized = card.indexOf('body[data-sb-files] .msg-composer .msg-composer-input {');
  const bumped = card.indexOf('  body[data-sb-files] .msg-composer .msg-composer-input { font-size: 16px; }');
  assert.ok(sized > -1 && bumped > sized, 'the 16px rule comes after the 13.5px one');
});
