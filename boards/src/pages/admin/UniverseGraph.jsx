// UniverseGraph — Cosmograph-backed WebGL render of every node and
// connection on the platform. Streaming load:
//
//   1. Mount with empty data; cosmograph initializes WebGL.
//   2. Page through /snapshot until done; concatenate into a single
//      pair (allNodes, allEdges) and pass them as React props.
//   3. After mount completes, start the delta SSE. Each incoming
//      node/edge goes into a 200ms-debounced flush buffer; flush
//      calls cosmograph.addPoints / addLinks so the simulation
//      updates incrementally instead of re-running from scratch.
//
// Anonymous: node rows carry only id, kind, workspace_id, created_at,
// and a precomputed color. No title, no body. Click → onNodeClick
// fires with the raw row so the host can show a drawer.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Cosmograph } from '@cosmograph/react';
import { fetchSnapshotPage, useUniverseDeltas } from './useUniverseStream.js';
import { colorForWorkspace } from './universeColors.js';

const NODE_PAGE = 50000;
const EDGE_PAGE = 100000;
const FLUSH_INTERVAL_MS = 200;

function decorateNode(n, index) {
  return { ...n, index, color: colorForWorkspace(n.workspace_id) };
}

export function UniverseGraph({ onNodeClick }) {
  const [snapshotNodes, setSnapshotNodes] = useState([]);
  const [snapshotEdges, setSnapshotEdges] = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [progress,      setProgress]      = useState({ nodes: 0, edges: 0 });
  const [error,         setError]         = useState(null);
  const cosmoRef = useRef(null);

  // Map of node_id → row for the click handler. Keeps the click
  // payload local (we don't ask cosmograph to round-trip it).
  const nodeMap = useRef(new Map());

  // Monotonic counter for the `index` column cosmograph requires
  // (pointIndexBy). Increments across the snapshot and every delta.
  const nextIndex = useRef(0);

  // ── 1. Paginated snapshot ────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const allNodes = [];
        const allEdges = [];
        let cursor = null;
        // Hard ceiling to keep the UI from running away if something is
        // misconfigured. 50 pages × 50k nodes = 2.5M nodes per snapshot
        // before we bail; comfortably past the "millions" bar.
        for (let i = 0; i < 50; i++) {
          const page = await fetchSnapshotPage({ cursor, nodeLimit: NODE_PAGE, edgeLimit: EDGE_PAGE });
          if (cancelled) return;
          for (const n of page.nodes || []) {
            if (nodeMap.current.has(n.node_id)) continue;
            const d = decorateNode(n, nextIndex.current++);
            allNodes.push(d);
            nodeMap.current.set(d.node_id, d);
          }
          for (const e of page.edges || []) allEdges.push(e);
          setProgress({ nodes: allNodes.length, edges: allEdges.length });
          cursor = page.next_cursor;
          if (page.done || !cursor) break;
        }
        if (cancelled) return;
        setSnapshotNodes(allNodes);
        setSnapshotEdges(allEdges);
        setLoading(false);
      } catch (e) {
        if (!cancelled) { setError(e?.message || String(e)); setLoading(false); }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── 2. Delta buffer + flush ──────────────────────────────────────
  // Deltas accumulate between flush ticks so we batch addPoints /
  // addLinks calls. Cosmograph re-runs its simulation after each
  // call; flushing at 200ms keeps the universe lively without
  // making the GPU sweat at high write rates.
  const pendingNodes = useRef([]);
  const pendingEdges = useRef([]);

  useEffect(() => {
    if (loading) return;
    const id = setInterval(async () => {
      const nodes = pendingNodes.current;
      const edges = pendingEdges.current;
      if (!nodes.length && !edges.length) return;
      pendingNodes.current = [];
      pendingEdges.current = [];
      const cosmo = cosmoRef.current;
      if (!cosmo) return;
      try {
        if (nodes.length) await cosmo.addPoints(nodes);
        if (edges.length) await cosmo.addLinks(edges);
      } catch (e) {
        // Most likely transient (cosmograph still initializing).
        // Re-queue and try again next tick.
        pendingNodes.current.unshift(...nodes);
        pendingEdges.current.unshift(...edges);
      }
    }, FLUSH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [loading]);

  useUniverseDeltas({
    since: undefined,
    onNode: (n) => {
      if (nodeMap.current.has(n.node_id)) return; // dedupe re-saves
      const d = decorateNode(n, nextIndex.current++);
      nodeMap.current.set(d.node_id, d);
      pendingNodes.current.push(d);
    },
    onEdge: (e) => { pendingEdges.current.push(e); },
    onBatch: ({ nodes, edges }) => {
      for (const n of nodes) {
        if (nodeMap.current.has(n.node_id)) continue;
        const d = decorateNode(n, nextIndex.current++);
        nodeMap.current.set(d.node_id, d);
        pendingNodes.current.push(d);
      }
      for (const e of edges) pendingEdges.current.push(e);
    },
  });

  // ── 3. Click → look up the row in our local map ──────────────────
  const config = useMemo(() => ({
    // Data plumbing
    points: snapshotNodes,
    links: snapshotEdges,
    pointIdBy:      'node_id',
    pointIndexBy:   'index',
    pointColorBy:   'color',
    linkSourceBy:   'source_id',
    linkTargetBy:   'target_id',
    // Visual: degree-based sizing reads as the universe "breathing"
    pointSizeStrategy: 'degree',
    pointSizeRange: [2, 10],
    pointDefaultSize: 3,
    linkDefaultColor: 'rgba(255,255,255,0.04)',
    linkDefaultWidth: 0.4,
    backgroundColor: '#0a0a0c',
    // Behavior
    enableSimulation: true,
    simulationRepulsion: 0.5,
    simulationLinkSpring: 0.6,
    simulationFriction: 0.85,
    fitViewOnInit: true,
    showFPSMonitor: false,
    onClick: (idx /*, point */) => {
      if (typeof idx !== 'number') { onNodeClick?.(null); return; }
      const id = snapshotNodes[idx]?.node_id;
      onNodeClick?.(id ? (nodeMap.current.get(id) || snapshotNodes[idx]) : null);
    },
  }), [snapshotNodes, snapshotEdges, onNodeClick]);

  if (error) {
    return <div className="universe-canvas universe-error t-body">Couldn't load the universe: {error}</div>;
  }

  return (
    <div className="universe-canvas">
      <Cosmograph
        ref={cosmoRef}
        style={{ width: '100%', height: '100%' }}
        {...config}
      />
      {loading && (
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
