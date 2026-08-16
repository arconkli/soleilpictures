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
const COLOR = {
  user:      '#fff4d8',
  ws:        '#8b8aa8',
  board:     '#ffa500',
  doc:       '#f1d9a3',
  note:      '#cf6a4f',
  image:     '#7c5cc9',
  palette:   '#3fa39a',
  link:      '#5b8fc7',
  board_:    '#c4a96b',
  boardlink: '#c4a96b',
  doc_card:  '#e6c98a',
  card:      '#7c8a98',
  url:       '#8c7a55',
};

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

function readTheme() {
  if (typeof document === 'undefined') return 'dark';
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}
const BG_FOR = { dark: '#0a0908', light: '#f5f5f7' };

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
const FX_CAPACITY       = 512;     // max concurrent pulses + flashes
const PULSE_DURATION_MS = 1500;
const FLASH_DURATION_MS = 1200;
const PULSE_COLOR       = new THREE.Color('#ffd06b');  // bright Soleil gold

function nextPow2(n, base) { let c = base; while (c < n) c *= 2; return c; }

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
    threeColor: new THREE.Color(colorHex),
    val,
    isAnchor: kind === 'ws' || kind === 'board',
    workspace_id: raw.workspace_id,
    created_at: raw.created_at,
  };
}

// ── Disc material — the leaf-node body ────────────────────────────
// One vertex per card. `size` is the world-space DIAMETER;
// uPxPerUnit converts world size at depth −mv.z into device pixels,
// so a disc is pixel-identical to a flat-shaded sphere of the same
// radius. Floor keeps far cards visible as single-pixel stars; the
// 512 cap respects common MAX_POINT_SIZE limits (cards are the
// smallest bodies — only anchors are ever viewed closer than that,
// and those are true spheres).
function makeBodyMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uPxPerUnit: { value: 600 },   // set for real on mount + resize
    },
    vertexShader: /* glsl */`
      uniform float uPxPerUnit;
      attribute float size;
      varying vec3 vColor;
      void main() {
        vColor = color;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float px = size * (uPxPerUnit / max(-mv.z, 1.0));
        gl_PointSize = size > 0.0 ? clamp(px, 1.25, 512.0) : 0.0;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */`
      varying vec3 vColor;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        if (dot(c, c) > 0.25) discard;
        gl_FragColor = vec4(vColor, 1.0);
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
    },
    vertexShader: /* glsl */`
      uniform float uScale;
      attribute float size;
      varying vec3 vColor;
      void main() {
        vColor = color;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
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
      varying vec3 vColor;
      void main() {
        vec4 tex = texture2D(map, gl_PointCoord);
        gl_FragColor = vec4(vColor, tex.a * uOpacity);
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
        gl_PointSize = min(size * (uScale / max(-mv.z, 1.0)), 220.0);
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
export function UniverseGraph({ onNodeClick, resetSignal, fitAll = false, dataSource = null }) {
  const containerRef = useRef(null);

  // ── React state for shell UI only ────────────────────────────────
  const [error, setError]         = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [progress, setProgress]   = useState({ nodes: 0, edges: 0 });
  const [calibrating, setCalibrating] = useState(true);
  const [theme, setTheme]         = useState(readTheme);

  // ── Theme watcher ────────────────────────────────────────────────
  useEffect(() => {
    const obs = new MutationObserver(() => setTheme(readTheme()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);

  // ── Refs to all the Three.js + sim state (kept out of React) ─────
  const refs = useRef({
    scene: null, camera: null, renderer: null, controls: null,
    composer: null, bloomPass: null,
    anchorMesh: null, bodyPoints: null, haloPoints: null, edgeLines: null, fxPoints: null,
    sharedPosAttr: null,            // ONE position buffer feeding body + halo clouds
    activeFx: [],                   // [{ kind:'pulse'|'flash', src, tgt, nodeIdx, start, dur, color }]
    baseScale: new Float32Array(INITIAL_NODE_CAP),   // per-node radius (0 = invisible user)
    anchorSlot: new Int32Array(INITIAL_NODE_CAP),    // global idx → sphere slot (-1 = not an anchor)
    anchorGlobals: [],              // sphere slot → global idx
    nodeCapacity: INITIAL_NODE_CAP, anchorCapacity: INITIAL_ANCHOR_CAP, edgeCapacity: INITIAL_EDGE_CAP,
    nodes: [],                      // [{id, threeColor, val, isAnchor, ...}]
    nodeIndex: new Map(),           // node_id → array index
    edges: [],                      // [{ sourceIdx, targetIdx, kind }]
    positions: new Float32Array(INITIAL_NODE_CAP * 3),
    pxPerUnit: 600,                 // devicePx per world-unit at distance 1 (resize-updated)
    snapshotReady: false,           // gates delta flushes until the worker has init state
    worker: null,
    rafId: null,
    onClick: null,
    pendingNodes: [],               // delta buffer
    pendingEdges: [],               // [{ raw, attempts }]
    onNodeClickFn: onNodeClick,
    // Auto-fit state. didInitialFit gates the first snap-to-fit.
    // fitAnimating drives a smooth pull-back when the universe grows.
    interacting: false,
    didInitialFit: false,
    fitAll: false,                  // when true, auto-fit frames EVERY visible node (100th pct)
    lastFitAt: 0,
    fitFromPos: null, fitFromTarget: null, fitToPos: null, fitToTarget: null,
    fitStart: 0, fitDuration: 700, fitAnimating: false,
  }).current;

  // Keep onNodeClick fresh without re-mounting the whole scene.
  useEffect(() => { refs.onNodeClickFn = onNodeClick; }, [onNodeClick, refs]);

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
    scene.background = new THREE.Color(BG_FOR[theme]);

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
      // Update live FX (pulses + spawn flashes) — cheap walk over
      // activeFx, splat into the fxPoints buffer, drop expired.
      updateFx(refs, now);
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
    // theme is read once at mount — the bg color update below patches it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey]);

  // Patch background color when theme flips without re-mounting.
  useEffect(() => {
    if (refs.scene) refs.scene.background = new THREE.Color(BG_FOR[theme]);
  }, [theme, refs]);

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
        refs.anchorGlobals = [];
        refs.anchorSlot.fill(-1);
        if (refs.anchorMesh) refs.anchorMesh.count = 0;
        refs.activeFx = [];
        for (const raw of allRawNodes) {
          if (refs.nodeIndex.has(raw.node_id)) continue;
          const node = toNode(raw);
          const idx = refs.nodes.length;
          refs.nodes.push(node);
          refs.nodeIndex.set(node.id, idx);
          writeNodeAppearance(refs, idx, node);
        }
        // Resolve edges; drop orphans.
        const resolvedEdges = [];
        for (const raw of allRawEdges) {
          const s = refs.nodeIndex.get(raw.source_id);
          const t = refs.nodeIndex.get(raw.target_id);
          if (s == null || t == null) continue;
          resolvedEdges.push({
            sourceIdx: s, targetIdx: t,
            kind:    classifyEdge(raw.edge_kind),   // visual tier (scaffold/structural/semantic)
            rawKind: raw.edge_kind,                  // raw kind (worker link classification)
          });
        }
        ensureEdgeCapacity(refs, resolvedEdges.length);
        refs.edges = resolvedEdges;
        writeEdgeColors(refs);

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
      const stillPending = [];
      const newEdges = [];
      for (const item of refs.pendingEdges) {
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
          writeNodeAppearance(refs, idx, n);
          // Spawn a brief halo flash on every new node so the user
          // can see it appear in the universe.
          spawnFlash(refs, idx, n.threeColor);
        }
        refs.worker.postMessage({
          type: 'addNodes',
          nodes: newNodes.map(n => ({ id: n.id, val: n.val })),
        });
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
    }, DELTA_FLUSH_MS);
    return () => clearInterval(id);
  }, [refs]);

  useUniverseDeltas({
    enabled: !dataSource?.disableDeltas,
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
    <div className="universe-canvas" ref={containerRef} style={{ background: BG_FOR[theme] }}>
      <div className="grain-surface" aria-hidden="true" style={{ zIndex: 1, pointerEvents: 'none' }} />
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

function writeNodeAppearance(refs, idx, node) {
  // User nodes are PHYSICS-ONLY — they exist in the simulation so
  // workspaces with shared people lean toward each other, but they
  // render nothing (no body, no halo). Radius 0 zeroes both sprites.
  const r = node.kind === 'user' ? 0 : (node.val || 8) * 0.4;
  refs.baseScale[idx] = r;

  // Halo attributes — color + size (per-vertex), all nodes.
  const hc = refs.haloPoints.geometry.attributes.color;
  const hs = refs.haloPoints.geometry.attributes.size;
  hc.array[idx * 3]     = node.threeColor.r;
  hc.array[idx * 3 + 1] = node.threeColor.g;
  hc.array[idx * 3 + 2] = node.threeColor.b;
  hs.array[idx]         = r * 3.7;
  hc.needsUpdate = true;
  hs.needsUpdate = true;

  const bc = refs.bodyPoints.geometry.attributes.color;
  const bs = refs.bodyPoints.geometry.attributes.size;
  if (node.isAnchor) {
    // Sphere slot; body disc disabled for this index.
    ensureAnchorCapacity(refs, refs.anchorGlobals.length + 1);
    const slot = refs.anchorGlobals.length;
    refs.anchorGlobals.push(idx);
    refs.anchorSlot[idx] = slot;
    _tmpScale.set(r, r, r);
    _tmpPos.set(0, 0, 0);
    _tmpMatrix.compose(_tmpPos, _tmpQuat, _tmpScale);
    refs.anchorMesh.setMatrixAt(slot, _tmpMatrix);
    refs.anchorMesh.setColorAt(slot, node.threeColor);
    refs.anchorMesh.count = refs.anchorGlobals.length;
    refs.anchorMesh.instanceMatrix.needsUpdate = true;
    if (refs.anchorMesh.instanceColor) refs.anchorMesh.instanceColor.needsUpdate = true;
    bs.array[idx] = 0;
  } else {
    refs.anchorSlot[idx] = -1;
    bc.array[idx * 3]     = node.threeColor.r;
    bc.array[idx * 3 + 1] = node.threeColor.g;
    bc.array[idx * 3 + 2] = node.threeColor.b;
    bs.array[idx]         = r * 2;      // shader takes world DIAMETER
  }
  bc.needsUpdate = true;
  bs.needsUpdate = true;
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
    const base = i * 6;
    if (c) {
      ca.array[base]     = c.r; ca.array[base + 1] = c.g; ca.array[base + 2] = c.b;
      ca.array[base + 3] = c.r; ca.array[base + 4] = c.g; ca.array[base + 5] = c.b;
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
    const r = base[i];
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
    if (!node || node.kind === 'user') continue;
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
  const targetCenter = new THREE.Vector3(bs.cx, bs.cy, bs.cz);
  const needed = fitDistance(bs.radius, refs.camera);
  const dir = refs.camera.position.clone().sub(refs.controls.target).normalize();
  if (dir.lengthSq() === 0) dir.set(0, 1, 0);
  refs.fitFromPos    = refs.camera.position.clone();
  refs.fitFromTarget = refs.controls.target.clone();
  refs.fitToPos      = targetCenter.clone().add(dir.multiplyScalar(needed));
  refs.fitToTarget   = targetCenter.clone();
  refs.fitStart      = performance.now();
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

function pushFx(refs, entry) {
  // Bounded buffer — drop oldest if we'd exceed FX_CAPACITY.
  if (refs.activeFx.length >= FX_CAPACITY) refs.activeFx.shift();
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
