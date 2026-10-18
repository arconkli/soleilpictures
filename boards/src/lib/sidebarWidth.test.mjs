import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SIDEBAR_W, SIDEBAR_W_KEY, clampSidebarWidth, readSidebarWidth,
  writeSidebarWidth, widthFromDrag, widthFromKey, isWideSidebar, toggledSidebarWidth,
} from './sidebarWidth.js';

const memory = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
};

test('clamp rounds into range and defaults on non-finite', () => {
  assert.equal(clampSidebarWidth(100), 240);
  assert.equal(clampSidebarWidth(900), 760);
  assert.equal(clampSidebarWidth(300.6), 301);
  assert.equal(clampSidebarWidth(NaN), 320);
  assert.equal(clampSidebarWidth(undefined), 320);
  assert.equal(clampSidebarWidth(Infinity), 320);
});

test('read/write round-trip and clamp', () => {
  const s = memory();
  assert.equal(readSidebarWidth(s), 320);
  assert.equal(writeSidebarWidth(1000, s), 760);
  assert.equal(s.getItem(SIDEBAR_W_KEY), '760');
  assert.equal(readSidebarWidth(s), 760);
  s.setItem(SIDEBAR_W_KEY, 'junk');
  assert.equal(readSidebarWidth(s), 320);
});

test('missing or throwing storage never throws', () => {
  const bad = { getItem() { throw new Error('no'); }, setItem() { throw new Error('no'); } };
  assert.equal(readSidebarWidth(bad), 320);
  assert.equal(writeSidebarWidth(260, bad), 260);
  assert.equal(readSidebarWidth(undefined), 320);
  assert.equal(writeSidebarWidth(260, null), 260);
});

test('drag and keys', () => {
  assert.equal(widthFromDrag(300, 300, 340), 340);
  assert.equal(widthFromDrag(300, 300, 0), 240);
  assert.equal(widthFromDrag(300, 300, 999), 760);
  assert.equal(widthFromKey(300, 'ArrowLeft'), 300 - SIDEBAR_W.STEP);
  assert.equal(widthFromKey(300, 'ArrowRight'), 300 + SIDEBAR_W.STEP);
  assert.equal(widthFromKey(244, 'ArrowLeft'), 240);
  assert.equal(widthFromKey(300, 'Home'), 240);
  assert.equal(widthFromKey(300, 'End'), 760);
  assert.equal(widthFromKey(300, 'a'), null);
});

test('past SPLIT_AT the sidebar is wide; the expand button jumps between narrow and wide', () => {
  assert.equal(isWideSidebar(SIDEBAR_W.SPLIT_AT - 1), false);
  assert.equal(isWideSidebar(SIDEBAR_W.SPLIT_AT), true);
  assert.equal(toggledSidebarWidth(320), SIDEBAR_W.WIDE);
  assert.equal(toggledSidebarWidth(SIDEBAR_W.WIDE, 300), 300, 'back to the narrow width it came from');
  assert.equal(toggledSidebarWidth(700, null), SIDEBAR_W.DEFAULT);
  assert.equal(toggledSidebarWidth(700, 600), SIDEBAR_W.DEFAULT, 'a remembered width that is itself wide is no way back');
});
