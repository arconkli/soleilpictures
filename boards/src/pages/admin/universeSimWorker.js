// universeSimWorker — d3-force-3d simulation in a Web Worker.
//
// Owns the node + link arrays. Computes positions every tick and
// posts a transferable Float32Array back to the main thread. Main
// thread renders only; it never runs the simulation.
//
// In addition to the standard link/charge/center forces, two custom
// forces give the layout a galactic shape:
//   • forceDisk         — pulls Y toward 0 per-kind. Users and ws
//                         anchors flatten hardest (the galactic
//                         plane); cards barely (they keep volume,
//                         like inclined-orbit satellites).
//   • forceGalacticGrav — degree-weighted pull toward origin. Hub
//                         nodes sink into the bulge; leaves drift to
//                         the rim.
//
// Messages in:
//   { type: 'init',      nodes: [{ id, val }], links: [{ source, target }] }
//   { type: 'addNodes',  nodes: [{ id, val }] }
//   { type: 'addLinks',  links: [{ source, target }] }
//   { type: 'pause' } / { type: 'resume' } / { type: 'stop' }
//
// Messages out:
//   { type: 'ready' }
//   { type: 'tick',    positions, count }      — transferred Float32Array
//   { type: 'degrees', byId: { id: degree } }  — after init + every addLinks
//   { type: 'error',   reason }

import { forceSimulation, forceLink, forceManyBody, forceCenter } from 'd3-force-3d';

const WARMUP_TICKS = 200;
const HOT_TICK_MS  = 16;
const COLD_TICK_MS = 250;
const ALPHA_RESTART = 0.3;

// User said: clusters should look like home; only attract-to-center
// + spiral arms layered on top. So no per-kind disk flattening, no
// degree-weighted gravity, no bulge — just two extra forces.

// Center attraction — MINIMAL. Just enough to keep the universe
// bounded so the spiral force has something to wind around; the
// equilibrium between this and repulsion is what sets the overall
// universe radius. Was 0.05 — felt too dense.
const GRAVITY_PULL = 0.008;

// Repulsion between every pair of nodes. Higher → clusters push
// each other further apart, things "feel far apart". Was -90.
const CHARGE_STRENGTH = -200;

// Very gentle Y-flattening so spiral arms can actually read as arms.
const DISK_PULL = 0.03;

// Spiral arms.
const NUM_ARMS        = 2;
const SPIRAL_PITCH    = 0.45;
const SPIRAL_STRENGTH = 0.06;
const SPIRAL_INNER_R  = 60;

let nodes = [];
let links = [];
let sim   = null;
let positions = null;
let paused    = false;
let stopped   = false;
let tickTimer = null;
// ── Custom forces ────────────────────────────────────────────────

// Pull every node toward the origin uniformly. d3's forceCenter only
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

// Tangential nudge that biases each node toward its nearest of N
// logarithmic spiral arms. Bulge nodes (r < SPIRAL_INNER_R) are
// exempt. The bias composes additively with the radial gravity and
// disk forces — clusters stay clustered, they just lean into arms.
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
      // Find the arm whose target angle is closest to the node's theta.
      let bestDelta = Infinity;
      for (let a = 0; a < NUM_ARMS; a++) {
        let d = curve + armOffsets[a] - theta;
        // Wrap to (-π, π].
        d = ((d + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
        if (Math.abs(d) < Math.abs(bestDelta)) bestDelta = d;
      }
      // Tangent direction at (x, z) in the disk plane is (-z, x) / r.
      // Velocity nudge perpendicular to position, magnitude scales with
      // how far off the arm we are.
      const k = bestDelta * strength;
      n.vx = (n.vx || 0) + (-z) * k;
      n.vz = (n.vz || 0) + ( x) * k;
    }
  }
  force.initialize = (n) => { ns = n; };
  return force;
}

// Per-edge link distance + strength. Cross-workspace "scaffold"
// edges (membership: user→ws, share: user→board) are intentionally
// near-zero strength + huge ideal distance so they don't yank
// workspaces together — they barely tug, just enough that connected
// people lean their clusters in each other's direction. Wsroot
// (ws→its own top-level boards) is in between: it should keep the
// workspace anchor near its content without forcing tight packing.
function linkDistance(l) {
  switch (l.kind) {
    case 'membership':
    case 'share':     return 500;
    case 'wsroot':    return 80;
    default:          return 36;
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

function buildSim() {
  sim = forceSimulation(nodes, 3)
    .force('link',    forceLink(links).id(d => d.id).distance(linkDistance).strength(linkStrength))
    .force('charge',  forceManyBody().strength(CHARGE_STRENGTH))
    .force('center',  forceCenter())
    .force('pull',    forcePull())
    .force('disk',    forceDiskLite())
    .force('spiral',  forceSpiral())
    .alphaDecay(0.04)
    .velocityDecay(0.32)
    .stop();
}

function ensurePositionsCapacity() {
  const needed = nodes.length * 3;
  if (!positions || positions.length < needed) {
    // Round up to next power of two for headroom on adds.
    let cap = 1024 * 3;
    while (cap < needed) cap *= 2;
    positions = new Float32Array(cap);
  }
}

function fillPositions() {
  ensurePositionsCapacity();
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    positions[i * 3]     = n.x || 0;
    positions[i * 3 + 1] = n.y || 0;
    positions[i * 3 + 2] = n.z || 0;
  }
}

function postTick() {
  fillPositions();
  // postMessage transfers the buffer (zero-copy). We immediately
  // re-allocate so the next tick has its own backing store.
  const out = positions;
  positions = null;
  self.postMessage({ type: 'tick', positions: out, count: nodes.length }, [out.buffer]);
}

function scheduleNext() {
  if (stopped || paused || !sim) return;
  const interval = sim.alpha() > sim.alphaMin() ? HOT_TICK_MS : COLD_TICK_MS;
  tickTimer = setTimeout(loop, interval);
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

self.onmessage = (ev) => {
  const msg = ev.data;
  if (!msg || typeof msg !== 'object') return;

  switch (msg.type) {
    case 'init': {
      nodes = (msg.nodes || []).map(n => ({ ...n }));
      links = (msg.links || []).map(l => ({ ...l }));
      buildSim();
      // Run warmup synchronously so the first frame the user sees
      // is already-settled, not bouncing into place.
      for (let i = 0; i < WARMUP_TICKS; i++) sim.tick();
      postTick();
      self.postMessage({ type: 'ready' });
      scheduleNext();
      return;
    }

    case 'addNodes': {
      if (!sim || !Array.isArray(msg.nodes) || msg.nodes.length === 0) return;
      const existing = new Set(nodes.map(n => n.id));
      for (const n of msg.nodes) {
        if (existing.has(n.id)) continue;
        nodes.push({ ...n });
        existing.add(n.id);
      }
      sim.nodes(nodes);
      sim.alpha(ALPHA_RESTART).restart();
      if (tickTimer) clearTimeout(tickTimer);
      scheduleNext();
      return;
    }

    case 'addLinks': {
      if (!sim || !Array.isArray(msg.links) || msg.links.length === 0) return;
      for (const l of msg.links) links.push({ ...l });
      // Re-bind forceLink so it picks up the extended array. d3-force
      // resolves string ids → node refs the first time you tick.
      sim.force('link', forceLink(links).id(d => d.id).distance(linkDistance).strength(linkStrength));
      sim.alpha(ALPHA_RESTART).restart();
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
      if (sim) { sim.alpha(Math.max(sim.alpha(), 0.05)).restart(); scheduleNext(); }
      return;
    }
    case 'stop': {
      stopped = true;
      if (tickTimer) { clearTimeout(tickTimer); tickTimer = null; }
      return;
    }
  }
};
