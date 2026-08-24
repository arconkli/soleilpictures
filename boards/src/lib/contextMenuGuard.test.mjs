// The popover right-click rule, and the one case it must NOT swallow.
//
// The bug being locked down: six popovers stopped propagation without
// preventDefault, so the OS menu opened where the app menu was suppressed and
// which one you got depended on where in the panel you clicked. The fix is not
// "always preventDefault" — over a text field the browser's menu is the correct
// one, and it is the only thing offering Paste, Copy and Look Up. Both halves
// are asserted here.
//
// The predicate is duck-typed over the DOM, so plain objects exercise it
// exactly — same technique as isEditableTarget.test.mjs.

import test from 'node:test';
import assert from 'node:assert/strict';
import { contextMenuAction, swallowContextMenu } from './contextMenuGuard.js';

function el({ tag = 'DIV', editable = false } = {}) {
  return {
    tagName: tag,
    isContentEditable: editable,
    matches: (sel) => editable && sel.includes('contenteditable'),
    closest: (sel) => (editable && sel.includes('contenteditable') ? el({ editable: true }) : null),
  };
}

// A contextmenu event with a recording of what the handler did to it.
function ev(target, path) {
  const rec = { prevented: false, stopped: false };
  return {
    target,
    composedPath: () => path ?? [target],
    preventDefault() { rec.prevented = true; },
    stopPropagation() { rec.stopped = true; },
    rec,
  };
}

test('panel chrome: swallowed — neither menu opens', () => {
  const e = ev(el());
  swallowContextMenu(e);
  assert.equal(contextMenuAction(e), 'swallow');
  assert.equal(e.rec.stopped, true, 'the card menu behind the panel must not open');
  assert.equal(e.rec.prevented, true, 'and neither must the OS menu — this was the bug');
});

test('a text input inside a panel: deferred to the browser', () => {
  // The colour picker hex field. Right-clicking it should offer Paste.
  const e = ev(el({ tag: 'INPUT' }));
  swallowContextMenu(e);
  assert.equal(contextMenuAction(e), 'defer');
  assert.equal(e.rec.prevented, false, 'suppressing this removes the only way to paste a hex');
  assert.equal(e.rec.stopped, true, 'still never reaches the card menu behind the panel');
});

test('a note being edited: deferred, so Paste/Copy/Look Up survive', () => {
  const e = ev(el({ editable: true }));
  assert.equal(contextMenuAction(e), 'defer');
  swallowContextMenu(e);
  assert.equal(e.rec.prevented, false);
});

test('deep target inside an editor is caught via the propagation path', () => {
  // ProseMirror delivers the event on a leaf whose ancestor is the editable
  // one — the exact case a naive target.isContentEditable check falls through.
  const leaf = el();
  const e = ev(leaf, [leaf, el(), el({ editable: true })]);
  assert.equal(contextMenuAction(e), 'defer');
});

test('textarea and select count as editable; a button does not', () => {
  assert.equal(contextMenuAction(ev(el({ tag: 'TEXTAREA' }))), 'defer');
  assert.equal(contextMenuAction(ev(el({ tag: 'SELECT' }))), 'defer');
  assert.equal(contextMenuAction(ev(el({ tag: 'BUTTON' }))), 'swallow');
});

test('stopPropagation happens on every path', () => {
  // The panel is on top. Whatever we decide about the OS menu, the menu for the
  // card *underneath* the panel must never be the answer.
  for (const target of [el(), el({ tag: 'INPUT' }), el({ editable: true })]) {
    const e = ev(target);
    swallowContextMenu(e);
    assert.equal(e.rec.stopped, true, `${target.tagName} should still stop propagation`);
  }
});
