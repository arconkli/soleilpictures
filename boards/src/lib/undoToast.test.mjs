// undoToast guard logic: the toast may only fire its undo while the delete's
// own stack item is still top-of-stack — otherwise it must explain, never
// revert whatever happens to be newest (the bug the helper exists to fix).
import test from 'node:test';
import assert from 'node:assert/strict';
import { undoToast } from './undoToast.js';

function fakeFeedback() {
  const calls = [];
  return {
    calls,
    toast(opts) { calls.push(opts); },
  };
}

test('closure mode (no stack item) fires onUndo directly', () => {
  const fb = fakeFeedback();
  let fired = 0;
  undoToast(fb, { message: 'Deleted', onUndo: () => { fired++; } });
  assert.equal(fb.calls.length, 1);
  fb.calls[0].action.onClick();
  assert.equal(fired, 1);
});

test('guarded mode fires only while the item is top-of-stack', () => {
  const fb = fakeFeedback();
  const item = { id: 'step' };
  const um = { undoStack: [item] };
  let fired = 0;
  undoToast(fb, { message: 'Deleted', undoManager: um, stackItem: item, onUndo: () => { fired++; } });
  fb.calls[0].action.onClick();
  assert.equal(fired, 1);
});

test('guarded mode refuses when a newer action superseded the delete', () => {
  const fb = fakeFeedback();
  const item = { id: 'step' };
  const um = { undoStack: [item, { id: 'newer' }] };
  let fired = 0;
  undoToast(fb, { message: 'Deleted', undoManager: um, stackItem: item, onUndo: () => { fired++; } });
  fb.calls[0].action.onClick();
  assert.equal(fired, 0, 'must not undo the wrong action');
  // …and it says so instead of failing silently.
  assert.equal(fb.calls.length, 2);
  assert.match(fb.calls[1].message, /changed since/i);
});

test('no message or no feedback is a silent no-op', () => {
  const fb = fakeFeedback();
  undoToast(fb, { onUndo: () => {} });
  assert.equal(fb.calls.length, 0);
  undoToast(null, { message: 'x', onUndo: () => {} });
});

test('another way on goes before Undo, and Undo still guards its step', () => {
  const fb = fakeFeedback();
  let put = 0, fired = 0;
  undoToast(fb, { message: 'Moved', also: [{ label: 'Put on board', onClick: () => { put++; } }, null], onUndo: () => { fired++; } });
  const [t] = fb.calls;
  assert.equal(t.action, undefined);
  assert.deepEqual(t.actions.map((a) => a.label), ['Put on board', 'Undo']);
  t.actions[0].onClick();
  t.actions[1].onClick();
  assert.deepEqual([put, fired], [1, 1]);
  undoToast(fb, { message: 'Moved', also: [], onUndo: () => {} });
  assert.equal(fb.calls[1].action.label, 'Undo', 'nothing else: the one Undo, as before');
});
