import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isAnchorId, parentBoardId, isSimLinkKind, orbitOffset, rogueOffset,
  LEAF_BASE_RADIUS, LEAF_Y_FLATTEN,
} from './universeLayout.js';

test('anchor classification: users, workspaces, boards simulate; cards do not', () => {
  assert.equal(isAnchorId('user:abc'), true);
  assert.equal(isAnchorId('ws:abc'), true);
  assert.equal(isAnchorId('board:abc'), true);
  assert.equal(isAnchorId('card:b:c'), false);
  assert.equal(isAnchorId('card:abc'), false);
});

test('parentBoardId parses the board out of a card id', () => {
  assert.equal(parentBoardId('card:B123:C456'), 'board:B123');
  // Card ids may themselves contain colons — first segment wins.
  assert.equal(parentBoardId('card:B123:C4:56'), 'board:B123');
});

test('parentBoardId: null for anchors and malformed ids', () => {
  assert.equal(parentBoardId('board:B123'), null);
  assert.equal(parentBoardId('user:U1'), null);
  // Legacy 2-segment doc ids (entity_links doc targets) have no
  // parseable parent.
  assert.equal(parentBoardId('card:justonesegment'), null);
  assert.equal(parentBoardId('card::empty'), null);
});

test('sim links are exactly the anchor-anchor kinds', () => {
  for (const k of ['hierarchy', 'wsroot', 'membership', 'share']) {
    assert.equal(isSimLinkKind(k), true, k);
  }
  for (const k of ['structural', 'board', 'card', 'doc', 'doc_board', 'doc_card', 'doc_doc', undefined]) {
    assert.equal(isSimLinkKind(k), false, String(k));
  }
});

test('orbitOffset is deterministic per id', () => {
  const a = orbitOffset('card:b:x', 3);
  const b = orbitOffset('card:b:x', 3);
  assert.deepEqual([...a], [...b]);
});

test('orbitOffset varies across ids', () => {
  const a = orbitOffset('card:b:x', 0);
  const b = orbitOffset('card:b:y', 0);
  assert.notDeepEqual([...a], [...b]);
});

test('orbitOffset radius stays within the jittered shell bounds', () => {
  for (let i = 0; i < 200; i++) {
    const o = orbitOffset(`card:b:${i}`, 0);
    const r = Math.hypot(o[0], o[1] / LEAF_Y_FLATTEN, o[2]);
    assert.ok(r >= LEAF_BASE_RADIUS * 0.649 && r <= LEAF_BASE_RADIUS * 1.351,
      `radius ${r} outside jitter bounds for i=${i}`);
  }
});

test('orbitOffset shells grow with orbital index (planetary systems, not rings)', () => {
  const inner = orbitOffset('card:b:x', 0);
  const outer = orbitOffset('card:b:x', 400);
  const rI = Math.hypot(inner[0], inner[1] / LEAF_Y_FLATTEN, inner[2]);
  const rO = Math.hypot(outer[0], outer[1] / LEAF_Y_FLATTEN, outer[2]);
  assert.ok(rO > rI * 2, `expected outer shell ${rO} to dwarf inner ${rI}`);
});

test('orbitOffset flattens Y so swarms read as disks', () => {
  let maxAbsY = 0, maxXZ = 0;
  for (let i = 0; i < 500; i++) {
    const o = orbitOffset(`card:b:${i}`, 0);
    maxAbsY = Math.max(maxAbsY, Math.abs(o[1]));
    maxXZ = Math.max(maxXZ, Math.hypot(o[0], o[2]));
  }
  assert.ok(maxAbsY < maxXZ * (LEAF_Y_FLATTEN + 0.05));
});

test('rogueOffset lands far outside any board swarm', () => {
  const o = rogueOffset('card:orphan');
  assert.ok(Math.hypot(o[0], o[1], o[2]) > LEAF_BASE_RADIUS * 10);
});

test('orbitOffset writes into a provided out array', () => {
  const out = new Float32Array(3);
  const ret = orbitOffset('card:b:x', 1, LEAF_BASE_RADIUS, out);
  assert.equal(ret, out);
  assert.notDeepEqual([...out], [0, 0, 0]);
});
