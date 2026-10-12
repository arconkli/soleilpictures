// settingsPendingPatch.test.mjs — quick successive Appearance changes don't
// undo each other on the server (ACCOUNT-11), and a dragged colour is written
// once, not per pointer frame (ACCOUNT-03).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { overlayPending, settlePending } from '../components/settings/pendingPatch.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

// Simulate the tab: every write sends the whole `ui` (the RPC replaces it).
function tab(serverUi) {
  let server = { ...serverUi };
  let fetched = { ...serverUi };
  let pending = {};
  const writes = [];
  return {
    setUi(patch) {
      pending = { ...pending, ...patch };
      const body = overlayPending(fetched, pending);
      writes.push(body);
      return body;
    },
    land(body) { server = { ...body }; },
    refetch() { fetched = { ...server }; pending = settlePending(fetched, pending); },
    shown: () => overlayPending(fetched, pending),
    get server() { return server; },
    get pending() { return pending; },
    writes,
  };
}

test('a second change before the refetch keeps the first one', () => {
  const t = tab({ theme: 'dark', sidebarOpen: true });
  const a = t.setUi({ theme: 'light' });
  const b = t.setUi({ sidebarOpen: false });     // refetch has not landed
  t.land(a); t.land(b);
  assert.deepEqual(t.server, { theme: 'light', sidebarOpen: false });
  assert.deepEqual(t.shown(), { theme: 'light', sidebarOpen: false });
});

test('an early refetch does not strip a key the server has not confirmed', () => {
  const t = tab({ theme: 'dark', sidebarOpen: true });
  const a = t.setUi({ theme: 'light' });
  t.land(a);
  t.setUi({ sidebarOpen: false });               // in flight
  t.refetch();                                   // sees only write A
  assert.deepEqual(t.pending, { sidebarOpen: false });
  assert.equal(t.shown().sidebarOpen, false);
  const c = t.setUi({ hideChrome: true });
  assert.deepEqual(c, { theme: 'light', sidebarOpen: false, hideChrome: true });
});

test('confirmed keys settle, and null (follow the OS) counts as confirmed', () => {
  const t = tab({ theme: 'dark' });
  t.land(t.setUi({ theme: null }));
  t.refetch();
  assert.deepEqual(t.pending, {});
  const p = { a: 1 };
  assert.equal(settlePending({ a: 2 }, p), p, 'unchanged pending is returned as-is');
  assert.deepEqual(settlePending({}, { theme: undefined }), {});
});

test('AppearanceTab writes through the pending overlay, not the fetched ui', () => {
  const src = read('../components/settings/AppearanceTab.jsx');
  assert.match(src, /overlayPending\(/);
  assert.match(src, /settlePending\(/);
  assert.doesNotMatch(src, /ui:\s*\{\s*\.\.\.ui,\s*\.\.\.patch\s*\}/);
});

test('colour pickers in Settings hand the tab one value, on close', () => {
  const src = read('../components/settings/fields.jsx');
  // Neither AccentPicker nor SwatchInput may pass the tab's onChange straight
  // to ColorPicker: it fires on every pointermove.
  const pickers = [...src.matchAll(/<ColorPicker[\s\S]*?\/>/g)].map((m) => m[0]);
  assert.equal(pickers.length, 2);
  for (const p of pickers) {
    assert.match(p, /onChange=\{setDraft\}/);
    assert.match(p, /onClose=\{\(\) => \{ setPickerPos\(null\); commit\(\); \}\}/);
  }
});
