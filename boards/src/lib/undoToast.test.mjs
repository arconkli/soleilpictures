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
