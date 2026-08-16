import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isAnchorId, parentBoardId, isSimLinkKind, orbitOffset, rogueOffset,
  LEAF_BASE_RADIUS, LEAF_RADIAL_MIN, LEAF_RADIAL_MAX,
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

test('orbitOffset planar radius stays inside the heavy-tailed envelope', () => {
  for (let i = 0; i < 500; i++) {
    const o = orbitOffset(`card:b:${i}`, 0);
    const r = Math.hypot(o[0], o[2]);
    assert.ok(r >= LEAF_BASE_RADIUS * LEAF_RADIAL_MIN - 1e-6 && r <= LEAF_BASE_RADIUS * LEAF_RADIAL_MAX + 1e-6,
      `radius ${r} outside envelope for i=${i}`);
  }
});

test('orbitOffset radius is heavy-tailed: dense core, sparse rim, real stragglers', () => {
  const rs = [];
  for (let i = 0; i < 2000; i++) {
    const o = orbitOffset(`card:b:${i}`, 0);
    rs.push(Math.hypot(o[0], o[2]) / LEAF_BASE_RADIUS);
  }
  rs.sort((a, b) => a - b);
  const median = rs[Math.floor(rs.length / 2)];
  const p99 = rs[Math.floor(rs.length * 0.99)];
  // A uniform shell would have median ≈ max; a galaxy packs the core
  // and trails a long tail.
  assert.ok(median < 1.0, `median ${median} should sit in the core`);
  assert.ok(p99 > median * 2.5, `p99 ${p99} should dwarf the median ${median}`);
});

test('orbitOffset shells grow with orbital index (planetary systems, not rings)', () => {
  const inner = orbitOffset('card:b:x', 0);
  const outer = orbitOffset('card:b:x', 400);
  const rI = Math.hypot(inner[0], inner[2]);
  const rO = Math.hypot(outer[0], outer[2]);
  assert.ok(rO > rI * 2, `expected outer shell ${rO} to dwarf inner ${rI}`);
});

test('orbitOffset concentrates toward the disk plane but keeps thick-disk stragglers', () => {
  let sumAbsY = 0, sumPlanar = 0, offPlane = 0;
  const n = 2000;
  for (let i = 0; i < n; i++) {
    const o = orbitOffset(`card:b:${i}`, 0);
    const planar = Math.hypot(o[0], o[2]);
    sumAbsY += Math.abs(o[1]);
    sumPlanar += planar;
    if (Math.abs(o[1]) > planar * 0.5) offPlane++;
  }
  // Mostly a disk…
  assert.ok(sumAbsY < sumPlanar * 0.25, `mean |y| ${sumAbsY / n} too thick vs planar ${sumPlanar / n}`);
  // …but not a pancake: some cards genuinely float off-plane.
  assert.ok(offPlane > n * 0.005, `expected off-plane stragglers, got ${offPlane}/${n}`);
});

test('orbitOffset angles clump instead of spreading evenly', () => {
  // Bin 1000 same-board cards into 12 angular sectors; a uniform ring
  // has near-equal bins, a clumped swarm concentrates several-fold.
  const bins = new Array(12).fill(0);
  const n = 1000;
  for (let i = 0; i < n; i++) {
    const o = orbitOffset(`card:b:${i}`, 0);
    const a = Math.atan2(o[2], o[0]) + Math.PI;
    bins[Math.min(11, Math.floor((a / (2 * Math.PI)) * 12))]++;
  }
  const max = Math.max(...bins);
  const min = Math.min(...bins);
  assert.ok(max > (n / 12) * 1.7, `densest sector ${max} should beat uniform ${n / 12} clearly`);
  assert.ok(max > min * 2, `spread ${min}..${max} should be visibly uneven`);
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
