import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STALE_MS, heldElsewhere, isFresh, rosterFrom, sameUserLoc, shouldAnnounce } from './workspaceRoster.js';

const NOW = 10_000_000;
const ann = { id: 'u1', name: 'Ann', color: '#4f8df8' };
const here = (sid, tabId, extra = {}) => ({
  sid, userId: 'u1', tabId, user: ann, location: { boardId: 'b1', surface: 'canvas' }, lastSeen: NOW, ...extra,
});

test('the roster lists each present tab once, freshest socket first, and nothing stale', () => {
  const roster = rosterFrom([
    { sid: 's0', userId: 'u1' },                                   // connected, never said `here`
    here('s1', 't1', { lastSeen: NOW - 5_000 }),
    here('s2', 't1', { lastSeen: NOW - 1_000, location: { boardId: 'b2' } }),   // the same tab, reconnected
    here('s3', 't2', { lastSeen: NOW - STALE_MS - 1 }),            // stale
    here('s4', 't3', { user: null }),                              // no identity
  ], NOW);
  assert.deepEqual(roster, [
    { tabId: 't1', user: ann, location: { boardId: 'b2' }, lastSeen: NOW - 1_000 },
  ]);
});

test('a roster entry carries exactly what the client reads, with location defaulting to null', () => {
  const [entry] = rosterFrom([here('s1', 't1', { location: undefined })], NOW);
  assert.deepEqual(Object.keys(entry).sort(), ['lastSeen', 'location', 'tabId', 'user']);
  assert.equal(entry.location, null);
});

test('freshness needs a tab, an identity and a heartbeat inside STALE_MS', () => {
  assert.equal(isFresh(here('s', 't'), NOW), true);
  assert.equal(isFresh(here('s', 't', { lastSeen: NOW - STALE_MS }), NOW), true);
  assert.equal(isFresh(here('s', 't', { lastSeen: NOW - STALE_MS - 1 }), NOW), false);
  assert.equal(isFresh({ sid: 's', userId: 'u1' }, NOW), false);
  assert.equal(isFresh(null, NOW), false);
  assert.equal(STALE_MS, 60_000);
});

test('a steady heartbeat is not fanned out; a new tab, a navigation or a rename is', () => {
  const prev = here('s1', 't1');
  assert.equal(shouldAnnounce(prev, here('s1', 't1', { lastSeen: NOW + 15_000 })), false);
  assert.equal(shouldAnnounce(prev, here('s1', 't1', { location: { boardId: 'b1', surface: 'canvas', scrollTop: 900 } })), false,
    'scrollTop is not rendered');
  assert.equal(shouldAnnounce({ sid: 's1', userId: 'u1' }, prev), true, 'first `here` on a socket');
  assert.equal(shouldAnnounce(prev, here('s1', 't1', { location: { boardId: 'b9', surface: 'canvas' } })), true);
  assert.equal(shouldAnnounce(prev, here('s1', 't1', { user: { ...ann, name: 'Annie' } })), true);
  assert.equal(shouldAnnounce(prev, here('s1', 't2')), true);
});

test('sameUserLoc compares identity and the rendered location bits only', () => {
  const a = here('s1', 't1', { location: { boardId: 'b1', surface: 'doc', pageId: 'p', docCardId: null, isActive: true, scrollTop: 1 } });
  const b = here('s2', 't1', { location: { boardId: 'b1', surface: 'doc', pageId: 'p', docCardId: null, isActive: true, scrollTop: 2 } });
  assert.equal(sameUserLoc(a, b), true);
  assert.equal(sameUserLoc(a, { ...b, location: { ...b.location, isActive: false } }), false);
  assert.equal(sameUserLoc(a, { ...b, user: { ...ann, color: '#000' } }), false);
});

test('a closing socket announces `leave` only when no other live socket still carries its tab', () => {
  const old = here('s1', 't1');
  const reconnected = here('s2', 't1');
  assert.equal(heldElsewhere([old, reconnected], 't1', 's1', NOW), true, 'the reconnect already brought it back');
  assert.equal(heldElsewhere([old], 't1', 's1', NOW), false);
  assert.equal(heldElsewhere([old, here('s3', 't2')], 't1', 's1', NOW), false, 'another tab does not count');
  assert.equal(heldElsewhere([old, here('s2', 't1', { lastSeen: NOW - STALE_MS - 1 })], 't1', 's1', NOW), false,
    'nor does a stale socket for the same tab');
});
