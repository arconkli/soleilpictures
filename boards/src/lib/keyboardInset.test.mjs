// lib/keyboardInset.js: the keyboard's share of the window, from the visual
// viewport, and nothing where there's no keyboard to measure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keyboardInset } from './keyboardInset.js';

const win = (innerHeight, vv) => ({ innerHeight, visualViewport: vv });

test('no keyboard: the visual viewport is the window', () => {
  assert.equal(keyboardInset(win(834, { height: 834, offsetTop: 0 })), 0);
});

test('a keyboard over the bottom: what the visual viewport lost', () => {
  assert.equal(keyboardInset(win(834, { height: 436.4, offsetTop: 0 })), 398);
});

test('iOS scrolls the visual viewport up into the page: that part is not keyboard', () => {
  assert.equal(keyboardInset(win(834, { height: 436, offsetTop: 120 })), 278);
});

test('a pinch-zoomed page reads no keyboard, wherever it is scrolled', () => {
  assert.equal(keyboardInset(win(834, { height: 417, offsetTop: 0, scale: 2 })), 0);
  assert.equal(keyboardInset(win(834, { height: 417, offsetTop: 417, scale: 2 })), 0);
});

test('no visualViewport, or no window: nothing', () => {
  assert.equal(keyboardInset(win(834, undefined)), 0);
  assert.equal(keyboardInset(null), 0);
});
