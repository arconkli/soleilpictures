// UniverseGraph — 3D constellation of every node every user has
// created across the platform. Visually identical to the per-workspace
// HomeGraph (boards/src/components/HomeGraph.jsx): same react-force-
// graph-3d + Three.js setup, same per-kind colors (Soleil-gold suns
// for boards, terracotta notes, jovian violet images, teal palettes,
// neptune-blue links, pale-cream doc moons), same sphere+halo
// "planet" geometry, same starfield, same tilted camera drift.
//
// Differences from HomeGraph:
//   • Data is platform-wide (snapshot RPC + delta SSE), not one
//     workspace via assembleGraph.
//   • Anonymous — no titles or content. Click drawer shows only
//     ID / kind / workspace / created_at.
//   • Nodes never have names, so hover tooltips read as kind labels.

import { useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph3D from 'react-force-graph-3d';
import * as THREE from 'three';
import { fetchSnapshotPage, useUniverseDeltas } from './useUniverseStream.js';

// ── Per-kind palette — copied verbatim from boards/src/lib/graphData.js
//    so the universe and the per-workspace home read as the same scene.
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

function readTheme() {
  if (typeof document === 'undefined') return 'dark';
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}
const BG_FOR = { dark: '#0a0908', light: '#f5f5f7' };

// Shared additive halo texture — identical to HomeGraph's.
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

const NODE_PAGE = 50000;
const EDGE_PAGE = 100000;
const FLUSH_INTERVAL_MS = 250;
const MAX_ORPHAN_ATTEMPTS = 6;
// react-force-graph + Three.js gets unhappy past ~12k nodes. The
// admin platform is currently well under this; if we ever cross it
// we'll either sample to viewport or swap the renderer.
const SOFT_NODE_LIMIT = 12000;

// Map our snapshot row into the shape HomeGraph nodes carry, with
// privacy: name is empty (anonymous), color is by kind.
function toNode(raw) {
  const [broad] = raw.node_id.split(':');
  let kind;
  let cardKind = null;
  if (broad === 'board') {
    kind = 'board';
  } else {
    // raw.kind is the card_index.kind: 'doc', 'note', 'image', etc.
    kind = raw.kind === 'doc' ? 'doc' : 'card';
    cardKind = raw.kind;
  }
  const colorKey = cardKind || kind;
  return {
    id: raw.node_id,
    kind,
    cardKind,
    name: '',
    color: COLOR[colorKey] || COLOR[kind] || COLOR.card,
    val: kind === 'board' ? 14 : (kind === 'doc' ? 12 : 8),
    workspace_id: raw.workspace_id,
    created_at: raw.created_at,
  };
}

function toLink(raw) {
  return {
    source: raw.source_id,
    target: raw.target_id,
    // edges from boards.parent_board_id arrive with edge_kind='hierarchy';
    // doc_backlinks come through as 'doc_<targetkind>'; entity_links use
    // their target_kind directly. Render hierarchy + doc_* edges as
    // structural (gray); everything else as semantic (gold).
    kind: (raw.edge_kind === 'hierarchy' || (raw.edge_kind || '').startsWith('doc_'))
      ? 'structural' : 'semantic',
  };
}

export function UniverseGraph({ onNodeClick }) {
  const fgRef        = useRef(null);
  const containerRef = useRef(null);
  const [data, setData]       = useState({ nodes: [], links: [] });
  const [loaded, setLoaded]   = useState(false);
  const [graphReady, setGraphReady] = useState(false);
  const [error, setError]     = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [progress, setProgress] = useState({ nodes: 0, edges: 0 });
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [theme, setTheme] = useState(readTheme);

  // node_id → node row, for dedupe and the click handler payload.
  const nodeMap = useRef(new Map());

  // ── Theme watcher (mirror HomeGraph) ──────────────────────────────
  useEffect(() => {
    const obs = new MutationObserver(() => setTheme(readTheme()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);

  // ── Container size ────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;
    const measure = () => {
      const r = containerRef.current.getBoundingClientRect();
      setSize({ w: Math.max(200, Math.floor(r.width)), h: Math.max(200, Math.floor(r.height)) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(containerRef.current);
    window.addEventListener('resize', measure);
    return () => { ro.disconnect(); window.removeEventListener('resize', measure); };
  }, []);

  // ── Star field (verbatim from HomeGraph) ──────────────────────────
  useEffect(() => {
    if (!fgRef.current) return;
    let raf = null;
    let added = null;
    const tryAttach = () => {
      const scene = fgRef.current?.scene?.();
      if (!scene) { raf = requestAnimationFrame(tryAttach); return; }
      const group = new THREE.Group();
      const N = 1800;
      const positions = new Float32Array(N * 3);
      const colors = new Float32Array(N * 3);
      for (let i = 0; i < N; i++) {
        const R = 3500 + Math.random() * 2500;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        positions[i * 3]     = R * Math.sin(phi) * Math.cos(theta);
        positions[i * 3 + 1] = R * Math.cos(phi);
        positions[i * 3 + 2] = R * Math.sin(phi) * Math.sin(theta);
        const warm = Math.random() < 0.2;
        colors[i * 3]     = 1.0;
        colors[i * 3 + 1] = warm ? 0.92 : 1.0;
        colors[i * 3 + 2] = warm ? 0.78 : 1.0;
      }
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      const mat = new THREE.PointsMaterial({
        size: 1.3, vertexColors: true, transparent: true, opacity: 0.25,
        depthWrite: false, sizeAttenuation: false, blending: THREE.AdditiveBlending,
      });
      const stars = new THREE.Points(geom, mat);
      group.add(stars);

      const REMOTE_HUES = [0xc4a96b, 0x7c5cc9, 0x3fa39a, 0xcf6a4f, 0x5b8fc7, 0xe6c98a];
      for (let k = 0; k < 9; k++) {
        const cR = 4200 + Math.random() * 2200;
        const cTheta = Math.random() * Math.PI * 2;
        const cPhi = Math.acos(2 * Math.random() - 1);
        const cx = cR * Math.sin(cPhi) * Math.cos(cTheta);
        const cy = cR * Math.cos(cPhi);
        const cz = cR * Math.sin(cPhi) * Math.sin(cTheta);
        const hue = REMOTE_HUES[k % REMOTE_HUES.length];
        const M = 6 + Math.floor(Math.random() * 9);
        const cPos = new Float32Array(M * 3);
        for (let i = 0; i < M; i++) {
          const jitter = 80;
          cPos[i * 3]     = cx + (Math.random() * 2 - 1) * jitter;
          cPos[i * 3 + 1] = cy + (Math.random() * 2 - 1) * jitter;
          cPos[i * 3 + 2] = cz + (Math.random() * 2 - 1) * jitter;
        }
        const cGeom = new THREE.BufferGeometry();
        cGeom.setAttribute('position', new THREE.BufferAttribute(cPos, 3));
        const cMat = new THREE.PointsMaterial({
          size: 1.9, color: hue, transparent: true, opacity: 0.20,
          depthWrite: false, sizeAttenuation: false, blending: THREE.AdditiveBlending,
        });
        group.add(new THREE.Points(cGeom, cMat));
      }
      scene.add(group);
      added = { group, dispose() {
        scene.remove(group);
        group.traverse(o => {
          if (o.geometry) o.geometry.dispose();
          if (o.material) o.material.dispose();
        });
      }};
    };
    tryAttach();
    return () => {
      if (raf) cancelAnimationFrame(raf);
      added?.dispose();
    };
  }, [data]);

  // ── Tilted-axis camera drift (verbatim from HomeGraph) ────────────
  useEffect(() => {
    if (!fgRef.current) return;
    let raf;
    let interacting = false;
    let lastT = performance.now();
    let detachInteract = null;
    const tiltAxis = new THREE.Vector3(0.35, 1, 0.18).normalize();
    const tryAttach = () => {
      const controls = fgRef.current?.controls?.();
      const camera = fgRef.current?.camera?.();
      if (!controls || !camera) { raf = requestAnimationFrame(tryAttach); return; }
      controls.autoRotate = false;
      controls.enableDamping = true;
      controls.dampingFactor = 0.06;
      controls.rotateSpeed = 0.55;
      controls.zoomSpeed = 0.7;
      controls.panSpeed = 0.6;
      const onStart = () => { interacting = true; };
      const onEnd = () => { interacting = false; };
      controls.addEventListener?.('start', onStart);
      controls.addEventListener?.('end', onEnd);
      detachInteract = () => {
        controls.removeEventListener?.('start', onStart);
        controls.removeEventListener?.('end', onEnd);
      };
      const tick = () => {
        const now = performance.now();
        const dt = Math.min(0.05, (now - lastT) / 1000);
        lastT = now;
        if (!interacting) {
          const rel = camera.position.clone().sub(controls.target);
          rel.applyAxisAngle(tiltAxis, 0.085 * dt);
          camera.position.copy(rel.add(controls.target));
        }
        controls.update();
        raf = requestAnimationFrame(tick);
      };
      lastT = performance.now();
      raf = requestAnimationFrame(tick);
    };
    tryAttach();
    return () => {
      if (raf) cancelAnimationFrame(raf);
      detachInteract?.();
    };
  }, [data]);

  // ── Snapshot loader ───────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setError(null);
    setLoaded(false);
    setGraphReady(false);
    setProgress({ nodes: 0, edges: 0 });
    setData({ nodes: [], links: [] });
    nodeMap.current = new Map();
    pendingNodes.current = [];
    pendingEdges.current = [];

    (async () => {
      try {
        const allNodes = [];
        const rawEdges = [];
        let cursor = null;
        for (let i = 0; i < 50; i++) {
          const page = await fetchSnapshotPage({ cursor, nodeLimit: NODE_PAGE, edgeLimit: EDGE_PAGE });
          if (cancelled) return;
          for (const n of page.nodes || []) {
            if (nodeMap.current.has(n.node_id)) continue;
            const decorated = toNode(n);
            nodeMap.current.set(decorated.id, decorated);
            allNodes.push(decorated);
            if (allNodes.length >= SOFT_NODE_LIMIT) break;
          }
          for (const e of page.edges || []) rawEdges.push(e);
          setProgress({ nodes: allNodes.length, edges: rawEdges.length });
          if (allNodes.length >= SOFT_NODE_LIMIT) break;
          cursor = page.next_cursor;
          if (page.done || !cursor) break;
        }
        if (cancelled) return;

        // Resolve edges against the node set; drop orphans.
        const links = [];
        for (const e of rawEdges) {
          if (!nodeMap.current.has(e.source_id) || !nodeMap.current.has(e.target_id)) continue;
          links.push(toLink(e));
        }

        setData({ nodes: allNodes, links });
        setLoaded(true);
      } catch (e) {
        if (!cancelled) { setError(e?.message || String(e)); setLoaded(true); }
      }
    })();
    return () => { cancelled = true; };
  }, [reloadKey]);

  // ── Reveal after the simulation has settled ──────────────────────
  useEffect(() => {
    if (!loaded) return;
    if (data.nodes.length === 0) { setGraphReady(true); return; }
    const t = setTimeout(() => setGraphReady(true), 650);
    return () => clearTimeout(t);
  }, [loaded, data]);

  // ── Delta buffer ──────────────────────────────────────────────────
  // New nodes/edges accumulate here and get applied to the graph as
  // a single state update every FLUSH_INTERVAL_MS. We keep orphan
  // edges around for a few flush ticks in case their endpoint
  // arrives via a subsequent delta.
  const pendingNodes = useRef([]);
  const pendingEdges = useRef([]); // [{ raw, attempts }]

  useEffect(() => {
    if (!loaded) return;
    const id = setInterval(() => {
      const nodes = pendingNodes.current;
      pendingNodes.current = [];

      const stillPending = [];
      const readyLinks = [];
      for (const item of pendingEdges.current) {
        if (nodeMap.current.has(item.raw.source_id) && nodeMap.current.has(item.raw.target_id)) {
          readyLinks.push(toLink(item.raw));
        } else if (item.attempts + 1 < MAX_ORPHAN_ATTEMPTS) {
          stillPending.push({ raw: item.raw, attempts: item.attempts + 1 });
        }
      }
      pendingEdges.current = stillPending;

      if (!nodes.length && !readyLinks.length) return;
      setData(prev => ({
        nodes: nodes.length ? prev.nodes.concat(nodes) : prev.nodes,
        links: readyLinks.length ? prev.links.concat(readyLinks) : prev.links,
      }));
    }, FLUSH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [loaded]);

  useUniverseDeltas({
    onNode: (n) => {
      if (nodeMap.current.has(n.node_id)) return;
      const decorated = toNode(n);
      nodeMap.current.set(decorated.id, decorated);
      pendingNodes.current.push(decorated);
    },
    onEdge: (e) => {
      pendingEdges.current.push({ raw: e, attempts: 0 });
    },
    onBatch: ({ nodes, edges }) => {
      for (const n of nodes) {
        if (nodeMap.current.has(n.node_id)) continue;
        const decorated = toNode(n);
        nodeMap.current.set(decorated.id, decorated);
        pendingNodes.current.push(decorated);
      }
      for (const e of edges) pendingEdges.current.push({ raw: e, attempts: 0 });
    },
  });

  // ── Sphere + halo node renderer (verbatim from HomeGraph) ─────────
  const nodeThree = useMemo(() => (node) => {
    const r = (node.val || 8) * 0.4;
    const color = node.color || '#ffa500';
    const group = new THREE.Group();
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(r, 20, 20),
      new THREE.MeshBasicMaterial({ color }),
    );
    group.add(core);
    if (HALO_TEXTURE) {
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({
        map: HALO_TEXTURE,
        color,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }));
      const haloScale = r * 3.7;
      halo.scale.set(haloScale, haloScale, 1);
      group.add(halo);
    }
    return group;
  }, []);

  // ── Error state with retry button ─────────────────────────────────
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
      <div className="grain-surface" aria-hidden="true" style={{ zIndex: 1 }} />
      <div className={`home-graph-stage ${graphReady ? 'is-ready' : ''}`} style={{ width: '100%', height: '100%' }}>
        <ForceGraph3D
          ref={fgRef}
          graphData={data}
          width={size.w}
          height={size.h}
          backgroundColor={BG_FOR[theme]}
          nodeThreeObject={nodeThree}
          nodeLabel={(n) => kindLabel(n)}
          linkColor={l => l.kind === 'structural' ? 'rgba(91,87,78,.45)' : 'rgba(255,165,0,.55)'}
          linkOpacity={0.7}
          linkCurvature={0.18}
          d3AlphaDecay={0.04}
          d3VelocityDecay={0.32}
          warmupTicks={200}
          cooldownTime={4000}
          onNodeClick={(n) => {
            if (!n) return;
            onNodeClick?.(n);
            if (fgRef.current) {
              const dist = 220;
              const distRatio = 1 + dist / Math.hypot(n.x || 1, n.y || 1, n.z || 1);
              fgRef.current.cameraPosition(
                { x: (n.x || 0) * distRatio, y: (n.y || 0) * distRatio, z: (n.z || 0) * distRatio },
                n, 1200,
              );
            }
          }}
          enableNodeDrag={false}
          controlType="orbit"
          showNavInfo={false}
        />
      </div>
      {!loaded && (
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

const KIND_LABEL = {
  board: 'Board',
  doc:   'Doc',
  note:  'Note',
  image: 'Image',
  palette: 'Palette',
  link:  'Link',
  card:  'Card',
};
function kindLabel(n) {
  const k = n?.cardKind || n?.kind;
  return KIND_LABEL[k] || (k ? k.charAt(0).toUpperCase() + k.slice(1) : 'Node');
}
