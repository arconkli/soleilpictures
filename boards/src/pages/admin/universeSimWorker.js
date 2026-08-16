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
  isAnchorId, parentBoardId, isSimLinkKind, orbitOffset, rogueOffset,
} from '../../lib/universeLayout.js';

const HOT_TICK_MS  = 16;
const ALPHA_RESTART = 0.3;

// Center attraction — MINIMAL. Just enough to keep the universe
// bounded so the spiral force has something to wind around. Every
// anchor carries a hashed personal multiplier (_g) so some sit deep
// and some drift wide — a uniform pull makes a uniform ring.
const GRAVITY_PULL = 0.008;

// Base repulsion between anchors. Boards scale this up with the size
// of their card swarm (see chargeStrength) so a 300-card galaxy claims
// proportionally more space than an empty board — and every anchor
// gets a hashed mass (_m) so spacing comes out ragged, not even.
const CHARGE_STRENGTH = -200;

// Very gentle Y-flattening so spiral arms can actually read as arms.
// ~15% of anchors get a near-zero personal factor (_d): thick-disk
// drifters that float off the plane like real halo objects.
const DISK_PULL = 0.03;

// Spiral arms — deliberately LOOSE: ~30% of anchors are "field stars"
// that ignore the arms entirely (_a = 0), the rest lean in with
// varied enthusiasm, so the arms read as ragged lanes instead of
// drawn curves.
const NUM_ARMS        = 2;
const SPIRAL_PITCH    = 0.45;
const SPIRAL_STRENGTH = 0.08;
const SPIRAL_INNER_R  = 60;

// ── Hierarchical state ───────────────────────────────────────────
// order[i] mirrors the main thread's node index i:
//   anchors: { anchor: <sim node> }
//   leaves:  { parentId, off: Float32Array(3) }
let order       = [];
let anchors     = [];            // d3 sim nodes (mutated in place)
let anchorById  = new Map();     // id → sim node
let simLinks    = [];            // anchor-anchor links only
let leafCounts  = new Map();     // board anchor id → leaf count (orbital shells + charge)
let sim         = null;
let positions   = null;
let paused      = false;
let stopped     = false;
let tickTimer   = null;

// ── Custom forces (anchors only) ─────────────────────────────────
// Each force reads the anchor's hashed personality factors (_g pull,
// _d disk, _a arm affinity) so no two anchors feel identical physics
// — uniform forces are what made the old layout look machine-even.

// Pull every anchor toward the origin. d3's forceCenter only pins the
// centroid; this is what actually drags everything in.
function forcePull() {
  let ns;
  function force(alpha) {
    for (const n of ns) {
      const k = GRAVITY_PULL * (n._g || 1) * alpha;
      n.vx = (n.vx || 0) - (n.x || 0) * k;
      n.vy = (n.vy || 0) - (n.y || 0) * k;
      n.vz = (n.vz || 0) - (n.z || 0) * k;
    }
  }
  force.initialize = (n) => { ns = n; };
  return force;
}

// Very gentle pull toward the Y=0 plane so spiral arms can read.
function forceDiskLite() {
  let ns;
  function force(alpha) {
    for (const n of ns) {
      n.vy = (n.vy || 0) - (n.y || 0) * DISK_PULL * (n._d ?? 1) * alpha;
    }
  }
  force.initialize = (n) => { ns = n; };
  return force;
}

// Tangential nudge that biases each anchor toward its nearest of N
// logarithmic spiral arms. Bulge anchors (r < SPIRAL_INNER_R) and
// field stars (_a = 0) are exempt. Cards inherit the spiral by riding
// their board.
function forceSpiral() {
  let ns;
  const armOffsets = new Float32Array(NUM_ARMS);
  for (let i = 0; i < NUM_ARMS; i++) armOffsets[i] = (2 * Math.PI * i) / NUM_ARMS;
  function force(alpha) {
    const strength = SPIRAL_STRENGTH * alpha;
    for (const n of ns) {
      const affinity = n._a ?? 1;
      if (affinity === 0) continue;
      const x = n.x || 0, z = n.z || 0;
      const r2 = x * x + z * z;
      if (r2 < SPIRAL_INNER_R * SPIRAL_INNER_R) continue;
      const r = Math.sqrt(r2);
      const theta = Math.atan2(z, x);
      const curve = SPIRAL_PITCH * Math.log(r);
      let bestDelta = Infinity;
      for (let a = 0; a < NUM_ARMS; a++) {
        let d = curve + armOffsets[a] - theta;
        d = ((d + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
        if (Math.abs(d) < Math.abs(bestDelta)) bestDelta = d;
      }
      const k = bestDelta * strength * affinity;
      n.vx = (n.vx || 0) + (-z) * k;
      n.vz = (n.vz || 0) + ( x) * k;
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

// ── Galaxy-shaped seeding ────────────────────────────────────────
// d3's default init spreads nodes on an even phyllotaxis ball, which
// takes ~200 warmup ticks to relax and STILL converges to even
// porridge. Seeding anchors straight into an exponential disk with
// loose arm bias means the sim starts ~settled: warmup drops to a
// blink, and the layout keeps the ragged structure instead of
// relaxing it away. All hash-keyed on ids — stable across reloads.
let wsCount = 0;

function seedDisk(a) {
  const R = 60 * Math.sqrt(Math.max(1, wsCount));
  const r = R * Math.pow(hash01(a.id + ':sr'), 0.6);      // dense core, thin rim
  let theta = 2 * Math.PI * hash01(a.id + ':sθ');
  if (a._a > 0 && r > SPIRAL_INNER_R) {
    // Lean arm-affine anchors toward a spiral lane, scattered wide.
    const arm = Math.floor(hash01(a.id + ':sa') * NUM_ARMS);
    const armTheta = SPIRAL_PITCH * Math.log(r) + (2 * Math.PI * arm) / NUM_ARMS;
    const scatter = (hash01(a.id + ':ss') + hash01(a.id + ':ss2') - 1) * 0.9;
    const w = 0.55 + 0.35 * hash01(a.id + ':sw');
    theta = theta * (1 - w) + (armTheta + scatter) * w;
  }
  const thick = a._d < 1 ? 0.6 : 0.18;                    // drifters float higher
  a.x = r * Math.cos(theta);
  a.y = r * Math.pow(2 * hash01(a.id + ':sy') - 1, 3) * thick;
  a.z = r * Math.sin(theta);
}

// Re-seed structural children next to their parents so link forces
// start near equilibrium: boards beside their workspace, sub-boards
// beside their parent board (two passes cover grandchildren), users
// beside their first workspace.
function seedChildrenNearParents(linksArr) {
  const placeNear = (parentId, childId, base) => {
    const p = anchorById.get(parentId);
    const c = anchorById.get(childId);
    if (!p || !c) return;
    const jr = base * orbitJitter(childId);
    const th = 2 * Math.PI * hash01(childId + ':sp');
    c.x = p.x + jr * Math.cos(th);
    c.y = p.y + (2 * hash01(childId + ':spy') - 1) * jr * 0.3;
    c.z = p.z + jr * Math.sin(th);
  };
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

function buildSim() {
  sim = forceSimulation(anchors, 3)
    .force('link',    forceLink(simLinks).id(d => d.id).distance(linkDistance).strength(linkStrength))
    .force('charge',  forceManyBody().strength(chargeStrength))
    .force('center',  forceCenter())
    .force('pull',    forcePull())
    .force('disk',    forceDiskLite())
    .force('spiral',  forceSpiral())
    .alphaDecay(0.04)
    .velocityDecay(0.32)
    .stop();
}

function addNode(n) {
  if (isAnchorId(n.id)) {
    if (n.id.startsWith('ws:')) wsCount++;
    const a = {
      id: n.id, val: n.val,
      // Hashed physics personality — see the force comments above.
      _m: 0.5 + 1.3 * hash01(n.id + ':m'),
      _g: 0.6 + 0.8 * hash01(n.id + ':g'),
      _d: hash01(n.id + ':d') > 0.85 ? 0.12 : 1,
      _a: hash01(n.id + ':a') < 0.3 ? 0 : 0.7 + 0.6 * hash01(n.id + ':a2'),
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
      off = orbitOffset(n.id, idx);
    } else {
      off = rogueOffset(n.id);
    }
    order.push({ parentId, off });
  }
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
      if (p) {
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
  if (sim.alpha() <= sim.alphaMin()) return;   // settled — sleep until something changes
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
  sim.force('charge', forceManyBody().strength(chargeStrength));
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
      simLinks = []; leafCounts = new Map(); wsCount = 0;
      for (const n of msg.nodes || []) addNode(n);
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
        if (acceptSimLink(l)) { simLinks.push({ ...l }); simRelevant++; }
      }
      if (simRelevant === 0) return;  // pure card links don't move anything
      rebindForces();
      sim.alpha(ALPHA_RESTART);
      if (tickTimer) clearTimeout(tickTimer);
      scheduleNext();
      return;
    }

    case 'pause': {
      paused = true;
      if (tickTimer) { clearTimeout(tickTimer); tickTimer = null; }
      return;
    }
    case 'resume': {
      if (!paused) return;
      paused = false;
      if (sim) { sim.alpha(Math.max(sim.alpha(), 0.05)); scheduleNext(); }
      return;
    }
    case 'stop': {
      stopped = true;
      if (tickTimer) { clearTimeout(tickTimer); tickTimer = null; }
      return;
    }
  }
};
