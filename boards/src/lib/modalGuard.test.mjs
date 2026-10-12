// modalGuard.test.mjs — the overlay registry.
//
//   node --test src/lib/modalGuard.test.mjs
//
// anyModalOpen() is what makes the canvas shortcuts stand down; the stack
// order is what makes Escape and Back close only the TOP layer.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  registerModalOpen, anyModalOpen, isTopModal, handleEscapeKey,
  registerBackLayer, __resetModalGuardForTests,
  focusablesIn, trapTabKey,
} from './modalGuard.js';

const esc = (extra = {}) => ({
  key: 'Escape', defaultPrevented: false, isComposing: false,
  prevented: false, stopped: false,
  preventDefault() { this.prevented = true; this.defaultPrevented = true; },
  stopPropagation() { this.stopped = true; },
  ...extra,
});

beforeEach(() => { __resetModalGuardForTests(); });

test('anyModalOpen counts stacked layers and the returned function unregisters', () => {
  assert.equal(anyModalOpen(), false);
  const a = registerModalOpen();
  const b = registerModalOpen();
  assert.equal(anyModalOpen(), true);
  a();
  assert.equal(anyModalOpen(), true, 'the other layer is still open');
  b();
  assert.equal(anyModalOpen(), false);
  b();
  assert.equal(anyModalOpen(), false, 'unregistering twice is harmless');
});

test('Escape closes only the top layer', () => {
  const closed = [];
  const settings = registerModalOpen({ onEscape: () => closed.push('settings') });
  const pricing = registerModalOpen({ onEscape: () => closed.push('pricing') });
  const e = esc();
  assert.equal(handleEscapeKey(e), true);
  assert.deepEqual(closed, ['pricing']);
  assert.equal(e.prevented, true);
  pricing();
  handleEscapeKey(esc());
  assert.deepEqual(closed, ['pricing', 'settings']);
  settings();
});

test('a top layer that handles its own Escape shields the layer beneath', () => {
  const closed = [];
  registerModalOpen({ onEscape: () => closed.push('settings') });
  // A feedback confirm (or a Modal) on top, with no onEscape of its own here.
  const confirm = registerModalOpen();
  assert.equal(handleEscapeKey(esc()), false);
  assert.deepEqual(closed, []);
  assert.equal(isTopModal(confirm), true);
});

test('Escape already handled nearer the focus, or mid-composition, is left alone', () => {
  const closed = [];
  registerModalOpen({ onEscape: () => closed.push('x') });
  assert.equal(handleEscapeKey(esc({ defaultPrevented: true })), false);
  assert.equal(handleEscapeKey(esc({ isComposing: true })), false);
  assert.equal(handleEscapeKey({ key: 'Backspace' }), false);
  assert.deepEqual(closed, []);
});

test('onEscape can decline (a nested popover is still open)', () => {
  registerModalOpen({ onEscape: () => false });
  const e = esc();
  assert.equal(handleEscapeKey(e), false);
  assert.equal(e.prevented, false);
});

test('isTopModal follows the stack', () => {
  const a = registerModalOpen();
  assert.equal(isTopModal(a), true);
  const b = registerModalOpen();
  assert.equal(isTopModal(a), false);
  b();
  assert.equal(isTopModal(a), true);
});

// ── Back ───────────────────────────────────────────────────────────────

function fakeBrowser() {
  const listeners = {};
  const entries = [{ state: null, url: 'https://x.test/b/1' }];
  let idx = 0;
  const location = { get href() { return entries[idx].url; } };
  const history = {
    get state() { return entries[idx].state; },
    pushState(state, _t, url) { entries.splice(idx + 1); entries.push({ state, url: url || entries[idx].url }); idx += 1; },
    replaceState(state, _t, url) { entries[idx] = { state, url: url || entries[idx].url }; },
    go(n) { idx = Math.max(0, idx + n); queueMicrotask(() => (listeners.popstate || []).forEach(f => f({}))); },
    back() { this.go(-1); },
  };
  globalThis.window = {
    history, location,
    addEventListener: (t, f) => { (listeners[t] ||= []).push(f); },
  };
  return { entries, get idx() { return idx; }, history, back: () => history.back() };
}
const tick = () => new Promise(r => setTimeout(r, 0));

test('Back closes the top layer instead of leaving the app', async () => {
  const b = fakeBrowser();
  const closed = [];
  registerBackLayer(() => closed.push('drawer'));
  registerBackLayer(() => closed.push('sheet'));
  await tick();
  assert.equal(b.entries.length, 3, 'one entry per open layer');
  b.back();
  await tick();
  assert.deepEqual(closed, ['sheet']);
  b.back();
  await tick();
  assert.deepEqual(closed, ['sheet', 'drawer']);
  delete globalThis.window;
});

test('closing a layer by the UI consumes its entry and keeps a URL the app changed', async () => {
  const b = fakeBrowser();
  const closed = [];
  const off = registerBackLayer(() => closed.push('drawer'));
  await tick();
  assert.equal(b.idx, 1);
  // Opening a cluster from the drawer: App replaceState-s the new URL.
  b.history.replaceState(null, '', 'https://x.test/b/2');
  off();
  await tick(); await tick();
  assert.equal(b.idx, 0, 'the layer entry was consumed');
  assert.equal(b.entries[0].url, 'https://x.test/b/2', 'the current URL survives');
  assert.deepEqual(closed, [], 'the traversal we caused is not a Back');
  delete globalThis.window;
});

test('a layer opened and closed in the same tick leaves no history behind', async () => {
  const b = fakeBrowser();
  const off = registerBackLayer(() => {});
  off();
  registerBackLayer(() => {});   // StrictMode remount
  await tick();
  assert.equal(b.entries.length, 2);
  delete globalThis.window;
});

// ── Tab trap ───────────────────────────────────────────────────────────
// Shared by Modal.jsx and Settings (VS-PANELS-02: Settings had none, so Tab
// walked the app behind its backdrop).

function fakePanel(n) {
  const body = { id: 'body' };
  const doc = { body, activeElement: body };
  const mk = (id) => ({ id, getClientRects: () => [1], focus() { doc.activeElement = this; } });
  const nodes = Array.from({ length: n }, (_, i) => mk(`b${i}`));
  const panel = { querySelectorAll: () => nodes, focus() { doc.activeElement = panel; } };
  globalThis.document = doc;
  return { doc, nodes, panel };
}
const tab = (shiftKey = false) => ({
  key: 'Tab', shiftKey, prevented: false, preventDefault() { this.prevented = true; },
});

test('Tab wraps from the last control to the first, Shift+Tab the other way', () => {
  const { doc, nodes, panel } = fakePanel(3);
  nodes[2].focus();
  const e = tab();
  trapTabKey(e, panel);
  assert.equal(e.prevented, true);
  assert.equal(doc.activeElement, nodes[0]);
  trapTabKey(tab(true), panel);
  assert.equal(doc.activeElement, nodes[2]);
  // In the middle the browser moves focus itself.
  nodes[1].focus();
  const mid = tab();
  trapTabKey(mid, panel);
  assert.equal(mid.prevented, false);
  delete globalThis.document;
});

test('Tab with focus lost to <body> pulls it back into the panel', () => {
  const { doc, nodes, panel } = fakePanel(2);
  const e = tab();
  trapTabKey(e, panel);
  assert.equal(e.prevented, true);
  assert.equal(doc.activeElement, nodes[0]);
  // Nothing focusable inside: the panel itself takes it.
  const empty = fakePanel(0);
  trapTabKey(tab(), empty.panel);
  assert.equal(empty.doc.activeElement, empty.panel);
  delete globalThis.document;
});

test('focusablesIn skips controls that are not rendered', () => {
  const { nodes, panel } = fakePanel(2);
  nodes[1].getClientRects = () => [];
  assert.deepEqual(focusablesIn(panel), [nodes[0]]);
  assert.deepEqual(focusablesIn(null), []);
  delete globalThis.document;
});
