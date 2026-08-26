// theme.test.mjs — the three-state theme preference.
//
// The regression this exists for: applyThemeNow used to coerce every non-'light'
// input to 'dark' AND write it into the soleil.ui mirror. Presence of `theme` in
// that blob is precisely what marks a choice as EXPLICIT — both here and in the
// pre-React bootstrap in index.html — so writing a resolved colour back made the
// "follow my OS" state unreachable the moment anyone picked once. Settings only
// ever offered two pills, so nobody noticed the third state had no way home.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// Minimal browser surface. theme.js reads localStorage and matchMedia at CALL
// time, not import time, so one import serves every case.
const store = new Map();
const attrs = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.document = {
  documentElement: {
    setAttribute: (k, v) => attrs.set(k, v),
    getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
  },
};
let prefersLight = false;
globalThis.window = { matchMedia: () => ({ matches: prefersLight }) };

const { applyThemeNow, resolveTheme, currentTheme, osPrefersLight } = await import('./theme.js');

const cachedUi = () => {
  const raw = store.get('soleil.ui');
  return raw ? JSON.parse(raw) : {};
};
const reset = () => { store.clear(); attrs.clear(); prefersLight = false; };

test('an explicit choice renders and is cached as itself', () => {
  reset();
  assert.equal(applyThemeNow('light'), 'light');
  assert.equal(attrs.get('data-theme'), 'light');
  assert.equal(cachedUi().theme, 'light');

  assert.equal(applyThemeNow('dark'), 'dark');
  assert.equal(attrs.get('data-theme'), 'dark');
  assert.equal(cachedUi().theme, 'dark');
});

test('System resolves against the OS but caches NOTHING', () => {
  reset();
  prefersLight = true;
  assert.equal(applyThemeNow(null), 'light', 'renders what the OS asked for');
  assert.equal(attrs.get('data-theme'), 'light');
  assert.ok(!('theme' in cachedUi()), 'a resolved colour must not be written back');

  prefersLight = false;
  assert.equal(applyThemeNow(null), 'dark');
  assert.ok(!('theme' in cachedUi()));
});

test('picking System after an explicit choice REMOVES the key', () => {
  // The whole bug in one test. Before the fix this left theme:'dark' behind and
  // the next cold load read it as an explicit choice.
  reset();
  applyThemeNow('dark');
  assert.equal(cachedUi().theme, 'dark');
  applyThemeNow(null);
  assert.ok(!('theme' in cachedUi()), 'System must clear the explicit marker');
});

test('System leaves other ui keys in the mirror alone', () => {
  reset();
  store.set('soleil.ui', JSON.stringify({ theme: 'light', accent: '#ff0000', wheelMode: 'zoom' }));
  applyThemeNow(null);
  const ui = cachedUi();
  assert.ok(!('theme' in ui));
  assert.equal(ui.accent, '#ff0000');
  assert.equal(ui.wheelMode, 'zoom');
});

test('garbage is treated as System, not as dark', () => {
  reset();
  prefersLight = true;
  for (const bad of [undefined, '', 'auto', 'DARK', 0, {}]) {
    assert.equal(applyThemeNow(bad), 'light', `${JSON.stringify(bad)} should follow the OS`);
    assert.ok(!('theme' in cachedUi()), `${JSON.stringify(bad)} should not be cached`);
  }
});

test('resolveTheme: explicit wins, otherwise the OS, otherwise dark', () => {
  prefersLight = false;
  assert.equal(resolveTheme('light'), 'light');
  assert.equal(resolveTheme('dark'), 'dark');
  assert.equal(resolveTheme(null), 'dark');
  prefersLight = true;
  assert.equal(resolveTheme(null), 'light');
  assert.equal(resolveTheme(undefined), 'light');
  assert.equal(resolveTheme('dark'), 'dark', 'an explicit choice ignores the OS');
});

test('currentTheme reads the rendered attribute, defaulting to dark', () => {
  reset();
  assert.equal(currentTheme(), 'dark', 'nothing set yet');
  applyThemeNow('light');
  assert.equal(currentTheme(), 'light');
});

test('osPrefersLight follows matchMedia', () => {
  prefersLight = true;
  assert.equal(osPrefersLight(), true);
  prefersLight = false;
  assert.equal(osPrefersLight(), false);
});
