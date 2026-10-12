// playerKeys.test.mjs — the review player's key map (lib/playerKeys.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { playerAction } from './playerKeys.js';

const k = (key, extra = {}) => ({ key, code: extra.code || '', shiftKey: false, altKey: false, metaKey: false, ctrlKey: false, ...extra });

test('transport keys', () => {
  assert.equal(playerAction(k(' ')), 'toggle');
  assert.equal(playerAction(k('ArrowRight')), 'fwd1f');
  assert.equal(playerAction(k('ArrowLeft')), 'back1f');
  assert.equal(playerAction(k('ArrowRight', { shiftKey: true })), 'fwd1s');
  assert.equal(playerAction(k('ArrowLeft', { shiftKey: true })), 'back1s');
  assert.equal(playerAction(k('Home')), 'start');
  assert.equal(playerAction(k('End')), 'end');
  assert.equal(playerAction(k('Escape')), 'escape');
  assert.equal(playerAction(k('\\')), 'compare');
});

test('J/K/L shuttle, and K held inches a frame', () => {
  assert.equal(playerAction(k('l')), 'shuttleFwd');
  assert.equal(playerAction(k('J')), 'shuttleBack');
  assert.equal(playerAction(k('k')), 'stop');
  assert.equal(playerAction(k('l'), { kHeld: true }), 'fwd1f');
  assert.equal(playerAction(k('j'), { kHeld: true }), 'back1f');
});

test('⌥ letters match the physical key (⌥L types ¬ on a Mac)', () => {
  assert.equal(playerAction(k('¬', { altKey: true, code: 'KeyL' })), 'loop');
  assert.equal(playerAction(k('≈', { altKey: true, code: 'KeyX' })), 'clearInOut');
  assert.equal(playerAction(k('a', { altKey: true, code: 'KeyA' })), null);
});

test('⌘ and Ctrl chords are left to the browser and the app', () => {
  assert.equal(playerAction(k('l', { metaKey: true })), null);
  assert.equal(playerAction(k('f', { ctrlKey: true })), null);
  assert.equal(playerAction(null), null);
});

test('in/out, mute, full screen, guides', () => {
  assert.equal(playerAction(k('i')), 'markIn');
  assert.equal(playerAction(k('o')), 'markOut');
  assert.equal(playerAction(k('m')), 'mute');
  assert.equal(playerAction(k('f')), 'fullscreen');
  assert.equal(playerAction(k('g')), 'guides');
});
