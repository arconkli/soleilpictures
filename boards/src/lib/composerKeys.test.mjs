// Enter in a message field: sends on a desktop keyboard, makes a line on a
// touch one, and never acts mid-composition. The composer and the edit box
// share the rule.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isComposingKey, messageKeyAction } from './composerKeys.js';

const key = (k, extra = {}) => ({ key: k, keyCode: k === 'Enter' ? 13 : 0, ...extra });

test('Enter sends on a desktop keyboard; Shift+Enter or Alt+Enter make a line', () => {
  assert.equal(messageKeyAction(key('Enter')), 'send');
  assert.equal(messageKeyAction(key('Enter', { shiftKey: true })), 'newline');
  assert.equal(messageKeyAction(key('Enter', { altKey: true })), 'newline');
});

test('on a touch keyboard Enter makes a line, and ⌘/Ctrl+Enter still sends', () => {
  assert.equal(messageKeyAction(key('Enter'), { touch: true }), 'newline');
  assert.equal(messageKeyAction(key('Enter', { metaKey: true }), { touch: true }), 'send');
  assert.equal(messageKeyAction(key('Enter', { ctrlKey: true }), { touch: true }), 'send');
});

test('an IME composing a word keeps every key, Enter included', () => {
  assert.equal(messageKeyAction(key('Enter', { isComposing: true })), null);
  assert.equal(messageKeyAction(key('Enter', { nativeEvent: { isComposing: true } })), null, 'React’s event carries it on nativeEvent');
  assert.equal(messageKeyAction(key('Enter', { keyCode: 229 })), null, 'Safari: composition already ended, keyCode 229 remains');
  assert.equal(isComposingKey(key('Escape', { isComposing: true })), true);
  assert.equal(isComposingKey(key('Escape')), false);
});

test('other keys are not the field’s business', () => {
  assert.equal(messageKeyAction(key('a')), null);
  assert.equal(messageKeyAction(key('Escape')), null);
  assert.equal(messageKeyAction(null), null);
});

test('the composer and the edit box both ask the shared rule', () => {
  const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
  for (const file of ['../components/MessageComposer.jsx', '../components/MessageBubble.jsx']) {
    const src = read(file);
    assert.match(src, /if \(isComposingKey\(e\)\) return;/, file);
    assert.match(src, /messageKeyAction\(e, \{ touch: touchKeyboard\(\) \}\) === 'send'/, file);
    assert.doesNotMatch(src, /e\.key === 'Enter' && !e\.shiftKey/, `${file}: no Enter rule of its own`);
  }
});
