// Unit tests for the hardened pointer tracker (lib/pointerStroke.js) — the fix
// for the Apple Pencil canvas freeze. The three behaviours that mattered:
//   1. rAF coalescing  — a 240Hz Pencil must produce ≤1 onSample per frame.
//   2. pointerId filter — a resting palm / 2nd finger must not corrupt or end
//      the stroke.
//   3. pointercancel    — iOS fires this (not pointerup) on palm rejection; the
//      old code leaked window listeners and stuck the canvas in draw mode.
//
// trackStroke only touches window.addEventListener + requestAnimationFrame, so
// minimal controllable shims let the pure logic run in the Node test process.

import { expect, test } from '@playwright/test';
import { trackStroke } from '../src/lib/pointerStroke.js';

function harness() {
  const listeners = { pointermove: [], pointerup: [], pointercancel: [] };
  let rafQueue = [];
  let rafId = 0;
  const prev = {
    window: globalThis.window,
    raf: globalThis.requestAnimationFrame,
    caf: globalThis.cancelAnimationFrame,
  };
  globalThis.window = {
    addEventListener: (t, fn) => { (listeners[t] ||= []).push(fn); },
    removeEventListener: (t, fn) => { listeners[t] = (listeners[t] || []).filter(f => f !== fn); },
  };
  globalThis.requestAnimationFrame = (fn) => { rafId++; rafQueue.push({ id: rafId, fn }); return rafId; };
  globalThis.cancelAnimationFrame = (id) => { rafQueue = rafQueue.filter(r => r.id !== id); };
  return {
    dispatch(type, ev) { (listeners[type] || []).slice().forEach(fn => fn(ev)); },
    flushFrame() { const q = rafQueue; rafQueue = []; q.forEach(r => r.fn()); },
    pendingFrames: () => rafQueue.length,
    liveListeners: () => listeners.pointermove.length + listeners.pointerup.length + listeners.pointercancel.length,
    restore() {
      globalThis.window = prev.window;
      globalThis.requestAnimationFrame = prev.raf;
      globalThis.cancelAnimationFrame = prev.caf;
    },
  };
}

test('rAF-coalesces a burst of moves into one onSample per frame (the latest)', () => {
  const h = harness();
  try {
    const xs = [];
    trackStroke({ pointerId: 1, onSample: (ev) => xs.push(ev.clientX), onEnd: () => {} });
    for (let x = 1; x <= 5; x++) h.dispatch('pointermove', { pointerId: 1, clientX: x, clientY: 0 });
    expect(xs).toEqual([]);          // nothing renders until the frame fires
    h.flushFrame();
    expect(xs).toEqual([5]);         // one sample, carrying the latest position
    h.dispatch('pointermove', { pointerId: 1, clientX: 9, clientY: 0 });
    h.flushFrame();
    expect(xs).toEqual([5, 9]);
  } finally { h.restore(); }
});

test('ignores moves + ups from a different pointer (palm rejection)', () => {
  const h = harness();
  try {
    const xs = []; let ended = null;
    trackStroke({ pointerId: 1, onSample: (ev) => xs.push(ev.clientX), onEnd: (_e, m) => { ended = m; } });
    h.dispatch('pointermove', { pointerId: 2, clientX: 99, clientY: 0 });   // palm
    h.flushFrame();
    expect(xs).toEqual([]);          // palm move ignored
    h.dispatch('pointerup', { pointerId: 2 });                             // palm lift
    expect(ended).toBe(null);        // does NOT end our stroke
    h.dispatch('pointermove', { pointerId: 1, clientX: 7, clientY: 0 });
    h.flushFrame();
    expect(xs).toEqual([7]);
    h.dispatch('pointerup', { pointerId: 1 });
    expect(ended).toEqual({ canceled: false });
  } finally { h.restore(); }
});

test('pointercancel ends the stroke (canceled) AND removes every listener', () => {
  const h = harness();
  try {
    let ended = null;
    trackStroke({ pointerId: 1, onSample: () => {}, onEnd: (_e, m) => { ended = m; } });
    expect(h.liveListeners()).toBe(3);
    h.dispatch('pointercancel', { pointerId: 1 });
    expect(ended).toEqual({ canceled: true });
    // The stuck-canvas bug WAS leaked listeners — assert full teardown.
    expect(h.liveListeners()).toBe(0);
  } finally { h.restore(); }
});

test('pointerup flushes the final queued move and cancels the pending frame', () => {
  const h = harness();
  try {
    const xs = []; let ended = null;
    trackStroke({ pointerId: 1, onSample: (ev) => xs.push(ev.clientX), onEnd: (_e, m) => { ended = m; } });
    h.dispatch('pointermove', { pointerId: 1, clientX: 4, clientY: 0 });   // queues a frame
    expect(h.pendingFrames()).toBe(1);
    h.dispatch('pointerup', { pointerId: 1 });
    expect(xs).toEqual([4]);          // final move applied synchronously at commit
    expect(ended).toEqual({ canceled: false });
    expect(h.pendingFrames()).toBe(0); // the queued rAF was canceled
    h.flushFrame();                    // a late frame must not re-fire onSample
    expect(xs).toEqual([4]);
  } finally { h.restore(); }
});

test('dispose() tears down without calling onEnd (Escape abort), and is idempotent', () => {
  const h = harness();
  try {
    let ended = null;
    const dispose = trackStroke({ pointerId: 1, onSample: () => {}, onEnd: (_e, m) => { ended = m; } });
    dispose();
    expect(ended).toBe(null);          // Escape does its OWN cleanup, not onEnd
    expect(h.liveListeners()).toBe(0);
    h.dispatch('pointerup', { pointerId: 1 });  // post-dispose events are no-ops
    expect(ended).toBe(null);
    dispose();                          // idempotent
  } finally { h.restore(); }
});

test('a null pointerId tracks any pointer (mouse path keeps working)', () => {
  const h = harness();
  try {
    const xs = []; let ended = null;
    trackStroke({ pointerId: null, onSample: (ev) => xs.push(ev.clientX), onEnd: (_e, m) => { ended = m; } });
    h.dispatch('pointermove', { pointerId: 77, clientX: 3, clientY: 0 });
    h.flushFrame();
    expect(xs).toEqual([3]);
    h.dispatch('pointerup', { pointerId: 88 });
    expect(ended).toEqual({ canceled: false });
  } finally { h.restore(); }
});
