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
import { orbitJitter, targetId } from '../../lib/hashJitter.js';
import {
  isAnchorId, parentBoardId, isSimLinkKind, orbitOffset, rogueOffset,
} from '../../lib/universeLayout.js';

const WARMUP_TICKS = 200;
const HOT_TICK_MS  = 16;
const ALPHA_RESTART = 0.3;

// Center attraction — MINIMAL. Just enough to keep the universe
// bounded so the spiral force has something to wind around.
const GRAVITY_PULL = 0.008;

// Base repulsion between anchors. Boards scale this up with the size
// of their card swarm (see chargeStrength) so a 300-card galaxy claims
// proportionally more space than an empty board.
const CHARGE_STRENGTH = -200;

// Very gentle Y-flattening so spiral arms can actually read as arms.
const DISK_PULL = 0.03;

// Spiral arms.
const NUM_ARMS        = 2;
const SPIRAL_PITCH    = 0.45;
const SPIRAL_STRENGTH = 0.06;
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

// Pull every anchor toward the origin uniformly. d3's forceCenter only
// pins the centroid; this is what actually drags everything in.
function forcePull() {
  let ns;
  function force(alpha) {
    for (const n of ns) {
      const k = GRAVITY_PULL * alpha;
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
      n.vy = (n.vy || 0) - (n.y || 0) * DISK_PULL * alpha;
    }
  }
  force.initialize = (n) => { ns = n; };
  return force;
}

// Tangential nudge that biases each anchor toward its nearest of N
// logarithmic spiral arms. Bulge anchors (r < SPIRAL_INNER_R) are
// exempt. Cards inherit the spiral by riding their board.
function forceSpiral() {
  let ns;
  const armOffsets = new Float32Array(NUM_ARMS);
  for (let i = 0; i < NUM_ARMS; i++) armOffsets[i] = (2 * Math.PI * i) / NUM_ARMS;
  function force(alpha) {
    const strength = SPIRAL_STRENGTH * alpha;
    for (const n of ns) {
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
      const k = bestDelta * strength;
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
// galaxies keep the elbow room the per-card charge used to buy them.
function chargeStrength(n) {
  const leaves = leafCounts.get(n.id) || 0;
  return CHARGE_STRENGTH * (1 + Math.sqrt(leaves) / 3);
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
    const a = { id: n.id, val: n.val };
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
      simLinks = []; leafCounts = new Map();
      for (const n of msg.nodes || []) addNode(n);
      for (const l of msg.links || []) {
        if (acceptSimLink(l)) simLinks.push({ ...l });
      }
      buildSim();
      // Run warmup synchronously so the first frame the user sees
      // is already-settled, not bouncing into place. Anchors only,
      // so this stays fast no matter how many cards exist — and at
      // extreme anchor counts (tens of thousands of boards) fewer
      // ticks buy a near-identical layout for a fraction of the
      // startup stall.
      const warmup = anchors.length > 20000 ? 60
                   : anchors.length > 5000  ? 120
                   : WARMUP_TICKS;
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
