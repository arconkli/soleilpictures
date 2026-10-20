import { useCallback, useContext, useEffect, useRef, useState, useMemo } from 'react';
import ForceGraph3D from 'react-force-graph-3d';
import * as THREE from 'three';
import { assembleGraph } from '../lib/graphData.js';
import { GraphFixtureContext } from '../lib/graphFixture.js';
import { cardPlacement, labelRank, viewOffset, visibleLabels } from '../lib/homeMap.js';
import { HomeGraphDetailDrawer } from './HomeGraphDetailDrawer.jsx';
import { HomeEmptyState } from './HomeEmptyState.jsx';
import { HomeGraph2DFallback } from './HomeGraph2DFallback.jsx';
import { prefetchEntity } from '../lib/prefetchKinds.js';
import { orbitJitter, targetId } from '../lib/hashJitter.js';
import { useMatchMedia } from '../hooks/useMatchMedia.js';

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
// `backdrop`: Home now floats a projects panel over this graph. In that mode
// the graph is scenery that can still be orbited and clicked, so its own
// messages (the empty state, the "link things with @" hint) stay out of the way
// of the panel, which is what Home is saying.
// `scenery`: kept for a Home that lays its own cards over the graph, where it
// takes no pointer. Nothing stays selected there: a planet's drawer would sit
// under Home out of reach, and would hold the drift still.
//
// The map (`labels` given — the files sidebar's Home, preview only, the owner's
// pick of 2026-10-19): the universe IS Home. Every cluster's star carries its
// name; clicking a star or its name picks it (`onSelect`), the camera glides to
// it and `card` is drawn beside it, kept inside the open area; double-clicking
// opens it (`onOpenStar`). `litIds` (a search) keeps those clusters and their
// cards lit and dims the rest. `insets` are what covers the window's edges (the
// sidebar, the top bar, the find bar): the universe is framed into what's left.
// Cards and docs keep their drawer. With `labels` null nothing here changes.
export function HomeGraph({
  workspaceId, onNavigate, backdrop = false, scenery = false,
  labels = null, selectedId = null, onSelect, onOpenStar, litIds = null, insets = null, refreshKey = 0, card = null,
}) {
  const fixture = useContext(GraphFixtureContext);
  const mapMode = Array.isArray(labels);
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
  useEffect(() => { if (scenery) setSelected(null); }, [scenery]);
  const [supportsWebGL, setSupportsWebGL] = useState(true);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [theme, setTheme] = useState(readTheme);
  // Hide the constellation until the force simulation has had time to
  // settle — otherwise the first ~600ms shows nodes bouncing into
  // place, which read as "broken" against the rest of the app's snappy
  // feel. Combined with the bumped d3AlphaDecay/warmupTicks below,
  // the user sees a clean reveal of the already-stable layout.
  const [graphReady, setGraphReady] = useState(false);

  // The map's live values, read by the frame loops without re-attaching them.
  const mapRef = useRef({});
  mapRef.current = { labels, selectedId, litIds, insets };
  const hoverRef = useRef(null);          // the cluster whose star or name the pointer is on
  const touch = useMatchMedia('(hover: none) and (pointer: coarse)');
  const objectsRef = useRef(new Map());   // node id → its planet, so a search can dim it
  const lastClickRef = useRef({ id: null, t: 0 });
  const reduceMotionRef = useRef(false);
  try { reduceMotionRef.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) {}

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
    // The drift is ambient motion nobody asked for. CSS prefers-reduced-motion
    // cannot reach a WebGL camera, so it is honoured here, in the loop.
    let reduceMotion = false;
    try { reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) {}
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
        // On the map it holds still while a cluster is picked or pointed at:
        // a name you're reaching for shouldn't drift out from under you.
        if (!selected && !mapRef.current.selectedId && !hoverRef.current && !interacting && !reduceMotion) {
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

  // Track container size for the canvas.
  //
  // Measured through a CALLBACK ref, not a [] effect. Two reasons, both of
  // which produced the production crash "Cannot read properties of null
  // (reading 'getBoundingClientRect')" at ResizeObserver.e:
  //
  //  1. The ref lands on one of FOUR mutually exclusive wrappers (empty state,
  //     pre-load shell, 2D fallback, main canvas). A [] effect binds the
  //     observer to whichever node existed after the first commit and keeps
  //     watching it after a branch swap — the dead node fires, the live one is
  //     never measured.
  //  2. On unmount the passive effect cleanup runs AFTER React has already
  //     nulled the ref and detached the node. The detach is a 0×0 size change,
  //     so the observer fires once into that window. Seen in the field during
  //     account deletion, which tears the whole tree down at once.
  //
  // A callback ref rebinds on every node change and disconnects synchronously
  // before the old node goes away; `measure` re-reads the ref and bails if it
  // is gone, so a queued callback can't deref null either.
  const measure = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setSize({ w: Math.max(200, Math.floor(r.width)), h: Math.max(200, Math.floor(r.height)) });
  }, []);

  const roRef = useRef(null);
  const setContainer = useCallback((node) => {
    if (roRef.current) { roRef.current.disconnect(); roRef.current = null; }
    containerRef.current = node;
    if (!node) return;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(node);
    roRef.current = ro;
  }, [measure]);

  useEffect(() => {
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('resize', measure);
      if (roRef.current) { roRef.current.disconnect(); roRef.current = null; }
    };
  }, [measure]);

  // Load graph data; refresh when workspace / structural toggle changes, and
  // on the map when its clusters change (`refreshKey`: one made, moved or
  // deleted). A refresh of the same workspace keeps what's on screen and where
  // every star already is; only another workspace starts over.
  const shownWsRef = useRef(null);
  const fittedRef = useRef(false);
  useEffect(() => {
    let cancelled = false;
    const refresh = shownWsRef.current === workspaceId;
    shownWsRef.current = workspaceId;
    if (!refresh) { setLoaded(false); fittedRef.current = false; }
    // Local QA workspaces don't have rows in Supabase; skip the (hanging) fetch.
    if (workspaceId === 'local-workspace') {
      setData({ nodes: [], links: [] });
      setLoaded(true);
      return () => {};
    }
    if (!refresh) setGraphReady(false);
    const settle = (g) => {
      if (cancelled) return;
      setData((prev) => (refresh ? keepPlaces(prev, g) : g));
      setLoaded(true);
    };
    if (fixture?.graph) { settle(copyGraph(fixture.graph)); return () => { cancelled = true; }; }
    (async () => {
      let g = { nodes: [], links: [] };
      try { g = await assembleGraph({ workspaceId, options: { structural } }); }
      catch (e) {
        console.warn('assembleGraph failed', e);
        // A refresh that fails keeps the universe on screen; only a first
        // load falls back to an empty one.
        if (refresh) { if (!cancelled) setLoaded(true); return; }
      }
      settle(g);
    })();
    return () => { cancelled = true; };
  }, [workspaceId, structural, refreshKey, fixture]);

  // Reveal after the simulation has had time to settle. With the bumped
  // warmupTicks=200 + d3AlphaDecay=0.04 below, the layout converges
  // well before this timer fires. The map frames it into the open area first,
  // so the reveal shows it already there.
  useEffect(() => {
    if (!loaded) return;
    if (data.nodes.length === 0) { setGraphReady(true); return; }
    const t = setTimeout(() => {
      if (mapMode && !fittedRef.current) { fittedRef.current = true; fitToOpenArea(0); }
      setGraphReady(true);
    }, 650);
    return () => clearTimeout(t);
  }, [loaded, data]); // eslint-disable-line react-hooks/exhaustive-deps

  // Kind filter is fixed (no HUD). Memoize so layout algorithms see stable refs.
  // The id set is built once, not per link — rebuilding it inside the filter
  // was O(links x nodes) work before Home's first frame.
  const filtered = useMemo(() => {
    const nodes = data.nodes.filter(n => kinds.has(n.kind));
    const seen = new Set(nodes.map(n => n.id));
    return {
      nodes,
      links: data.links.filter(l => {
        const sId = typeof l.source === 'string' ? l.source : l.source.id;
        const tId = typeof l.target === 'string' ? l.target : l.target.id;
        return seen.has(sId) && seen.has(tId);
      }),
    };
  }, [data, kinds]);

  // Scatter dots onto varied orbits instead of one even shell: vary each
  // structural parent↔child link's ideal distance by a deterministic ±35%
  // (semantic backlinks keep the default 30 so cross-references aren't
  // stretched). forceLink caches per-link distances at initialize() time, so
  // re-feed the links to force a recompute. We deliberately do NOT call
  // d3ReheatSimulation(): it flips engineRunning on before the kapsule digest
  // has assigned state.layout, so the render loop ticks an undefined layout
  // (blanks the graph). The engine's own warmup/cooldown applies the new
  // distances. Keyed on `filtered` so it re-applies on each data change.
  useEffect(() => {
    const link = fgRef.current?.d3Force?.('link');
    if (!link?.distance) return;
    link.distance(l => l.kind === 'structural' ? 30 * orbitJitter(targetId(l)) : 30);
    if (typeof link.links === 'function') link.links(link.links()); // recompute cached distances
  }, [filtered]);

  // ── The map ──────────────────────────────────────────────────────────────
  const nodeById = useMemo(() => new Map(filtered.nodes.map(n => [n.id, n])), [filtered]);
  const nodeByIdRef = useRef(nodeById);
  nodeByIdRef.current = nodeById;
  const sizeRef = useRef(size);
  sizeRef.current = size;

  // The open area: the window less what covers its edges.
  const areaOf = () => {
    const { w, h } = sizeRef.current;
    const i = mapRef.current.insets || {};
    return { left: (i.left || 0) + 8, top: (i.top || 0) + 4, right: w - (i.right || 0) - 8, bottom: h - (i.bottom || 0) - 4 };
  };

  // Frame the universe into the open area: the camera's view offset puts its
  // centre there, and the camera stands back far enough that it all fits.
  useEffect(() => {
    if (!mapMode || !graphReady) return;
    const cam = fgRef.current?.camera?.();
    if (!cam?.setViewOffset) return;
    const off = viewOffset(insets);
    cam.setViewOffset(size.w, size.h, off.x, off.y, size.w, size.h);
    cam.updateProjectionMatrix();
  }, [mapMode, graphReady, size.w, size.h, insets?.left, insets?.top, insets?.right, insets?.bottom]); // eslint-disable-line react-hooks/exhaustive-deps

  function fitToOpenArea(ms = 800) {
    const fg = fgRef.current;
    const cam = fg?.camera?.();
    const controls = fg?.controls?.();
    const box = fg?.getGraphBbox?.();
    if (!cam || !controls || !box) return;
    const c = { x: (box.x[0] + box.x[1]) / 2, y: (box.y[0] + box.y[1]) / 2, z: (box.z[0] + box.z[1]) / 2 };
    // Fit by the widest side, not the box's diagonal: the universe is wider
    // than it is deep, and the diagonal left it small in the middle.
    // A workspace of one or two stars still stands back: a single star up
    // close is a ball, not a star.
    const r = Math.max(260, (Math.max(box.x[1] - box.x[0], box.y[1] - box.y[0], box.z[1] - box.z[0]) / 2) * 1.12);
    const a = areaOf();
    const half = Math.max(120, Math.min(a.right - a.left, a.bottom - a.top) / 2 - 24);
    const d = r * (sizeRef.current.h / 2) / (half * Math.tan((cam.fov * Math.PI) / 360));
    const dir = cam.position.clone().sub(controls.target);
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
    dir.normalize();
    fg.cameraPosition({ x: c.x + dir.x * d, y: c.y + dir.y * d, z: c.z + dir.z * d }, c, ms);
  }

  // A picked cluster: the camera glides toward its star, keeping the angle it
  // was looking from, close enough to read its neighbours. Put down, it glides
  // back out to the whole map.
  const hadSelRef = useRef(false);
  useEffect(() => {
    if (!mapMode) return;
    if (!selectedId) {
      if (hadSelRef.current && graphReady) fitToOpenArea(reduceMotionRef.current ? 0 : 900);
      hadSelRef.current = false;
      return;
    }
    hadSelRef.current = true;
    // Not at once: a double-click's second click has to land where the first
    // did, on the star, before the camera carries it off.
    const t = setTimeout(() => {
      const fg = fgRef.current;
      const n = nodeByIdRef.current.get(`board:${selectedId}`);
      const cam = fg?.camera?.();
      const controls = fg?.controls?.();
      if (!n || !cam || !controls || n.x == null) return;
      const dir = cam.position.clone().sub(controls.target);
      const dist = Math.max(180, Math.min(dir.length() * 0.8, 900));
      dir.normalize();
      fg.cameraPosition(
        { x: n.x + dir.x * dist, y: n.y + dir.y * dist, z: n.z + dir.z * dist },
        { x: n.x, y: n.y, z: n.z },
        reduceMotionRef.current ? 0 : 1000,
      );
    }, 450);
    return () => clearTimeout(t);
  }, [mapMode, selectedId, graphReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // The card comes with the glide, not at once: a double-click's second click
  // lands on the star's name, where the card would otherwise already be.
  const [cardFor, setCardFor] = useState(null);
  useEffect(() => {
    if (!mapMode || !selectedId) { setCardFor(null); return undefined; }
    setCardFor(null);
    const t = setTimeout(() => setCardFor(selectedId), 450);
    return () => clearTimeout(t);
  }, [mapMode, selectedId]);

  // A search: what it found, and their cards, stay lit; the rest dims.
  useEffect(() => {
    if (!mapMode) return;
    for (const [id, group] of objectsRef.current) dimPlanet(group, !litIds || litIds.has(clusterOf(id)));
  }, [mapMode, litIds, filtered]); // eslint-disable-line react-hooks/exhaustive-deps
  const linkColor = useCallback((l) => {
    const base = l.kind === 'structural' ? 'rgba(91,87,78,.45)' : 'rgba(255,165,0,.55)';
    if (!litIds) return base;
    const s = clusterOf(typeof l.source === 'object' ? l.source.id : l.source);
    const t = clusterOf(typeof l.target === 'object' ? l.target.id : l.target);
    return litIds.has(s) && litIds.has(t) ? base : 'rgba(91,87,78,.08)';
  }, [litIds]); // eslint-disable-line react-hooks/exhaustive-deps

  // The names and the picked cluster's card follow their stars, every frame:
  // projected through the camera (its view offset included), laid out so no
  // name covers another (the one that matters more keeps its place), and kept
  // inside the open area.
  const labelEls = useRef(new Map());
  const shownRef = useRef(null);
  const widthOf = useRef(new Map());
  const cardRef = useRef(null);
  const leadRef = useRef(null);
  useEffect(() => {
    if (!mapMode || !graphReady) return undefined;
    let raf = 0;
    let frame = 0;
    const v = new THREE.Vector3();
    const project = (n, cam) => {
      v.set(n.x, n.y, n.z).project(cam);
      if (v.z > 1 || v.z < -1) return null;
      const { w, h } = sizeRef.current;
      return { x: (v.x + 1) * w / 2, y: (1 - v.y) * h / 2 };
    };
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const cam = fgRef.current?.camera?.();
      if (!cam) return;
      const { labels: ls, selectedId: sel, litIds: lit } = mapRef.current;
      const area = areaOf();
      const items = [];
      for (const l of ls || []) {
        const el = labelEls.current.get(l.id);
        if (!el) continue;
        const n = nodeByIdRef.current.get(l.id);
        const p = n && n.x != null ? project(n, cam) : null;
        if (!p) { el.dataset.off = '1'; continue; }
        el.style.transform = `translate3d(${Math.round(p.x - 13)}px, ${Math.round(p.y - 13)}px, 0)`;
        let w = widthOf.current.get(l.id);
        if (w == null || frame % 30 === 0) { w = el.offsetWidth; widthOf.current.set(l.id, w); }
        items.push({ id: l.id, el, x: p.x - 13, y: p.y - 13, w, h: 26,
          rank: labelRank({ kind: l.kind, selected: l.boardId === sel, hover: l.boardId === hoverRef.current, hit: !!lit?.has(l.boardId) }) });
      }
      // Which names give way: every frame for a usual workspace, every few
      // frames for one with hundreds of clusters (it's a pass over every pair).
      if (!shownRef.current || frame % (items.length > 120 ? 4 : 1) === 0) shownRef.current = visibleLabels(items, area);
      const shown = shownRef.current;
      for (const it of items) {
        const off = !shown.has(it.id);
        if ((it.el.dataset.off === '1') !== off) it.el.dataset.off = off ? '1' : '';
        const isHover = it.el.dataset.board === hoverRef.current;
        if (it.el.classList.contains('is-hover') !== isHover) it.el.classList.toggle('is-hover', isHover);
      }
      const cardEl = cardRef.current;
      if (cardEl) {
        const n = sel ? nodeByIdRef.current.get(`board:${sel}`) : null;
        const p = n && n.x != null ? project(n, cam) : null;
        if (!p) { cardEl.dataset.off = '1'; }
        else {
          const box = { w: cardEl.offsetWidth, h: cardEl.offsetHeight };
          const at = cardPlacement(p, box, area);
          cardEl.style.transform = `translate3d(${at.left}px, ${at.top}px, 0)`;
          cardEl.dataset.off = '';
          const lead = leadRef.current;
          if (lead) {
            const x0 = at.side === 'right' ? p.x + 13 : at.left + box.w;
            const x1 = at.side === 'right' ? at.left : p.x - 13;
            lead.style.transform = `translate3d(${Math.round(x0)}px, ${Math.round(p.y)}px, 0)`;
            lead.style.width = `${Math.max(0, Math.round(x1 - x0))}px`;
          }
        }
      }
      frame++;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [mapMode, graphReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // A star picked from the keyboard takes focus on to its card once it shows,
  // rather than leaving it behind every other name in the tab order.
  const focusCardRef = useRef(false);
  useEffect(() => {
    if (!cardFor || !focusCardRef.current) return;
    focusCardRef.current = false;
    cardRef.current?.querySelector('.ch-primary')?.focus({ preventScroll: true });
  }, [cardFor]);

  const pickStar = (boardId, { keyboard = false } = {}) => {
    const now = performance.now();
    const last = lastClickRef.current;
    if (last.id === boardId && now - last.t < 420) {
      lastClickRef.current = { id: null, t: 0 };
      onOpenStar?.(boardId);
      return;
    }
    lastClickRef.current = { id: boardId, t: now };
    focusCardRef.current = keyboard;
    setSelected(null);
    onSelect?.(boardId);
    try { prefetchEntity({ kind: 'board', id: boardId }, { lane: 'high' }); } catch (_) {}
  };

  // Build each node as a tinted "planet": solid core sphere + an additive
  // halo sprite in the same hue. The halo gives the node a soft glow that
  // reads as planetary against the dark canvas, and because the sprite is
  // tinted by the node color, each card type ends up with its own
  // distinct atmosphere.
  const nodeThree = useCallback((node) => {
    const r = (node.val || 8) * 0.4;
    const color = node.color || '#ffa500';
    const group = new THREE.Group();
    // On the map a core can be dimmed by a search, so it is born transparent:
    // three.js bakes an opaque material's alpha into its shader.
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(r, 20, 20),
      new THREE.MeshBasicMaterial(mapMode ? { color, transparent: true } : { color }),
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
    if (mapMode) {
      objectsRef.current.set(node.id, group);
      const lit = mapRef.current.litIds;
      if (lit) dimPlanet(group, lit.has(clusterOf(node.id)));
    }
    return group;
  }, [mapMode]);

  // Show the canvas as soon as we have nodes. Empty state only after we've
  // confirmed the workspace is genuinely empty (graph load resolved + 0 nodes).
  if (loaded && filtered.nodes.length === 0) {
    return (
      <div className="home-graph-wrap" ref={setContainer}>
        {!backdrop && <HomeEmptyState />}
      </div>
    );
  }

  // Pre-load shell — same bg as the canvas so there's no flash, no HUD, no empty.
  if (!loaded) {
    return (
      <div className="home-graph-wrap" ref={setContainer}
           style={{ background: BG_FOR[theme] }} />
    );
  }

  // A 3-node constellation floating in the dark reads as "unfinished", not
  // "get started" — give sparse graphs a quiet next-step nudge.
  const sparseHint = !backdrop && filtered.nodes.length > 0 && filtered.nodes.length < 5 ? (
    <div className="home-sparse-hint" aria-hidden="true">
      Your map grows as you link things — type @ in any doc or note to connect boards, docs, and cards.
    </div>
  ) : null;

  // Shared by both renderers: the 2D fallback used to set `selected` with no
  // drawer to show it, so without WebGL no node could be opened at all.
  const detailDrawer = selected ? (
    <HomeGraphDetailDrawer
      workspaceId={workspaceId}
      node={selected}
      onClose={() => setSelected(null)}
      onOpen={() => onNavigate?.(nodeToTarget(selected))}
    />
  ) : null;

  if (!supportsWebGL) {
    return (
      <div className="home-graph-wrap" ref={setContainer}>
        <HomeGraph2DFallback data={filtered} width={size.w} height={size.h}
                             backgroundColor={BG_FOR[theme]}
                             onNodeClick={setSelected}
                             onNodeRightClick={(n) => onNavigate?.(nodeToTarget(n))} />
        {sparseHint}
        {detailDrawer}
      </div>
    );
  }

  return (
    <div className="home-graph-wrap" ref={setContainer}
         onPointerLeave={mapMode ? () => { hoverRef.current = null; } : undefined}>
      <div className="grain-surface" aria-hidden="true" style={{ zIndex: 1 }} />
      <div className={`home-graph-stage ${graphReady ? 'is-ready' : ''}`}>
      <ForceGraph3D
        ref={fgRef}
        graphData={filtered}
        width={size.w}
        height={size.h}
        backgroundColor={BG_FOR[theme]}
        nodeThreeObject={nodeThree}
        // On the map a cluster's name is on its star already.
        nodeLabel={mapMode ? (n => (n.kind === 'board' ? '' : n.name)) : (n => n.name)}
        linkColor={mapMode ? linkColor : (l => l.kind === 'structural' ? 'rgba(91,87,78,.45)' : 'rgba(255,165,0,.55)')}
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
          // On the map a cluster's star picks it (twice, opens it); cards and
          // docs keep their drawer.
          if (mapMode && n.kind === 'board') { pickStar(n.id.slice(6)); return; }
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
        onNodeHover={(n) => {
          if (mapMode) hoverRef.current = n?.kind === 'board' ? n.id.slice(6) : null;
          if (n) prefetchEntity(nodeToTarget(n));
        }}
        // The empty sky puts down whatever was picked.
        onBackgroundClick={mapMode ? () => { setSelected(null); onSelect?.(null); } : undefined}
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
      {mapMode && (
        <div className={`hg-map${graphReady ? ' is-ready' : ''}${selectedId ? ' has-sel' : ''}`}>
          {labels.map((l) => (
            <button key={l.id} type="button" data-board={l.boardId} data-off="1"
                    ref={(el) => {
                      if (el) { labelEls.current.set(l.id, el); return; }
                      labelEls.current.delete(l.id);
                      if (hoverRef.current === l.boardId) hoverRef.current = null;   // its cluster gone
                    }}
                    className={`hg-name is-${l.kind}${selectedId === l.boardId ? ' is-sel' : ''}${litIds ? (litIds.has(l.boardId) ? ' is-hit' : ' is-faded') : ''}`}
                    aria-pressed={selectedId === l.boardId}
                    title={l.kind === 'nested' ? undefined : touch ? 'Tap to see it · double-tap to open it' : 'Click to see it · double-click to open it'}
                    onClick={(e) => pickStar(l.boardId, { keyboard: e.detail === 0 })}
                    onPointerEnter={() => { hoverRef.current = l.boardId; }}
                    onPointerLeave={() => { if (hoverRef.current === l.boardId) hoverRef.current = null; }}
                    onFocus={() => { hoverRef.current = l.boardId; }}
                    onBlur={() => { if (hoverRef.current === l.boardId) hoverRef.current = null; }}>
              <span className="hg-ring" aria-hidden="true" />
              <span className="hg-name-text">{l.name}</span>
            </button>
          ))}
          {card && selectedId && cardFor === selectedId && (
            <>
              <span className="hg-lead" ref={leadRef} aria-hidden="true" />
              <div className="hg-card" ref={cardRef} data-off="1" onPointerEnter={() => { hoverRef.current = null; }}>{card}</div>
            </>
          )}
        </div>
      )}
      {sparseHint}
      {detailDrawer}
    </div>
  );
}

// Which cluster a node belongs to: a cluster's star is its own; a card or doc
// is its cluster's ('card:<boardId>:<cardId>').
function clusterOf(id) {
  if (id.startsWith('board:')) return id.slice(6);
  if (id.startsWith('card:')) return id.split(':')[1];
  return null;
}

// Dim a planet (its core, then its halo) or bring it back.
function dimPlanet(group, on) {
  group.children.forEach((o, i) => {
    const m = o.material;
    if (!m) return;
    if (!m.transparent) { m.transparent = true; m.needsUpdate = true; }
    m.opacity = i === 0 ? (on ? 1 : 0.16) : (on ? 0.22 : 0.035);
  });
}

// A refresh of the same workspace keeps every star where it is: the new graph's
// nodes take the old ones' places (and speeds), so only what changed moves.
function keepPlaces(prev, next) {
  const was = new Map((prev?.nodes || []).map(n => [n.id, n]));
  return {
    links: next.links,
    nodes: next.nodes.map((n) => {
      const o = was.get(n.id);
      return o && o.x != null ? { ...n, x: o.x, y: o.y, z: o.z, vx: 0, vy: 0, vz: 0 } : n;
    }),
  };
}

// The force engine writes positions into the nodes and swaps a link's ends for
// the nodes themselves, so a fixture's graph is copied before it is handed in.
function copyGraph(g) {
  const end = (e) => (e && typeof e === 'object' ? e.id : e);
  return {
    nodes: (g?.nodes || []).map(n => ({ ...n })),
    links: (g?.links || []).map(l => ({ ...l, source: end(l.source), target: end(l.target) })),
  };
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
