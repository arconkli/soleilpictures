import { useEffect, useRef, useState, useMemo } from 'react';
import ForceGraph3D from 'react-force-graph-3d';
import * as THREE from 'three';
import { assembleGraph } from '../lib/graphData.js';
import { HomeGraphDetailDrawer } from './HomeGraphDetailDrawer.jsx';
import { HomeEmptyState } from './HomeEmptyState.jsx';
import { HomeGraph2DFallback } from './HomeGraph2DFallback.jsx';

// All entity kinds visible by default; users navigate the graph by hovering
// + right-clicking to open. The HUD/filter chips were removed — they were
// decorative more than functional, and cluttered the surface.
const KIND_FILTER_DEFAULT = new Set(['board', 'doc', 'card', 'url']);

// Read the html element's data-theme so the canvas bg can match light/dark.
function readTheme() {
  if (typeof document === 'undefined') return 'dark';
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

const BG_FOR = { dark: '#0a0908', light: '#f5f5f7' };

// Soft radial-gradient halo, used as a sprite around each node so each
// "planet" gets a glow tinted by its own color. Built once at module
// scope and re-used for every node.
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

// 3D workspace graph home. Force-directed via react-force-graph-3d.
//   workspaceId — required
//   onNavigate(target) — open the entity in the existing board surface
export function HomeGraph({ workspaceId, onNavigate }) {
  const fgRef = useRef(null);
  const containerRef = useRef(null);
  const [data, setData] = useState({ nodes: [], links: [] });
  // Loaded turns true the first time assembleGraph resolves. Used to suppress
  // a brief empty-state flash before the data lands.
  const [loaded, setLoaded] = useState(false);
  // Structural edges (board↔child-board, board↔card) on by default so the
  // graph reveals workspace hierarchy without requiring explicit doc links.
  const structural = true;
  const kinds = KIND_FILTER_DEFAULT;
  const [selected, setSelected] = useState(null);
  const [supportsWebGL, setSupportsWebGL] = useState(true);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [theme, setTheme] = useState(readTheme);

  // Watch html[data-theme] so the canvas bg flips with the rest of the app.
  useEffect(() => {
    const obs = new MutationObserver(() => setTheme(readTheme()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);

  // WebGL probe
  useEffect(() => {
    try {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl2') || c.getContext('webgl');
      setSupportsWebGL(!!gl);
    } catch { setSupportsWebGL(false); }
  }, []);

  // Camera idle motion. We don't use OrbitControls.autoRotate because that
  // only spins around the world Y axis — the result is purely horizontal,
  // which feels flat. Instead we run our own RAF that rotates the camera
  // around a *tilted* axis so the constellation drifts diagonally, then
  // lets OrbitControls.update() apply damping on top so user input still
  // feels weighty. Pauses while a node is selected (the cameraPosition
  // ease shouldn't fight the drift) and while the user is actively
  // interacting with the orbit.
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
      // Damping gives the orbit weight + glide. Low factor = long, smooth
      // ease-out after the user releases the cursor (floats to a stop
      // instead of cutting). Combined with the lower rotate/zoom speeds,
      // the camera feels like it has mass.
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
        if (!selected && !interacting) {
          // ~0.085 rad/s around a tilted axis = leisurely diagonal drift.
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
  }, [selected, data]);

  // Track container size for the canvas
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

  // Load graph data; refresh when workspace / structural toggle changes.
  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    // Local QA workspaces don't have rows in Supabase; skip the (hanging) fetch.
    if (workspaceId === 'local-workspace') {
      setData({ nodes: [], links: [] });
      setLoaded(true);
      return () => {};
    }
    (async () => {
      let g = { nodes: [], links: [] };
      try { g = await assembleGraph({ workspaceId, options: { structural } }); }
      catch (e) { console.warn('assembleGraph failed', e); }
      if (!cancelled) { setData(g); setLoaded(true); }
    })();
    return () => { cancelled = true; };
  }, [workspaceId, structural]);

  // Kind filter is fixed (no HUD). Memoize so layout algorithms see stable refs.
  const filtered = useMemo(() => ({
    nodes: data.nodes.filter(n => kinds.has(n.kind)),
    links: data.links.filter(l => {
      const sId = typeof l.source === 'string' ? l.source : l.source.id;
      const tId = typeof l.target === 'string' ? l.target : l.target.id;
      const seen = new Set(data.nodes.filter(n => kinds.has(n.kind)).map(n => n.id));
      return seen.has(sId) && seen.has(tId);
    }),
  }), [data, kinds]);

  // Build each node as a tinted "planet": solid core sphere + an additive
  // halo sprite in the same hue. The halo gives the node a soft glow that
  // reads as planetary against the dark canvas, and because the sprite is
  // tinted by the node color, each card type ends up with its own
  // distinct atmosphere.
  const nodeThree = (node) => {
    const r = (node.val || 8) * 0.4;
    const color = node.color || '#d4a04a';
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
      const haloScale = r * 3.8;
      halo.scale.set(haloScale, haloScale, 1);
      group.add(halo);
    }
    return group;
  };

  // Show the canvas as soon as we have nodes. Empty state only after we've
  // confirmed the workspace is genuinely empty (graph load resolved + 0 nodes).
  if (loaded && filtered.nodes.length === 0) {
    return (
      <div className="home-graph-wrap" ref={containerRef}>
        <HomeEmptyState />
      </div>
    );
  }

  // Pre-load shell — same bg as the canvas so there's no flash, no HUD, no empty.
  if (!loaded) {
    return (
      <div className="home-graph-wrap" ref={containerRef}
           style={{ background: BG_FOR[theme] }} />
    );
  }

  if (!supportsWebGL) {
    return (
      <div className="home-graph-wrap" ref={containerRef}>
        <HomeGraph2DFallback data={filtered} width={size.w} height={size.h} onNodeClick={setSelected} />
      </div>
    );
  }

  return (
    <div className="home-graph-wrap" ref={containerRef}>
      <div className="grain-surface" aria-hidden="true" style={{ zIndex: 1 }} />
      <ForceGraph3D
        ref={fgRef}
        graphData={filtered}
        width={size.w}
        height={size.h}
        backgroundColor={BG_FOR[theme]}
        nodeThreeObject={nodeThree}
        nodeLabel={n => n.name}
        linkColor={l => l.kind === 'structural' ? 'rgba(91,87,78,.45)' : 'rgba(212,160,74,.55)'}
        linkOpacity={0.7}
        linkCurvature={0.18}
        // Floatier idle physics — lower velocity decay = nodes glide longer
        // before settling, and a long cooldown keeps the constellation
        // breathing instead of freezing into a static lattice.
        d3AlphaDecay={0.012}
        d3VelocityDecay={0.22}
        warmupTicks={40}
        cooldownTime={20000}
        onNodeClick={(n) => {
          setSelected(n);
          if (fgRef.current) {
            const dist = 200;
            const distRatio = 1 + dist / Math.hypot(n.x || 1, n.y || 1, n.z || 1);
            fgRef.current.cameraPosition(
              { x: (n.x || 0) * distRatio, y: (n.y || 0) * distRatio, z: (n.z || 0) * distRatio },
              n, 1200,
            );
          }
        }}
        onNodeRightClick={(n) => onNavigate?.(nodeToTarget(n))}
        enableNodeDrag
        controlType="orbit"
        showNavInfo={false}
      />
      {selected && (
        <HomeGraphDetailDrawer
          workspaceId={workspaceId}
          node={selected}
          onClose={() => setSelected(null)}
          onOpen={() => onNavigate?.(nodeToTarget(selected))}
        />
      )}
    </div>
  );
}

function nodeToTarget(n) {
  if (!n) return null;
  const [kind, ...rest] = n.id.split(':');
  if (kind === 'board') return { kind: 'board', id: rest[0] };
  if (kind === 'card') {
    const [boardId, cardId] = rest;
    return n.kind === 'doc' ? { kind: 'doc', docCardId: cardId } : { kind: 'card', boardId, cardId };
  }
  if (kind === 'url') return { kind: 'url', href: rest.join(':') };
  return null;
}
