import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isAnchorId, parentBoardId, isSimLinkKind, orbitOffset, rogueOffset, galaxySeed,
  moonOffset, systemArchetype, systemPlane,
  LEAF_BASE_RADIUS, LEAF_RADIAL_MIN, LEAF_RADIAL_MAX,
  SYSTEM_RING0, SYSTEM_RING_GROWTH, SYSTEM_RING_COUNT, SYSTEM_BELT_R, SYSTEM_KUIPER_R,
  galaxyOrbit, orbitalRate, systemSpin, starTemp, starMagnitude,
  GALAXY_CORE_FRAC, GALAXY_PATTERN_RATE, STAR_TEMP_MIN, STAR_TEMP_MAX,
  STAR_MAG_MIN, STAR_MAG_MAX, armAngle, GALAXY_PITCH,
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

// ── Galactic rotation ────────────────────────────────────────────

// Measures angular over-density in a narrow annulus — the same
// statistic the static density-wave test uses, at an arbitrary time.
function armContrast(R, t) {
  const bins = new Array(10).fill(0);
  let n = 0;
  for (let i = 0; i < 40000; i++) {
    const id = `board:x${i}`;
    const { a } = galaxyOrbit(id, R);
    const o = galaxySeed(id, R, null, orbitalRate(a, R) * t, GALAXY_PATTERN_RATE * t);
    const r = Math.hypot(o[0], o[2]);
    if (r < 0.55 * R || r > 0.65 * R) continue;
    n++;
    let ang = Math.atan2(o[2], o[0]);
    if (ang < 0) ang += Math.PI * 2;
    bins[Math.min(9, Math.floor(((ang % Math.PI) / Math.PI) * 10))]++;
  }
  const mean = n / bins.length;
  return { n, mean, max: Math.max(...bins), min: Math.min(...bins) };
}

// THE test for this feature. Differential rotation applied to fixed
// positions shears them, and the spiral winds itself into mush within
// minutes — which would be invisible in a screenshot taken at t=0 and
// ruinous on the Command Center wall display that runs for hours.
// Advancing each star along its OWN ellipse (phase) while the ellipse
// ORIENTATIONS turn together (pattern) cannot wind up, because the
// arms are an interference effect, not a material structure.
test('density-wave arms SURVIVE rotation: still crowded after 10 minutes', () => {
  const R = 1000;
  for (const t of [0, 60, 600, 3600]) {
    const { n, mean, max, min } = armContrast(R, t);
    assert.ok(n > 500, `t=${t}s annulus too sparse: ${n}`);
    assert.ok(max > mean * 1.4, `t=${t}s arms washed out: max ${max} vs mean ${mean}`);
    assert.ok(min < mean * 0.55, `t=${t}s inter-arm filled in: min ${min} vs mean ${mean}`);
  }
});

test('rotation is differential: inner orbits sweep faster than outer', () => {
  const R = 1000;
  assert.ok(orbitalRate(0.2 * R, R) > orbitalRate(0.5 * R, R));
  assert.ok(orbitalRate(0.5 * R, R) > orbitalRate(1.5 * R, R));
  // A real shear, not a token one: core should lap the rim many times.
  assert.ok(orbitalRate(GALAXY_CORE_FRAC * R, R) / orbitalRate(1.5 * R, R) > 5);
});

test('rotation curve is solid-body in the core and finite at a=0', () => {
  const R = 1000, core = GALAXY_CORE_FRAC * R;
  assert.equal(orbitalRate(0, R), orbitalRate(core, R));
  assert.equal(orbitalRate(core * 0.3, R), orbitalRate(core, R));
  assert.ok(Number.isFinite(orbitalRate(0, R)));
});

test('galaxySeed with zero phase equals the static layout', () => {
  const R = 900;
  for (const id of ['ws:a', 'board:b', 'user:c']) {
    assert.deepEqual([...galaxySeed(id, R)], [...galaxySeed(id, R, null, 0, 0)]);
  }
});

test('galaxyOrbit agrees with the position galaxySeed builds from it', () => {
  const R = 800, id = 'ws:orbit';
  const { a, theta } = galaxyOrbit(id, R);
  const o = galaxySeed(id, R);
  // galaxySeed writes a Float32Array, so compare at float32 precision.
  assert.ok(Math.abs(o[0] - a * Math.cos(theta)) < 1e-3);
  assert.ok(Math.abs(o[2] - a * Math.sin(theta)) < 1e-3);
});

// Arm stars ride the pattern rigidly; everything else shears. That
// split is what lets the spiral survive indefinitely while the disk
// still visibly moves — verify both halves actually behave that way.
test('arm stars ride the pattern; field stars shear', () => {
  const R = 1000;
  let armSeen = 0, fieldSeen = 0;
  for (let i = 0; i < 400; i++) {
    const id = `ws:p${i}`;
    const { arm } = galaxyOrbit(id, R);
    const at0 = galaxySeed(id, R, null, 0, 0);
    // Advance the star's OWN orbit but hold the pattern still.
    const spun = galaxySeed(id, R, null, 1.2, 0);
    const moved = Math.hypot(spun[0] - at0[0], spun[2] - at0[2]) > 1;
    if (arm >= 0) { armSeen++; assert.ok(!moved, 'an arm star drifted off the pattern'); }
    else { fieldSeen++; assert.ok(moved, 'a field star failed to shear'); }
  }
  assert.ok(armSeen > 50 && fieldSeen > 50, `population split off: ${armSeen}/${fieldSeen}`);
});

test('arms are logarithmic: pitch angle stays constant with radius', () => {
  const R = 1000;
  // A log spiral has d(theta)/d(ln r) constant — that IS constant pitch.
  const slope = (r1, r2) =>
    (armAngle(r2, R, 0) - armAngle(r1, R, 0)) / (Math.log(r2) - Math.log(r1));
  const inner = slope(0.2 * R, 0.4 * R);
  const outer = slope(0.8 * R, 1.6 * R);
  assert.ok(Math.abs(inner - outer) < 1e-9, `not logarithmic: ${inner} vs ${outer}`);
  assert.ok(Math.abs(inner - 1 / Math.tan(GALAXY_PITCH)) < 1e-9);
});
test('systemSpin is deterministic, mostly prograde, occasionally retrograde', () => {
  assert.equal(systemSpin('board:s'), systemSpin('board:s'));
  let retro = 0;
  for (let i = 0; i < 2000; i++) if (systemSpin(`board:s${i}`) < 0) retro++;
  assert.ok(retro > 40 && retro < 300, `retrograde share off: ${retro}/2000`);
});

// The reference is dominated by blue-white stars with a distinct
// amber minority and very few mid-tones — a BIMODAL population, not
// a smear and not a radial ramp. Both halves matter: lose the
// bimodality and it turns muddy, lose the radial trend and the core
// stops reading as old.
test('starTemp: bimodal population, amber-richer in the core', () => {
  const R = 1000;
  const sample = (a) => {
    const v = [];
    for (let i = 0; i < 6000; i++) v.push(starTemp(`card:t${i}`, a, R));
    return v;
  };
  const inner = sample(0.05 * R), outer = sample(0.95 * R);
  const share = (v, lo, hi) => v.filter((x) => x >= lo && x < hi).length / v.length;

  // Amber minority, denser in the bulge than at the rim.
  const amberIn = share(inner, 0, 5000), amberOut = share(outer, 0, 5000);
  assert.ok(amberIn > amberOut + 0.1, `no radial trend: ${amberIn} vs ${amberOut}`);
  assert.ok(amberIn > 0.2 && amberIn < 0.45, `core amber share off: ${amberIn}`);
  assert.ok(amberOut > 0.05 && amberOut < 0.3, `rim amber share off: ${amberOut}`);

  // The gap between the two populations is what keeps it from muddying.
  assert.ok(share(inner, 4600, 6200) < 0.02, 'mid-tones present: not bimodal');
  for (const v of [...inner, ...outer]) {
    assert.ok(v >= STAR_TEMP_MIN && v <= STAR_TEMP_MAX, `out of range: ${v}`);
  }
});

// A near-uniform size per node kind reads as a scatter plot. The
// reference's texture is a few big bloomed blobs among hundreds of
// specks, so the tail has to be genuinely rare.
test('starMagnitude is heavy-tailed: most faint, a rare few huge', () => {
  const v = [];
  for (let i = 0; i < 20000; i++) v.push(starMagnitude(`card:m${i}`));
  v.sort((a, b) => a - b);
  const at = (q) => v[Math.floor(q * v.length)];
  assert.ok(v[0] >= STAR_MAG_MIN && v[v.length - 1] <= STAR_MAG_MAX);
  assert.ok(at(0.5) < STAR_MAG_MIN + 0.6, `median too bright: ${at(0.5)}`);
  assert.ok(at(0.999) > 2.2, `no bright tail: p99.9 = ${at(0.999)}`);
  assert.ok(at(0.9) < 1.6, `too many bright stars: p90 = ${at(0.9)}`);
  assert.equal(starMagnitude('card:m1'), starMagnitude('card:m1'));
});