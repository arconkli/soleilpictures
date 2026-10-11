// Spring-loaded folders (lib/springLoad.js): the hold timer, and the drag
// session that survives the drag's source tile being unmounted.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSpring, SPRING_DELAY, beginDragSession, endDragSession, dragSession, onDragSession } from './springLoad.js';

function fakeTimers() {
  let now = 0;
  const q = [];
  return {
    setTimer: (fn, ms) => { const t = { fn, at: now + ms, live: true }; q.push(t); return t; },
    clearTimer: (t) => { if (t) t.live = false; },
    advance(ms) {
      now += ms;
      for (const t of q) if (t.live && t.at <= now) { t.live = false; t.fn(); }
    },
  };
}

test('holding over a target fires after the delay, and reports what is armed', () => {
  const t = fakeTimers();
  const armed = [];
  const s = createSpring({ ...t, onArm: (k) => armed.push(k) });
  let fired = 0;
  s.enter('folder:a', () => fired++);
  t.advance(SPRING_DELAY - 1);
  assert.equal(fired, 0);
  assert.equal(s.armed, 'folder:a');
  t.advance(1);
  assert.equal(fired, 1);
  assert.equal(s.armed, null);
  assert.deepEqual(armed, ['folder:a', null]);
});

test('repeated enters on the same target keep the first timer', () => {
  const t = fakeTimers();
  const s = createSpring(t);
  let fired = 0;
  s.enter('back', () => fired++);
  t.advance(400);
  s.enter('back', () => fired++);   // dragover repeats
  t.advance(300);
  assert.equal(fired, 1);
});

test('moving to another target restarts the hold; leaving cancels it', () => {
  const t = fakeTimers();
  const s = createSpring(t);
  const hits = [];
  s.enter('folder:a', () => hits.push('a'));
  t.advance(500);
  s.enter('folder:b', () => hits.push('b'));
  t.advance(500);
  assert.deepEqual(hits, []);
  t.advance(200);
  assert.deepEqual(hits, ['b']);
  s.enter('folder:c', () => hits.push('c'));
  s.leave('folder:x');               // leaving something else changes nothing
  s.leave('folder:c');
  t.advance(1000);
  assert.deepEqual(hits, ['b']);
});

test('after a spring fires, a still pointer does not arm the next target until it moves', () => {
  const t = fakeTimers();
  const win = { listeners: {}, addEventListener(ty, f) { (this.listeners[ty] ||= new Set()).add(f); }, removeEventListener(ty, f) { this.listeners[ty]?.delete(f); } };
  const over = (x, y) => [...(win.listeners.dragover || [])].forEach((f) => f({ clientX: x, clientY: y }));
  beginDragSession(null, { kind: 'files' }, win);
  const s = createSpring(t);
  const hits = [];
  over(100, 100);
  s.enter('folder:a', () => hits.push('a'));
  t.advance(SPRING_DELAY);
  assert.deepEqual(hits, ['a']);
  // The new folder now under the same point doesn't arm…
  over(101, 100);
  s.enter('folder:b', () => hits.push('b'));
  t.advance(SPRING_DELAY * 2);
  assert.deepEqual(hits, ['a']);
  // …until the pointer moves.
  over(130, 120);
  s.enter('folder:b', () => hits.push('b'));
  t.advance(SPRING_DELAY);
  assert.deepEqual(hits, ['a', 'b']);
  endDragSession(false, win);
});

test('a drag session tells listeners it started and how it ended, and clears the side channels', () => {
  const win = { listeners: {}, addEventListener(t, f) { (this.listeners[t] ||= new Set()).add(f); }, removeEventListener(t, f) { this.listeners[t]?.delete(f); } };
  const events = [];
  const off = onDragSession((e) => events.push([e.type, e.dropped ?? null, e.session.kind]));
  win.__soleilFilesDrag = { sourceBoardId: 'A' };
  beginDragSession(null, { kind: 'files', sourceBoardId: 'A' }, win);
  assert.equal(dragSession()?.kind, 'files');
  // The first mouse move after an HTML5 drag ends it — even with no dragend.
  [...win.listeners.mousemove].forEach((f) => f());
  assert.equal(dragSession(), null);
  assert.deepEqual(events, [['start', null, 'files'], ['end', false, 'files']]);
  assert.equal(win.listeners.mousemove.size, 0);
  // endDragSession on its own window clears what dragover reads.
  beginDragSession(null, { kind: 'folders' }, win);
  win.__soleilBoardDrag = { boardIds: ['x'] };
  endDragSession(true, win);
  assert.equal(win.__soleilBoardDrag, null);
  assert.deepEqual(events.at(-1), ['end', true, 'folders']);
  off();
});
