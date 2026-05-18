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

// Galactic tunables. Bigger disk strength = flatter universe.
// Gravity weight scales how hard hubs sink toward the bulge.
const DISK_STRENGTH = {
  user:  0.18,
  ws:    0.14,
  board: 0.06,
  doc:   0.03,
  card:  0.02,
};
const GRAVITY_BASE   = 0.04;   // floor pull for everyone
const GRAVITY_DEGREE = 0.012;  // extra per sqrt(degree)

let nodes = [];
let links = [];
let sim   = null;
let positions = null;
let paused    = false;
let stopped   = false;
let tickTimer = null;
let degreeMap = new Map();

// id prefix → broad kind. Doc cards share the 'card:' prefix with
// other cards but get a bigger val (12 vs 8); use that to peel them
// off so they flatten a touch more aggressively than note/image cards.
function kindFromNode(n) {
  const id = n.id || '';
  if (id.startsWith('user:'))  return 'user';
  if (id.startsWith('ws:'))    return 'ws';
  if (id.startsWith('board:')) return 'board';
  if (n.val >= 12)             return 'doc';
  return 'card';
}

function diskStrength(n) {
  return DISK_STRENGTH[kindFromNode(n)] || DISK_STRENGTH.card;
}

function getDegree(id) {
  return degreeMap.get(id) || 0;
}

function recomputeDegrees() {
  degreeMap = new Map();
  for (const l of links) {
    const s = typeof l.source === 'string' ? l.source : l.source?.id;
    const t = typeof l.target === 'string' ? l.target : l.target?.id;
    if (s) degreeMap.set(s, (degreeMap.get(s) || 0) + 1);
    if (t) degreeMap.set(t, (degreeMap.get(t) || 0) + 1);
  }
}

function postDegrees() {
  // Plain-object payload (structured-cloned). At ~250k nodes this is
  // a few MB but only fires on init + each addLinks, not per tick.
  const byId = {};
  for (const [k, v] of degreeMap) byId[k] = v;
  self.postMessage({ type: 'degrees', byId });
}

// ── Custom forces ────────────────────────────────────────────────
function forceDisk() {
  let ns;
  function force(alpha) {
    for (const n of ns) {
      const s = diskStrength(n);
      n.vy = (n.vy || 0) - (n.y || 0) * s * alpha;
    }
  }
  force.initialize = (n) => { ns = n; };
  return force;
}

function forceGalacticGrav() {
  let ns;
  function force(alpha) {
    for (const n of ns) {
      const k = GRAVITY_BASE + Math.sqrt(getDegree(n.id)) * GRAVITY_DEGREE;
      n.vx = (n.vx || 0) - (n.x || 0) * k * alpha;
      n.vy = (n.vy || 0) - (n.y || 0) * k * alpha;
      n.vz = (n.vz || 0) - (n.z || 0) * k * alpha;
    }
  }
  force.initialize = (n) => { ns = n; };
  return force;
}

function buildSim() {
  sim = forceSimulation(nodes, 3)
    .force('link',    forceLink(links).id(d => d.id).distance(36).strength(0.6))
    .force('charge',  forceManyBody().strength(-90))
    .force('center',  forceCenter())
    .force('disk',    forceDisk())
    .force('gravity', forceGalacticGrav())
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
      recomputeDegrees();
      buildSim();
      // Run warmup synchronously so the first frame the user sees
      // is already-settled, not bouncing into place.
      for (let i = 0; i < WARMUP_TICKS; i++) sim.tick();
      postTick();
      postDegrees();
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
      sim.force('link', forceLink(links).id(d => d.id).distance(36).strength(0.6));
      recomputeDegrees();
      sim.alpha(ALPHA_RESTART).restart();
      if (tickTimer) clearTimeout(tickTimer);
      scheduleNext();
      postDegrees();
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
