// Focus has a home in a conversation, opens there, and goes back there when
// whatever held it goes away — never left on the page where no key reaches
// the conversation.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const thread = read('../components/MessageThread.jsx');
const composer = read('../components/MessageComposer.jsx');

test('home is the box you type in with a mouse and keyboard, the panel itself under a finger', () => {
  assert.match(thread, /if \(composerRef\.current && finePointer\(\)\) composerRef\.current\.focus\(\);\s*else rootRef\.current\?\.focus\(\{ preventScroll: true \}\);/);
  assert.match(read('./composerKeys.js'), /matchMedia\?\.\('\(hover: hover\) and \(pointer: fine\)'\)/);
  assert.match(thread, /<div className="msg-pane msg-pane-thread" ref=\{rootRef\} tabIndex=\{-1\} onFocus=\{\(e\) => \{ lastFocusRef\.current = e\.target; \}\}>/);
});

test('the conversation opens with focus at home, unless something in it already has it', () => {
  assert.match(thread, /if \(!rootRef\.current\?\.contains\(document\.activeElement\)\) focusHome\(\);/);
});

test('focus that goes with its element comes home: in the panel, and in its portals on <body>', () => {
  assert.match(thread, /if \(!had \|\| had\.isConnected\) return;/);
  assert.match(thread, /if \(active && active !== document\.body && active !== document\.documentElement\) return;/);
  assert.match(thread, /inside\.observe\(root, \{ childList: true, subtree: true \}\);/);
  assert.match(thread, /portals\.observe\(document\.body, \{ childList: true \}\);/);
});

test('↑ in an empty box edits your last message, through the same event as `e`', () => {
  assert.match(composer, /if \(e\.key === 'ArrowUp' && !body && !e\.shiftKey && !e\.altKey && !e\.metaKey && !e\.ctrlKey && onEditLast\?\.\(\)\) \{/);
  assert.match(thread, /const m = lastEditableMessage\(messages, userId\);/);
  assert.match(thread, /onEditLast=\{editLast\}/);
});

test('the composer gives the thread focus(), and a picked mention leaves the caret after the name', () => {
  assert.match(composer, /export const MessageComposer = forwardRef\(function MessageComposer\(/);
  assert.match(composer, /focus: \(\) => inputRef\.current\?\.focus\(\{ preventScroll: true \}\),/);
  assert.match(composer, /const caret = before\.length \+ name\.length \+ 2;/);
  assert.match(thread, /ref=\{composerRef\}/);
});
