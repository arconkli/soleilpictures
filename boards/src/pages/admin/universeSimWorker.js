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
} from '../../lib/universeLayout.js';

const HOT_TICK_MS  = 16;
const ALPHA_RESTART = 0.3;

// Base repulsion between anchors. Boards scale this up with the size
// of their card swarm (see chargeStrength) so a 300-card galaxy claims
// proportionally more space than an empty board — and every anchor
// gets a hashed mass (_m) so spacing comes out ragged, not even.
// (−140, down from −200: with the home spring holding the wave
// pattern, stronger repulsion just puffed the crowded arm lanes —
// the very over-density the layout exists to show.)
const CHARGE_STRENGTH = -140;

// The epicyclic restoring force. Real disk stars oscillate around a
// guiding center set by their orbit; here every anchor's guiding
// center is its galaxySeed position (the kinematic density-wave
// layout — see lib/universeLayout.js), and this spring pulls it home.
// Charge and links then resolve LOCAL crowding without ever being
// strong enough to erase the wave pattern. This replaces the old
// center-pull + disk-flatten + spiral-tug trio — those sculpted the
// layout from outside, which is exactly how the arms ended up looking
// like drawn tubes instead of emergent crowding.
const HOME_PULL = 0.08;

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

function seedDisk(a) {
  const R = 60 * Math.sqrt(Math.max(1, wsCount));
  galaxySeed(a.id, R, _seedTmp);
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
function placeNear(parentId, childId, base) {
  const p = anchorById.get(parentId);
  const c = anchorById.get(childId);
  if (!p || !c) return;
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
const CHARGE_REACH = 160;

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
