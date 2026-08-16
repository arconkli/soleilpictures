import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isAnchorId, parentBoardId, isSimLinkKind, orbitOffset, rogueOffset, galaxySeed,
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

test('galaxySeed is deterministic per id', () => {
  assert.deepEqual([...galaxySeed('ws:a', 1000)], [...galaxySeed('ws:a', 1000)]);
  assert.notDeepEqual([...galaxySeed('ws:a', 1000)], [...galaxySeed('ws:b', 1000)]);
});

test('galaxySeed builds an exponential disk: packed core, no hard edge', () => {
  const R = 1000, rs = [];
  for (let i = 0; i < 5000; i++) {
    const o = galaxySeed(`board:x${i}`, R);
    rs.push(Math.hypot(o[0], o[2]));
  }
  rs.sort((a, b) => a - b);
  const median = rs[rs.length >> 1];
  const beyond = rs.filter((r) => r > R).length / rs.length;
  assert.ok(median < 0.45 * R, `median ${median} should sit deep in the disk`);
  assert.ok(beyond > 0.02, `expected a real halo tail past R, got ${(beyond * 100).toFixed(1)}%`);
});

test('galaxySeed: puffy bulge, thin disk', () => {
  const R = 1000;
  let coreY = 0, coreN = 0, rimY = 0, rimN = 0;
  for (let i = 0; i < 8000; i++) {
    const o = galaxySeed(`board:x${i}`, R);
    const r = Math.hypot(o[0], o[2]);
    if (r < 0.2 * R) { coreY += Math.abs(o[1]); coreN++; }
    if (r > 0.8 * R) { rimY += Math.abs(o[1]); rimN++; }
  }
  assert.ok(coreN > 100 && rimN > 100, 'need both populations');
  assert.ok(coreY / coreN > (rimY / rimN) * 1.8,
    `bulge ${coreY / coreN} should be visibly puffier than the rim ${rimY / rimN}`);
});

test('galaxySeed produces density-wave arms: crowded bearings AND populated inter-arm space', () => {
  // Precessing-ellipse crowding must show up as angular over-density in
  // a narrow annulus — with stars still present between arms (that's
  // what separates a density wave from a tube of points on a curve).
  const R = 1000, bins = new Array(10).fill(0);
  let n = 0;
  for (let i = 0; i < 40000; i++) {
    const o = galaxySeed(`board:x${i}`, R);
    const r = Math.hypot(o[0], o[2]);
    if (r < 0.55 * R || r > 0.65 * R) continue;
    n++;
    let ang = Math.atan2(o[2], o[0]);
    if (ang < 0) ang += Math.PI * 2;
    bins[Math.min(9, Math.floor(((ang % Math.PI) / Math.PI) * 10))]++;
  }
  const mean = n / bins.length;
  const max = Math.max(...bins);
  const min = Math.min(...bins);
  assert.ok(n > 500, `annulus too sparse: ${n}`);
  assert.ok(max > mean * 1.4, `no wave crowding: max bin ${max} vs mean ${mean}`);
  assert.ok(min < mean * 0.55, `no inter-arm depletion: min bin ${min} vs mean ${mean}`);
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
