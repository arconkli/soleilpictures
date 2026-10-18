import test from 'node:test';
import assert from 'node:assert/strict';
import {
  initialExpandState, expandReducer, isExpanded, persistManual, shelfKey, toggleShelf,
} from './sidebarExpand.js';

const run = (s, ...actions) => actions.reduce(expandReducer, s);

test('navigate unfolds active + ancestors, then folds them when you move on', () => {
  let s = run(initialExpandState(), { type: 'navigate', activeId: 'A', ancestorIds: ['root'] });
  assert.ok(isExpanded(s, 'A') && isExpanded(s, 'root'));
  s = run(s, { type: 'navigate', activeId: 'B', ancestorIds: ['root'] });
  assert.ok(!isExpanded(s, 'A'));
  assert.ok(isExpanded(s, 'B') && isExpanded(s, 'root'));
});

test('a cluster unfolded by hand stays unfolded after navigating away', () => {
  let s = run(initialExpandState(), { type: 'navigate', activeId: 'A' }, { type: 'toggle', id: 'X' });
  s = run(s, { type: 'navigate', activeId: 'B' });
  assert.ok(isExpanded(s, 'X'));
  assert.ok(!isExpanded(s, 'A'));
});

test('folding the active cluster survives until the next navigate', () => {
  let s = run(initialExpandState(), { type: 'navigate', activeId: 'A' }, { type: 'toggle', id: 'A' });
  assert.ok(!isExpanded(s, 'A'));
  assert.deepEqual(s.closed, ['A']);
  s = run(s, { type: 'toggle', id: 'A' });
  assert.ok(isExpanded(s, 'A'));
  s = run(s, { type: 'toggle', id: 'A' }, { type: 'navigate', activeId: 'A' });
  assert.ok(isExpanded(s, 'A'));
});

test('folding a manual cluster removes it from manual', () => {
  let s = run(initialExpandState(['X']), { type: 'toggle', id: 'X' });
  assert.deepEqual(persistManual(s), []);
  assert.ok(!isExpanded(s, 'X'));
});

test('search overrides closed and clears', () => {
  let s = run(initialExpandState(), { type: 'navigate', activeId: 'A' }, { type: 'toggle', id: 'A' });
  s = run(s, { type: 'search', ids: ['A', 'Q', 'Q'] });
  assert.deepEqual(s.search, ['A', 'Q']);
  assert.ok(isExpanded(s, 'A') && isExpanded(s, 'Q'));
  s = run(s, { type: 'clearSearch' });
  assert.ok(!isExpanded(s, 'A') && !isExpanded(s, 'Q'));
});

test('toggle of a search-only cluster folds it', () => {
  let s = run(initialExpandState(), { type: 'search', ids: ['Q'] }, { type: 'toggle', id: 'Q' });
  assert.deepEqual(s.search, []);
});

test('collapseAll folds everything including auto', () => {
  let s = run(initialExpandState(['X']), { type: 'navigate', activeId: 'A', ancestorIds: ['R'] }, { type: 'collapseAll' });
  assert.ok(!isExpanded(s, 'X') && !isExpanded(s, 'A') && !isExpanded(s, 'R'));
  assert.deepEqual(s.manual, []);
});

test('legacy saved array loads as manual; persist is plain JSON', () => {
  const s = initialExpandState(JSON.parse('["a","b","a"]'));
  assert.deepEqual(s.manual, ['a', 'b']);
  assert.ok(isExpanded(s, 'a'));
  assert.deepEqual(JSON.parse(JSON.stringify(s)), s);
  assert.deepEqual(initialExpandState('nope').manual, []);
});

test('navigate drops nullish ids; unknown action returns same state', () => {
  const s = run(initialExpandState(), { type: 'navigate', activeId: null, ancestorIds: ['R'] });
  assert.deepEqual(s.auto, ['R']);
  assert.equal(expandReducer(s, { type: 'nope' }), s);
});

test('shelf keys and toggleShelf', () => {
  assert.equal(shelfKey('b1', 'photos'), 'b1:photos');
  const m1 = toggleShelf({}, 'b1:photos', 'expanded');
  assert.deepEqual(m1['b1:photos'], { open: false, expanded: true });
  const m2 = toggleShelf(m1, 'b1:photos', 'open');
  assert.deepEqual(m2['b1:photos'], { open: true, expanded: true });
  const m3 = toggleShelf(m2, 'b1:photos', 'expanded');
  assert.deepEqual(m3['b1:photos'], { open: true, expanded: false });
  assert.notEqual(m3, m2);
  assert.deepEqual(m2['b1:photos'], { open: true, expanded: true });
});

test('reset swaps in another workspace\'s saved state whole', () => {
  const a = expandReducer(initialExpandState(['x']), { type: 'navigate', activeId: 'y' });
  const b = expandReducer(a, { type: 'reset', state: initialExpandState(['z']) });
  assert.deepEqual(b.manual, ['z']);
  assert.deepEqual(b.auto, []);
  assert.deepEqual(expandReducer(a, { type: 'reset' }), initialExpandState());
});
