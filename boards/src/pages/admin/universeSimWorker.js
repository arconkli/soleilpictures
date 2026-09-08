// universeSimWorker — hierarchical universe layout in a Web Worker.
//
// The old worker ran d3-force over EVERY node and link — O((N+E)·logN)
// per tick — which is what capped the universe at ~250k nodes. This
// one simulates only the ANCHORS (user / ws / board: the structurally
// small population) and places every LEAF (cards — the unbounded
// population) procedurally on a deterministic orbit around its parent
// board (see ../../lib/universeLayout.js). Per tick, leaves cost three
// float adds each; the sim itself never sees them. Boards with more
// cards repel harder, so big galaxies keep their elbow room even
// though their cards no longer participate in the charge force.
//
// The main thread's contract is unchanged: it sends nodes/links in
// arrival order and renders positions[i] for the i-th node it added.
// `order` mirrors that indexing exactly.
//
// One behavioral improvement: the old worker kept posting identical
// positions forever at 250ms once the sim went cold. Now, when alpha
// decays below the floor we post one final settled frame and stop —
// addNodes / addLinks / resume restart the loop.
//
// Messages in:
//   { type: 'init',      nodes: [{ id, val }], links: [{ source, target, kind }] }
//   { type: 'addNodes',  nodes: [{ id, val }] }
//   { type: 'addLinks',  links: [{ source, target, kind }] }
//   { type: 'pause' } / { type: 'resume' } / { type: 'stop' }
//
// Messages out:
//   { type: 'ready' }
//   { type: 'tick',  positions, count }   — transferred Float32Array
//   { type: 'error', reason }

import { forceSimulation, forceLink, forceManyBody, forceCenter } from 'd3-force-3d';
import { hash01, orbitJitter, targetId } from '../../lib/hashJitter.js';
import {
  isAnchorId, parentBoardId, isSimLinkKind, orbitOffset, rogueOffset, galaxySeed,
  moonOffset, systemArchetype, SYSTEM_RING_COUNT,
  galaxyOrbit, orbitalRate, systemSpin, systemPlane, GALAXY_PATTERN_RATE,
} from '../../lib/universeLayout.js';

const HOT_TICK_MS  = 16;
const ALPHA_RESTART = 0.3;

// Base repulsion between anchors. Boards scale this up with the size
// of their card swarm (see chargeStrength) so a 300-card galaxy claims
// proportionally more space than an empty board — and every anchor
// gets a hashed mass (_m) so spacing comes out ragged, not even.
//
// History worth keeping: this went 200 → 140 because stronger repulsion
// puffed the crowded arm lanes, which is the very over-density the
// layout exists to show. 175 is a deliberate step back toward that
// edge — the core was reading as one saturated mass — but it stays
// well under 200, and CHARGE_REACH still stops it from seeing anything
// at arm wavelength.
//
// The lever that does NOT work, tried and reverted: scaling the whole
// anchor layout up (disk radius + link distances together). The camera
// auto-fits, so a uniform scale-up is invisible by construction; worse,
// it pushes the outliers further out, the fit pulls back to frame them,
// and the crowded core ends up looking DENSER than before. Perceived
// density here is local crowding measured against the 95th-percentile
// fit radius, so only a local force can change it.
// Halved alongside the stronger home spring. Repulsion is still what
// stops two workspaces landing on top of each other, but it must not
// be able to push one off its lane.
const CHARGE_STRENGTH = -90;

// The epicyclic restoring force. Real disk stars oscillate around a
// guiding center set by their orbit; here every anchor's guiding
// center is its galaxySeed position (the kinematic density-wave
// layout — see lib/universeLayout.js), and this spring pulls it home.
// Charge and links then resolve LOCAL crowding without ever being
// strong enough to erase the wave pattern. This replaces the old
// center-pull + disk-flatten + spiral-tug trio — those sculpted the
// layout from outside, which is exactly how the arms ended up looking
// like drawn tubes instead of emergent crowding.
//
// Eased 0.08 → 0.065 alongside the charge bump: the spring is what
// decides how much of the extra repulsion actually becomes spacing
// rather than being pulled straight back to the seed. Below about 0.05
// the arms start dissolving into an even field, which is the failure
// mode this force exists to prevent.
// Raised hard (was 0.065) because the arms are now EXPLICIT: the seed
// is the structure, not a statistical tendency the forces are free to
// relax. At 0.065 the charge force spread the anchors into an even
// disk and the lanes measured 7x contrast in the layout but rendered
// as a featureless blob. The spring has to win.
const HOME_PULL = 0.40;

// ── Hierarchical state ───────────────────────────────────────────
// order[i] mirrors the main thread's node index i:
//   anchors: { anchor: <sim node> }
//   leaves:  { parentId, off: Float32Array(3) }
let order       = [];
let anchors     = [];            // d3 sim nodes (mutated in place)
let anchorById  = new Map();     // id → sim node
let simLinks    = [];            // anchor-anchor links only
let leafCounts  = new Map();     // board anchor id → leaf count (orbital index + charge)
let leafHosts   = new Map();     // board anchor id → first-arrival cards (moon hosts)
let sim         = null;
let positions   = null;
let paused      = false;
let stopped     = false;
let tickTimer   = null;

// ── Galactic rotation ────────────────────────────────────────────
// Once the sim settles we stop simulating and start TURNING. The
// layout is not re-simulated — every anchor's guiding center is
// re-derived analytically from its own orbit (galaxySeed with an
// advanced phase), and the local jiggle the force sim earned is
// carried along as a rigid residual. So the galaxy shears the way a
// real one does without the forces ever fighting the motion.
//
// Only WORKSPACES orbit under their own steam. placeNear() re-homes
// every board onto its workspace and every card onto its board, so
// the whole subtree rides along rigidly — which is precisely why no
// drawn edge can ever stretch.
const ROTATE_TICK_MS = 16;
// Above this the per-frame rebuild stops being free and the main
// thread rotates the whole scene rigidly instead (no shear, but no
// cost either). The live corpus is orders of magnitude below this, so
// the full path is what actually runs.
const ROTATE_MAX_NODES = 120000;

let rotating   = false;   // in rotate mode right now
let rotArmed   = false;   // rotation state captured at least once
let rotElapsed = 0;       // TOTAL seconds of rotation, across settles
let rotMark    = 0;       // performance.now() when this rotate run began
let rigidRate  = 0;       // non-zero once we told the main thread to do it
// Global speed dial. prefers-reduced-motion drives this to a crawl
// rather than pausing, so arrivals still land and the scene simply
// stops being a motion source.
let rotSpeed   = 1;
const leafMat  = new Map();   // board id → 3x3 (spin · galactic carry · scale)
let systemScale = 1;

function nowMs() {
  return (typeof performance !== 'undefined' && performance.now)
    ? performance.now() : Date.now();
}

// Total galactic time. rotElapsed banks whole runs so a re-settle or a
// speed change never makes the phase jump.
function rotNow() {
  return rotElapsed + (rotating ? ((nowMs() - rotMark) / 1000) * rotSpeed : 0);
}

// ── Custom force (anchors only) ──────────────────────────────────

// Epicyclic home spring — pulls every anchor toward its guiding
// center (_hx/_hy/_hz, the seeded density-wave position). The wave
// pattern lives in the homes; the sim only jiggles around them.
function forceHome() {
  let ns;
  function force(alpha) {
    const k = HOME_PULL * alpha;
    for (const n of ns) {
      n.vx = (n.vx || 0) + ((n._hx || 0) - (n.x || 0)) * k;
      n.vy = (n.vy || 0) + ((n._hy || 0) - (n.y || 0)) * k;
      n.vz = (n.vz || 0) + ((n._hz || 0) - (n.z || 0)) * k;
    }
  }
  force.initialize = (n) => { ns = n; };
  return force;
}

// Per-edge link distance + strength — same tuning as the full sim
// had, minus the card kinds (cards aren't simulated anymore).
// Scaffold edges (membership/share) barely tug; wsroot keeps a
// workspace anchor near its boards; hierarchy nests sub-boards.
function linkDistance(l) {
  switch (l.kind) {
    case 'membership':
    case 'share':     return 500;
    case 'wsroot':    return 80 * orbitJitter(targetId(l));
    default:          return 36 * orbitJitter(targetId(l));   // hierarchy
  }
}
function linkStrength(l) {
  switch (l.kind) {
    case 'membership':
    case 'share':     return 0.015;
    case 'wsroot':    return 0.25;
    default:          return 0.6;
  }
}

// Boards repel proportionally to the sqrt of their card swarm so big
// galaxies keep the elbow room the per-card charge used to buy them,
// times the anchor's hashed mass so spacing never comes out even.
function chargeStrength(n) {
  const leaves = leafCounts.get(n.id) || 0;
  return CHARGE_STRENGTH * (n._m || 1) * (1 + Math.sqrt(leaves) / 3);
}

// ── Galaxy seeding — kinematic density waves ─────────────────────
// Every anchor gets a guiding center from galaxySeed (precessing-
// ellipse orbits on an exponential disk — the arms emerge as orbit
// crowding, see lib/universeLayout.js), then structural children are
// re-homed beside their parents. The sim starts ~settled: warmup
// drops to a blink and, because the home spring anchors everything,
// the live settle can't relax the wave pattern away.
//
// wsCount sets the disk radius AND the twist normalization, so it
// must be identical for every star of one layout — init pre-counts
// the whole snapshot before seeding (a per-arrival count desyncs
// ω(a) across the population and smears the arms into mush). Live
// deltas seed against the then-current count; the next reload
// re-seeds everything coherently.
let wsCount = 0;

// Disk radius = DISK_COEFF · sqrt(workspaces).
//
// Raised from 60. Scaling the whole layout uniformly IS invisible —
// the camera auto-fits, which is a lever this repo already tried and
// reverted. But this is not uniform: leaf orbits (LEAF_BASE_RADIUS)
// deliberately do NOT scale with it, so what actually changes is the
// RATIO of a board's card swarm to the disk. At 60 a single board's
// swarm spanned ~16% of the galaxy's diameter, which smears any arm
// it sits on into the background. At 150 it is ~3%, and the lanes
// survive.
const DISK_COEFF = 150;

// Seeds an anchor onto the disk AT THE GALAXY'S CURRENT PHASE. A
// node that arrives an hour into a session must land where its orbit
// has actually carried it by now — seeding it at phase zero would
// drop it on the far side of the disk and then snap it across the
// screen the moment rotation resumed.
function seedDisk(a) {
  const R = DISK_COEFF * Math.sqrt(Math.max(1, wsCount));
  const t = rotNow();
  a._ga = galaxyOrbit(a.id, R).a;
  galaxySeed(a.id, R, _seedTmp, 0, 0);
  a._th0 = Math.atan2(_seedTmp[2], _seedTmp[0]);
  if (t > 0) {
    galaxySeed(a.id, R, _seedTmp,
               orbitalRate(a._ga, R) * t, GALAXY_PATTERN_RATE * t);
  }
  a.x = _seedTmp[0];
  // Thick-disk drifters (~15%) float at 3× the local scale height,
  // like real halo objects.
  a.y = _seedTmp[1] * (a._d < 1 ? 3 : 1);
  a.z = _seedTmp[2];
  setHome(a);
}
const _seedTmp = new Float32Array(3);

function setHome(a) {
  a._hx = a.x; a._hy = a.y; a._hz = a.z;
}

// Place (and re-home) structural children next to their parents so
// link forces start near equilibrium AND the home spring agrees with
// the hierarchy: boards beside their workspace, sub-boards beside
// their parent board (two passes cover grandchildren), users beside
// their first workspace.
// child anchor id → parent anchor id, in the order placeNear ran.
// Rotation replays this list so a subtree is rebuilt parent-first.
let rehomeOrder = [];
const rehomedIds = new Set();

function placeNear(parentId, childId, base) {
  const p = anchorById.get(parentId);
  const c = anchorById.get(childId);
  if (!p || !c) return;
  if (!rehomedIds.has(childId)) {
    rehomedIds.add(childId);
    rehomeOrder.push({ child: childId, parent: parentId });
  }
  rotArmed = false;   // topology moved; recapture before rotating again
  const jr = base * orbitJitter(childId);
  const th = 2 * Math.PI * hash01(childId + ':sp');
  c.x = p.x + jr * Math.cos(th);
  c.y = p.y + (2 * hash01(childId + ':spy') - 1) * jr * 0.3;
  c.z = p.z + jr * Math.sin(th);
  setHome(c);
}

function seedChildrenNearParents(linksArr) {
  for (const l of linksArr) {
    if (l.kind === 'wsroot') placeNear(l.source, l.target, 80);
  }
  for (let pass = 0; pass < 2; pass++) {
    for (const l of linksArr) {
      if (l.kind === 'hierarchy') placeNear(l.source, l.target, 36);
    }
  }
  const placedUsers = new Set();
  for (const l of linksArr) {
    if (l.kind !== 'membership' || placedUsers.has(l.source)) continue;
    placedUsers.add(l.source);
    placeNear(l.target, l.source, 120);
  }
}

// Repulsion is CAPPED at 160 units: it may untangle neighboring
// systems, but it must never see — let alone flatten — structure at
// arm wavelength (1000+). Unbounded n-body charge equalizes bulk
// density, and the density wave IS bulk density; with the cap, the
// arms the seeding builds actually survive the settle.
const CHARGE_REACH = 90;

function buildSim() {
  sim = forceSimulation(anchors, 3)
    .force('link',    forceLink(simLinks).id(d => d.id).distance(linkDistance).strength(linkStrength))
    .force('charge',  forceManyBody().strength(chargeStrength).distanceMax(CHARGE_REACH))
    .force('center',  forceCenter())
    .force('home',    forceHome())
    .alphaDecay(0.04)
    .velocityDecay(0.32)
    .stop();
}

function addNode(n, preCounted = false) {
  if (isAnchorId(n.id)) {
    if (!preCounted && n.id.startsWith('ws:')) wsCount++;
    const a = {
      id: n.id, val: n.val,
      // Hashed physics personality: _m = charge mass (ragged spacing),
      // _d < 1 marks a thick-disk drifter (seeded off-plane).
      _m: 0.5 + 1.3 * hash01(n.id + ':m'),
      _d: hash01(n.id + ':d') > 0.85 ? 0.12 : 1,
    };
    seedDisk(a);
    anchors.push(a);
    anchorById.set(n.id, a);
    order.push({ anchor: a });
  } else {
    const parentId = parentBoardId(n.id);
    let off;
    if (parentId) {
      const idx = leafCounts.get(parentId) || 0;
      leafCounts.set(parentId, idx + 1);
      if (idx < SYSTEM_RING_COUNT) {
        // An inner planet — remember it as a potential moon host.
        const hosts = leafHosts.get(parentId);
        if (hosts) hosts.push({ id: n.id, idx });
        else leafHosts.set(parentId, [{ id: n.id, idx }]);
        off = orbitOffset(n.id, idx);
      } else {
        // Belt-era arrivals: ~18% become MOONS of an inner planet
        // (planetary systems only — debris clouds have no planets to
        // host them). The host's offset is recomputed deterministically
        // from its id + ring index, so moons need no stored state
        // beyond the host list.
        const hosts = leafHosts.get(parentId);
        if (hosts && hosts.length &&
            hash01(n.id + ':moon') < 0.18 &&
            systemArchetype(parentId) === 'planetary') {
          const host = hosts[Math.floor(hash01(n.id + ':mh') * hosts.length)];
          off = moonOffset(n.id, orbitOffset(host.id, host.idx));
        } else {
          off = orbitOffset(n.id, idx);
        }
      }
    } else {
      off = rogueOffset(n.id);
    }
    order.push({ parentId, off });
  }
}

// ── Rotation engine ──────────────────────────────────────────────

// Rodrigues rotation matrix about a unit axis, row-major 3x3.
function rodrigues(kx, ky, kz, th) {
  const c = Math.cos(th), s = Math.sin(th), C = 1 - c;
  return [
    c + kx * kx * C,      kx * ky * C - kz * s, kx * kz * C + ky * s,
    ky * kx * C + kz * s, c + ky * ky * C,      ky * kz * C - kx * s,
    kz * kx * C - ky * s, kz * ky * C + kx * s, c + kz * kz * C,
  ];
}

// Rotation about +Y by th, matching the atan2(z, x) convention used
// for the guiding centres: (x,z) = r(cos th, sin th).
function yaw(v0, v2, th) {
  const c = Math.cos(th), s = Math.sin(th);
  return [v0 * c - v2 * s, v0 * s + v2 * c];
}

const _rotTmp = new Float32Array(3);
function diskR() { return DISK_COEFF * Math.sqrt(Math.max(1, wsCount)); }

// Angle a free anchor's guiding centre has swept by time t.
function sweptAngle(a, R, t) {
  galaxySeed(a.id, R, _rotTmp, orbitalRate(a._ga, R) * t, GALAXY_PATTERN_RATE * t);
  return Math.atan2(_rotTmp[2], _rotTmp[0]) - a._th0;
}

// Freeze what the force sim earned, so rotation can carry it rigidly.
// Offsets and residuals are stored in the LOCAL frame (un-rotated by
// however far their carrier has already swept), which is what lets
// this be re-run after a delta re-settle without the galaxy jumping.
function captureRotation() {
  const R = diskR();
  for (const a of anchors) a._rehomed = false;
  for (const e of rehomeOrder) {
    const c = anchorById.get(e.child);
    if (c) c._rehomed = true;
  }
  // Free anchors — workspaces, plus anything no parent ever claimed.
  for (const a of anchors) {
    if (a._rehomed) continue;
    a._ga = galaxyOrbit(a.id, R).a;
    galaxySeed(a.id, R, _rotTmp, 0, 0);
    a._th0 = Math.atan2(_rotTmp[2], _rotTmp[0]);
    a._dth = sweptAngle(a, R, rotElapsed);
  }
  // Children inherit their carrier's angle, parent-first.
  for (let i = 0; i < rehomeOrder.length; i++) {
    const p = anchorById.get(rehomeOrder[i].parent);
    const c = anchorById.get(rehomeOrder[i].child);
    if (p && c) c._dth = p._dth || 0;
  }
  // Local offset of each child from its parent's guiding centre.
  for (let i = 0; i < rehomeOrder.length; i++) {
    const p = anchorById.get(rehomeOrder[i].parent);
    const c = anchorById.get(rehomeOrder[i].child);
    if (!p || !c) continue;
    const o = yaw(c._hx - p._hx, c._hz - p._hz, -(p._dth || 0));
    c._ox = o[0]; c._oy = c._hy - p._hy; c._oz = o[1];
  }
  // The local jiggle: how far the forces pushed each anchor off home.
  for (const a of anchors) {
    const r = yaw(a.x - a._hx, a.z - a._hz, -(a._dth || 0));
    a._rx = r[0]; a._ry = a.y - a._hy; a._rz = r[1];
  }
  rotArmed = true;
}

// Rebuild every position for time t. No forces run here at all.
function applyRotation(t) {
  const R = diskR();
  for (const a of anchors) {
    if (a._rehomed) continue;
    galaxySeed(a.id, R, _rotTmp, orbitalRate(a._ga, R) * t, GALAXY_PATTERN_RATE * t);
    a._hx = _rotTmp[0];
    a._hy = _rotTmp[1] * (a._d < 1 ? 3 : 1);   // thick-disk drifters, as seedDisk
    a._hz = _rotTmp[2];
    a._dth = Math.atan2(_rotTmp[2], _rotTmp[0]) - a._th0;
  }
  for (let i = 0; i < rehomeOrder.length; i++) {
    const p = anchorById.get(rehomeOrder[i].parent);
    const c = anchorById.get(rehomeOrder[i].child);
    if (!p || !c) continue;
    const th = p._dth || 0;
    const o = yaw(c._ox, c._oz, th);
    c._hx = p._hx + o[0];
    c._hy = p._hy + c._oy;
    c._hz = p._hz + o[1];
    c._dth = th;
  }
  for (const a of anchors) {
    const th = a._dth || 0;
    const r = yaw(a._rx, a._rz, th);
    a.x = a._hx + r[0];
    a.y = a._hy + a._ry;
    a.z = a._hz + r[1];
  }
  buildLeafMatrices(t);
}

// One 3x3 per board carries its whole card swarm: the system's own
// spin in its own tilted plane, the galactic angle its board has
// swept, and the zoom-driven tightening — folded into a single
// matrix so a card costs nine multiplies and no trigonometry.
function buildLeafMatrices(t) {
  leafMat.clear();
  for (const boardId of leafCounts.keys()) {
    const b = anchorById.get(boardId);
    const pl = systemPlane(boardId);
    const R1 = rodrigues(pl.n[0], pl.n[1], pl.n[2], systemSpin(boardId) * t);
    const th = (b && b._dth) || 0;
    const c = Math.cos(th), sn = Math.sin(th), k = systemScale;
    // Ry(th) · R1 · systemScale
    leafMat.set(boardId, [
      (c * R1[0] + sn * R1[6]) * k, (c * R1[1] + sn * R1[7]) * k, (c * R1[2] + sn * R1[8]) * k,
      R1[3] * k,                    R1[4] * k,                    R1[5] * k,
      (-sn * R1[0] + c * R1[6]) * k, (-sn * R1[1] + c * R1[7]) * k, (-sn * R1[2] + c * R1[8]) * k,
    ]);
  }
}

function rotateLoop() {
  if (stopped || paused || !sim || !rotating) return;
  try {
    applyRotation(rotNow());
    postTick();
  } catch (e) {
    rotating = false;
    self.postMessage({ type: 'error', reason: String(e?.message || e) });
    return;
  }
  tickTimer = setTimeout(rotateLoop, ROTATE_TICK_MS);
}

// Leaving rotate mode (a delta restarted the sim) banks the elapsed
// time so the next run picks the phase up exactly where it left off.
// Without this the galaxy would snap back to t=0 on every arrival.
function exitRotate() {
  if (!rotating) return;
  rotElapsed = rotNow();
  rotating = false;
  leafMat.clear();
}

function enterRotate() {
  if (order.length > ROTATE_MAX_NODES) {
    // Too big to rebuild per frame — hand the main thread a single
    // rigid spin instead. No shear, but no cost either, and it is
    // announced rather than silently dropped.
    if (!rigidRate) {
      rigidRate = GALAXY_PATTERN_RATE * 4;
      self.postMessage({ type: 'rotate', mode: 'rigid', rate: rigidRate,
                         count: order.length });
    }
    return false;
  }
  if (!rotArmed) captureRotation();
  rotMark = nowMs();
  rotating = true;
  return true;
}

function ensurePositionsCapacity() {
  const needed = order.length * 3;
  if (!positions || positions.length < needed) {
    let cap = 1024 * 3;
    while (cap < needed) cap *= 2;
    positions = new Float32Array(cap);
  }
}

function fillPositions() {
  ensurePositionsCapacity();
  for (let i = 0; i < order.length; i++) {
    const e = order[i];
    const base = i * 3;
    if (e.anchor) {
      positions[base]     = e.anchor.x || 0;
      positions[base + 1] = e.anchor.y || 0;
      positions[base + 2] = e.anchor.z || 0;
    } else {
      // Leaf: parent board position + fixed local orbit. A leaf whose
      // board hasn't arrived yet orbits the origin at rogue distance
      // and snaps into place the moment the board shows up.
      const p = e.parentId ? anchorById.get(e.parentId) : null;
      const off = e.off;
      const m = p && leafMat.size ? leafMat.get(e.parentId) : null;
      if (p && m) {
        positions[base]     = (p.x || 0) + m[0] * off[0] + m[1] * off[1] + m[2] * off[2];
        positions[base + 1] = (p.y || 0) + m[3] * off[0] + m[4] * off[1] + m[5] * off[2];
        positions[base + 2] = (p.z || 0) + m[6] * off[0] + m[7] * off[1] + m[8] * off[2];
      } else if (p) {
        positions[base]     = (p.x || 0) + off[0];
        positions[base + 1] = (p.y || 0) + off[1];
        positions[base + 2] = (p.z || 0) + off[2];
      } else {
        positions[base]     = off[0];
        positions[base + 1] = off[1];
        positions[base + 2] = off[2];
      }
    }
  }
}

function postTick() {
  fillPositions();
  // postMessage transfers the buffer (zero-copy). We immediately
  // re-allocate so the next tick has its own backing store.
  const out = positions;
  positions = null;
  self.postMessage({ type: 'tick', positions: out, count: order.length }, [out.buffer]);
}

function scheduleNext() {
  if (stopped || paused || !sim) return;
  if (sim.alpha() <= sim.alphaMin()) {
    // Settled. The old worker slept here forever, which is why the
    // universe was a still photograph. Now the forces stand down and
    // the galaxy starts turning.
    if (enterRotate()) tickTimer = setTimeout(rotateLoop, ROTATE_TICK_MS);
    return;
  }
  tickTimer = setTimeout(loop, HOT_TICK_MS);
}

function loop() {
  if (stopped || paused || !sim) return;
  try {
    sim.tick();
    postTick();
  } catch (e) {
    self.postMessage({ type: 'error', reason: String(e?.message || e) });
  }
  scheduleNext();
}

// After adds, forces that cache per-node values (charge strengths,
// link endpoints) must re-initialize against the mutated arrays.
function rebindForces() {
  sim.nodes(anchors);
  sim.force('link', forceLink(simLinks).id(d => d.id).distance(linkDistance).strength(linkStrength));
  sim.force('charge', forceManyBody().strength(chargeStrength).distanceMax(CHARGE_REACH));
}

// A sim link with a non-anchor endpoint would make d3's id resolver
// throw and kill the sim. The server never produces one (hierarchy /
// wsroot / membership / share are anchor-anchor by construction), but
// a guard is cheaper than a dead universe.
function acceptSimLink(l) {
  return isSimLinkKind(l.kind) && isAnchorId(l.source) && isAnchorId(l.target);
}

self.onmessage = (ev) => {
  const msg = ev.data;
  if (!msg || typeof msg !== 'object') return;

  switch (msg.type) {
    case 'init': {
      order = []; anchors = []; anchorById = new Map();
      simLinks = []; leafCounts = new Map(); leafHosts = new Map();
      rehomeOrder = []; rehomedIds.clear(); leafMat.clear();
      rotating = false; rotArmed = false; rotElapsed = 0; rigidRate = 0;
      // Pre-count workspaces so every seed shares one disk scale.
      wsCount = 0;
      for (const n of msg.nodes || []) {
        if (typeof n.id === 'string' && n.id.startsWith('ws:')) wsCount++;
      }
      for (const n of msg.nodes || []) addNode(n, true);
      for (const l of msg.links || []) {
        if (acceptSimLink(l)) simLinks.push({ ...l });
      }
      // Anchors are already disk-seeded (addNode); snap structural
      // children next to their parents so link forces start near
      // equilibrium instead of dragging boards across the galaxy.
      seedChildrenNearParents(simLinks);
      buildSim();
      // Seeding replaces most of the old 200-tick synchronous warmup:
      // a short blocking burst tidies the worst overlaps, then the
      // first frame ships and the remaining settle plays out LIVE as
      // gentle congealing — the user watches a galaxy form instead of
      // staring at "Calibrating…".
      const warmup = anchors.length > 20000 ? 25
                   : anchors.length > 5000  ? 40
                   : 60;
      for (let i = 0; i < warmup; i++) sim.tick();
      postTick();
      self.postMessage({ type: 'ready' });
      scheduleNext();
      return;
    }

    case 'addNodes': {
      if (!sim || !Array.isArray(msg.nodes) || msg.nodes.length === 0) return;
      // NO dedupe here: the main thread guarantees each node id is
      // sent exactly once, and positions[i] must stay index-aligned
      // with its refs.nodes[i]. (The old worker deduped while the
      // main thread didn't — one duplicate delta and every position
      // after it rendered on the wrong node, forever.)
      for (const n of msg.nodes) addNode(n);
      rebindForces();
      exitRotate();                   // bank the phase; the sim takes over again
      rotArmed = false;               // new anchors → recapture residuals on settle
      sim.alpha(ALPHA_RESTART);       // sim was built stopped; we drive ticks ourselves
      if (tickTimer) clearTimeout(tickTimer);
      // Post immediately so freshly-added leaves appear this frame
      // even if every anchor is already settled.
      postTick();
      scheduleNext();
      return;
    }

    case 'addLinks': {
      if (!sim || !Array.isArray(msg.links) || msg.links.length === 0) return;
      let simRelevant = 0;
      for (const l of msg.links) {
        if (acceptSimLink(l)) {
          simLinks.push({ ...l });
          simRelevant++;
          // A live delta anchor seeded onto the disk before its
          // structural link arrived — snap it (and its home) beside
          // its parent now, like the init-time pass would have.
          if (l.kind === 'wsroot')    placeNear(l.source, l.target, 80);
          if (l.kind === 'hierarchy') placeNear(l.source, l.target, 36);
        }
      }
      if (simRelevant === 0) return;  // pure card links don't move anything
      rebindForces();
      exitRotate();
      rotArmed = false;
      sim.alpha(ALPHA_RESTART);
      if (tickTimer) clearTimeout(tickTimer);
      scheduleNext();
      return;
    }

    case 'pause': {
      paused = true;
      // Bank the elapsed phase: a backgrounded tab must not come back
      // having "rotated" for the twenty minutes it was hidden.
      exitRotate();
      if (tickTimer) { clearTimeout(tickTimer); tickTimer = null; }
      return;
    }
    case 'resume': {
      if (!paused) return;
      paused = false;
      if (sim) { scheduleNext(); }
      return;
    }

    // Camera distance drives how tightly each board's cards orbit, so
    // the far view reads as a smooth star field and the detail scales
    // back in as you fly down. Positions stay real, so picking and
    // hover need no special-casing.
    // prefers-reduced-motion, and any future speed control. Banking
    // through exitRotate() first is what stops a speed change from
    // teleporting the galaxy: the phase is continuous, only its slope
    // changes.
    case 'rotateSpeed': {
      const v = Number(msg.value);
      if (!Number.isFinite(v) || v < 0) return;
      const wasRotating = rotating;
      exitRotate();
      rotSpeed = v;
      if (wasRotating && enterRotate()) {
        if (tickTimer) clearTimeout(tickTimer);
        tickTimer = setTimeout(rotateLoop, ROTATE_TICK_MS);
      }
      return;
    }

    case 'systemScale': {
      const v = Number(msg.value);
      if (!Number.isFinite(v) || v <= 0) return;
      systemScale = v;
      return;
    }
    case 'stop': {
      stopped = true;
      if (tickTimer) { clearTimeout(tickTimer); tickTimer = null; }
      return;
    }
  }
};
