import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isAnchorId, parentBoardId, isSimLinkKind, orbitOffset, rogueOffset, galaxySeed,
  moonOffset, systemArchetype, systemPlane,
  LEAF_BASE_RADIUS, LEAF_RADIAL_MIN, LEAF_RADIAL_MAX,
  SYSTEM_RING0, SYSTEM_RING_GROWTH, SYSTEM_RING_COUNT, SYSTEM_BELT_R, SYSTEM_KUIPER_R,
} from './universeLayout.js';

// Find board ids of each archetype so tests exercise the right path.
function findBoard(archetype) {
  for (let i = 0; i < 200; i++) {
    const b = `board:t${i}`;
    if (systemArchetype(b) === archetype) return b;
  }
  throw new Error(`no ${archetype} board in 200 tries`);
}
const PLANETARY = findBoard('planetary');
const CLOUD = findBoard('cloud');
const cardOf = (board, i) => `card:${board.slice(6)}:c${i}`;
const dot = (o, n) => o[0] * n[0] + o[1] * n[1] + o[2] * n[2];
const len = (o) => Math.hypot(o[0], o[1], o[2]);

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

test('orbitOffset stays inside the system envelope for both archetypes', () => {
  for (const board of [PLANETARY, CLOUD]) {
    for (let i = 0; i < 400; i++) {
      const r = len(orbitOffset(cardOf(board, i), i)) / LEAF_BASE_RADIUS;
      assert.ok(r >= LEAF_RADIAL_MIN - 1e-6 && r <= LEAF_RADIAL_MAX + 1e-6,
        `${board} card ${i}: ${r} outside envelope`);
    }
  }
});

test('planetary systems: the first eight cards take distinct geometric rings', () => {
  // Comet-band cards (~5%) are legitimately off-ladder; the rest must
  // climb the Titius–Bode ladder in order.
  const { n } = systemPlane(PLANETARY);
  const radii = [];
  for (let i = 0; i < SYSTEM_RING_COUNT; i++) {
    const o = orbitOffset(cardOf(PLANETARY, i), i);
    const h = dot(o, n);
    const inPlane = Math.sqrt(Math.max(0, len(o) ** 2 - h * h));
    if (inPlane < LEAF_BASE_RADIUS * 3) radii.push(inPlane);   // skip comets
  }
  assert.ok(radii.length >= 6, `too many comets among planets: ${radii.length}`);
  for (let i = 1; i < radii.length; i++) {
    assert.ok(radii[i] > radii[i - 1] * 1.1,
      `ring ${i} (${radii[i]}) not clearly outside ring ${i - 1} (${radii[i - 1]})`);
  }
  const expected0 = LEAF_BASE_RADIUS * SYSTEM_RING0;
  assert.ok(Math.abs(radii[0] - expected0) < expected0 * 0.1,
    `innermost ring ${radii[0]} far from ladder base ${expected0}`);
});

test('planetary systems are coplanar: planets hug their own tilted plane', () => {
  let flat = 0, total = 0;
  for (let b = 0; b < 30; b++) {
    const board = `board:t${b}`;
    if (systemArchetype(board) !== 'planetary') continue;
    const { n } = systemPlane(board);
    for (let i = 0; i < SYSTEM_RING_COUNT; i++) {
      const o = orbitOffset(cardOf(board, i), i);
      if (len(o) > LEAF_BASE_RADIUS * 3) continue;   // comet
      total++;
      if (Math.abs(dot(o, n)) < len(o) * 0.2) flat++;
    }
  }
  assert.ok(total > 50, `sample too small: ${total}`);
  assert.ok(flat / total > 0.9, `only ${flat}/${total} planets near their system plane`);
});

test('planetary systems: the crowd condenses into main + Kuiper belts', () => {
  const { n } = systemPlane(PLANETARY);
  let inBelts = 0, total = 0;
  for (let i = SYSTEM_RING_COUNT; i < 300; i++) {
    const o = orbitOffset(cardOf(PLANETARY, i), i);
    const r = len(o) / LEAF_BASE_RADIUS;
    if (r > 3.0) continue;                            // comet band
    total++;
    const h = dot(o, n);
    const inPlane = Math.sqrt(Math.max(0, len(o) ** 2 - h * h)) / LEAF_BASE_RADIUS;
    const inMain = inPlane > SYSTEM_BELT_R * 0.8 && inPlane < SYSTEM_BELT_R * 1.2;
    const inKuiper = inPlane > SYSTEM_KUIPER_R * 0.75 && inPlane < SYSTEM_KUIPER_R * 1.25;
    if (inMain || inKuiper) inBelts++;
  }
  assert.ok(total > 200, `sample too small: ${total}`);
  assert.ok(inBelts / total > 0.9, `only ${inBelts}/${total} of the crowd sits in a belt`);
});

test('planetary systems keep long-period comets', () => {
  let comets = 0;
  const n = 2000;
  for (let i = SYSTEM_RING_COUNT; i < n; i++) {
    if (len(orbitOffset(cardOf(PLANETARY, i), i)) > LEAF_BASE_RADIUS * 3.0) comets++;
  }
  assert.ok(comets > n * 0.02 && comets < n * 0.12, `comet share off: ${comets}/${n}`);
});

test('system planes tilt differently per board, mostly modestly, with mavericks', () => {
  let upright = 0, mavericks = 0;
  const normals = [];
  const N = 200;
  for (let b = 0; b < N; b++) {
    const { n } = systemPlane(`board:t${b}`);
    normals.push(n);
    if (Math.abs(n[1]) > 0.75) upright++;
    if (Math.abs(n[1]) < 0.4) mavericks++;
  }
  assert.ok(upright / N > 0.6, `most systems should tilt modestly: ${upright}/${N}`);
  assert.ok(mavericks > 0, 'nature keeps a few sideways systems');
  // And the tilts genuinely vary board to board.
  const [a, b] = [normals[0], normals[1]];
  assert.ok(Math.abs(a[0] - b[0]) + Math.abs(a[2] - b[2]) > 0.01, 'planes look identical');
});

test('moonOffset parks a moon a hop away from its host, deterministically', () => {
  const host = orbitOffset(cardOf(PLANETARY, 2), 2);
  const m1 = moonOffset(cardOf(PLANETARY, 40), host);
  const m2 = moonOffset(cardOf(PLANETARY, 40), host);
  assert.deepEqual([...m1], [...m2]);
  const d = Math.hypot(m1[0] - host[0], m1[1] - host[1], m1[2] - host[2]);
  assert.ok(d > 1.5 && d < 6, `moon distance ${d} out of range`);
});

test('cloud boards stay ragged: heavy-tailed radii, clumped bearings', () => {
  const rs = [];
  const bins = new Array(12).fill(0);
  const n = 1000;
  for (let i = 0; i < n; i++) {
    const o = orbitOffset(cardOf(CLOUD, i), i);
    rs.push(Math.hypot(o[0], o[2]) / LEAF_BASE_RADIUS);
    const a = Math.atan2(o[2], o[0]) + Math.PI;
    bins[Math.min(11, Math.floor((a / (2 * Math.PI)) * 12))]++;
  }
  rs.sort((x, y) => x - y);
  assert.ok(rs[n >> 1] < 1.0, 'cloud median should sit in the core');
  assert.ok(rs[Math.floor(n * 0.99)] > rs[n >> 1] * 2.5, 'cloud needs a real tail');
  assert.ok(Math.max(...bins) > (n / 12) * 1.5, 'cloud bearings should clump');
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
