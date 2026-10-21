// A control's shortcut in aria-keyshortcuts' words: the tooltip shows ⌘B, and
// the attribute says which keys that is on this machine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ariaKeys } from './ariaKeys.js';

test('Mod is Meta on a Mac and Control elsewhere, as the editor\'s keymap reads it', () => {
  assert.equal(ariaKeys('Mod+B', true), 'Meta+B');
  assert.equal(ariaKeys('Mod+B', false), 'Control+B');
  assert.equal(ariaKeys('Mod+Shift+Z', true), 'Meta+Shift+Z');
  assert.equal(ariaKeys('Mod+Alt+M', false), 'Control+Alt+M');
});

test('everything else passes through: bare keys, the other modifiers, several shortcuts', () => {
  assert.equal(ariaKeys('V', true), 'V');
  assert.equal(ariaKeys('Shift+1', false), 'Shift+1');
  assert.equal(ariaKeys('Mod+\\', false), 'Control+\\');
  assert.equal(ariaKeys('Mod+= Mod+-', true), 'Meta+= Meta+-');
  assert.equal(ariaKeys('', true), '');
});
