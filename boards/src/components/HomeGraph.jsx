import { useEffect, useRef, useState, useMemo } from 'react';
import ForceGraph3D from 'react-force-graph-3d';
import * as THREE from 'three';
import { assembleGraph } from '../lib/graphData.js';
import { HomeGraphDetailDrawer } from './HomeGraphDetailDrawer.jsx';
import { HomeEmptyState } from './HomeEmptyState.jsx';
import { HomeGraph2DFallback } from './HomeGraph2DFallback.jsx';
import { prefetchEntity } from '../lib/prefetchKinds.js';
import { orbitJitter, targetId } from '../lib/hashJitter.js';

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
  // Hide the constellation until the force simulation has had time to
  // settle — otherwise the first ~600ms shows nodes bouncing into
  // place, which read as "broken" against the rest of the app's snappy
  // feel. Combined with the bumped d3AlphaDecay/warmupTicks below,
  // the user sees a clean reveal of the already-stable layout.
  const [graphReady, setGraphReady] = useState(false);

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

  // Distant star field — represents "other people's solar systems of
  // data viz" floating in the background. Built as one Points cloud
  // for the bulk uniform sprinkle plus a few faint warm-tinted
  // clusters so the eye reads them as remote constellations rather
  // than uniform white noise.
  useEffect(() => {
    if (!fgRef.current) return;
    let raf = null;
    let added = null;
    const tryAttach = () => {
      const scene = fgRef.current?.scene?.();
      if (!scene) { raf = requestAnimationFrame(tryAttach); return; }
      const group = new THREE.Group();
      // (1) Bulk distant stars — uniform on a thick sphere shell.
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
        // 80% pure white, 20% warm cream — varies the field subtly.
        const warm = Math.random() < 0.2;
        colors[i * 3]     = warm ? 1.0 : 1.0;
        colors[i * 3 + 1] = warm ? 0.92 : 1.0;
        colors[i * 3 + 2] = warm ? 0.78 : 1.0;
      }
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      const mat = new THREE.PointsMaterial({
        size: 1.3,
        vertexColors: true,
        transparent: true,
        opacity: 0.25,
        depthWrite: false,
        sizeAttenuation: false,
        blending: THREE.AdditiveBlending,
      });
      const stars = new THREE.Points(geom, mat);
      group.add(stars);

      // (2) A handful of faint "remote workspaces" — small clustered
      // sprites tinted in different hues, scattered far out. Each one
      // reads as someone else's solar system in the distance.
      const REMOTE_HUES = [0xc4a96b, 0x7c5cc9, 0x3fa39a, 0xcf6a4f, 0x5b8fc7, 0xe6c98a];
      const clusterCount = 9;
      for (let k = 0; k < clusterCount; k++) {
        const cR = 4200 + Math.random() * 2200;
        const cTheta = Math.random() * Math.PI * 2;
        const cPhi = Math.acos(2 * Math.random() - 1);
        const cx = cR * Math.sin(cPhi) * Math.cos(cTheta);
        const cy = cR * Math.cos(cPhi);
        const cz = cR * Math.sin(cPhi) * Math.sin(cTheta);
        const hue = REMOTE_HUES[k % REMOTE_HUES.length];
        // 6–14 points per cluster, jittered around the centroid
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
          size: 1.9,
          color: hue,
          transparent: true,
          opacity: 0.20,
          depthWrite: false,
          sizeAttenuation: false,
          blending: THREE.AdditiveBlending,
        });
        const cluster = new THREE.Points(cGeom, cMat);
        group.add(cluster);
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
  }, [data]);  // re-run when the workspace changes (data identity)

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
      // Touch gestures (P4.1): one-finger rotate, two-finger
      // dolly-pan (pinch zoom + two-finger pan). These map to the
      // mouse left-drag-orbit + wheel-zoom desktop behavior so the
      // 3D graph navigates the same way on iPhone / iPad.
      if (THREE.TOUCH) {
        controls.touches = {
          ONE: THREE.TOUCH.ROTATE,
          TWO: THREE.TOUCH.DOLLY_PAN,
        };
      }
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
    setGraphReady(false);
    (async () => {
      let g = { nodes: [], links: [] };
      try { g = await assembleGraph({ workspaceId, options: { structural } }); }
      catch (e) { console.warn('assembleGraph failed', e); }
      if (!cancelled) { setData(g); setLoaded(true); }
    })();
    return () => { cancelled = true; };
  }, [workspaceId, structural]);

  // Reveal after the simulation has had time to settle. With the bumped
  // warmupTicks=200 + d3AlphaDecay=0.04 below, the layout converges
  // well before this timer fires.
  useEffect(() => {
    if (!loaded) return;
    if (data.nodes.length === 0) { setGraphReady(true); return; }
    const t = setTimeout(() => setGraphReady(true), 650);
    return () => clearTimeout(t);
  }, [loaded, data]);

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

  // Scatter dots onto varied orbits instead of one even shell: give each
  // structural parent↔child link an orbital distance jittered deterministically
  // (±35%) by the child id. Semantic backlinks keep the default so
  // cross-references aren't stretched. Keyed on `filtered` so it re-applies
  // whenever the engine rebuilds the link force on a data change.
  useEffect(() => {
    const fg = fgRef.current;
    const link = fg?.d3Force?.('link');
    if (!link) return;
    link.distance(l => l.kind === 'structural' ? 30 * orbitJitter(targetId(l)) : 30);
    // Runs while graphReady is still false (reveal is gated 650ms after load),
    // so any re-settle happens behind the curtain — the user still sees an
    // already-stable layout when the reveal lands.
    fg.d3ReheatSimulation?.();
  }, [filtered]);

  // Build each node as a tinted "planet": solid core sphere + an additive
  // halo sprite in the same hue. The halo gives the node a soft glow that
  // reads as planetary against the dark canvas, and because the sprite is
  // tinted by the node color, each card type ends up with its own
  // distinct atmosphere.
  const nodeThree = (node) => {
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
      <div className={`home-graph-stage ${graphReady ? 'is-ready' : ''}`}>
      <ForceGraph3D
        ref={fgRef}
        graphData={filtered}
        width={size.w}
        height={size.h}
        backgroundColor={BG_FOR[theme]}
        nodeThreeObject={nodeThree}
        nodeLabel={n => n.name}
        linkColor={l => l.kind === 'structural' ? 'rgba(91,87,78,.45)' : 'rgba(255,165,0,.55)'}
        linkOpacity={0.7}
        linkCurvature={0.18}
        // Settle fast so the user sees an already-stable layout when
        // the reveal lands. Higher alpha decay = simulation cools off
        // sooner; more warmup ticks = the off-screen pre-roll runs the
        // sim further before any frame paints. Velocity decay still
        // keeps the user-facing drift gentle.
        d3AlphaDecay={0.04}
        d3VelocityDecay={0.32}
        warmupTicks={200}
        cooldownTime={4000}
        // Click → open info drawer. Camera also eases toward the
        // node so the user knows they hit the right one.
        onNodeClick={(n) => {
          if (!n) return;
          setSelected(n);
          if (fgRef.current) {
            const dist = 200;
            const distRatio = 1 + dist / Math.hypot(n.x || 1, n.y || 1, n.z || 1);
            fgRef.current.cameraPosition(
              { x: (n.x || 0) * distRatio, y: (n.y || 0) * distRatio, z: (n.z || 0) * distRatio },
              n, 1200,
            );
          }
          // Warm the target so a "Open" click in the drawer opens
          // against an already-fetched cache.
          try { prefetchEntity(nodeToTarget(n), { lane: 'high' }); } catch (_) {}
        }}
        // Hover the planet → start warming its target.
        onNodeHover={(n) => { if (n) prefetchEntity(nodeToTarget(n)); }}
        // Right-click is the legacy "open immediately" gesture. Keep
        // it for power users.
        onNodeRightClick={(n) => onNavigate?.(nodeToTarget(n))}
        // Drag was hijacking single clicks (a tiny mouse jitter would
        // cancel onNodeClick). Disabling it makes click → drawer
        // reliable; the camera orbit still works because that's
        // controlled separately.
        enableNodeDrag={false}
        controlType="orbit"
        showNavInfo={false}
      />
      </div>
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
