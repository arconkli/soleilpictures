// universeSimWorker — d3-force-3d simulation in a Web Worker.
//
// Owns the node + link arrays. Computes positions every tick and
// posts a transferable Float32Array back to the main thread. Main
// thread renders only; it never runs the simulation.
//
// Messages in:
//   { type: 'init',      nodes: [{ id, val }], links: [{ source, target }] }
//   { type: 'addNodes',  nodes: [{ id, val }] }
//   { type: 'addLinks',  links: [{ source, target }] }
//   { type: 'pause' }    — stop ticking (used when tab hides)
//   { type: 'resume' }   — resume ticking
//
// Messages out:
//   { type: 'ready' }                     — after init warmup completes
//   { type: 'tick', positions, count }    — positions is Float32Array(count*3)
//                                           transferred; index i = node order
//                                           in the worker's internal array.
//                                           count == nodes.length when posted.
//   { type: 'error', reason }             — non-fatal; sim keeps running

import { forceSimulation, forceLink, forceManyBody, forceCenter } from 'd3-force-3d';

// Layout settings cloned from HomeGraph (d3AlphaDecay=0.04,
// d3VelocityDecay=0.32). warmupTicks runs synchronously before we
// post the first tick so the user sees a stable layout immediately.
const WARMUP_TICKS = 200;
const HOT_TICK_MS  = 16;     // ~60Hz while alpha > alphaMin
const COLD_TICK_MS = 250;    // 4Hz once settled — integrates tiny drift
const ALPHA_RESTART = 0.3;   // reheat on add

let nodes = [];          // [{ id, val, x?, y?, z? }]
let links = [];          // [{ source, target }]
let sim   = null;
let positions = null;    // Float32Array(nodes.length * 3)
let paused    = false;
let stopped   = false;
let tickTimer = null;

function buildSim() {
  sim = forceSimulation(nodes, 3)
    .force('link',   forceLink(links).id(d => d.id).distance(36).strength(0.6))
    .force('charge', forceManyBody().strength(-90))
    .force('center', forceCenter())
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
      // Make sure we tick promptly even if we were in the cold loop.
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
