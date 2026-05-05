import { useEffect, useRef, useState, useMemo } from 'react';
import ForceGraph3D from 'react-force-graph-3d';
import * as THREE from 'three';
import { assembleGraph } from '../lib/graphData.js';
import { HomeGraphHud } from './HomeGraphHud.jsx';
import { HomeGraphDetailDrawer } from './HomeGraphDetailDrawer.jsx';
import { HomeEmptyState } from './HomeEmptyState.jsx';
import { HomeGraph2DFallback } from './HomeGraph2DFallback.jsx';

const KIND_FILTER_DEFAULT = new Set(['board', 'doc', 'card', 'url']);

// 3D workspace graph home. Force-directed via react-force-graph-3d.
//   workspaceId — required
//   onNavigate(target) — open the entity in the existing board surface
export function HomeGraph({ workspaceId, onNavigate }) {
  const fgRef = useRef(null);
  const containerRef = useRef(null);
  const [data, setData] = useState({ nodes: [], links: [] });
  // Structural edges (board↔child-board, board↔card) on by default so the
  // graph reveals workspace hierarchy without requiring explicit doc links.
  const [structural, setStructural] = useState(true);
  const [kinds, setKinds] = useState(KIND_FILTER_DEFAULT);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const [supportsWebGL, setSupportsWebGL] = useState(true);
  const [size, setSize] = useState({ w: 800, h: 600 });

  // WebGL probe
  useEffect(() => {
    try {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl2') || c.getContext('webgl');
      setSupportsWebGL(!!gl);
    } catch { setSupportsWebGL(false); }
  }, []);

  // Auto-rotate the camera when no node is selected. Stops while a node is
  // open so the camera ease-to-node doesn't fight the rotation. OrbitControls
  // also pauses autoRotate while the user is actively dragging.
  useEffect(() => {
    if (!fgRef.current) return;
    let raf;
    const tryAttach = () => {
      const controls = fgRef.current?.controls?.();
      if (!controls) { raf = requestAnimationFrame(tryAttach); return; }
      controls.autoRotate = !selected;
      controls.autoRotateSpeed = 0.35;
    };
    tryAttach();
    return () => { if (raf) cancelAnimationFrame(raf); };
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
    (async () => {
      const g = await assembleGraph({ workspaceId, options: { structural } });
      if (!cancelled) setData(g);
    })();
    return () => { cancelled = true; };
  }, [workspaceId, structural]);

  // Apply kind filter on the client side without re-fetching.
  const filtered = useMemo(() => ({
    nodes: data.nodes.filter(n => kinds.has(n.kind)),
    links: data.links.filter(l => {
      // Both endpoints must still be visible
      const sId = typeof l.source === 'string' ? l.source : l.source.id;
      const tId = typeof l.target === 'string' ? l.target : l.target.id;
      const seen = new Set(data.nodes.filter(n => kinds.has(n.kind)).map(n => n.id));
      return seen.has(sId) && seen.has(tId);
    }),
  }), [data, kinds]);

  // Build nodes as small glowing spheres.
  const nodeThree = (node) => {
    const r = (node.val || 8) * 0.4;
    const geom = new THREE.SphereGeometry(r, 16, 16);
    const mat = new THREE.MeshBasicMaterial({
      color: node.color || '#d4a04a',
      transparent: true,
      opacity: 0.92,
    });
    return new THREE.Mesh(geom, mat);
  };

  if (filtered.nodes.length === 0) {
    return (
      <div className="home-graph-wrap" ref={containerRef}>
        <HomeGraphHud
          kinds={kinds} setKinds={setKinds}
          structural={structural} setStructural={setStructural}
          search={search} setSearch={setSearch}
          onReset={() => {}}
          onSearchPulse={() => {}}
        />
        <HomeEmptyState />
      </div>
    );
  }

  if (!supportsWebGL) {
    return (
      <div className="home-graph-wrap" ref={containerRef}>
        <HomeGraphHud
          kinds={kinds} setKinds={setKinds}
          structural={structural} setStructural={setStructural}
          search={search} setSearch={setSearch}
          onReset={() => {}}
          onSearchPulse={() => {}}
        />
        <HomeGraph2DFallback data={filtered} width={size.w} height={size.h} onNodeClick={setSelected} />
      </div>
    );
  }

  return (
    <div className="home-graph-wrap" ref={containerRef}>
      <HomeGraphHud
        kinds={kinds} setKinds={setKinds}
        structural={structural} setStructural={setStructural}
        search={search} setSearch={setSearch}
        onReset={() => fgRef.current?.zoomToFit?.(800, 60)}
        onSearchPulse={() => {
          const q = search.trim().toLowerCase();
          if (!q) return;
          const hit = filtered.nodes.find(n => (n.name || '').toLowerCase().includes(q));
          if (hit && fgRef.current) {
            const dist = 220;
            const distRatio = 1 + dist / Math.hypot(hit.x || 1, hit.y || 1, hit.z || 1);
            fgRef.current.cameraPosition(
              { x: (hit.x || 0) * distRatio, y: (hit.y || 0) * distRatio, z: (hit.z || 0) * distRatio },
              hit, 1200,
            );
          }
        }}
      />
      <ForceGraph3D
        ref={fgRef}
        graphData={filtered}
        width={size.w}
        height={size.h}
        backgroundColor="#0a0908"
        nodeThreeObject={nodeThree}
        nodeLabel={n => n.name}
        linkColor={l => l.kind === 'structural' ? 'rgba(91,87,78,.45)' : 'rgba(212,160,74,.55)'}
        linkOpacity={0.7}
        linkCurvature={0.18}
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
