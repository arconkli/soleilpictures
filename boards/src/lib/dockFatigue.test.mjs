// dockFatigue.test.mjs — node --test src/lib/dockFatigue.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DOCK_MAX_VISITS, DISMISS_RETIRES, dockVisitAllowed, noteDockVisit, parseVisits,
  dockRetired, rootHoldsClusters, dockVisitsKey, dockDismissCountKey,
} from './dockFatigue.js';

test('a dock shows on at most two visits to a board, and stays shown within a visit', () => {
  let visits = [];
  assert.equal(dockVisitAllowed({ visits, session: 's1' }), true);
  visits = noteDockVisit(visits, 's1');
  assert.equal(dockVisitAllowed({ visits, session: 's1' }), true, 'the same visit keeps it');
  assert.equal(dockVisitAllowed({ visits, session: 's2' }), true);
  visits = noteDockVisit(visits, 's2');
  assert.equal(dockVisitAllowed({ visits, session: 's3' }), false, 'the third visit is spared it');
  assert.equal(DOCK_MAX_VISITS, 2);
});

test('recording is idempotent per visit and bounded', () => {
  let v = [];
  for (let i = 0; i < 30; i++) v = noteDockVisit(v, `s${i}`);
  assert.ok(v.length <= 10);
  assert.deepEqual(noteDockVisit(['a'], 'a'), ['a']);
  assert.deepEqual(noteDockVisit(['a'], null), ['a']);
});

test('a missing session never suppresses, and malformed storage reads as never shown', () => {
  assert.equal(dockVisitAllowed({ visits: ['a', 'b', 'c'], session: null }), true);
  assert.deepEqual(parseVisits('not json'), []);
  assert.deepEqual(parseVisits('{"a":1}'), []);
  assert.deepEqual(parseVisits(null), []);
  assert.deepEqual(parseVisits('["s1", 7, "", "s2"]'), ['s1', 's2']);
});

test('two dismissals retire a kind of dock for this person', () => {
  assert.equal(dockRetired(0), false);
  assert.equal(dockRetired(1), false);
  assert.equal(dockRetired(DISMISS_RETIRES), true);
  assert.equal(dockRetired('nope'), false);
});

test('a root that holds clusters is a home, not a thin board', () => {
  const root = { id: 'r', parent_board_id: null };
  const project = { id: 'p', parent_board_id: 'r' };
  assert.equal(rootHoldsClusters(root, [{ kind: 'image' }, { kind: 'board' }]), true);
  assert.equal(rootHoldsClusters(root, [{ kind: 'image' }]), false);
  assert.equal(rootHoldsClusters(project, [{ kind: 'board' }]), false, 'only the root');
  assert.equal(rootHoldsClusters(null, []), false);
});

test('keys are per kind and per board', () => {
  assert.notEqual(dockVisitsKey('mix', 'b1'), dockVisitsKey('depth', 'b1'));
  assert.notEqual(dockVisitsKey('mix', 'b1'), dockVisitsKey('mix', 'b2'));
  assert.notEqual(dockDismissCountKey('mix'), dockDismissCountKey('depth'));
});
