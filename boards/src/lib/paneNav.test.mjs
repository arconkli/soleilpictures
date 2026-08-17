// paneNav — the split pane's breadcrumb stack.
//
// Two properties carry the fix and are worth stating outright.
//
// A NO-OP RETURNS THE SAME REFERENCE. These run inside setState updaters, so
// returning a fresh array for "nothing changed" would re-render a pane (and
// its Y.Doc-backed canvas) on every stray click.
//
// PRUNING TO EMPTY CLOSES THE SPLIT. The main pane falls back to the root
// board when its stack is emptied; the split pane has no root — an empty stack
// IS "no split", which is what should happen when every board it was showing
// has been deleted.

import test from 'node:test';
import assert from 'node:assert/strict';
import { pushPane, climbPane, prunePane, restorePaneStack } from './paneNav.js';

test('pushPane appends a frame', () => {
  assert.deepEqual(pushPane(['a'], 'b'), ['a', 'b']);
  assert.deepEqual(pushPane([], 'a'), ['a']);
});

test('pushPane is a no-op for the board already on top', () => {
  const s = ['a', 'b'];
  assert.equal(pushPane(s, 'b'), s, 'same reference — no re-render');
});

test('pushPane ignores a falsy id', () => {
  const s = ['a'];
  assert.equal(pushPane(s, null), s);
  assert.equal(pushPane(s, undefined), s);
});

test('pushPane allows revisiting a board deeper in the stack', () => {
  // Not deduped globally: a → b → a is a legitimate trail (a linked cluster
  // can point back up), and collapsing it would break the crumbs.
  assert.deepEqual(pushPane(['a', 'b'], 'a'), ['a', 'b', 'a']);
});

test('climbPane truncates to the clicked crumb', () => {
  assert.deepEqual(climbPane(['a', 'b', 'c'], 0), ['a']);
  assert.deepEqual(climbPane(['a', 'b', 'c'], 1), ['a', 'b']);
});

test('climbPane is a no-op on the last crumb and on out-of-range', () => {
  const s = ['a', 'b', 'c'];
  assert.equal(climbPane(s, 2), s, 'clicking "here" changes nothing');
  assert.equal(climbPane(s, 3), s);
  assert.equal(climbPane(s, -1), s);
  assert.equal(climbPane(s, 1.5), s);
});

test('prunePane drops deleted frames', () => {
  const alive = new Set(['a', 'c']);
  assert.deepEqual(prunePane(['a', 'b', 'c'], (id) => alive.has(id)), ['a', 'c']);
});

test('prunePane keeps the same reference when nothing was deleted', () => {
  const s = ['a', 'b'];
  assert.equal(prunePane(s, () => true), s);
});

test('prunePane collapses to empty — which closes the split', () => {
  assert.deepEqual(prunePane(['a', 'b'], () => false), []);
});

test('restorePaneStack reads a stack session', () => {
  assert.deepEqual(restorePaneStack({ splitStack: ['a', 'b'] }), ['a', 'b']);
});

test('restorePaneStack upgrades a legacy scalar splitId', () => {
  assert.deepEqual(restorePaneStack({ splitId: 'a' }), ['a']);
});

test('restorePaneStack returns no split for empty/absent sessions', () => {
  assert.deepEqual(restorePaneStack(null), []);
  assert.deepEqual(restorePaneStack({}), []);
  assert.deepEqual(restorePaneStack({ splitStack: [] }), []);
  assert.deepEqual(restorePaneStack({ splitId: null }), []);
});

test('restorePaneStack drops null frames from a corrupt blob', () => {
  assert.deepEqual(restorePaneStack({ splitStack: ['a', null, 'b'] }), ['a', 'b']);
});
