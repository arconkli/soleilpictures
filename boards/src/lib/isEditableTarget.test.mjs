// The two editor guards, and the difference between them.
//
// This exists because collapsing them cost real behaviour. `isEditableTarget`
// consults document.activeElement and the live selection — correct for a
// keystroke, which has no meaningful target. Pointer guards were using it too,
// so once a docked document held the caret, EVERY click on the canvas beside it
// answered "you're typing" and returned early. The board rendered perfectly and
// responded to nothing.
//
// The predicate is duck-typed over the DOM (composedPath / tagName /
// isContentEditable / matches / closest), so plain objects exercise it exactly.

import test from 'node:test';
import assert from 'node:assert/strict';
import { isEditableTarget, isEditablePointerTarget } from './isEditableTarget.js';

// A stand-in element. `editable` marks it contenteditable; `ancestorEditable`
// makes closest() report an editable ancestor without putting one in the path.
function el({ tag = 'DIV', editable = false, ancestorEditable = false } = {}) {
  return {
    tagName: tag,
    isContentEditable: editable,
    matches: (sel) => editable && sel.includes('contenteditable'),
    closest: (sel) => ((editable || ancestorEditable) && sel.includes('contenteditable') ? el({ editable: true }) : null),
  };
}
const ev = (target, path) => ({ target, composedPath: () => path ?? [target] });

// Stub the globals the focus-aware fallbacks read. Node has neither.
function withFocus({ activeEditable = false, selectionEditable = false }, fn) {
  const prevDoc = globalThis.document, prevWin = globalThis.window;
  globalThis.document = { activeElement: activeEditable ? el({ editable: true }) : el() };
  globalThis.window = {
    getSelection: () => ({ anchorNode: selectionEditable ? el({ editable: true }) : el() }),
  };
  try { return fn(); } finally { globalThis.document = prevDoc; globalThis.window = prevWin; }
}

test('both guards catch an event that really happened in an editor', () => {
  const target = el({ editable: true });
  assert.equal(isEditablePointerTarget(ev(target)), true);
  assert.equal(isEditableTarget(ev(target)), true);
});

test('both guards catch form fields', () => {
  for (const tag of ['INPUT', 'TEXTAREA', 'SELECT']) {
    assert.equal(isEditablePointerTarget(ev(el({ tag }))), true, tag);
    assert.equal(isEditableTarget(ev(el({ tag }))), true, tag);
  }
});

test('both guards walk the composed path, not just the target', () => {
  // TipTap/ProseMirror deliver events whose target is a plain node inside a
  // contenteditable ancestor — the reason composedPath is the primary signal.
  const inner = el();
  const e = ev(inner, [inner, el({ editable: true })]);
  assert.equal(isEditablePointerTarget(e), true);
  assert.equal(isEditableTarget(e), true);
});

test('THE FIX: a click outside an editor is not editable, even while an editor holds the caret', () => {
  const canvasClick = ev(el());
  withFocus({ activeEditable: true }, () => {
    assert.equal(isEditablePointerTarget(canvasClick), false,
      'a canvas click must stay clickable while a docked doc has focus');
    assert.equal(isEditableTarget(canvasClick), true,
      'the keyboard guard still defers to the focused editor');
  });
});

test('a live selection parked in an editor moves the keyboard guard only', () => {
  const canvasClick = ev(el());
  withFocus({ selectionEditable: true }, () => {
    assert.equal(isEditablePointerTarget(canvasClick), false);
    assert.equal(isEditableTarget(canvasClick), true);
  });
});

test('with focus elsewhere the two agree', () => {
  const canvasClick = ev(el());
  withFocus({}, () => {
    assert.equal(isEditablePointerTarget(canvasClick), false);
    assert.equal(isEditableTarget(canvasClick), false);
  });
});

test('the path scan stops at window/document rather than running off the end', () => {
  const inner = el();
  const e = ev(inner, [inner, globalThis, {}]);
  assert.equal(isEditablePointerTarget(e), false);
});

test('a malformed event is not editable rather than throwing', () => {
  for (const bad of [undefined, null, {}, { composedPath: () => null }, { target: null }]) {
    assert.doesNotThrow(() => isEditablePointerTarget(bad));
    assert.equal(isEditablePointerTarget(bad), false);
  }
});
