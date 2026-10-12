import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitMenuTop } from './ctxMenuFit.js';

test('a menu that fits where it was asked opens there', () => {
  assert.equal(fitMenuTop(100, 300, 900), 100);
});

test('a menu opened low moves up so its bottom clears the window by the pad', () => {
  // The sweep's tablet case: 652px menu asked at 168 in a 768px window.
  const top = fitMenuTop(168, 652, 768);
  assert.equal(top + 652, 768 - 8);
});

test('content still loading is reserved, so the menu does not jump when it lands', () => {
  assert.equal(fitMenuTop(600, 300, 900, 44), 900 - 8 - 344);
  assert.equal(fitMenuTop(600, 300, 900), 900 - 8 - 300);
});

test('a menu taller than the window starts at the top pad (and scrolls)', () => {
  assert.equal(fitMenuTop(300, 2000, 768), 8);
  assert.equal(fitMenuTop(-40, 100, 768), 8);
});
