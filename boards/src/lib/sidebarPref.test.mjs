// sidebarPref.test.mjs — "Sidebar open by default" now actually does something.
//
// It used to write profiles.settings.ui.sidebarOpen, which NOTHING read; the
// real state lived in the per-device `tweak.compactSidebar` blob. So the toggle
// could be flipped, saved and reloaded with no effect whatsoever. This module is
// the single source of truth now, and these are the rules it has to keep:
// absent means open, only an explicit false collapses, and the mirror survives
// a write so a cold load reads the right value before the profile fetch lands.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const cachedUi = () => {
  const raw = store.get('soleil.ui');
  return raw ? JSON.parse(raw) : {};
};

// The module reads the cache once at import, which is the behaviour under test
// for the seeding cases — so each of those needs its own module instance.
let v = 0;
const freshImport = () => import(`./sidebarPref.js?v=${v++}`);

test('no cache at all: open', async () => {
  store.clear();
  const { getSidebarOpen } = await freshImport();
  assert.equal(getSidebarOpen(), true);
});

test('cache without the key: open — this is the historical default', async () => {
  store.clear();
  store.set('soleil.ui', JSON.stringify({ theme: 'dark', wheelMode: 'zoom' }));
  const { getSidebarOpen } = await freshImport();
  assert.equal(getSidebarOpen(), true);
});

test('only an explicit false collapses', async () => {
  store.clear();
  store.set('soleil.ui', JSON.stringify({ sidebarOpen: false }));
  const { getSidebarOpen } = await freshImport();
  assert.equal(getSidebarOpen(), false);
});

test('sidebarOpen: true seeds open', async () => {
  store.clear();
  store.set('soleil.ui', JSON.stringify({ sidebarOpen: true }));
  const { getSidebarOpen } = await freshImport();
  assert.equal(getSidebarOpen(), true);
});

test('corrupt cache falls back to open rather than throwing', async () => {
  store.clear();
  store.set('soleil.ui', '{not json');
  const { getSidebarOpen } = await freshImport();
  assert.equal(getSidebarOpen(), true);
});

test('apply updates the getter and the mirror in one step', async () => {
  store.clear();
  const { getSidebarOpen, applySidebarOpenNow } = await freshImport();
  assert.equal(applySidebarOpenNow(false), false);
  assert.equal(getSidebarOpen(), false, 'readable synchronously by the next render');
  assert.equal(cachedUi().sidebarOpen, false, 'and by the next cold load');

  assert.equal(applySidebarOpenNow(true), true);
  assert.equal(getSidebarOpen(), true);
  assert.equal(cachedUi().sidebarOpen, true);
});

test('apply leaves the rest of the ui mirror intact', async () => {
  store.clear();
  store.set('soleil.ui', JSON.stringify({ theme: 'light', accent: '#abcdef' }));
  const { applySidebarOpenNow } = await freshImport();
  applySidebarOpenNow(false);
  const ui = cachedUi();
  assert.equal(ui.theme, 'light');
  assert.equal(ui.accent, '#abcdef');
  assert.equal(ui.sidebarOpen, false);
});

test('anything that is not false is open', async () => {
  store.clear();
  const { applySidebarOpenNow } = await freshImport();
  for (const truthy of [true, undefined, null, 1, 'no']) {
    assert.equal(applySidebarOpenNow(truthy), true, `${JSON.stringify(truthy)}`);
  }
  assert.equal(applySidebarOpenNow(false), false);
});
