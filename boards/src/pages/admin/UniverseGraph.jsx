// UniverseGraph — GPU-instanced 3D constellation of every node and
// every connection on the platform.
//
// Performance shape:
//   • All node bodies render via a SINGLE THREE.InstancedMesh<Sphere>
//     (one draw call for any node count).
//   • All node halos render via a SINGLE THREE.Points cloud with a
//     custom shader for per-vertex color + size (one draw call).
//   • All edges render via a SINGLE THREE.LineSegments with one
//     packed BufferGeometry (one draw call regardless of edge count).
//   • The d3-force-3d simulation runs in a Web Worker; main thread
//     never blocks on a tick. Worker posts transferable Float32Array
//     positions that we splat directly into the GPU buffers.
//
// Effective ceiling: ~200–250k nodes at 30+ fps on a typical laptop.
// Beyond that, see "Stage 3" notes in the plan (server-precomputed
// layout, viewport LOD, binary snapshot transport).
//
// Visual contract: each node looks like a HomeGraph "planet" — sphere
// + halo, same per-kind palette (board=gold, doc=cream, note=
// terracotta, image=jovian violet, palette=teal, link=neptune blue).
// NO background star field (real nodes only, per user request).
//
// Privacy: rows carry only id / kind / workspace_id / created_at.
// No titles or content. Click drawer (in AdminUniverseTab) shows
// those identity fields only.

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import SimWorker from './universeSimWorker.js?worker';
import { fetchSnapshotPage, useUniverseDeltas } from './useUniverseStream.js';

// ── Per-kind palette — copied from boards/src/lib/graphData.js. ───
const COLOR = {
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

const STRUCTURAL_COLOR = new THREE.Color('rgb(91,87,78)');
const SEMANTIC_COLOR   = new THREE.Color('rgb(255,165,0)');
const STRUCTURAL_ALPHA = 0.45;
const SEMANTIC_ALPHA   = 0.55;

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
const INITIAL_EDGE_CAP  = 2048;
// Hard ceiling so a runaway dataset can't OOM the tab. 250k is
// comfortably below where the GPU buffer rewrite per tick stops
// fitting in the frame budget.
const SOFT_NODE_LIMIT   = 250_000;

function nextPow2(n, base) { let c = base; while (c < n) c *= 2; return c; }

// Map a snapshot row → render node. `val` is the sphere radius
// proxy; same numbers HomeGraph uses (14 for boards, 12 for docs,
// 8 for everything else).
function toNode(raw) {
  const broad = raw.node_id.split(':')[0];
  let kind, cardKind = null;
  if (broad === 'board') {
    kind = 'board';
  } else {
    kind = raw.kind === 'doc' ? 'doc' : 'card';
    cardKind = raw.kind;
  }
  const colorKey = cardKind || kind;
  const colorHex = COLOR[colorKey] || COLOR[kind] || COLOR.card;
  return {
    id: raw.node_id,
    kind,
    cardKind,
    color: colorHex,
    threeColor: new THREE.Color(colorHex),
    val: kind === 'board' ? 14 : (kind === 'doc' ? 12 : 8),
    workspace_id: raw.workspace_id,
    created_at: raw.created_at,
  };
}

// ── Custom shader material for halos ──────────────────────────────
// Per-vertex `color` + `size`. Size scales with distance from camera
// like a real sprite so far-away nodes shrink naturally.
function makeHaloMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      map:      { value: HALO_TEXTURE },
      uOpacity: { value: 0.22 },
      uScale:   { value: 350 },  // tuned to match HomeGraph haloScale ~3.7x at default distance
    },
    vertexShader: /* glsl */`
      attribute float size;
      varying vec3 vColor;
      void main() {
        vColor = color;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size * (uScale / max(-mv.z, 1.0));
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

export function UniverseGraph({ onNodeClick }) {
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
    nodeMesh: null, haloPoints: null, edgeLines: null,
    nodeCapacity: INITIAL_NODE_CAP, edgeCapacity: INITIAL_EDGE_CAP,
    nodes: [],                      // [{id, threeColor, val, ...}]
    nodeIndex: new Map(),           // node_id → array index
    edges: [],                      // [{ sourceIdx, targetIdx, kind }]
    positions: new Float32Array(INITIAL_NODE_CAP * 3),
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
    lastFitAt: 0,
    fitFromPos: null, fitFromTarget: null, fitToPos: null, fitToTarget: null,
    fitStart: 0, fitDuration: 700, fitAnimating: false,
  }).current;

  // Keep onNodeClick fresh without re-mounting the whole scene.
  useEffect(() => { refs.onNodeClickFn = onNodeClick; }, [onNodeClick, refs]);

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

    const camera = new THREE.PerspectiveCamera(60, w / h, 0.1, 12000);
    camera.position.set(0, 0, 400);

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h);
    renderer.domElement.style.display = 'block';
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.rotateSpeed = 0.55;
    controls.zoomSpeed   = 0.7;
    controls.panSpeed    = 0.6;
    controls.enablePan   = true;
    controls.minDistance = 30;
    controls.maxDistance = 5000;

    // GPU buffers — allocated empty; filled when snapshot arrives.
    const nodeMesh = makeNodeMesh(INITIAL_NODE_CAP);
    nodeMesh.count = 0;
    scene.add(nodeMesh);

    const haloPoints = makeHaloPoints(INITIAL_NODE_CAP);
    haloPoints.geometry.setDrawRange(0, 0);
    scene.add(haloPoints);

    const edgeLines = makeEdgeLines(INITIAL_EDGE_CAP);
    edgeLines.geometry.setDrawRange(0, 0);
    scene.add(edgeLines);

    refs.scene = scene;
    refs.camera = camera;
    refs.renderer = renderer;
    refs.controls = controls;
    refs.nodeMesh = nodeMesh;
    refs.haloPoints = haloPoints;
    refs.edgeLines = edgeLines;
    refs.nodeCapacity = INITIAL_NODE_CAP;
    refs.edgeCapacity = INITIAL_EDGE_CAP;
    refs.nodes = [];
    refs.nodeIndex = new Map();
    refs.edges = [];
    refs.positions = new Float32Array(INITIAL_NODE_CAP * 3);
    refs.pendingNodes = [];
    refs.pendingEdges = [];

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

    // Click picking.
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
      const hits = raycaster.intersectObject(nodeMesh, false);
      if (hits.length > 0 && typeof hits[0].instanceId === 'number') {
        const node = refs.nodes[hits[0].instanceId];
        if (node && refs.onNodeClickFn) refs.onNodeClickFn(node);
      }
    };
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerup',   onPointerUp);

    // rAF loop — controls + tilted drift + fit animation + render.
    const tiltAxis = new THREE.Vector3(0.35, 1, 0.18).normalize();
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
      } else if (!refs.interacting) {
        // Idle drift — pauses during interaction AND during a fit
        // animation so the two motions don't fight.
        const rel = camera.position.clone().sub(controls.target);
        rel.applyAxisAngle(tiltAxis, 0.085 * dt);
        camera.position.copy(rel.add(controls.target));
      }
      controls.update();
      renderer.render(scene, camera);
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
      document.removeEventListener('visibilitychange', onVis);
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
      nodeMesh.geometry.dispose();
      nodeMesh.material.dispose();
      haloPoints.geometry.dispose();
      haloPoints.material.dispose();
      edgeLines.geometry.dispose();
      edgeLines.material.dispose();
      renderer.dispose();
      refs.scene = null; refs.camera = null; refs.renderer = null; refs.controls = null;
      refs.nodeMesh = null; refs.haloPoints = null; refs.edgeLines = null;
    };
    // theme is read once at mount — the bg color update below patches it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey]);

  // Patch background color when theme flips without re-mounting.
  useEffect(() => {
    if (refs.scene) refs.scene.background = new THREE.Color(BG_FOR[theme]);
  }, [theme, refs]);

  // ── Snapshot loader ──────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setError(null);
    setCalibrating(true);
    setProgress({ nodes: 0, edges: 0 });

    (async () => {
      try {
        const allRawNodes = [];
        const allRawEdges = [];
        let nodesCursor = null;
        let edgesCursor = null;
        for (let i = 0; i < 50; i++) {
          const page = await fetchSnapshotPage({
            nodesCursor, edgesCursor,
            nodeLimit: NODE_PAGE,
            edgeLimit: EDGE_PAGE,
          });
          if (cancelled) return;
          for (const n of (page.nodes || [])) {
            allRawNodes.push(n);
            if (allRawNodes.length >= SOFT_NODE_LIMIT) break;
          }
          for (const e of (page.edges || [])) allRawEdges.push(e);
          setProgress({ nodes: allRawNodes.length, edges: allRawEdges.length });
          if (allRawNodes.length >= SOFT_NODE_LIMIT) break;
          nodesCursor = page.next_nodes_cursor || page.next_cursor || nodesCursor;
          edgesCursor = page.next_edges_cursor || page.next_cursor || edgesCursor;
          if (page.done) break;
          if (!nodesCursor && !edgesCursor) break;
        }
        if (cancelled) return;

        // Build render state.
        ensureNodeCapacity(refs, allRawNodes.length);
        refs.nodes = [];
        refs.nodeIndex = new Map();
        refs.edges = [];
        for (const raw of allRawNodes) {
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
          const kind = (raw.edge_kind === 'hierarchy' || raw.edge_kind === 'structural'
                       || (raw.edge_kind || '').startsWith('doc_'))
            ? 'structural' : 'semantic';
          resolvedEdges.push({ sourceIdx: s, targetIdx: t, kind });
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
          }));
          refs.worker.postMessage({ type: 'init', nodes: initNodes, links: initLinks });
        }
      } catch (e) {
        if (!cancelled) { setError(e?.message || String(e)); setCalibrating(false); }
      }
    })();

    return () => { cancelled = true; };
  }, [reloadKey, refs]);

  // ── Delta integration ────────────────────────────────────────────
  // Buffer deltas; flush every DELTA_FLUSH_MS by sending addNodes/
  // addLinks to the worker and growing GPU buffers when we cross
  // capacity.
  useEffect(() => {
    const id = setInterval(() => {
      if (!refs.worker || !refs.nodeMesh) return;
      const newNodes = refs.pendingNodes;
      refs.pendingNodes = [];

      // Resolve pending edges; defer ones whose endpoints haven't
      // arrived yet up to ORPHAN_MAX_TRIES times before dropping.
      const stillPending = [];
      const newEdges = [];
      for (const item of refs.pendingEdges) {
        const s = refs.nodeIndex.get(item.raw.source_id);
        const t = refs.nodeIndex.get(item.raw.target_id);
        if (s != null && t != null) {
          const kind = (item.raw.edge_kind === 'hierarchy' || item.raw.edge_kind === 'structural'
                       || (item.raw.edge_kind || '').startsWith('doc_'))
            ? 'structural' : 'semantic';
          newEdges.push({ sourceIdx: s, targetIdx: t, kind });
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
          })),
        });
      }
    }, DELTA_FLUSH_MS);
    return () => clearInterval(id);
  }, [refs]);

  useUniverseDeltas({
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

function makeNodeMesh(capacity) {
  // Unit sphere — per-instance scale lives in the instance matrix.
  const geom = new THREE.SphereGeometry(1, 16, 16);
  const mat  = new THREE.MeshBasicMaterial({ vertexColors: false });
  const mesh = new THREE.InstancedMesh(geom, mat, capacity);
  mesh.frustumCulled = false;
  // Per-instance color attribute.
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
  mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  return mesh;
}

function makeHaloPoints(capacity) {
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(capacity * 3), 3));
  geom.setAttribute('color',    new THREE.BufferAttribute(new Float32Array(capacity * 3), 3));
  geom.setAttribute('size',     new THREE.BufferAttribute(new Float32Array(capacity),     1));
  geom.attributes.position.setUsage(THREE.DynamicDrawUsage);
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
  const mat = new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.7, depthWrite: false,
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

function writeNodeAppearance(refs, idx, node) {
  // Matrix — translate to (0,0,0) for now; sphere radius via scale.
  const r = (node.val || 8) * 0.4;
  _tmpScale.set(r, r, r);
  _tmpPos.set(0, 0, 0);
  _tmpMatrix.compose(_tmpPos, new THREE.Quaternion(), _tmpScale);
  refs.nodeMesh.setMatrixAt(idx, _tmpMatrix);
  refs.nodeMesh.setColorAt(idx, node.threeColor);
  refs.nodeMesh.count = Math.max(refs.nodeMesh.count, idx + 1);

  // Halo attributes — color + size (per-vertex).
  const ca = refs.haloPoints.geometry.attributes.color;
  const sa = refs.haloPoints.geometry.attributes.size;
  ca.array[idx * 3]     = node.threeColor.r;
  ca.array[idx * 3 + 1] = node.threeColor.g;
  ca.array[idx * 3 + 2] = node.threeColor.b;
  sa.array[idx]         = r * 3.7;

  refs.nodeMesh.instanceMatrix.needsUpdate = true;
  if (refs.nodeMesh.instanceColor) refs.nodeMesh.instanceColor.needsUpdate = true;
  ca.needsUpdate = true;
  sa.needsUpdate = true;
}

function writeEdgeColors(refs) {
  const ca = refs.edgeLines.geometry.attributes.color;
  for (let i = 0; i < refs.edges.length; i++) {
    const e = refs.edges[i];
    const c = e.kind === 'structural' ? STRUCTURAL_COLOR : SEMANTIC_COLOR;
    const base = i * 6;
    ca.array[base]     = c.r; ca.array[base + 1] = c.g; ca.array[base + 2] = c.b;
    ca.array[base + 3] = c.r; ca.array[base + 4] = c.g; ca.array[base + 5] = c.b;
  }
  ca.needsUpdate = true;
}

// Splat positions[] (Float32Array of (x,y,z) per node) into both the
// node instance matrices and the halo position attribute. Then rebuild
// the edge vertex buffer from the new positions.
function uploadPositions(refs, count) {
  const pos = refs.positions;
  const haloPos = refs.haloPoints.geometry.attributes.position;
  const quat = new THREE.Quaternion();
  for (let i = 0; i < count; i++) {
    const node = refs.nodes[i];
    if (!node) continue;
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    const r = (node.val || 8) * 0.4;
    _tmpPos.set(x, y, z);
    _tmpScale.set(r, r, r);
    _tmpMatrix.compose(_tmpPos, quat, _tmpScale);
    refs.nodeMesh.setMatrixAt(i, _tmpMatrix);
    haloPos.array[i * 3]     = x;
    haloPos.array[i * 3 + 1] = y;
    haloPos.array[i * 3 + 2] = z;
  }
  refs.nodeMesh.instanceMatrix.needsUpdate = true;
  haloPos.needsUpdate = true;
  refs.nodeMesh.count = Math.min(refs.nodeCapacity, refs.nodes.length);
  refs.haloPoints.geometry.setDrawRange(0, Math.min(refs.nodeCapacity, refs.nodes.length));

  // Edges — rebuild endpoints from the new positions.
  const ep = refs.edgeLines.geometry.attributes.position;
  for (let i = 0; i < refs.edges.length; i++) {
    const e = refs.edges[i];
    const a = e.sourceIdx, b = e.targetIdx;
    const base = i * 6;
    ep.array[base]     = pos[a * 3];
    ep.array[base + 1] = pos[a * 3 + 1];
    ep.array[base + 2] = pos[a * 3 + 2];
    ep.array[base + 3] = pos[b * 3];
    ep.array[base + 4] = pos[b * 3 + 1];
    ep.array[base + 5] = pos[b * 3 + 2];
  }
  ep.needsUpdate = true;
  refs.edgeLines.geometry.setDrawRange(0, refs.edges.length * 2);

  // Pull the camera back so the whole universe stays in view as more
  // nodes arrive. Cheap to check; the heavy work only fires when the
  // bounding sphere has actually grown past the current frustum.
  maybeAutoFit(refs, count);
}

// Compute the bounding sphere of the current node positions (single
// pass for the center, second pass for the max radius). O(N).
function computeBoundingSphere(refs, count) {
  if (count === 0) return null;
  const pos = refs.positions;
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < count; i++) {
    cx += pos[i * 3]; cy += pos[i * 3 + 1]; cz += pos[i * 3 + 2];
  }
  cx /= count; cy /= count; cz /= count;
  let maxD2 = 0;
  for (let i = 0; i < count; i++) {
    const dx = pos[i * 3]     - cx;
    const dy = pos[i * 3 + 1] - cy;
    const dz = pos[i * 3 + 2] - cz;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > maxD2) maxD2 = d2;
  }
  return { cx, cy, cz, radius: Math.sqrt(maxD2) };
}

// Distance the camera needs to be from `center` to fit a sphere of
// `radius` in view, considering both the vertical and horizontal FoV.
function fitDistance(radius, camera, padding = 1.30) {
  const vFov = (camera.fov * Math.PI) / 180;
  const distV = radius / Math.tan(vFov / 2);
  const distH = radius / (Math.tan(vFov / 2) * camera.aspect);
  return Math.max(distV, distH, 50) * padding;
}

// Decide whether to refit the camera and, if so, kick off the
// interpolation. Rules:
//   • First call (didInitialFit=false): snap to fit, no animation.
//     This is the moment after the worker's first stable tick.
//   • Subsequent calls: only refit if the universe has grown enough
//     that the camera's current distance is now < ~90% of what we'd
//     need to see everything. Don't refit while the user is actively
//     orbiting (don't fight their input). Don't refit more than once
//     every 700ms (avoid jitter while the layout is settling).
function maybeAutoFit(refs, count) {
  if (!refs.camera || !refs.controls || count === 0) return;
  const now = performance.now();

  const bs = computeBoundingSphere(refs, count);
  if (!bs || !isFinite(bs.radius)) return;
  const targetCenter = new THREE.Vector3(bs.cx, bs.cy, bs.cz);
  const needed = fitDistance(bs.radius, refs.camera);

  if (!refs.didInitialFit) {
    // First fit — snap. Preserve the camera's existing direction so
    // we don't override OrbitControls' initial pose orientation.
    const dir = refs.camera.position.clone().sub(refs.controls.target).normalize();
    if (dir.lengthSq() === 0) dir.set(0, 0, 1);
    refs.camera.position.copy(targetCenter).add(dir.multiplyScalar(needed));
    refs.controls.target.copy(targetCenter);
    refs.didInitialFit = true;
    refs.lastFitAt = now;
    return;
  }
  if (refs.interacting) return;
  if (refs.fitAnimating) return;
  if (now - refs.lastFitAt < 700) return;

  const currentDist = refs.camera.position.distanceTo(refs.controls.target);
  // Re-fit if visible universe extends beyond the current view, or if
  // the centroid drifted far from where we last looked.
  const centerDrift = refs.controls.target.distanceTo(targetCenter);
  const needsExpand = currentDist < needed * 0.90;
  const needsRecenter = centerDrift > bs.radius * 0.25;
  if (!needsExpand && !needsRecenter) return;

  // Set up animation. Preserve the camera's direction relative to the
  // target so the orbit pose stays put — we just zoom out and slide
  // the look-at point to the new center.
  const dir = refs.camera.position.clone().sub(refs.controls.target).normalize();
  if (dir.lengthSq() === 0) dir.set(0, 0, 1);
  refs.fitFromPos    = refs.camera.position.clone();
  refs.fitFromTarget = refs.controls.target.clone();
  refs.fitToPos      = targetCenter.clone().add(dir.multiplyScalar(Math.max(needed, currentDist)));
  refs.fitToTarget   = targetCenter.clone();
  refs.fitStart      = now;
  refs.fitAnimating  = true;
  refs.lastFitAt     = now;
}

function ensureNodeCapacity(refs, needed) {
  if (needed <= refs.nodeCapacity) return;
  const newCap = nextPow2(needed, refs.nodeCapacity);
  const oldMesh  = refs.nodeMesh;
  const oldHalos = refs.haloPoints;
  const newMesh  = makeNodeMesh(newCap);
  const newHalos = makeHaloPoints(newCap);

  // Copy existing data.
  const oldCount = Math.min(oldMesh.count, refs.nodes.length);
  for (let i = 0; i < oldCount; i++) {
    oldMesh.getMatrixAt(i, _tmpMatrix);
    newMesh.setMatrixAt(i, _tmpMatrix);
    if (oldMesh.instanceColor) {
      const r = oldMesh.instanceColor.array[i * 3];
      const g = oldMesh.instanceColor.array[i * 3 + 1];
      const b = oldMesh.instanceColor.array[i * 3 + 2];
      newMesh.instanceColor.array[i * 3]     = r;
      newMesh.instanceColor.array[i * 3 + 1] = g;
      newMesh.instanceColor.array[i * 3 + 2] = b;
    }
  }
  newMesh.count = oldCount;
  newMesh.instanceMatrix.needsUpdate = true;
  if (newMesh.instanceColor) newMesh.instanceColor.needsUpdate = true;

  // Halo: copy positions/colors/sizes.
  const op = oldHalos.geometry.attributes;
  const np = newHalos.geometry.attributes;
  np.position.array.set(op.position.array.subarray(0, oldCount * 3));
  np.color.array   .set(op.color.array   .subarray(0, oldCount * 3));
  np.size.array    .set(op.size.array    .subarray(0, oldCount));
  np.position.needsUpdate = true;
  np.color.needsUpdate    = true;
  np.size.needsUpdate     = true;
  newHalos.geometry.setDrawRange(0, oldCount);

  // Positions ring.
  const newPositions = new Float32Array(newCap * 3);
  newPositions.set(refs.positions.subarray(0, oldCount * 3));
  refs.positions = newPositions;

  // Swap in, dispose old.
  refs.scene.remove(oldMesh);
  refs.scene.remove(oldHalos);
  oldMesh.geometry.dispose();   oldMesh.material.dispose();
  oldHalos.geometry.dispose();  oldHalos.material.dispose();
  refs.scene.add(newMesh);
  refs.scene.add(newHalos);
  refs.nodeMesh   = newMesh;
  refs.haloPoints = newHalos;
  refs.nodeCapacity = newCap;
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
