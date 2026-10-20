// The shell a device gets (lib/deviceShell.js), and that everything deciding
// it asks the same rule — a harness that decided by width alone drew a
// portrait iPad as a broken desktop and a landscape one without touch sizes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { shellOf } from './deviceShell.js';

test('phones and touch tablets up to 1024px get the mobile shell', () => {
  assert.deepEqual(shellOf({ isPhone: true, isTouch: true }), { mobileShell: true, coarse: true });
  // A narrow desktop window is still a phone-width layout.
  assert.deepEqual(shellOf({ isPhone: true }), { mobileShell: true, coarse: false });
  // A portrait iPad (834 wide) and a 1024-wide landscape one.
  assert.deepEqual(shellOf({ isTablet: true, isTouch: true }), { mobileShell: true, coarse: true });
});

test('a wide touch iPad keeps the desktop layout, with touch sizes', () => {
  assert.deepEqual(shellOf({ isTouch: true }), { mobileShell: false, coarse: true });
});

test('a mouse at tablet or desktop width is a desktop', () => {
  assert.deepEqual(shellOf({ isTablet: true }), { mobileShell: false, coarse: false });
  assert.deepEqual(shellOf({}), { mobileShell: false, coarse: false });
  assert.deepEqual(shellOf(), { mobileShell: false, coarse: false });
});

test('App, the local app, the canvas and the sidebar harness all ask shellOf', () => {
  for (const file of ['../App.jsx', '../local/LocalBoardsApp.jsx', '../components/CanvasSurface.jsx', '../local/SidebarQaHarness.jsx']) {
    const src = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.match(src, /shellOf\(/, `${file} decides its shell with shellOf`);
    assert.doesNotMatch(src, /isPhone \|\| \(isTablet && isTouch\)/, `${file} repeats the rule by hand`);
  }
});
