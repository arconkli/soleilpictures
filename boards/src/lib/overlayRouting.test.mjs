// Which open doc a ⌘Z (pressed outside its text) undoes the page structure of.
// A doc over everything (fullscreen, the sketch pad) takes it while it is up.
// A doc in a pane beside the canvas takes it only while the keyboard is in its
// pane: with a doc docked, ⌘Z on the canvas used to undo the doc's pages, and
// never the canvas, because any open doc stood the canvas down.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pushDocUndoTarget, removeDocUndoTarget, getDocUndoTarget, setDocUndoTarget } from './overlayRouting.js';
import { setActivePane } from './activePane.js';

const docked = { name: 'docked' };
const beside = { name: 'beside' };
const full = { name: 'full' };

beforeEach(() => { setDocUndoTarget(null); setActivePane('main'); });

test('a doc docked in the split pane takes ⌘Z only while the keyboard is in that pane', () => {
  pushDocUndoTarget(docked, 'split');
  assert.equal(getDocUndoTarget(), null, 'the canvas keeps its own ⌘Z');
  setActivePane('split');
  assert.equal(getDocUndoTarget(), docked);
  setActivePane('main');
  assert.equal(getDocUndoTarget(), null);
});

test('two docs side by side: each takes ⌘Z in its own pane', () => {
  pushDocUndoTarget(docked, 'split');
  pushDocUndoTarget(beside, 'beside');
  setActivePane('split');
  assert.equal(getDocUndoTarget(), docked, 'not the one opened last');
  setActivePane('beside');
  assert.equal(getDocUndoTarget(), beside);
});

test('a doc over everything takes ⌘Z whichever pane the keyboard was in, and hands it back', () => {
  pushDocUndoTarget(docked, 'split');
  setActivePane('split');
  pushDocUndoTarget(full);
  assert.equal(getDocUndoTarget(), full);
  setActivePane('main');
  assert.equal(getDocUndoTarget(), full);
  removeDocUndoTarget(full);
  assert.equal(getDocUndoTarget(), null);
  setActivePane('split');
  assert.equal(getDocUndoTarget(), docked);
});

test('a doc over everything keeps ⌘Z when a doc in a pane registers after it', () => {
  pushDocUndoTarget(full);
  pushDocUndoTarget(docked, 'split');
  setActivePane('split');
  assert.equal(getDocUndoTarget(), full, 'the docked doc is under it');
});

test('with no pane given, the last one opened takes it, as before', () => {
  const a = {}; const b = {};
  pushDocUndoTarget(a);
  pushDocUndoTarget(b);
  assert.equal(getDocUndoTarget(), b);
  removeDocUndoTarget(b);
  assert.equal(getDocUndoTarget(), a);
});
