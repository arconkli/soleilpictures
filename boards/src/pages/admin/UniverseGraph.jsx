// UniverseGraph — GPU 3D constellation of every node and every
// connection on the platform. Every node means EVERY node: the
// snapshot walk keeps paginating until the server says done, so the
// universe always shows the whole corpus (the old pipeline stopped at
// PostgREST's 1,000-row truncation and called it a day).
//
// Performance shape (built to keep scaling):
//   • Card nodes ("leaves", the unbounded population) render as a
//     SINGLE THREE.Points cloud of shader discs — one vertex per
//     card. A flat disc is pixel-identical to the flat-shaded
//     MeshBasicMaterial spheres we used to draw, at 1/450th the
//     geometry cost.
//   • ws/board anchors keep TRUE instanced spheres (small population,
//     and they're the bodies you fly up close to — a point sprite
//     would clamp at MAX_POINT_SIZE and stop growing).
//   • Node halos are a second Points cloud that SHARES the same
//     position BufferAttribute as the disc cloud — one position
//     upload feeds both.
//   • All edges render via a SINGLE THREE.LineSegments buffer.
//   • The d3-force-3d sim runs in a Web Worker over ANCHORS ONLY
//     (user/ws/board); cards ride deterministic orbits around their
//     board at three float-adds each (see lib/universeLayout.js).
//     The worker stops posting once settled instead of re-uploading
//     identical frames forever.
//   • Picking is a CPU walk over the positions array (exact per-node
//     radii + angular slop so far-away dots stay clickable) — no
//     raycast against 450-triangle spheres.
//
// Ceiling: SOFT_NODE_LIMIT (2M) guards tab memory, not the frame
// budget — position+color+size buffers at 2M nodes are ~80MB. Beyond
// that the next step is LOD impostors (aggregate distant galaxies
// into single sprites), which the anchor/leaf split here is already
// shaped for.
//
// Visual contract: each node looks like a HomeGraph "planet" — body
// + halo, same per-kind palette (board=gold, doc=cream, note=
// terracotta, image=jovian violet, palette=teal, link=neptune blue).
// NO background star field (real nodes only, per user request).
//
// Privacy: rows carry only id / kind / workspace_id / created_at.
// No titles or content. Click drawer (in AdminUniverseTab) shows
// those identity fields only.

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls }  from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer }    from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass }        from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass }   from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import SimWorker from './universeSimWorker.js?worker';
import { fetchSnapshotPage, useUniverseDeltas } from './useUniverseStream.js';
import { collectSnapshot } from '../../lib/universePaging.js';

// ── Per-kind palette — copied from boards/src/lib/graphData.js
//    with two admin-only additions (user + ws). User reads as a
//    warm-white sun the workspaces orbit around; ws is a muted
//    lavender anchor that doesn't compete with the gold board suns.
//
// On adding hues: don't. The six shipped anchors (note/image/palette/
// link/doc/board) already saturate the perceptual field — measured
// all-pairs, link-blue↔palette-teal sit at ΔE 10.6 under NORMAL vision,
// below the 15 floor, before anything new is added. Every candidate 7th+
// hue tested collided worse: rose↔teal ΔE 1.4 (deutan), indigo↔violet 5.1
// (normal), cyan↔teal 8.7 (normal). `grid` earns the one exception below
// because it is the one card kind with real volume behind it; the rest
// deliberately share
// the neutral `card` slate rather than get muddy near-duplicates, and the
// legend (KIND_LEGEND) carries identity so hue never has to alone.
const COLOR = {
  user:      '#fff4d8',
  ws:        '#8b8aa8',
  board:     '#ffa500',
  doc:       '#f1d9a3',
  note:      '#cf6a4f',
  image:     '#7c5cc9',
  palette:   '#3fa39a',
  link:      '#5b8fc7',
  grid:      '#6aab4a',   // admin-only: the one card kind big enough to earn a hue
  board_:    '#c4a96b',
  boardlink: '#c4a96b',
  doc_card:  '#e6c98a',
  card:      '#7c8a98',   // shape / video / schedule / art / pdf / audio / file
  url:       '#8c7a55',
};

// Legend rows for the Universe HUD, in the order they should read. `card`
// is the explicit catch-all so the neutral slate is never unexplained.
export const KIND_LEGEND = [
  { key: 'board',   label: 'Boards'    },
  { key: 'image',   label: 'Images'    },
  { key: 'note',    label: 'Notes'     },
  { key: 'grid',    label: 'Grids'     },
  { key: 'link',    label: 'Links'     },
  { key: 'palette', label: 'Palettes'  },
  { key: 'doc',       label: 'Docs'       },
  { key: 'boardlink', label: 'Board links' },
  { key: 'card',      label: 'Other'      },
  { key: 'ws',        label: 'Workspaces' },
];
export const KIND_COLORS = COLOR;

// Edge tints — match the per-workspace HomeGraph look exactly.
// HomeGraph uses rgba(91,87,78,.45) structural + rgba(255,165,0,.55)
// semantic with linkOpacity=0.7, so effective alpha = 0.315 / 0.385.
// Our line material runs at opacity 1 with vertexColors=true, so we
// premultiply the alpha into the per-vertex RGB to produce the same
// on-screen color. Scaffold (cross-workspace) stays whispery.
function premul(hex, alpha) {
  const c = new THREE.Color(hex);
  return new THREE.Color(c.r * alpha, c.g * alpha, c.b * alpha);
}
const SCAFFOLD_RGB   = premul('#ffffff',         0.025);  // barely-there threads
const STRUCTURAL_RGB = premul('rgb(91,87,78)',   0.315);
const SEMANTIC_RGB   = premul('rgb(255,165,0)',  0.385);

const SCAFFOLD_EDGE_KINDS = new Set(['scaffold', 'membership', 'wsroot', 'share']);
const STRUCTURAL_EDGE_KINDS = new Set(['hierarchy', 'structural']);

function classifyEdge(rawKind) {
  const k = rawKind || '';
  if (SCAFFOLD_EDGE_KINDS.has(k))    return 'scaffold';
  if (STRUCTURAL_EDGE_KINDS.has(k))  return 'structural';
  if (k.startsWith('doc_'))          return 'structural';
  return 'semantic';
}

// ── Universe tunables ─────────────────────────────────────────────
const GALAXY = {
  // Galactic spin around the disk normal — slow enough that the
  // spiral reads as a turning galaxy, not a spinning logo.
  rotationRate: 0.035,
  // Keep camera.far modest. Bigger ratios (we had 1e6) tank depth-
  // buffer precision. 20k is plenty: a typical universe radius is <5k.
  cameraFar:    20000,
  zoomMin:      5,
  zoomMax:      18000,
  // Bloom — bright pixels bleed energy into neighbors for the
  // pinprick-with-soft-glow look real stars have in long exposures.
  bloomStrength:  0.45,
  bloomRadius:    0.85,
  bloomThreshold: 0.15,
};

// The universe is a planetarium, not a themed panel: node halos use ADDITIVE
// blending and the bloom pass only has anything to do with luminance above the
// background. On the old light-theme canvas (#f5f5f7) additive blending is a
// no-op and bloom has no headroom, so the "light" universe was a near-blank
// grey field. It stays dark in both themes; .universe-tab scopes dark ink
// tokens over it so the surrounding HUD stays legible either way.
const SPACE_BG = '#0a0908';

// Halo texture — radial gradient white sprite, same as HomeGraph.
const HALO_TEXTURE = (() => {
  if (typeof document === 'undefined') return null;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0.0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1.0, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
})();

const NODE_PAGE         = 50000;
const EDGE_PAGE         = 100000;
const DELTA_FLUSH_MS    = 250;
const ORPHAN_MAX_TRIES  = 12;
const INITIAL_NODE_CAP  = 1024;
const INITIAL_ANCHOR_CAP = 256;
const INITIAL_EDGE_CAP  = 2048;
// Memory guard, not a render budget: 2M nodes ≈ 80MB of GPU/JS
// buffers. The hierarchical sim + disc pipeline holds frame rate far
// past the old 250k full-sim ceiling; past THIS number the tab's
// memory is the binding constraint and the next move is LOD
// aggregation, not a bigger cap.
const SOFT_NODE_LIMIT   = 2_000_000;

// Angular pick slop in device pixels — a card that projects to a
// 2px dot is still clickable within a ~7px circle around it.
const PICK_SLOP_PX = 7;

// FX (live activity).
const FX_CAPACITY       = 512;     // max concurrent pulses + flashes + rings
const PULSE_DURATION_MS = 1500;
const FLASH_DURATION_MS = 1200;
const PULSE_COLOR       = new THREE.Color('#ffd06b');  // bright Soleil gold

// Arrival choreography.
//
// A new node used to get a 1.2s halo flash and nothing else. On a platform that
// creates a node about once every twenty minutes, onto a canvas framed to fit
// ~4,000 of them, that is a two-pixel dot brightening for one second somewhere
// in your peripheral vision. The event was real; the odds of witnessing it were
// not. So arrival now has three overlapping timescales:
//
//   RING   — a shockwave you can catch out of the corner of your eye
//   FLASH  — the original bloom, kept, because it marks the exact spot
//   HOT    — a full minute of elevated halo, so "I saw something flicker over
//            there" survives long enough for you to actually go look
//
// HOT_DURATION_MS is a full minute rather than a few seconds precisely because
// arrivals are rare: there is no risk of the universe filling up with hot nodes
// at ~3 arrivals an hour, and the cost is a Map with single-digit entries.
const RING_DURATION_MS  = 2500;
const HOT_DURATION_MS   = 60000;
const RING_MAX_SCALE    = 26;      // multiples of the node's own radius
const HOT_HALO_BOOST    = 2.2;     // peak halo multiplier, decaying to 1

// Activity sparks — "somebody is working here right now".
//
// The universe is a map of what EXISTS, and creation is rare. But people open
// boards, place cards and move around them roughly five times as often as they
// create a node, and nearly every in-app analytics event carries a board_id. So
// the same board that lights up once an hour for an arrival can shimmer several
// times an hour for presence.
//
// Deliberately NOT gold and deliberately small: gold is the reserved
// active/selection/focus accent and an arrival has to stay the loudest thing on
// screen. A spark is a cool-white blink at a board, gone in under a second.
// SPARK_COOLDOWN_MS stops one busy board from strobing — a person placing ten
// cards is one story, not ten.
const SPARK_DURATION_MS = 900;
const SPARK_COOLDOWN_MS = 1800;
const SPARK_COLOR       = new THREE.Color('#dfe7f2');

// Hover picking is the same O(N) ray walk as click picking (~1-2ms at a few
// thousand nodes). That is nothing per click and too much per mousemove, so it
// is throttled — and disabled outright past a corpus size where the walk would
// start costing frames. Click picking has no ceiling; it stays exact forever.
const HOVER_THROTTLE_MS = 70;
const HOVER_MAX_NODES   = 200_000;

function nextPow2(n, base) { let c = base; while (c < n) c *= 2; return c; }

// Nodes share per-hex THREE.Color instances (read-only everywhere —
// setColorAt copies, the attribute writes read r/g/b). Saves hundreds
// of thousands of allocations during a big snapshot build.
const THREE_COLOR_CACHE = new Map();
function cachedColor(hex) {
  let c = THREE_COLOR_CACHE.get(hex);
  if (!c) { c = new THREE.Color(hex); THREE_COLOR_CACHE.set(hex, c); }
  return c;
}

// Map a snapshot row → render node. `val` is the body radius proxy;
// bigger numbers for the higher-level anchors. isAnchor mirrors the
// worker's classification: ws + board get true spheres; user is
// physics-only (invisible); everything else is a disc in the leaf
// cloud.
function toNode(raw) {
  const broad = raw.node_id.split(':')[0];
  let kind, cardKind = null, val;
  if (broad === 'user') {
    kind = 'user'; val = 20;
  } else if (broad === 'ws') {
    kind = 'ws'; val = 16;
  } else if (broad === 'board') {
    kind = 'board'; val = 14;
  } else {
    kind = raw.kind === 'doc' ? 'doc' : 'card';
    cardKind = raw.kind;
    val = kind === 'doc' ? 12 : 8;
  }
  const colorKey = cardKind || kind;
  const colorHex = COLOR[colorKey] || COLOR[kind] || COLOR.card;
  return {
    id: raw.node_id,
    kind,
    cardKind,
    color: colorHex,
    threeColor: cachedColor(colorHex),
    val,
    isAnchor: kind === 'ws' || kind === 'board',
    workspace_id: raw.workspace_id,
    created_at: raw.created_at,
  };
}

// Identity of an edge as far as the renderer is concerned. The server's own
// keyset uses the same triple (see admin_universe_edges_v2's edge_key), so a
// row that reappears under a moved timestamp lands on the same key here.
const UNIT_SEP = '\u001f';   // chr(31), same separator the SQL edge_key uses
function edgeKeyOf(raw) {
  return `${raw.source_id}${UNIT_SEP}${raw.target_id}${UNIT_SEP}${raw.edge_kind}`;
}

// Legend tallies. Cards count under their card kind when it has its own hue,
// otherwise under 'card' — which is exactly the bucket the legend labels
// "Other", so the neutral slate is always accounted for.
function countKind(refs, node) {
  const key = node.cardKind && COLOR[node.cardKind] ? node.cardKind : node.kind;
  refs.kindCounts.set(key, (refs.kindCounts.get(key) || 0) + 1);
}

function reportStats(refs) {
  if (!refs.onStatsFn) return;
  refs.onStatsFn({
    nodes: refs.nodes.length,
    edges: refs.edges.length,
    byKind: Object.fromEntries(refs.kindCounts),
  });
}

// ── Disc material — the leaf-node body ────────────────────────────
// One vertex per card. `size` is the world-space DIAMETER;
// uPxPerUnit converts world size at depth −mv.z into device pixels,
// so a disc is pixel-identical to a flat-shaded sphere of the same
// radius. Floor keeps far cards visible as single-pixel stars; the
// 512 cap respects common MAX_POINT_SIZE limits (cards are the
// smallest bodies — only anchors are ever viewed closer than that,
// and those are true spheres).
// Depth fog.
//
// A galaxy rendered without it is flat: every star is equally crisp, so the
// only depth cue is parallax while you move, and a still frame reads as a
// sticker sheet. Real distance eats contrast, so the far side of the disk
// should sink toward the background.
//
// Not THREE.Fog — scene fog only applies to materials with `fog: true`, and
// both node clouds are custom ShaderMaterials. The edge material deliberately
// opts out (fog would push already-dim threads below visibility), so putting
// this in the two node shaders is also the only way to fog nodes WITHOUT
// fogging edges.
//
// Opaque bodies mix toward the background colour; additive halos cannot — a
// mix toward a near-black background is a no-op under additive blending — so
// they lose alpha instead. Same perceptual result, two different mechanisms.
const FOG_NEAR_FACTOR = 0.9;   // × universe radius: fog starts past the bulk
const FOG_FAR_FACTOR  = 4.2;   // × universe radius: fully sunk at the rim
const _fogColor = new THREE.Color(SPACE_BG);

function setFogRange(refs, radius) {
  if (!Number.isFinite(radius) || radius <= 0) return;
  const near = radius * FOG_NEAR_FACTOR;
  const far  = radius * FOG_FAR_FACTOR;
  for (const m of [refs.bodyPoints?.material, refs.haloPoints?.material]) {
    if (!m?.uniforms?.uFogNear) continue;
    m.uniforms.uFogNear.value = near;
    m.uniforms.uFogFar.value  = far;
  }
  refs.fogNear = near;
  refs.fogFar  = far;
}

function makeBodyMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uPxPerUnit: { value: 600 },   // set for real on mount + resize
      uFogNear:   { value: 1e9 },   // 1e9 = fog off until the first fit sizes it
      uFogFar:    { value: 2e9 },
      uFogColor:  { value: _fogColor },
    },
    vertexShader: /* glsl */`
      uniform float uPxPerUnit;
      attribute float size;
      varying vec3 vColor;
      varying float vDepth;
      void main() {
        vColor = color;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vDepth = -mv.z;
        float px = size * (uPxPerUnit / max(-mv.z, 1.0));
        gl_PointSize = size > 0.0 ? clamp(px, 1.25, 512.0) : 0.0;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */`
      uniform float uFogNear;
      uniform float uFogFar;
      uniform vec3  uFogColor;
      varying vec3  vColor;
      varying float vDepth;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        if (dot(c, c) > 0.25) discard;
        float f = smoothstep(uFogNear, uFogFar, vDepth);
        // Cap at 0.82 so the deepest bodies stay findable rather than merging
        // into the background entirely — this is a depth cue, not a cull.
        gl_FragColor = vec4(mix(vColor, uFogColor, f * 0.82), 1.0);
      }
    `,
    vertexColors: true,
    transparent: false,
    depthWrite: true,
  });
}

// ── Custom shader material for halos ──────────────────────────────
// Per-vertex `color` + `size`. Size scales with distance from camera
// like a real sprite so far-away nodes shrink naturally.
function makeHaloMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      map:      { value: HALO_TEXTURE },
      uOpacity: { value: 0.30 },  // bumped 0.22→0.30 so the bloom pass has luminance to glow from
      uScale:   { value: 350 },
      uFogNear: { value: 1e9 },
      uFogFar:  { value: 2e9 },
    },
    vertexShader: /* glsl */`
      uniform float uScale;
      attribute float size;
      varying vec3 vColor;
      varying float vDepth;
      void main() {
        vColor = color;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vDepth = -mv.z;
        // Clamp upper bound so we stay under MAX_POINT_SIZE; clamp
        // LOWER bound so even at extreme zoom-out the halo stays a
        // visible pinprick instead of vanishing entirely — keeps
        // the node dots shining through the noise of edges.
        // Size 0 (e.g. invisible user nodes) opts out of the floor.
        float px = size * (uScale / max(-mv.z, 1.0));
        gl_PointSize = size > 0.0 ? clamp(px, 1.6, 220.0) : 0.0;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */`
      uniform sampler2D map;
      uniform float uOpacity;
      uniform float uFogNear;
      uniform float uFogFar;
      varying vec3  vColor;
      varying float vDepth;
      void main() {
        vec4 tex = texture2D(map, gl_PointCoord);
        // Additive blending means mixing toward a near-black background does
        // nothing; distance has to remove energy instead.
        float f = smoothstep(uFogNear, uFogFar, vDepth);
        gl_FragColor = vec4(vColor, tex.a * uOpacity * (1.0 - f * 0.75));
      }
    `,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

// FX material — same idea as halo, with an extra per-vertex `alpha`
// attribute so pulses/flashes can fade independently per particle.
function makeFxMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      map:    { value: HALO_TEXTURE },
      uScale: { value: 350 },
    },
    vertexShader: /* glsl */`
      uniform float uScale;
      attribute float size;
      attribute float alpha;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vColor = color;
        vAlpha = alpha;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        // 512, not 220: an arrival ring expands to ~26x the node radius and
        // clipping it at the halo's ceiling froze the expansion mid-flight,
        // which is the one thing a shockwave must not do. 512 is the same cap
        // the body shader uses and stays inside common MAX_POINT_SIZE limits.
        gl_PointSize = min(size * (uScale / max(-mv.z, 1.0)), 512.0);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */`
      uniform sampler2D map;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vec4 tex = texture2D(map, gl_PointCoord);
        gl_FragColor = vec4(vColor, tex.a * vAlpha);
      }
    `,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

function makeFxPoints(capacity) {
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(capacity * 3), 3));
  geom.setAttribute('color',    new THREE.BufferAttribute(new Float32Array(capacity * 3), 3));
  geom.setAttribute('size',     new THREE.BufferAttribute(new Float32Array(capacity),     1));
  geom.setAttribute('alpha',    new THREE.BufferAttribute(new Float32Array(capacity),     1));
  geom.attributes.position.setUsage(THREE.DynamicDrawUsage);
  geom.attributes.color.setUsage(THREE.DynamicDrawUsage);
  geom.attributes.size.setUsage(THREE.DynamicDrawUsage);
  geom.attributes.alpha.setUsage(THREE.DynamicDrawUsage);
  geom.setDrawRange(0, 0);
  const points = new THREE.Points(geom, makeFxMaterial());
  points.frustumCulled = false;
  return points;
}

// dataSource — optional override for the QA harness: { fetchPage,
// disableDeltas }. Production leaves it null and uses the real party
// endpoints.
// onStats — fires with { nodes, edges, byKind } once the snapshot is built and
// again whenever deltas change the totals. This is the ONLY honest source for
// "how big is the thing on screen": platform_counters counts rows, several of
// which never become nodes or edges (tag attachments, cards on soft-deleted
// boards), so a HUD reading the counters can claim connections the universe
// does not draw.
// onArrival — fires once per node the delta stream adds, with the render node.
//   Feeds the arrivals rail, which is what makes a rare event catchable: miss
//   the ring and the thing that arrived is still listed, one click from being
//   flown to.
// onStream — fires with { status, lastDeltaAt } so a HUD can say whether the
//   socket is alive. On a universe that is legitimately still for twenty
//   minutes at a stretch, "nothing is happening" and "nothing is arriving
//   because the stream died" are the same picture without this.
// focusRequest — { id, nonce }; bump the nonce to fly the camera to that node.
// hiddenKinds — Set of render kinds to hide (legend filtering).
// isolateWorkspaceId — dim everything outside one workspace.
export function UniverseGraph({
  onNodeClick, resetSignal, fitAll = false, dataSource = null, onStats = null,
  onArrival = null, onStream = null, focusRequest = null,
  hiddenKinds = null, isolateWorkspaceId = null, selectedId = null,
  activity = null,
}) {
  const containerRef = useRef(null);

  // ── React state for shell UI only ────────────────────────────────
  const [error, setError]         = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [progress, setProgress]   = useState({ nodes: 0, edges: 0 });
  const [calibrating, setCalibrating] = useState(true);
  // Gate the delta stream on the snapshot: before it lands there is no
  // server-authored timestamp to start from, and a flush would push nodes into
  // a worker that has no sim yet.
  const [deltaReady, setDeltaReady] = useState(false);
  const sinceRef = useRef(null);
  const [hover, setHover] = useState(null);   // { x, y, node } in container px

  // ── Refs to all the Three.js + sim state (kept out of React) ─────
  const refs = useRef({
    scene: null, camera: null, renderer: null, controls: null,
    composer: null, bloomPass: null,
    anchorMesh: null, bodyPoints: null, haloPoints: null, edgeLines: null, fxPoints: null,
    sharedPosAttr: null,            // ONE position buffer feeding body + halo clouds
    activeFx: [],                   // [{ kind:'pulse'|'flash', src, tgt, nodeIdx, start, dur, color }]
    baseScale: new Float32Array(INITIAL_NODE_CAP),   // per-node radius (0 = invisible user)
    visMul:    new Float32Array(INITIAL_NODE_CAP).fill(1),  // 0 = filtered out by the legend
    dimMul:    new Float32Array(INITIAL_NODE_CAP).fill(1),  // < 1 = outside the isolated workspace
    anchorSlot: new Int32Array(INITIAL_NODE_CAP),    // global idx → sphere slot (-1 = not an anchor)
    anchorGlobals: [],              // sphere slot → global idx
    nodeCapacity: INITIAL_NODE_CAP, anchorCapacity: INITIAL_ANCHOR_CAP, edgeCapacity: INITIAL_EDGE_CAP,
    nodes: [],                      // [{id, threeColor, val, isAnchor, ...}]
    nodeIndex: new Map(),           // node_id → array index
    edges: [],                      // [{ sourceIdx, targetIdx, kind }]
    edgeKeys: new Set(),            // 'srctgtkind' — guards the delta path
    kindCounts: new Map(),          // legend/HUD: render kind → count
    positions: new Float32Array(INITIAL_NODE_CAP * 3),
    pxPerUnit: 600,                 // devicePx per world-unit at distance 1 (resize-updated)
    snapshotReady: false,           // gates delta flushes until the worker has init state
    worker: null,
    rafId: null,
    onClick: null,
    pendingNodes: [],               // delta buffer
    pendingEdges: [],               // [{ raw, attempts }]
    // Arrival FX cannot be spawned at the moment a node is appended: the
    // worker has not placed it yet, so refs.positions[idx] is still the zeroed
    // tail of a freshly grown buffer and every ring/flash fired at the world
    // ORIGIN — a gold bloom at the galactic centre for a card created out on
    // the rim. These queue instead and drain on the first tick that carries a
    // real position for them.
    pendingFx: [],                  // [{ idx, color, val }]
    hotNodes: new Map(),            // idx → { until, color } — the 60s afterglow
    hiddenKinds: null,              // Set of legend keys the operator switched off
    isolateWs: null,                // workspace_id to keep lit; everything else dims
    selectionFx: null,              // the persistent ring on the selected node
    seenActivity: new Set(),        // analytics_events ids already sparked
    sparkCooldown: new Map(),       // node idx → next allowed spark (perf clock)
    onNodeClickFn: onNodeClick,
    onStatsFn: onStats,
    onArrivalFn: onArrival,
    // Auto-fit state. didInitialFit gates the first snap-to-fit.
    // fitAnimating drives a smooth pull-back when the universe grows.
    interacting: false,
    didInitialFit: false,
    fitAll: false,                  // when true, auto-fit frames EVERY visible node (100th pct)
    lastFitAt: 0,
    fitFromPos: null, fitFromTarget: null, fitToPos: null, fitToTarget: null,
    fitStart: 0, fitDuration: 700, fitAnimating: false,
  }).current;

  // Keep callbacks fresh without re-mounting the whole scene.
  useEffect(() => { refs.onNodeClickFn = onNodeClick; }, [onNodeClick, refs]);
  useEffect(() => { refs.onStatsFn = onStats; }, [onStats, refs]);
  useEffect(() => { refs.onArrivalFn = onArrival; }, [onArrival, refs]);

  // Legend filtering + workspace isolation. Both repaint through the same
  // multiplier pass, so they compose: hide every kind but images, then isolate
  // one workspace, and you get that workspace's images.
  useEffect(() => {
    refs.hiddenKinds = hiddenKinds && hiddenKinds.size ? hiddenKinds : null;
    refs.isolateWs   = isolateWorkspaceId || null;
    applyVisualFilters(refs);
  }, [hiddenKinds, isolateWorkspaceId, refs]);

  // Selection: a persistent gold ring on the picked node. --soleil is reserved
  // for active/selection/focus, which is exactly what this is.
  useEffect(() => {
    if (refs.selectionFx) {
      const at = refs.activeFx.indexOf(refs.selectionFx);
      if (at >= 0) refs.activeFx.splice(at, 1);
      refs.selectionFx = null;
    }
    if (!selectedId) return;
    const idx = refs.nodeIndex.get(selectedId);
    if (idx == null) return;
    // dur = Infinity keeps it alive until the selection changes; updateFx's
    // expiry check is `t >= 1`, which never trips.
    refs.selectionFx = {
      kind: 'select', nodeIdx: idx, start: performance.now(),
      dur: Infinity, color: PULSE_COLOR, val: refs.nodes[idx]?.val || 8,
    };
    pushFx(refs, refs.selectionFx);
  }, [selectedId, refs]);

  // ── Activity layer ───────────────────────────────────────────────
  // Real analytics events, mapped onto the board they happened on. Events that
  // carry no board_id — landing views, signups, anything signed-out — are
  // DROPPED rather than placed somewhere plausible. Inventing a location would
  // make the universe show activity where none occurred, which is the one thing
  // this surface has always refused to do.
  useEffect(() => {
    if (!activity || !activity.length || !refs.snapshotReady) return;
    const now = performance.now();
    for (const ev of activity) {
      if (!ev?.id || refs.seenActivity.has(ev.id)) continue;
      refs.seenActivity.add(ev.id);
      const boardId = ev.props?.board_id;
      if (!boardId) continue;
      const idx = refs.nodeIndex.get(`board:${boardId}`);
      if (idx == null || refs.visMul[idx] === 0) continue;
      const until = refs.sparkCooldown.get(idx) || 0;
      if (now < until) continue;
      refs.sparkCooldown.set(idx, now + SPARK_COOLDOWN_MS);
      pushFx(refs, {
        kind: 'spark', nodeIdx: idx, start: now,
        dur: SPARK_DURATION_MS, color: SPARK_COLOR,
        val: refs.nodes[idx]?.val || 14,
      });
    }
    // The id set is bounded by the hook's own window; trim if it ever isn't.
    if (refs.seenActivity.size > 4000) refs.seenActivity = new Set();
  }, [activity, refs]);

  // Fly to a node on request (the arrivals rail). nonce, not id, so asking for
  // the same node twice still flies.
  useEffect(() => {
    if (!focusRequest?.id) return;
    const idx = refs.nodeIndex.get(focusRequest.id);
    if (idx == null) return;
    flyToNode(refs, idx);
    // Select it too. Flying somewhere and then having to find the thing you
    // flew to defeats the trip — the selection ring is what says "this one",
    // and it is the only marker that survives the arrival glow expiring.
    refs.onNodeClickFn?.(refs.nodes[idx]);
  }, [focusRequest?.nonce, focusRequest?.id, refs]);

  // Opt-in: frame every visible node on auto-fit/reset (Command Center wants the
  // whole universe inside its box, not the 95th-percentile bulk).
  useEffect(() => { refs.fitAll = !!fitAll; }, [fitAll, refs]);

  // When the parent bumps resetSignal (the "Reset view" button),
  // pull the camera back to fit the whole universe — same animated
  // pull-back as the initial fit.
  useEffect(() => {
    if (resetSignal == null) return;
    requestFit(refs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetSignal]);

  // ── Mount the Three.js scene (one-time + on reload) ───────────────
  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    const rect = container.getBoundingClientRect();
    const w = Math.max(200, Math.floor(rect.width));
    const h = Math.max(200, Math.floor(rect.height));

    // Scene + camera + renderer.
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(SPACE_BG);

    const camera = new THREE.PerspectiveCamera(60, w / h, 0.1, GALAXY.cameraFar);
    // Start ABOVE the disk plane, looking down at its face. Small Z
    // offset prevents gimbal lock and gives the spiral a touch of
    // perspective like in the classic milky-way photos.
    camera.position.set(0, 500, 60);

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h);
    // ACES filmic tonemap so blown-out bright pixels (the bloomed
    // node cores) roll off with a photographic curve instead of
    // clipping to flat white — gives real "overexposed star" feel.
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.domElement.style.display = 'block';
    container.appendChild(renderer.domElement);

    // Post-process chain: standard render → bloom.
    const composer = new EffectComposer(renderer);
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(w, h);
    const renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(w, h),
      GALAXY.bloomStrength,
      GALAXY.bloomRadius,
      GALAXY.bloomThreshold,
    );
    composer.addPass(bloomPass);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.rotateSpeed = 0.55;
    controls.zoomSpeed   = 0.7;
    controls.panSpeed    = 0.6;
    controls.enablePan   = true;
    controls.minDistance = GALAXY.zoomMin;
    controls.maxDistance = GALAXY.zoomMax;
    // Zoom toward where the cursor is pointing instead of the
    // orbit center — lets you fly into any specific cluster.
    controls.zoomToCursor = true;

    // World-units → device-pixels conversion for the disc shader and
    // the picker's angular slop.
    const updatePxPerUnit = (hCss) => {
      const px = (hCss * renderer.getPixelRatio()) /
        (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
      refs.pxPerUnit = px;
      if (refs.bodyPoints) refs.bodyPoints.material.uniforms.uPxPerUnit.value = px;
    };

    // GPU buffers — allocated empty; filled when snapshot arrives.
    // ONE position attribute feeds both the disc bodies and the halos.
    const sharedPosAttr = new THREE.BufferAttribute(new Float32Array(INITIAL_NODE_CAP * 3), 3);
    sharedPosAttr.setUsage(THREE.DynamicDrawUsage);

    const bodyPoints = makeBodyPoints(INITIAL_NODE_CAP, sharedPosAttr);
    bodyPoints.geometry.setDrawRange(0, 0);
    scene.add(bodyPoints);

    const haloPoints = makeHaloPoints(INITIAL_NODE_CAP, sharedPosAttr);
    haloPoints.geometry.setDrawRange(0, 0);
    scene.add(haloPoints);

    const anchorMesh = makeAnchorMesh(INITIAL_ANCHOR_CAP);
    anchorMesh.count = 0;
    scene.add(anchorMesh);

    const edgeLines = makeEdgeLines(INITIAL_EDGE_CAP);
    edgeLines.geometry.setDrawRange(0, 0);
    scene.add(edgeLines);

    const fxPoints = makeFxPoints(FX_CAPACITY);
    scene.add(fxPoints);

    refs.scene = scene;
    refs.camera = camera;
    refs.renderer = renderer;
    refs.controls = controls;
    refs.composer = composer;
    refs.bloomPass = bloomPass;
    refs.anchorMesh = anchorMesh;
    refs.bodyPoints = bodyPoints;
    refs.haloPoints = haloPoints;
    refs.sharedPosAttr = sharedPosAttr;
    refs.edgeLines = edgeLines;
    refs.fxPoints = fxPoints;
    refs.activeFx = [];
    refs.baseScale  = new Float32Array(INITIAL_NODE_CAP);
    refs.visMul     = new Float32Array(INITIAL_NODE_CAP).fill(1);
    refs.dimMul     = new Float32Array(INITIAL_NODE_CAP).fill(1);
    refs.anchorSlot = new Int32Array(INITIAL_NODE_CAP).fill(-1);
    refs.anchorGlobals = [];
    refs.nodeCapacity = INITIAL_NODE_CAP;
    refs.anchorCapacity = INITIAL_ANCHOR_CAP;
    refs.edgeCapacity = INITIAL_EDGE_CAP;
    refs.nodes = [];
    refs.nodeIndex = new Map();
    refs.edges = [];
    refs.positions = new Float32Array(INITIAL_NODE_CAP * 3);
    refs.pendingNodes = [];
    refs.pendingEdges = [];
    updatePxPerUnit(h);

    // Worker.
    const worker = new SimWorker();
    refs.worker = worker;
    worker.onmessage = (ev) => {
      const msg = ev.data;
      if (!msg) return;
      if (msg.type === 'tick') {
        if (msg.positions && msg.positions.length >= msg.count * 3) {
          // Keep our local positions array sized correctly.
          if (refs.positions.length < msg.positions.length) {
            refs.positions = new Float32Array(msg.positions.length);
          }
          refs.positions.set(msg.positions.subarray(0, msg.count * 3));
          uploadPositions(refs, msg.count);
          // Positions for the newly-arrived nodes exist as of this frame, so
          // their arrival FX can finally be placed where they actually are.
          // The worker posts a tick immediately on addNodes, so this is the
          // very next message — not a perceptible delay.
          if (refs.pendingFx.length) drainArrivalFx(refs, msg.count);
        }
      } else if (msg.type === 'ready') {
        setCalibrating(false);
      } else if (msg.type === 'error') {
        // Non-fatal — log only.
        // eslint-disable-next-line no-console
        console.warn('[universeSim]', msg.reason);
      }
    };

    // Click picking — CPU walk over the positions array. Exact
    // per-node radii, plus angular slop so a 2px card is clickable,
    // and no invisible-user false hits (they're skipped outright).
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let downAt = null, downXY = null;
    const onPointerDown = (e) => { downAt = e.timeStamp; downXY = [e.clientX, e.clientY]; };
    const onPointerUp = (e) => {
      if (!downAt || !downXY) return;
      const dt = e.timeStamp - downAt;
      const dx = Math.abs(e.clientX - downXY[0]);
      const dy = Math.abs(e.clientY - downXY[1]);
      downAt = null; downXY = null;
      // Distinguish click from drag — release within 300ms and < 5px movement.
      if (dt > 300 || dx > 5 || dy > 5) return;
      const r = renderer.domElement.getBoundingClientRect();
      ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
      raycaster.setFromCamera(ndc, camera);
      const picked = pickNode(refs, raycaster.ray);
      if (picked) {
        if (refs.onNodeClickFn) refs.onNodeClickFn(picked);
      } else {
        // Empty space click → enter pointer-lock fly mode.
        try { renderer.domElement.requestPointerLock(); } catch (_) {}
      }
    };
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerup',   onPointerUp);

    // ── Hover readout ───────────────────────────────────────────────
    // The universe had no hover at all: every node was an anonymous dot until
    // you committed to a click. pickNode is the same O(N) ray walk the click
    // path uses — nothing per click, too much per mousemove — so it is
    // throttled, skipped while dragging or flying, and disabled outright past
    // HOVER_MAX_NODES, where the walk would start costing frames. Clicking is
    // never gated; it stays exact at any corpus size.
    let lastHoverAt = 0;
    let hoveredId = null;
    const onHoverMove = (e) => {
      if (isPointerLocked || refs.interacting || downAt) return;
      if (refs.nodes.length === 0 || refs.nodes.length > HOVER_MAX_NODES) return;
      if (e.timeStamp - lastHoverAt < HOVER_THROTTLE_MS) return;
      lastHoverAt = e.timeStamp;
      const r = renderer.domElement.getBoundingClientRect();
      ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
      raycaster.setFromCamera(ndc, camera);
      const picked = pickNode(refs, raycaster.ray);
      const id = picked ? picked.id : null;
      renderer.domElement.style.cursor = id ? 'pointer' : '';
      if (id === hoveredId && !id) return;
      hoveredId = id;
      setHover(picked ? { x: e.clientX - r.left, y: e.clientY - r.top, node: picked } : null);
    };
    const onHoverLeave = () => {
      hoveredId = null;
      renderer.domElement.style.cursor = '';
      setHover(null);
    };
    renderer.domElement.addEventListener('pointermove',  onHoverMove);
    renderer.domElement.addEventListener('pointerleave', onHoverLeave);

    // ── FPS-style mouse-look while pointer is locked ────────────────
    // Pointer-lock hides the cursor and feeds us raw mouse deltas via
    // movementX/Y. We rotate the controls.target around camera.position
    // (preserving orbit distance) so when the user ESC's out, the
    // OrbitControls pose is consistent with where they're looking.
    const WORLD_UP   = new THREE.Vector3(0, 1, 0);
    const LOOK_SENS  = 0.0022;
    const MAX_PITCH  = Math.PI * 0.49;  // stop just shy of ±90°
    let isPointerLocked = false;

    const onPointerLockChange = () => {
      isPointerLocked = document.pointerLockElement === renderer.domElement;
      controls.enabled = !isPointerLocked;  // OrbitControls off while flying
      refs.lookActive  = isPointerLocked;   // pauses idle drift
    };
    document.addEventListener('pointerlockchange', onPointerLockChange);

    const onMouseMove = (e) => {
      if (!isPointerLocked) return;
      const dx = e.movementX || 0, dy = e.movementY || 0;
      if (dx === 0 && dy === 0) return;
      const dist = camera.position.distanceTo(controls.target);
      const fwd = controls.target.clone().sub(camera.position).normalize();
      fwd.applyAxisAngle(WORLD_UP, -dx * LOOK_SENS);                // yaw
      const right = fwd.clone().cross(WORLD_UP).normalize();
      const next  = fwd.clone().applyAxisAngle(right, -dy * LOOK_SENS);  // pitch
      // Reject pitches that put us within MAX_PITCH of vertical so
      // we don't flip past straight up/down.
      const angleFromUp = next.angleTo(WORLD_UP);
      if (angleFromUp > (Math.PI / 2 - MAX_PITCH) && angleFromUp < (Math.PI / 2 + MAX_PITCH)) {
        fwd.copy(next);
      }
      controls.target.copy(camera.position).add(fwd.multiplyScalar(dist));
    };
    window.addEventListener('mousemove', onMouseMove);

    // WASD / Q-E flying — moves the camera AND its orbit target by the
    // same offset so the orbit pose is preserved. Speed scales with
    // current zoom distance so a single key-hold travels a sensible
    // fraction of the visible scene at any scale.
    const keys = new Set();
    const isTypingTarget = (el) => {
      if (!el) return false;
      const tag = el.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
      if (el.isContentEditable) return true;
      return false;
    };
    const onKeyDown = (e) => {
      // Cmd/Alt still pass through to the browser (Cmd+W close, etc).
      // Ctrl is a SPEED MODIFIER for fly mode, not a bypass.
      if (e.metaKey || e.altKey) return;
      if (isTypingTarget(document.activeElement)) return;
      const k = e.key.toLowerCase();
      if ('wasdqe'.includes(k)) { keys.add(k); e.preventDefault(); }
    };
    const onKeyUp = (e) => {
      const k = e.key.toLowerCase();
      if ('wasdqe'.includes(k)) keys.delete(k);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup',   onKeyUp);
    refs.flyKeys = keys;

    // Shift = sprint, Ctrl = precision. Tracked separately from the
    // WASD set so they apply even mid-press (you can hold W then tap
    // Shift to accelerate without releasing). Cleared on blur so a
    // window switch doesn't leave the modifier "stuck on".
    const onModKey = (e) => {
      refs.speedFast = e.shiftKey;
      refs.speedSlow = e.ctrlKey;
    };
    const onBlur = () => {
      refs.speedFast = false;
      refs.speedSlow = false;
      keys.clear();
    };
    window.addEventListener('keydown', onModKey);
    window.addEventListener('keyup',   onModKey);
    window.addEventListener('blur',    onBlur);

    // rAF loop — controls + galactic drift + fit animation + render.
    const rotationAxis = new THREE.Vector3(0, 1, 0);
    let last = performance.now();
    controls.addEventListener('start', () => { refs.interacting = true; });
    controls.addEventListener('end',   () => { refs.interacting = false; });
    const loop = () => {
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      // Fit animation — interpolate camera position + controls.target
      // from "from" to "to" over fitDuration. Cubic ease-out.
      if (refs.fitAnimating) {
        const t = Math.min(1, (now - refs.fitStart) / refs.fitDuration);
        const eased = 1 - Math.pow(1 - t, 3);
        camera.position.lerpVectors(refs.fitFromPos, refs.fitToPos, eased);
        controls.target.lerpVectors(refs.fitFromTarget, refs.fitToTarget, eased);
        if (t >= 1) refs.fitAnimating = false;
      } else if (!refs.interacting && !refs.lookActive && keys.size === 0) {
        // Idle drift = galactic rotation. Pauses during orbit drag,
        // pointer-lock look mode, WASD movement, and fit animations
        // so the various motions never fight.
        const rel = camera.position.clone().sub(controls.target);
        rel.applyAxisAngle(rotationAxis, GALAXY.rotationRate * dt);
        camera.position.copy(rel.add(controls.target));
      }

      // WASD / QE flying — applied AFTER fit/drift so movement isn't
      // overwritten. Move both camera and orbit target by the same
      // offset so OrbitControls' orbit pose stays consistent.
      if (keys.size > 0) {
        const dist = camera.position.distanceTo(controls.target);
        // Speed modifiers: Shift = 3× (sprint), Ctrl = 0.25× (precision).
        // Both held cancels out roughly to the base rate.
        const mod = (refs.speedFast ? 3 : 1) * (refs.speedSlow ? 0.25 : 1);
        const speed = Math.max(50, dist * 1.2) * mod * dt;
        const forward = controls.target.clone().sub(camera.position).normalize();
        const right   = forward.clone().cross(camera.up).normalize();
        const up      = camera.up.clone().normalize();
        const move = new THREE.Vector3();
        if (keys.has('w')) move.add(forward);
        if (keys.has('s')) move.sub(forward);
        if (keys.has('d')) move.add(right);
        if (keys.has('a')) move.sub(right);
        if (keys.has('e')) move.add(up);
        if (keys.has('q')) move.sub(up);
        if (move.lengthSq() > 0) {
          move.normalize().multiplyScalar(speed);
          camera.position.add(move);
          controls.target.add(move);
        }
      }
      // Update live FX (rings, flashes, edge pulses) — cheap walk over
      // activeFx, splat into the fxPoints buffer, drop expired.
      updateFx(refs, now);
      // The minute-long arrival afterglow, written straight into the halo
      // sizes. No-ops entirely when nothing is hot.
      updateHot(refs, now);
      controls.update();
      // Edge fade by distance — at long zoom the edges drown out
      // the actual node dots; fade them so the nodes shine through.
      // Sharp at typical viewing distance, dims to ~25% at the rim.
      const focusDist = camera.position.distanceTo(controls.target);
      const edgeFade = THREE.MathUtils.smoothstep(focusDist, 600, 4000);
      // Density normalization — long-exposure style: the more sources
      // on screen, the less luminance each contributes. Without this,
      // 200k additive halos stack dozens deep per pixel and bloom
      // saturates the whole universe into one gold blob. Unity below
      // ~30k, so today's corpus renders exactly as it always did.
      const edgeDensity = Math.min(1, Math.max(0.12,
        Math.sqrt(30000 / Math.max(1, refs.edges.length))));
      // refs.edgeLines, NOT the mount-time const — ensureEdgeCapacity
      // swaps the object once the corpus outgrows the initial buffer,
      // and writing to the disposed one silently disables the fade.
      refs.edgeLines.material.opacity = (1 - 0.75 * edgeFade) * edgeDensity;
      const haloDensity = Math.min(1, Math.max(0.05,
        Math.sqrt(30000 / Math.max(1, refs.nodes.length))));
      refs.haloPoints.material.uniforms.uOpacity.value = 0.30 * haloDensity;
      composer.render();
      refs.rafId = requestAnimationFrame(loop);
    };
    refs.rafId = requestAnimationFrame(loop);

    // Resize observer.
    const ro = new ResizeObserver(() => {
      const r2 = container.getBoundingClientRect();
      const w2 = Math.max(200, Math.floor(r2.width));
      const h2 = Math.max(200, Math.floor(r2.height));
      camera.aspect = w2 / h2;
      camera.updateProjectionMatrix();
      renderer.setSize(w2, h2);
      composer.setSize(w2, h2);
      bloomPass.setSize(w2, h2);
      updatePxPerUnit(h2);
    });
    ro.observe(container);
    const onWinResize = () => { ro.takeRecords?.(); };
    window.addEventListener('resize', onWinResize);

    // Tab visibility — pause worker + rAF when hidden.
    const onVis = () => {
      if (document.visibilityState === 'visible') {
        if (!refs.rafId) refs.rafId = requestAnimationFrame(loop);
        worker.postMessage({ type: 'resume' });
      } else {
        if (refs.rafId) { cancelAnimationFrame(refs.rafId); refs.rafId = null; }
        worker.postMessage({ type: 'pause' });
      }
    };
    document.addEventListener('visibilitychange', onVis);

    // Cleanup.
    return () => {
      window.removeEventListener('keydown',  onKeyDown);
      window.removeEventListener('keyup',    onKeyUp);
      window.removeEventListener('keydown',  onModKey);
      window.removeEventListener('keyup',    onModKey);
      window.removeEventListener('blur',     onBlur);
      window.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('pointerlockchange', onPointerLockChange);
      document.removeEventListener('visibilitychange', onVis);
      if (document.pointerLockElement === renderer.domElement) {
        try { document.exitPointerLock(); } catch (_) {}
      }
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup',   onPointerUp);
      renderer.domElement.removeEventListener('pointermove',  onHoverMove);
      renderer.domElement.removeEventListener('pointerleave', onHoverLeave);
      window.removeEventListener('resize', onWinResize);
      ro.disconnect();
      if (refs.rafId) cancelAnimationFrame(refs.rafId);
      refs.rafId = null;
      try { worker.postMessage({ type: 'stop' }); } catch (_) {}
      try { worker.terminate(); } catch (_) {}
      refs.worker = null;
      try { container.removeChild(renderer.domElement); } catch (_) {}
      // Dispose GPU resources.
      anchorMesh.geometry.dispose();
      anchorMesh.material.dispose();
      bodyPoints.geometry.dispose();
      bodyPoints.material.dispose();
      haloPoints.geometry.dispose();
      haloPoints.material.dispose();
      edgeLines.geometry.dispose();
      edgeLines.material.dispose();
      fxPoints.geometry.dispose();
      fxPoints.material.dispose();
      composer.dispose();
      renderer.dispose();
      refs.scene = null; refs.camera = null; refs.renderer = null; refs.controls = null;
      refs.composer = null; refs.bloomPass = null;
      refs.anchorMesh = null; refs.bodyPoints = null; refs.haloPoints = null;
      refs.sharedPosAttr = null; refs.edgeLines = null; refs.fxPoints = null;
      refs.activeFx = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey]);

  // ── Snapshot loader ──────────────────────────────────────────────
  // Walks EVERY page until the server's SQL-computed `done` — the
  // page-size heuristic that froze the universe at PostgREST's 1k
  // truncation is gone (see lib/universePaging.js).
  useEffect(() => {
    let cancelled = false;
    setError(null);
    setCalibrating(true);
    setProgress({ nodes: 0, edges: 0 });

    // Deltas that arrive mid-walk stay buffered until the worker has
    // its init state — a flush before then would push nodes the
    // worker silently drops (no sim yet), desyncing indices, and the
    // loader's rebuild below would strand their anchor slots.
    refs.snapshotReady = false;
    setDeltaReady(false);

    (async () => {
      try {
        const fetchPage = dataSource?.fetchPage || fetchSnapshotPage;
        const { nodes: allRawNodes, edges: allRawEdges, truncated } = await collectSnapshot({
          fetchPage,
          nodeLimit: NODE_PAGE,
          edgeLimit: EDGE_PAGE,
          maxNodes: SOFT_NODE_LIMIT,
          onProgress: (p) => { if (!cancelled) setProgress(p); },
          isCancelled: () => cancelled,
        });
        if (cancelled) return;
        if (truncated) {
          // eslint-disable-next-line no-console
          console.warn(`[universe] corpus exceeds SOFT_NODE_LIMIT (${SOFT_NODE_LIMIT.toLocaleString()}); showing the first ${SOFT_NODE_LIMIT.toLocaleString()} nodes`);
        }

        // Build render state from scratch — including the anchor
        // bookkeeping and FX, which would otherwise keep slots from
        // any state written before this rebuild.
        ensureNodeCapacity(refs, allRawNodes.length);
        refs.nodes = [];
        refs.nodeIndex = new Map();
        refs.edges = [];
        refs.edgeKeys = new Set();
        refs.kindCounts = new Map();
        refs.anchorGlobals = [];
        refs.anchorSlot.fill(-1);
        if (refs.anchorMesh) refs.anchorMesh.count = 0;
        refs.activeFx = [];
        refs.pendingFx = [];
        refs.hotNodes = new Map();
        // The delta cursor. Every one of these timestamps was written by
        // Postgres, so starting the stream here cannot be thrown off by a
        // browser clock (see useUniverseDeltas). Edges are scanned too because
        // an edge can carry a timestamp newer than any node's.
        let maxTs = null;
        for (const raw of allRawNodes) {
          if (raw.created_at && (!maxTs || raw.created_at > maxTs)) maxTs = raw.created_at;
          if (refs.nodeIndex.has(raw.node_id)) continue;
          const node = toNode(raw);
          const idx = refs.nodes.length;
          refs.nodes.push(node);
          refs.nodeIndex.set(node.id, idx);
          countKind(refs, node);
          writeNodeAppearance(refs, idx, node);
        }
        // Resolve edges; drop orphans and any duplicate (src,tgt,kind).
        const resolvedEdges = [];
        for (const raw of allRawEdges) {
          if (raw.created_at && (!maxTs || raw.created_at > maxTs)) maxTs = raw.created_at;
          const s = refs.nodeIndex.get(raw.source_id);
          const t = refs.nodeIndex.get(raw.target_id);
          if (s == null || t == null) continue;
          const key = edgeKeyOf(raw);
          if (refs.edgeKeys.has(key)) continue;
          refs.edgeKeys.add(key);
          resolvedEdges.push({
            sourceIdx: s, targetIdx: t,
            kind:    classifyEdge(raw.edge_kind),   // visual tier (scaffold/structural/semantic)
            rawKind: raw.edge_kind,                  // raw kind (worker link classification)
          });
        }
        ensureEdgeCapacity(refs, resolvedEdges.length);
        refs.edges = resolvedEdges;
        writeEdgeColors(refs);

        // Filters set before the corpus arrived (or surviving a "Try again")
        // apply to the freshly built node list — otherwise a reload silently
        // un-hides everything while the legend still shows the rows struck out.
        if (refs.hiddenKinds || refs.isolateWs) applyVisualFilters(refs);

        // Hand off to the worker. The worker computes positions and
        // posts them back; we render whatever it gives us.
        if (refs.worker) {
          const initNodes = refs.nodes.map(n => ({ id: n.id, val: n.val }));
          const initLinks = refs.edges.map(e => ({
            source: refs.nodes[e.sourceIdx].id,
            target: refs.nodes[e.targetIdx].id,
            kind:   e.rawKind,
          }));
          refs.worker.postMessage({ type: 'init', nodes: initNodes, links: initLinks });
        }
        refs.snapshotReady = true;
        // Null when the corpus is empty — useUniverseDeltas then omits `since`
        // entirely rather than substituting a local clock.
        sinceRef.current = maxTs;
        setDeltaReady(true);
        reportStats(refs);
        if (import.meta.env.DEV && typeof window !== 'undefined') {
          // QA hook for the ?adminpreview universe bench + Playwright.
          window.__universeQaStats = { nodes: refs.nodes.length, edges: refs.edges.length };
        }
      } catch (e) {
        if (!cancelled) { setError(e?.message || String(e)); setCalibrating(false); }
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey, refs]);

  // ── Delta integration ────────────────────────────────────────────
  // Buffer deltas; flush every DELTA_FLUSH_MS by sending addNodes/
  // addLinks to the worker and growing GPU buffers when we cross
  // capacity.
  useEffect(() => {
    const id = setInterval(() => {
      if (!refs.worker || !refs.bodyPoints || !refs.snapshotReady) return;
      // Dedupe the pending batch — both against already-known nodes
      // and within itself (two SSE frames can carry the same node in
      // one flush window). The worker mirrors our indices blindly, so
      // a duplicate here would desync every position after it.
      const seen = new Set();
      const newNodes = [];
      for (const n of refs.pendingNodes) {
        if (refs.nodeIndex.has(n.id) || seen.has(n.id)) continue;
        seen.add(n.id);
        newNodes.push(n);
      }
      refs.pendingNodes = [];
      // Memory guard — identical policy to the snapshot cap. Trim
      // BEFORE edge resolution so `seen` only vouches for nodes that
      // will actually exist.
      if (refs.nodes.length + newNodes.length > SOFT_NODE_LIMIT) {
        newNodes.length = Math.max(0, SOFT_NODE_LIMIT - refs.nodes.length);
        seen.clear();
        for (const n of newNodes) seen.add(n.id);
      }

      // Resolve pending edges; defer ones whose endpoints haven't
      // arrived yet up to ORPHAN_MAX_TRIES times before dropping.
      //
      // An edge we ALREADY have is dropped outright. The snapshot path always
      // deduped implicitly (one pass over one page); the delta path did not,
      // and the server re-sends an edge whenever its row's timestamp moves.
      // Every re-send used to append a duplicate to refs.edges — permanently,
      // since nothing ever removes edges — and fire a gold "new connection"
      // pulse for it. On a kiosk left up for hours that grew the edge buffer
      // without bound and celebrated edits as new links.
      const stillPending = [];
      const newEdges = [];
      for (const item of refs.pendingEdges) {
        if (refs.edgeKeys.has(edgeKeyOf(item.raw))) continue;
        const s = refs.nodeIndex.get(item.raw.source_id);
        const t = refs.nodeIndex.get(item.raw.target_id);
        const sNew = s == null && seen.has(item.raw.source_id);
        const tNew = t == null && seen.has(item.raw.target_id);
        if ((s != null || sNew) && (t != null || tNew)) {
          // Defer edges touching this batch's brand-new nodes by one
          // flush so indices exist before we resolve them. Attempts
          // still count so nothing can defer forever.
          if (sNew || tNew) {
            stillPending.push({ raw: item.raw, attempts: item.attempts + 1 });
            continue;
          }
          // Claim the key now so two identical edges inside ONE flush
          // window can't both get through.
          refs.edgeKeys.add(edgeKeyOf(item.raw));
          newEdges.push({
            sourceIdx: s, targetIdx: t,
            kind:    classifyEdge(item.raw.edge_kind),
            rawKind: item.raw.edge_kind,
          });
        } else if (item.attempts + 1 < ORPHAN_MAX_TRIES) {
          stillPending.push({ raw: item.raw, attempts: item.attempts + 1 });
        }
      }
      refs.pendingEdges = stillPending;

      if (newNodes.length) {
        ensureNodeCapacity(refs, refs.nodes.length + newNodes.length);
        for (const n of newNodes) {
          const idx = refs.nodes.length;
          refs.nodes.push(n);
          refs.nodeIndex.set(n.id, idx);
          countKind(refs, n);
          writeNodeAppearance(refs, idx, n);
          // Queue, don't spawn — the worker hasn't placed this index yet, so
          // there is no position to attach the effect to (see refs.pendingFx).
          refs.pendingFx.push({ idx, color: n.threeColor, val: n.val || 8 });
          refs.onArrivalFn?.(n);
        }
        refs.worker.postMessage({
          type: 'addNodes',
          nodes: newNodes.map(n => ({ id: n.id, val: n.val })),
        });
        // New indices default to fully visible. If a filter is active, classify
        // them now — otherwise a hidden kind quietly reappears one node at a
        // time as the stream runs.
        if (refs.hiddenKinds || refs.isolateWs) applyVisualFilters(refs);
      }
      if (newEdges.length) {
        ensureEdgeCapacity(refs, refs.edges.length + newEdges.length);
        refs.edges.push(...newEdges);
        writeEdgeColors(refs);
        refs.worker.postMessage({
          type: 'addLinks',
          links: newEdges.map(e => ({
            source: refs.nodes[e.sourceIdx].id,
            target: refs.nodes[e.targetIdx].id,
            kind:   e.rawKind,
          })),
        });
        // Pulse traveling along each newly-formed connection — but
        // not for scaffold edges (memberships/wsroots/shares would
        // throw bright streaks at scaffolding we just made faint).
        for (const e of newEdges) {
          if (e.kind === 'scaffold') continue;
          spawnPulse(refs, e.sourceIdx, e.targetIdx);
        }
      }
      if (newNodes.length || newEdges.length) reportStats(refs);
    }, DELTA_FLUSH_MS);
    return () => clearInterval(id);
  }, [refs]);

  const deltaStream = useUniverseDeltas({
    enabled: !dataSource?.disableDeltas,
    ready: deltaReady,
    sinceRef,
    onNode: (raw) => {
      if (refs.nodeIndex.has(raw.node_id)) return;
      refs.pendingNodes.push(toNode(raw));
    },
    onEdge: (raw) => { refs.pendingEdges.push({ raw, attempts: 0 }); },
    onBatch: ({ nodes, edges }) => {
      for (const raw of nodes) {
        if (refs.nodeIndex.has(raw.node_id)) continue;
        refs.pendingNodes.push(toNode(raw));
      }
      for (const raw of edges) refs.pendingEdges.push({ raw, attempts: 0 });
    },
  });

  // Surface stream health upward. Without this a still universe is ambiguous:
  // it looks the same whether nothing was created or the socket is gone.
  useEffect(() => {
    onStream?.(deltaStream);
  }, [onStream, deltaStream.status, deltaStream.lastDeltaAt]);   // eslint-disable-line react-hooks/exhaustive-deps

  // ── Dev-only arrival injector ────────────────────────────────────
  // Arrival choreography is the one thing here that cannot be iterated on by
  // looking at it: the real event fires about three times an hour, at a
  // location you did not choose. So DEV builds get a way to fire one on demand,
  // through the SAME buffers the SSE path writes to — not a shortcut around
  // them, or it would prove nothing about the code that actually runs.
  //
  // Guarded by the literal import.meta.env.DEV so the bundler drops it from
  // production, matching every other QA harness in this repo.
  useEffect(() => {
    if (!import.meta.env.DEV || typeof window === 'undefined') return undefined;
    window.__universeInject = (opts = {}) => {
      if (!refs.snapshotReady || refs.nodes.length === 0) return null;
      // Hang it off a real board so it lands somewhere plausible rather than
      // at the origin, and so the board→card edge resolves like a real one.
      const boards = refs.nodes.filter((n) => n.kind === 'board');
      const host = boards.length
        ? boards[Math.floor((opts.at ?? 0.5) * (boards.length - 1))]
        : refs.nodes[0];
      const id = `card:${host.id.slice(6)}:qa-${refs.nodes.length}-${opts.seq ?? 0}`;
      const created_at = new Date().toISOString();
      refs.pendingNodes.push(toNode({
        node_id: id, kind: opts.kind || 'image',
        workspace_id: host.workspace_id, created_at,
      }));
      refs.pendingEdges.push({
        raw: { source_id: host.id, target_id: id, edge_kind: 'structural', created_at },
        attempts: 0,
      });
      return id;
    };
    // Activity sparks have the same observability problem as arrivals, minus
    // the delta stream — the harness has no realtime server at all, so without
    // this the layer is invisible in the one place it can be iterated on.
    window.__universeSpark = (count = 6) => {
      const boards = refs.nodes
        .map((n, i) => (n.kind === 'board' && refs.visMul[i] !== 0 ? i : -1))
        .filter((i) => i >= 0);
      if (!boards.length) return 0;
      const now = performance.now();
      for (let k = 0; k < count; k++) {
        const idx = boards[Math.floor((k / count) * (boards.length - 1))];
        pushFx(refs, {
          kind: 'spark', nodeIdx: idx, start: now + k * 60,
          dur: SPARK_DURATION_MS, color: SPARK_COLOR, val: refs.nodes[idx]?.val || 14,
        });
      }
      return count;
    };
    return () => {
      try { delete window.__universeInject; delete window.__universeSpark; } catch (_) { /* ignore */ }
    };
  }, [refs]);

  // ── Error / loading UI ───────────────────────────────────────────
  if (error) {
    return (
      <div className="universe-canvas universe-error t-body" ref={containerRef}>
        <div className="universe-error-inner">
          <div>Couldn't load the universe.</div>
          <div className="t-meta" style={{ marginTop: 6, color: 'var(--ink-3)' }}>{error}</div>
          <button className="auth-link" style={{ marginTop: 14 }} onClick={() => setReloadKey(k => k + 1)}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="universe-canvas" ref={containerRef} style={{ background: SPACE_BG }}>
      <div className="grain-surface" aria-hidden="true" style={{ zIndex: 1, pointerEvents: 'none' }} />
      {/* Vignette. A CSS overlay rather than a post-processing pass: the
          composer already runs bloom over the full frame, and a second pass to
          darken corners would cost real milliseconds to do what one gradient
          does for free. */}
      <div className="universe-vignette" aria-hidden="true" />
      {hover && <HoverCard hover={hover} />}
      {calibrating && (
        <div className="universe-overlay">
          <div className="universe-overlay-inner">
            <div className="t-eyebrow">Calibrating universe…</div>
            <div className="t-meta" style={{ marginTop: 6 }}>
              {progress.nodes.toLocaleString()} nodes · {progress.edges.toLocaleString()} connections
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// The hover readout. Deliberately the same three facts the click drawer shows —
// kind, workspace, created — because the privacy contract is that this view
// carries identity and never content, and hover is not an exception to it.
function HoverCard({ hover }) {
  const n = hover.node;
  const label = KIND_HOVER_LABELS[n.cardKind] || KIND_HOVER_LABELS[n.kind] || n.cardKind || n.kind;
  return (
    <div className="universe-hover surface-frosted"
         style={{ left: hover.x, top: hover.y }}
         aria-hidden="true">
      <span className="universe-hover-dot" style={{ background: n.color }} />
      <span className="universe-hover-kind">{label}</span>
      <span className="universe-hover-time">{shortAgo(n.created_at)}</span>
    </div>
  );
}

const KIND_HOVER_LABELS = {
  ws: 'Workspace', board: 'Board', doc: 'Doc', note: 'Note', image: 'Image',
  palette: 'Palette', link: 'Link', grid: 'Grid', url: 'External link',
  boardlink: 'Board link', card: 'Card',
};

// Compact relative age. adminFormat's relativeTime is prose ("3 hours ago");
// this sits inside a ~140px chip beside a colour dot, where prose wraps.
function shortAgo(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60)     return `${Math.round(s)}s`;
  if (s < 3600)   return `${Math.round(s / 60)}m`;
  if (s < 86400)  return `${Math.round(s / 3600)}h`;
  if (s < 2592000) return `${Math.round(s / 86400)}d`;
  return new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// ─────────────────────────────────────────────────────────────────
// Three.js construction helpers
// ─────────────────────────────────────────────────────────────────

// True spheres for the ws/board anchors only. Flat-shaded, so the
// silhouette is what matters — and it keeps growing past point-sprite
// size limits when you fly right up to a sun.
function makeAnchorMesh(capacity) {
  const geom = new THREE.SphereGeometry(1, 16, 16);
  const mat  = new THREE.MeshBasicMaterial({ vertexColors: false });
  const mesh = new THREE.InstancedMesh(geom, mat, capacity);
  mesh.frustumCulled = false;
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
  mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  return mesh;
}

function makeBodyPoints(capacity, sharedPosAttr) {
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', sharedPosAttr);
  geom.setAttribute('color',    new THREE.BufferAttribute(new Float32Array(capacity * 3), 3));
  geom.setAttribute('size',     new THREE.BufferAttribute(new Float32Array(capacity),     1));
  geom.attributes.color.setUsage(THREE.DynamicDrawUsage);
  geom.attributes.size.setUsage(THREE.DynamicDrawUsage);
  const points = new THREE.Points(geom, makeBodyMaterial());
  points.frustumCulled = false;
  return points;
}

function makeHaloPoints(capacity, sharedPosAttr) {
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', sharedPosAttr);
  geom.setAttribute('color',    new THREE.BufferAttribute(new Float32Array(capacity * 3), 3));
  geom.setAttribute('size',     new THREE.BufferAttribute(new Float32Array(capacity),     1));
  geom.attributes.color.setUsage(THREE.DynamicDrawUsage);
  geom.attributes.size.setUsage(THREE.DynamicDrawUsage);
  const points = new THREE.Points(geom, makeHaloMaterial());
  points.frustumCulled = false;
  return points;
}

function makeEdgeLines(edgeCapacity) {
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(edgeCapacity * 2 * 3), 3));
  geom.setAttribute('color',    new THREE.BufferAttribute(new Float32Array(edgeCapacity * 2 * 3), 3));
  geom.attributes.position.setUsage(THREE.DynamicDrawUsage);
  geom.attributes.color.setUsage(THREE.DynamicDrawUsage);
  // opacity stays at 1 because per-edge alpha is baked into the
  // vertex colors (see premul() above). fog disabled so the scene
  // fog doesn't dim already-dim edges into invisibility.
  const mat = new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, opacity: 1.0, depthWrite: false, fog: false,
  });
  const lines = new THREE.LineSegments(geom, mat);
  lines.frustumCulled = false;
  return lines;
}

// ─────────────────────────────────────────────────────────────────
// GPU buffer maintenance
// ─────────────────────────────────────────────────────────────────

const _tmpMatrix = new THREE.Matrix4();
const _tmpPos    = new THREE.Vector3();
const _tmpScale  = new THREE.Vector3();
const _tmpQuat   = new THREE.Quaternion();
const _tmpColor  = new THREE.Color();

// Allocate this node's slot (anchors get a sphere; leaves get a disc) and then
// write its appearance. Slot allocation is one-time and append-only; the visual
// write is re-runnable, which is what lets filtering and isolation repaint
// without disturbing the index alignment the worker mirrors.
function writeNodeAppearance(refs, idx, node) {
  // User nodes are PHYSICS-ONLY — they exist in the simulation so
  // workspaces with shared people lean toward each other, but they
  // render nothing (no body, no halo). Radius 0 zeroes both sprites.
  const r = node.kind === 'user' ? 0 : (node.val || 8) * 0.4;
  refs.baseScale[idx] = r;

  if (node.isAnchor) {
    ensureAnchorCapacity(refs, refs.anchorGlobals.length + 1);
    const slot = refs.anchorGlobals.length;
    refs.anchorGlobals.push(idx);
    refs.anchorSlot[idx] = slot;
    // Seed a valid zero-scale matrix. The real one is written on the next tick
    // from the worker's position; until then the slot is already inside
    // anchorMesh.count, and an all-zero (never-composed) matrix is degenerate
    // rather than merely invisible. Zero SCALE is the well-defined way to say
    // "not yet placed" — and it beats the old behaviour, which composed the
    // sphere at full size on the world origin for a frame.
    _tmpScale.set(0, 0, 0);
    _tmpPos.set(0, 0, 0);
    _tmpMatrix.compose(_tmpPos, _tmpQuat, _tmpScale);
    refs.anchorMesh.setMatrixAt(slot, _tmpMatrix);
    refs.anchorMesh.instanceMatrix.needsUpdate = true;
    refs.anchorMesh.count = refs.anchorGlobals.length;
  } else {
    refs.anchorSlot[idx] = -1;
  }
  writeNodeVisual(refs, idx, node);
}

// The re-runnable half: colour and size only, with the per-node visibility and
// dim multipliers folded in.
//
// Those two multipliers exist so legend filtering, workspace isolation and the
// arrival afterglow never have to know about each other. Each feature writes a
// multiplier; this is the single place that turns multipliers into pixels.
// Mutating colours in place instead (the obvious approach) means whichever
// feature repaints last silently wins, and the node's true colour is gone.
function writeNodeVisual(refs, idx, node) {
  const vis = refs.visMul[idx];
  const dim = refs.dimMul[idx];
  const r = refs.baseScale[idx];
  const c = node.threeColor;
  const cr = c.r * dim, cg = c.g * dim, cb = c.b * dim;

  const hc = refs.haloPoints.geometry.attributes.color;
  const hs = refs.haloPoints.geometry.attributes.size;
  hc.array[idx * 3]     = cr;
  hc.array[idx * 3 + 1] = cg;
  hc.array[idx * 3 + 2] = cb;
  hs.array[idx]         = r * 3.7 * vis;
  hc.needsUpdate = true;
  hs.needsUpdate = true;

  const bc = refs.bodyPoints.geometry.attributes.color;
  const bs = refs.bodyPoints.geometry.attributes.size;
  const slot = refs.anchorSlot[idx];
  if (slot >= 0) {
    // Anchors are true spheres. Hiding one means scaling its instance to zero;
    // the matrix is rewritten every tick from baseScale, so the vis multiplier
    // has to live there too (see uploadPositions).
    refs.anchorMesh.setColorAt(slot, _tmpColor.setRGB(cr, cg, cb));
    if (refs.anchorMesh.instanceColor) refs.anchorMesh.instanceColor.needsUpdate = true;
    bs.array[idx] = 0;
  } else {
    bc.array[idx * 3]     = cr;
    bc.array[idx * 3 + 1] = cg;
    bc.array[idx * 3 + 2] = cb;
    bs.array[idx]         = r * 2 * vis;   // shader takes world DIAMETER
  }
  bc.needsUpdate = true;
  bs.needsUpdate = true;
}

// Recompute every node's visibility/dim from the current filters, then repaint.
// O(N) — a few milliseconds on today's corpus, and it only runs when a filter
// actually changes, never per frame.
const DIM_FACTOR = 0.16;
function applyVisualFilters(refs) {
  if (!refs.bodyPoints || !refs.haloPoints) return;
  const hidden = refs.hiddenKinds;
  const iso    = refs.isolateWs;
  const hasHidden = hidden && hidden.size > 0;
  for (let i = 0; i < refs.nodes.length; i++) {
    const n = refs.nodes[i];
    if (!n) continue;
    const legendKey = n.cardKind && COLOR[n.cardKind] ? n.cardKind : n.kind;
    // Users are invisible either way; isolating never dims them into a
    // different kind of invisible.
    const isHidden = hasHidden && hidden.has(legendKey);
    const isDim    = !!iso && n.kind !== 'user' && n.workspace_id !== iso;
    refs.visMul[i] = isHidden ? 0 : 1;
    refs.dimMul[i] = isDim ? DIM_FACTOR : 1;
    writeNodeVisual(refs, i, n);
  }
  writeEdgeColors(refs);
}

function writeEdgeColors(refs) {
  const ca = refs.edgeLines.geometry.attributes.color;
  for (let i = 0; i < refs.edges.length; i++) {
    const e = refs.edges[i];
    // People-mediated edges render nothing — physics still apply
    // (workspaces with shared users get a faint tug toward each
    // other) but no thread is drawn between them.
    const hidden = e.rawKind === 'membership' || e.rawKind === 'share';
    const c = hidden                  ? null
            : e.kind === 'scaffold'   ? SCAFFOLD_RGB
            : e.kind === 'structural' ? STRUCTURAL_RGB
            :                           SEMANTIC_RGB;
    // An edge is only as visible as its dimmer endpoint. A thread left at full
    // strength between two dimmed nodes reads as the brightest thing on screen
    // once everything around it fades — the isolate view would be all edges.
    const m = c
      ? Math.min(refs.visMul[e.sourceIdx], refs.visMul[e.targetIdx]) *
        Math.min(refs.dimMul[e.sourceIdx], refs.dimMul[e.targetIdx])
      : 0;
    const base = i * 6;
    if (c && m > 0) {
      const r = c.r * m, g = c.g * m, b = c.b * m;
      ca.array[base]     = r; ca.array[base + 1] = g; ca.array[base + 2] = b;
      ca.array[base + 3] = r; ca.array[base + 4] = g; ca.array[base + 5] = b;
    } else {
      ca.array[base] = ca.array[base + 1] = ca.array[base + 2] = 0;
      ca.array[base + 3] = ca.array[base + 4] = ca.array[base + 5] = 0;
    }
  }
  ca.needsUpdate = true;
}

// Splat positions[] (Float32Array of (x,y,z) per node) into the
// SHARED position attribute (bodies + halos in one upload), the
// anchor sphere matrices (small loop — anchors only), and the edge
// vertex buffer. This is the per-tick hot path; leaves cost one
// memcpy, not a Matrix4 compose each.
function uploadPositions(refs, count) {
  const pos = refs.positions;
  const shared = refs.sharedPosAttr;
  shared.array.set(pos.subarray(0, Math.min(count * 3, shared.array.length)));
  shared.needsUpdate = true;
  const n = Math.min(refs.nodeCapacity, refs.nodes.length);
  refs.bodyPoints.geometry.setDrawRange(0, n);
  refs.haloPoints.geometry.setDrawRange(0, n);

  // Anchor spheres — matrix per anchor, nothing per leaf.
  const base = refs.baseScale;
  for (let s = 0; s < refs.anchorGlobals.length; s++) {
    const i = refs.anchorGlobals[s];
    if (i >= count) continue;
    // A filtered-out anchor scales to zero here rather than being removed from
    // the instance list: slots are index-aligned with anchorGlobals for the
    // life of the snapshot, and compacting them would desync every slot after.
    const r = base[i] * refs.visMul[i];
    _tmpPos.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
    _tmpScale.set(r, r, r);
    _tmpMatrix.compose(_tmpPos, _tmpQuat, _tmpScale);
    refs.anchorMesh.setMatrixAt(s, _tmpMatrix);
  }
  refs.anchorMesh.count = refs.anchorGlobals.length;
  refs.anchorMesh.instanceMatrix.needsUpdate = true;

  // Edges — rebuild endpoints from the new positions.
  const ep = refs.edgeLines.geometry.attributes.position;
  for (let i = 0; i < refs.edges.length; i++) {
    const e = refs.edges[i];
    const a = e.sourceIdx, b = e.targetIdx;
    const o = i * 6;
    ep.array[o]     = pos[a * 3];
    ep.array[o + 1] = pos[a * 3 + 1];
    ep.array[o + 2] = pos[a * 3 + 2];
    ep.array[o + 3] = pos[b * 3];
    ep.array[o + 4] = pos[b * 3 + 1];
    ep.array[o + 5] = pos[b * 3 + 2];
  }
  ep.needsUpdate = true;
  refs.edgeLines.geometry.setDrawRange(0, refs.edges.length * 2);

  // Pull the camera back so the whole universe stays in view as more
  // nodes arrive. Cheap to check; the heavy work only fires when the
  // bounding sphere has actually grown past the current frustum.
  maybeAutoFit(refs, count);
}

// CPU picking: closest node along the ray whose radius (or angular
// slop — PICK_SLOP_PX device pixels at its depth) contains the ray.
// O(N) over a flat Float32Array: ~1-2ms per click at a million nodes,
// and exact — no invisible user-node hits, no sphere-mesh raycasting.
function pickNode(refs, ray) {
  const ro = ray.origin, rd = ray.direction;
  const pos = refs.positions;
  const base = refs.baseScale;
  const nodes = refs.nodes;
  const slopPerUnit = PICK_SLOP_PX * (refs.renderer?.getPixelRatio?.() || 1) / refs.pxPerUnit;
  let best = null, bestT = Infinity;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    // Users are invisible by design; filtered-out kinds are invisible by
    // request. Neither may be picked — a click landing on something you cannot
    // see is the definition of a phantom hit.
    if (!node || node.kind === 'user' || refs.visMul[i] === 0) continue;
    const px = pos[i * 3]     - ro.x;
    const py = pos[i * 3 + 1] - ro.y;
    const pz = pos[i * 3 + 2] - ro.z;
    const t = px * rd.x + py * rd.y + pz * rd.z;
    if (t <= 0 || t >= bestT) continue;
    const dx = px - t * rd.x;
    const dy = py - t * rd.y;
    const dz = pz - t * rd.z;
    const rr = Math.max(base[i], t * slopPerUnit);
    if (dx * dx + dy * dy + dz * dz <= rr * rr) { best = node; bestT = t; }
  }
  return best;
}

// Compute the bounding sphere of the current node positions.
// Skips invisible user nodes (they're physics-only — including them
// would let an off-the-rim user drag the framing to oblivion) and
// uses the 95th percentile of distance instead of the max so any
// single outlier card can't blow up the auto-fit either. Above
// FIT_SAMPLE_MAX nodes the percentile runs on an even stride sample —
// framing needs the shape of the distribution, not every member.
const FIT_SAMPLE_MAX = 20000;
function computeBoundingSphere(refs, count) {
  if (count === 0) return null;
  const pos = refs.positions;
  const nodes = refs.nodes;
  const stride = Math.max(1, Math.ceil(count / FIT_SAMPLE_MAX));
  let cx = 0, cy = 0, cz = 0, used = 0;
  for (let i = 0; i < count; i += stride) {
    const n = nodes[i];
    if (n && n.kind === 'user') continue;
    cx += pos[i * 3]; cy += pos[i * 3 + 1]; cz += pos[i * 3 + 2];
    used++;
  }
  if (used === 0) return null;
  cx /= used; cy /= used; cz /= used;
  const d2s = new Float64Array(used);
  let j = 0;
  for (let i = 0; i < count; i += stride) {
    const n = nodes[i];
    if (n && n.kind === 'user') continue;
    const dx = pos[i * 3]     - cx;
    const dy = pos[i * 3 + 1] - cy;
    const dz = pos[i * 3 + 2] - cz;
    d2s[j++] = dx * dx + dy * dy + dz * dz;
  }
  d2s.sort();
  const pct = refs.fitAll ? (used - 1) : Math.min(used - 1, Math.floor(used * 0.95));
  return { cx, cy, cz, radius: Math.sqrt(d2s[pct]) };
}

// Distance the camera needs to be from `center` to fit a sphere of
// `radius` in view, considering both the vertical and horizontal FoV.
// 1.10 padding = tight framing.
function fitDistance(radius, camera, padding = 1.10) {
  const vFov = (camera.fov * Math.PI) / 180;
  const distV = radius / Math.tan(vFov / 2);
  const distH = radius / (Math.tan(vFov / 2) * camera.aspect);
  return Math.max(distV, distH, 50) * padding;
}

// Initial-only auto-fit. The first time we have settled positions,
// snap the camera to fit the universe (preserving the top-down
// starting direction). After that, the camera is the user's — we
// never pull them back from a manual zoom. They can hit the
// "Reset view" button to request a fit via requestFit().
function maybeAutoFit(refs, count) {
  if (refs.didInitialFit) return;
  if (!refs.camera || !refs.controls || count === 0) return;
  const bs = computeBoundingSphere(refs, count);
  if (!bs || !isFinite(bs.radius)) return;
  // Size the fog to the universe rather than to fixed world units, so a
  // 500-unit corpus and a 5,000-unit one both get the same amount of depth.
  setFogRange(refs, bs.radius);
  const targetCenter = new THREE.Vector3(bs.cx, bs.cy, bs.cz);
  const needed = fitDistance(bs.radius, refs.camera);
  const dir = refs.camera.position.clone().sub(refs.controls.target).normalize();
  if (dir.lengthSq() === 0) dir.set(0, 0, 1);
  refs.camera.position.copy(targetCenter).add(dir.multiplyScalar(needed));
  refs.controls.target.copy(targetCenter);
  refs.didInitialFit = true;
  refs.lastFitAt = performance.now();
}

// Animated "fit everything" — kicked by the Reset view button. Pulls
// the camera back to frame the whole universe along its CURRENT
// direction (so the top-down pose is preserved). Animates over ~700ms.
function requestFit(refs) {
  if (!refs.camera || !refs.controls) return;
  const count = refs.nodes.length;
  if (count === 0) return;
  const bs = computeBoundingSphere(refs, count);
  if (!bs || !isFinite(bs.radius)) return;
  setFogRange(refs, bs.radius);
  const targetCenter = new THREE.Vector3(bs.cx, bs.cy, bs.cz);
  const needed = fitDistance(bs.radius, refs.camera);
  const dir = refs.camera.position.clone().sub(refs.controls.target).normalize();
  if (dir.lengthSq() === 0) dir.set(0, 1, 0);
  refs.fitFromPos    = refs.camera.position.clone();
  refs.fitFromTarget = refs.controls.target.clone();
  refs.fitToPos      = targetCenter.clone().add(dir.multiplyScalar(needed));
  refs.fitToTarget   = targetCenter.clone();
  refs.fitStart      = performance.now();
  refs.fitDuration   = 700;
  refs.fitAnimating  = true;
  refs.lastFitAt     = refs.fitStart;
}

// Fly to one node, keeping the current viewing direction so the trip reads as
// approaching rather than teleporting. Same lerp machinery as requestFit —
// this is that function with an arbitrary target instead of the bounding
// sphere's centre.
//
// The stop distance scales with the node's own radius, so arriving at a
// workspace anchor frames a neighbourhood and arriving at a card frames the
// card. A fixed distance does one of those two jobs badly.
function flyToNode(refs, idx) {
  if (!refs.camera || !refs.controls) return;
  const pos = refs.positions;
  if (!pos || idx * 3 + 2 >= pos.length) return;
  const target = new THREE.Vector3(pos[idx * 3], pos[idx * 3 + 1], pos[idx * 3 + 2]);
  const r = Math.max(refs.baseScale[idx] || 0, 3);
  // Stop far enough out to see the node's neighbourhood. Scaling purely by the
  // node's own radius put a card's camera ~90 units away, which lands you
  // INSIDE the swarm: the arrival is dead centre and completely
  // indistinguishable from the hundred cards crowding the frame. The floor is
  // what makes the destination legible; the multiplier still gives a board or
  // workspace the wider berth it needs.
  const needed = Math.max(240, r * 30);
  const dir = refs.camera.position.clone().sub(refs.controls.target).normalize();
  if (dir.lengthSq() === 0) dir.set(0, 1, 0);
  refs.fitFromPos    = refs.camera.position.clone();
  refs.fitFromTarget = refs.controls.target.clone();
  refs.fitToPos      = target.clone().add(dir.multiplyScalar(needed));
  refs.fitToTarget   = target.clone();
  refs.fitStart      = performance.now();
  refs.fitDuration   = 900;
  refs.fitAnimating  = true;
  refs.lastFitAt     = refs.fitStart;
}

// Grow the per-node buffers (shared positions, body + halo colors and
// sizes, baseScale, anchorSlot). Anchor sphere capacity grows
// independently in ensureAnchorCapacity.
function ensureNodeCapacity(refs, needed) {
  if (needed <= refs.nodeCapacity) return;
  const newCap = nextPow2(needed, refs.nodeCapacity);
  const oldCount = refs.nodes.length;

  const newShared = new THREE.BufferAttribute(new Float32Array(newCap * 3), 3);
  newShared.setUsage(THREE.DynamicDrawUsage);
  newShared.array.set(refs.sharedPosAttr.array.subarray(0, oldCount * 3));

  const oldBody = refs.bodyPoints;
  const oldHalo = refs.haloPoints;
  const newBody = makeBodyPoints(newCap, newShared);
  const newHalo = makeHaloPoints(newCap, newShared);
  newBody.material.uniforms.uPxPerUnit.value = refs.pxPerUnit;
  // Fresh materials come with fog disabled (1e9). Carry the sized range across
  // the swap or the universe silently flattens the moment it outgrows a buffer.
  if (refs.fogNear) {
    newBody.material.uniforms.uFogNear.value = refs.fogNear;
    newBody.material.uniforms.uFogFar.value  = refs.fogFar;
    newHalo.material.uniforms.uFogNear.value = refs.fogNear;
    newHalo.material.uniforms.uFogFar.value  = refs.fogFar;
  }

  const ob = oldBody.geometry.attributes;
  const nb = newBody.geometry.attributes;
  nb.color.array.set(ob.color.array.subarray(0, oldCount * 3));
  nb.size.array .set(ob.size.array .subarray(0, oldCount));
  nb.color.needsUpdate = true;
  nb.size.needsUpdate  = true;
  newBody.geometry.setDrawRange(0, oldCount);

  const oh = oldHalo.geometry.attributes;
  const nh = newHalo.geometry.attributes;
  nh.color.array.set(oh.color.array.subarray(0, oldCount * 3));
  nh.size.array .set(oh.size.array .subarray(0, oldCount));
  nh.color.needsUpdate = true;
  nh.size.needsUpdate  = true;
  newHalo.geometry.setDrawRange(0, oldCount);

  // Positions ring + per-node scalar arrays.
  const newPositions = new Float32Array(newCap * 3);
  newPositions.set(refs.positions.subarray(0, oldCount * 3));
  refs.positions = newPositions;

  const newBase = new Float32Array(newCap);
  newBase.set(refs.baseScale.subarray(0, oldCount));
  refs.baseScale = newBase;

  // Grown filled with 1 so a node that arrives while a filter is active is
  // visible-by-default until applyVisualFilters classifies it — the delta path
  // calls that right after appending, so the window is one flush wide.
  const newVis = new Float32Array(newCap).fill(1);
  newVis.set(refs.visMul.subarray(0, oldCount));
  refs.visMul = newVis;

  const newDim = new Float32Array(newCap).fill(1);
  newDim.set(refs.dimMul.subarray(0, oldCount));
  refs.dimMul = newDim;

  const newSlot = new Int32Array(newCap).fill(-1);
  newSlot.set(refs.anchorSlot.subarray(0, oldCount));
  refs.anchorSlot = newSlot;

  // Swap in, dispose old.
  refs.scene.remove(oldBody);
  refs.scene.remove(oldHalo);
  oldBody.geometry.dispose(); oldBody.material.dispose();
  oldHalo.geometry.dispose(); oldHalo.material.dispose();
  refs.scene.add(newBody);
  refs.scene.add(newHalo);
  refs.bodyPoints = newBody;
  refs.haloPoints = newHalo;
  refs.sharedPosAttr = newShared;
  refs.nodeCapacity = newCap;
}

function ensureAnchorCapacity(refs, needed) {
  if (needed <= refs.anchorCapacity) return;
  const newCap = nextPow2(needed, refs.anchorCapacity);
  const oldMesh = refs.anchorMesh;
  const newMesh = makeAnchorMesh(newCap);
  const oldCount = refs.anchorGlobals.length;
  for (let s = 0; s < oldCount; s++) {
    oldMesh.getMatrixAt(s, _tmpMatrix);
    newMesh.setMatrixAt(s, _tmpMatrix);
  }
  if (oldMesh.instanceColor && newMesh.instanceColor) {
    newMesh.instanceColor.array.set(oldMesh.instanceColor.array.subarray(0, oldCount * 3));
  }
  newMesh.count = oldCount;
  newMesh.instanceMatrix.needsUpdate = true;
  if (newMesh.instanceColor) newMesh.instanceColor.needsUpdate = true;
  refs.scene.remove(oldMesh);
  oldMesh.geometry.dispose();
  oldMesh.material.dispose();
  refs.scene.add(newMesh);
  refs.anchorMesh = newMesh;
  refs.anchorCapacity = newCap;
}

// ─────────────────────────────────────────────────────────────────
// Live FX — pulses on new edges + spawn flashes on new nodes
// ─────────────────────────────────────────────────────────────────

function spawnPulse(refs, sourceIdx, targetIdx) {
  if (sourceIdx == null || targetIdx == null) return;
  pushFx(refs, {
    kind: 'pulse',
    src: sourceIdx, tgt: targetIdx,
    start: performance.now(),
    dur: PULSE_DURATION_MS,
    color: PULSE_COLOR,
  });
}

function spawnFlash(refs, nodeIdx, color) {
  pushFx(refs, {
    kind: 'flash',
    nodeIdx,
    start: performance.now(),
    dur: FLASH_DURATION_MS,
    color: color || PULSE_COLOR,
    val: refs.nodes[nodeIdx]?.val || 8,
  });
}

// The shockwave. Gold, because --soleil is the reserved active-state accent and
// a node arriving is about as active as this surface gets.
function spawnRing(refs, nodeIdx, val) {
  pushFx(refs, {
    kind: 'ring',
    nodeIdx,
    start: performance.now(),
    dur: RING_DURATION_MS,
    color: PULSE_COLOR,
    val: val || refs.nodes[nodeIdx]?.val || 8,
  });
}

// Drain queued arrival effects for every node the worker has now placed.
// `count` is the tick's node count: anything at or past it still has no
// position, so it waits for the next tick rather than being drawn at (0,0,0).
function drainArrivalFx(refs, count) {
  const now = performance.now();
  const waiting = [];
  for (const q of refs.pendingFx) {
    if (q.idx >= count) { waiting.push(q); continue; }
    spawnRing(refs, q.idx, q.val);
    spawnFlash(refs, q.idx, q.color);
    refs.hotNodes.set(q.idx, { start: now, until: now + HOT_DURATION_MS });
  }
  refs.pendingFx = waiting;
}

// The minute-long afterglow. Walks only the nodes currently hot — a Map with
// single-digit entries at this platform's arrival rate — and writes straight
// into the halo size attribute, restoring the resting value on expiry.
//
// Indices are stable for the lifetime of a snapshot and ensureNodeCapacity
// copies the size array forward, so a buffer swap mid-glow is transparent here.
function updateHot(refs, now) {
  if (refs.hotNodes.size === 0 || !refs.haloPoints) return;
  const hs = refs.haloPoints.geometry.attributes.size;
  for (const [idx, h] of refs.hotNodes) {
    // Filtered-out nodes glow at zero: an arrival must never punch through a
    // filter the operator deliberately set.
    const base = refs.baseScale[idx] * 3.7 * refs.visMul[idx];
    if (now >= h.until) {
      hs.array[idx] = base;
      refs.hotNodes.delete(idx);
      continue;
    }
    const t = (now - h.start) / HOT_DURATION_MS;
    hs.array[idx] = base * (1 + (HOT_HALO_BOOST - 1) * Math.pow(1 - t, 2));
  }
  hs.needsUpdate = true;
}

function pushFx(refs, entry) {
  // Bounded buffer — drop oldest if we'd exceed FX_CAPACITY. The selection ring
  // is exempt: it is state rather than an event, and evicting it would make the
  // selection quietly vanish from the scene while the drawer still shows it.
  if (refs.activeFx.length >= FX_CAPACITY) {
    const at = refs.activeFx.findIndex((f) => f.kind !== 'select');
    if (at >= 0) refs.activeFx.splice(at, 1);
    else refs.activeFx.shift();
  }
  refs.activeFx.push(entry);
}

// Splat all active FX into the fxPoints buffer. Drops expired ones
// in-place. Called every rAF tick.
function updateFx(refs, now) {
  const fx = refs.fxPoints;
  if (!fx || refs.activeFx.length === 0) {
    if (fx) fx.geometry.setDrawRange(0, 0);
    return;
  }
  const pos = refs.positions;
  const geom = fx.geometry;
  const ap = geom.attributes.position.array;
  const ac = geom.attributes.color.array;
  const as = geom.attributes.size.array;
  const aa = geom.attributes.alpha.array;
  let writeIdx = 0;
  // Walk activeFx, keeping non-expired entries (rebuild list in place).
  const kept = [];
  for (let i = 0; i < refs.activeFx.length; i++) {
    if (writeIdx >= FX_CAPACITY) break;
    const f = refs.activeFx[i];
    const t = (now - f.start) / f.dur;
    if (t >= 1) continue;
    let x = 0, y = 0, z = 0, size = 0, alpha = 0;
    if (f.kind === 'pulse') {
      const sx = pos[f.src * 3],     sy = pos[f.src * 3 + 1], sz = pos[f.src * 3 + 2];
      const tx = pos[f.tgt * 3],     ty = pos[f.tgt * 3 + 1], tz = pos[f.tgt * 3 + 2];
      x = sx + (tx - sx) * t;
      y = sy + (ty - sy) * t;
      z = sz + (tz - sz) * t;
      size = 14;
      // sin-shaped envelope: bright in the middle, faded at endpoints.
      alpha = Math.sin(Math.PI * t) * 0.85;
    } else if (f.kind === 'flash') {
      x = pos[f.nodeIdx * 3];
      y = pos[f.nodeIdx * 3 + 1];
      z = pos[f.nodeIdx * 3 + 2];
      // Starts ~3x normal halo, shrinks back to the node size.
      const base = (f.val || 8) * 3.7;
      size  = base * (1 + 2 * (1 - t));
      alpha = (1 - t) * 0.7;
    } else if (f.kind === 'spark') {
      x = pos[f.nodeIdx * 3];
      y = pos[f.nodeIdx * 3 + 1];
      z = pos[f.nodeIdx * 3 + 2];
      // A quick blink out and back: peaks early, gone fast. Small enough that a
      // busy hour reads as a shimmer across the map rather than a fireworks
      // display competing with real arrivals.
      size  = (f.val || 14) * (2.2 + 2.6 * t);
      alpha = Math.sin(Math.PI * t) * 0.42;
    } else if (f.kind === 'select') {
      // Persistent while selected: a slow breathe rather than a decay, so it
      // reads as state instead of as an event that never finished.
      x = pos[f.nodeIdx * 3];
      y = pos[f.nodeIdx * 3 + 1];
      z = pos[f.nodeIdx * 3 + 2];
      // Sized well clear of the node's own halo. At the original 5.5x it sat
      // inside the local bloom and was indistinguishable from any other bright
      // spot — which matters most right after a fly-to, when finding the thing
      // you travelled to is the entire job.
      const breathe = 0.5 + 0.5 * Math.sin((now - f.start) / 420);
      size  = (f.val || 8) * (10 + 3 * breathe);
      alpha = 0.30 + 0.25 * breathe;
    } else if (f.kind === 'ring') {
      x = pos[f.nodeIdx * 3];
      y = pos[f.nodeIdx * 3 + 1];
      z = pos[f.nodeIdx * 3 + 2];
      // Expands fast then coasts, fading quadratically — the eye catches the
      // leading edge of the growth, not the peak brightness. Cubic ease-out on
      // size against a squared alpha falloff is what makes it read as a
      // shockwave rather than a slow bloom.
      const eased = 1 - Math.pow(1 - t, 3);
      size  = (f.val || 8) * 2 * (1 + (RING_MAX_SCALE - 1) * eased);
      alpha = Math.pow(1 - t, 2) * 0.5;
    }
    ap[writeIdx * 3]     = x;
    ap[writeIdx * 3 + 1] = y;
    ap[writeIdx * 3 + 2] = z;
    ac[writeIdx * 3]     = f.color.r;
    ac[writeIdx * 3 + 1] = f.color.g;
    ac[writeIdx * 3 + 2] = f.color.b;
    as[writeIdx]         = size;
    aa[writeIdx]         = alpha;
    writeIdx++;
    kept.push(f);
  }
  refs.activeFx = kept;
  geom.attributes.position.needsUpdate = true;
  geom.attributes.color.needsUpdate    = true;
  geom.attributes.size.needsUpdate     = true;
  geom.attributes.alpha.needsUpdate    = true;
  geom.setDrawRange(0, writeIdx);
}

function ensureEdgeCapacity(refs, needed) {
  if (needed <= refs.edgeCapacity) return;
  const newCap = nextPow2(needed, refs.edgeCapacity);
  const oldLines = refs.edgeLines;
  const newLines = makeEdgeLines(newCap);
  const oldVerts = refs.edges.length * 2 * 3;
  newLines.geometry.attributes.position.array.set(oldLines.geometry.attributes.position.array.subarray(0, oldVerts));
  newLines.geometry.attributes.color   .array.set(oldLines.geometry.attributes.color   .array.subarray(0, oldVerts));
  newLines.geometry.attributes.position.needsUpdate = true;
  newLines.geometry.attributes.color   .needsUpdate = true;
  newLines.geometry.setDrawRange(0, refs.edges.length * 2);
  refs.scene.remove(oldLines);
  oldLines.geometry.dispose();
  oldLines.material.dispose();
  refs.scene.add(newLines);
  refs.edgeLines = newLines;
  refs.edgeCapacity = newCap;
}
