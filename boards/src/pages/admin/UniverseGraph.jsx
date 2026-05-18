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
// Cosmograph v2 requires BOTH a string id (pointIdBy) AND a
// sequential integer index (pointIndexBy) per point — and the same
// for links (linkSource{,Index}By / linkTarget{,Index}By). We assign
// indices via a monotonic counter and look them up in a node_id →
// index map when materializing edges. Orphan edges (endpoint not
// yet in the map) get retried on later flush ticks; they're dropped
// after a few attempts so a permanently-missing endpoint doesn't
// pile up in the pending buffer forever.
//
// Anonymous: node rows carry only id, kind, workspace_id, created_at,
// and a precomputed color. No title, no body. Click → onNodeClick.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Cosmograph } from '@cosmograph/react';
import { fetchSnapshotPage, useUniverseDeltas } from './useUniverseStream.js';
import { colorForWorkspace } from './universeColors.js';

const NODE_PAGE = 50000;
const EDGE_PAGE = 100000;
const FLUSH_INTERVAL_MS = 200;
const MAX_ORPHAN_ATTEMPTS = 6;  // ~1.2s of retries before dropping an orphan edge

function decorateNode(n, index) {
  return { ...n, index, color: colorForWorkspace(n.workspace_id) };
}

export function UniverseGraph({ onNodeClick }) {
  const [snapshotNodes, setSnapshotNodes] = useState([]);
  const [snapshotEdges, setSnapshotEdges] = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [progress,      setProgress]      = useState({ nodes: 0, edges: 0 });
  const [error,         setError]         = useState(null);
  const [reloadKey,     setReloadKey]     = useState(0);
  const cosmoRef = useRef(null);

  // node_id → full row (for click drawer payloads).
  const nodeMap   = useRef(new Map());
  // node_id → sequential int index (for cosmograph link resolution).
  const nodeIndex = useRef(new Map());
  // Next index to assign. Monotonic across snapshot + all deltas.
  const nextIndex = useRef(0);

  // Attach a pre-decorated node to both maps. Returns the decorated row.
  const ingestNode = useCallback((raw) => {
    const existing = nodeMap.current.get(raw.node_id);
    if (existing) return existing;
    const idx = nextIndex.current++;
    const decorated = decorateNode(raw, idx);
    nodeMap.current.set(raw.node_id, decorated);
    nodeIndex.current.set(raw.node_id, idx);
    return decorated;
  }, []);

  // Resolve an edge's endpoints to indices. Returns the enriched edge
  // when both ends are known, or null when either is missing.
  const enrichEdge = useCallback((raw) => {
    const s = nodeIndex.current.get(raw.source_id);
    const t = nodeIndex.current.get(raw.target_id);
    if (s == null || t == null) return null;
    return { ...raw, source_idx: s, target_idx: t };
  }, []);

  // ── 1. Paginated snapshot ────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    // Reset on reload trigger.
    setError(null);
    setLoading(true);
    setProgress({ nodes: 0, edges: 0 });
    setSnapshotNodes([]);
    setSnapshotEdges([]);
    nodeMap.current = new Map();
    nodeIndex.current = new Map();
    nextIndex.current = 0;
    pendingNodes.current = [];
    pendingEdges.current = [];

    (async () => {
      try {
        const allNodes = [];
        const rawEdges = [];
        let cursor = null;
        // 50 pages × 50k nodes = 2.5M ceiling. Plenty of headroom.
        for (let i = 0; i < 50; i++) {
          const page = await fetchSnapshotPage({ cursor, nodeLimit: NODE_PAGE, edgeLimit: EDGE_PAGE });
          if (cancelled) return;
          for (const n of page.nodes || []) {
            if (nodeMap.current.has(n.node_id)) continue;
            const d = ingestNode(n);
            allNodes.push(d);
          }
          for (const e of page.edges || []) rawEdges.push(e);
          setProgress({ nodes: allNodes.length, edges: rawEdges.length });
          cursor = page.next_cursor;
          if (page.done || !cursor) break;
        }
        if (cancelled) return;

        // After all nodes are ingested, resolve every edge against
        // nodeIndex. Drop orphans silently — they're usually edges
        // pointing to soft-deleted boards or doc anchors we don't
        // render as nodes.
        const resolvedEdges = [];
        for (const e of rawEdges) {
          const enriched = enrichEdge(e);
          if (enriched) resolvedEdges.push(enriched);
        }

        setSnapshotNodes(allNodes);
        setSnapshotEdges(resolvedEdges);
        setLoading(false);
      } catch (e) {
        if (!cancelled) { setError(e?.message || String(e)); setLoading(false); }
      }
    })();
    return () => { cancelled = true; };
  }, [reloadKey, ingestNode, enrichEdge]);

  // ── 2. Delta buffer + flush ──────────────────────────────────────
  // Pending edges keep an `_attempts` counter; once we've tried more
  // than MAX_ORPHAN_ATTEMPTS times to resolve their endpoints, we drop
  // them so a permanently-missing endpoint doesn't bloat the buffer.
  const pendingNodes = useRef([]);
  const pendingEdges = useRef([]);  // [{ raw, attempts }]

  useEffect(() => {
    if (loading) return;
    const id = setInterval(async () => {
      const cosmo = cosmoRef.current;
      if (!cosmo) return;

      // Drain pending nodes first so freshly-arrived deltas can
      // satisfy queued edges this same tick.
      const nodes = pendingNodes.current;
      pendingNodes.current = [];

      // Try to resolve pending edges; split into ready vs. still-orphan.
      const stillPending = [];
      const ready = [];
      for (const item of pendingEdges.current) {
        const enriched = enrichEdge(item.raw);
        if (enriched) {
          ready.push(enriched);
        } else if (item.attempts + 1 < MAX_ORPHAN_ATTEMPTS) {
          stillPending.push({ raw: item.raw, attempts: item.attempts + 1 });
        } // else: drop
      }
      pendingEdges.current = stillPending;

      if (!nodes.length && !ready.length) return;
      try {
        if (nodes.length) await cosmo.addPoints(nodes);
        if (ready.length) await cosmo.addLinks(ready);
      } catch (_) {
        // Most likely cosmograph still initializing. Re-queue.
        pendingNodes.current.unshift(...nodes);
        for (const e of ready) pendingEdges.current.push({ raw: e, attempts: 0 });
      }
    }, FLUSH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [loading, enrichEdge]);

  useUniverseDeltas({
    since: undefined,
    onNode: (n) => {
      if (nodeMap.current.has(n.node_id)) return;
      const d = ingestNode(n);
      pendingNodes.current.push(d);
    },
    onEdge: (e) => {
      pendingEdges.current.push({ raw: e, attempts: 0 });
    },
    onBatch: ({ nodes, edges }) => {
      for (const n of nodes) {
        if (nodeMap.current.has(n.node_id)) continue;
        const d = ingestNode(n);
        pendingNodes.current.push(d);
      }
      for (const e of edges) pendingEdges.current.push({ raw: e, attempts: 0 });
    },
  });

  // ── 3. Cosmograph config ─────────────────────────────────────────
  const config = useMemo(() => ({
    points: snapshotNodes,
    links: snapshotEdges,
    pointIdBy:           'node_id',
    pointIndexBy:        'index',
    pointColorBy:        'color',
    linkSourceBy:        'source_id',
    linkSourceIndexBy:   'source_idx',
    linkTargetBy:        'target_id',
    linkTargetIndexBy:   'target_idx',
    // Visual: degree-based sizing reads as the universe "breathing".
    pointSizeStrategy: 'degree',
    pointSizeRange: [2, 10],
    pointDefaultSize: 3,
    linkDefaultColor: 'rgba(255,255,255,0.04)',
    linkDefaultWidth: 0.4,
    backgroundColor: '#0a0a0c',
    enableSimulation: true,
    simulationRepulsion: 0.5,
    simulationLinkSpring: 0.6,
    simulationFriction: 0.85,
    fitViewOnInit: true,
    showFPSMonitor: false,
    onClick: (idx) => {
      if (typeof idx !== 'number') { onNodeClick?.(null); return; }
      const row = snapshotNodes[idx];
      onNodeClick?.(row ? (nodeMap.current.get(row.node_id) || row) : null);
    },
  }), [snapshotNodes, snapshotEdges, onNodeClick]);

  if (error) {
    return (
      <div className="universe-canvas universe-error t-body">
        <div className="universe-error-inner">
          <div>Couldn't load the universe.</div>
          <div className="t-meta" style={{ marginTop: 6, color: 'var(--ink-3)' }}>{error}</div>
          <button
            className="auth-link"
            style={{ marginTop: 14 }}
            onClick={() => setReloadKey((k) => k + 1)}
          >
            Try again
          </button>
        </div>
      </div>
    );
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
