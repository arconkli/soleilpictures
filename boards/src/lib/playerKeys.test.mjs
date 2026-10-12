// playerKeys.test.mjs — the review player's key map (lib/playerKeys.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { playerAction, shouldHandleKey, actionName, PLAYER_KEYS } from './playerKeys.js';

const k = (key, extra = {}) => ({ key, code: extra.code || '', shiftKey: false, altKey: false, metaKey: false, ctrlKey: false, ...extra });

test('transport keys', () => {
  assert.equal(playerAction(k(' ')), 'toggle');
  assert.equal(playerAction(k(' ', { shiftKey: true })), 'playInOut');
  assert.equal(playerAction(k('ArrowRight')), 'fwd1f');
  assert.equal(playerAction(k('ArrowLeft')), 'back1f');
  assert.equal(playerAction(k('ArrowRight', { shiftKey: true })), 'fwd1s');
  assert.equal(playerAction(k('ArrowLeft', { shiftKey: true })), 'back1s');
  assert.equal(playerAction(k(',')), 'back1f');
  assert.equal(playerAction(k('.')), 'fwd1f');
  assert.equal(playerAction(k('<', { shiftKey: true })), 'slower');
  assert.equal(playerAction(k('>', { shiftKey: true })), 'faster');
  assert.equal(playerAction(k('Home')), 'start');
  assert.equal(playerAction(k('End')), 'end');
  assert.equal(playerAction(k('Escape')), 'escape');
  assert.equal(playerAction(k('\\')), 'compare');
  assert.equal(playerAction(k('?', { shiftKey: true })), 'help');
});

test('J/K/L shuttle, and K held inches a frame', () => {
  assert.equal(playerAction(k('l')), 'shuttleFwd');
  assert.equal(playerAction(k('J')), 'shuttleBack');
  assert.equal(playerAction(k('k')), 'stop');
  assert.equal(playerAction(k('l'), { kHeld: true }), 'fwd1f');
  assert.equal(playerAction(k('j'), { kHeld: true }), 'back1f');
});

test('⌥ chords match the physical key (⌥L types ¬ on a Mac)', () => {
  assert.equal(playerAction(k('¬', { altKey: true, code: 'KeyL' })), 'loop');
  assert.equal(playerAction(k('≈', { altKey: true, code: 'KeyX' })), 'clearInOut');
  assert.equal(playerAction(k('≠', { altKey: true, code: 'Equal' })), 'zoomIn');
  assert.equal(playerAction(k('–', { altKey: true, code: 'Minus' })), 'zoomOut');
  assert.equal(playerAction(k('º', { altKey: true, code: 'Digit0' })), 'zoomFit');
  assert.equal(playerAction(k('a', { altKey: true, code: 'KeyA' })), null);
});

test('⌘C copies the timecode; other ⌘ chords are the app’s', () => {
  assert.equal(playerAction(k('c', { metaKey: true })), 'copyTc');
  assert.equal(playerAction(k('c', { ctrlKey: true, shiftKey: true })), 'copyLink');
  assert.equal(playerAction(k('l', { metaKey: true })), null);
  assert.equal(playerAction(k('f', { ctrlKey: true })), null);
  assert.equal(playerAction(null), null);
});

test('marking, view, and typing a timecode', () => {
  assert.equal(playerAction(k('i')), 'markIn');
  assert.equal(playerAction(k('O', { shiftKey: true })), 'goOut');
  assert.equal(playerAction(k('I', { shiftKey: true })), 'goIn');
  assert.equal(playerAction(k('Z', { shiftKey: true })), 'zoomRange');
  assert.equal(playerAction(k('z')), 'pictureZoom');
  assert.equal(playerAction(k('m')), 'mute');
  assert.equal(playerAction(k('f')), 'fullscreen');
  assert.equal(playerAction(k('g')), 'guides');
  assert.equal(playerAction(k('ArrowUp', { shiftKey: true })), 'volUp');
  assert.equal(playerAction(k('ArrowDown', { shiftKey: true })), 'volDown');
  assert.deepEqual(playerAction(k('4')), { action: 'tcEntry', seed: '4' });
  assert.deepEqual(playerAction(k('+', { shiftKey: true })), { action: 'tcEntry', seed: '+' });
  assert.deepEqual(playerAction(k('-')), { action: 'tcEntry', seed: '-' });
  assert.equal(actionName({ action: 'tcEntry', seed: '4' }), 'tcEntry');
});

test('not while typing, not Space on a button, and only steps repeat', () => {
  const on = (tag, extra = {}) => ({ ...k(' '), target: { tagName: tag }, ...extra });
  assert.equal(shouldHandleKey(on('INPUT'), 'toggle'), false);
  assert.equal(shouldHandleKey(on('SELECT'), 'toggle'), false);
  assert.equal(shouldHandleKey(on('BUTTON'), 'toggle'), false);
  assert.equal(shouldHandleKey({ ...k('ArrowRight'), target: { tagName: 'BUTTON' } }, 'fwd1f'), true);
  assert.equal(shouldHandleKey({ ...k('x'), target: { tagName: 'DIV', isContentEditable: true } }, 'x'), false);
  assert.equal(shouldHandleKey(on('DIV'), 'toggle'), true);
  assert.equal(shouldHandleKey({ ...k('l'), repeat: true, target: { tagName: 'DIV' } }, 'shuttleFwd'), false);
  assert.equal(shouldHandleKey({ ...k('ArrowRight'), repeat: true, target: { tagName: 'DIV' } }, 'fwd1f'), true);
  assert.equal(shouldHandleKey({ ...k('4'), target: { tagName: 'DIV' } }, null), false);
});

test('every shipped row is in the docs and the app’s shortcuts overlay; future rows in neither', () => {
  const docs = readFileSync(new URL('../../content/docs/keyboard-shortcuts.md', import.meta.url), 'utf8');
  const section = docs.slice(docs.indexOf('## Player'), docs.indexOf('\n## ', docs.indexOf('## Player') + 5));
  const overlay = readFileSync(new URL('../components/ShortcutsOverlay.jsx', import.meta.url), 'utf8');
  for (const row of PLAYER_KEYS) {
    if (row.future) {
      assert.ok(!section.includes(row.label), `future row "${row.label}" is not documented yet`);
      continue;
    }
    assert.ok(section.includes(row.label), `docs Player section lists "${row.label}"`);
    assert.ok(overlay.includes(row.label), `ShortcutsOverlay lists "${row.label}"`);
  }
});
