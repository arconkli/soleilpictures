// AdminUniverseTab — the admin Universe surface. Two subtabs share the same
// shell:
//   • "Universe"        — the original full-screen 3D force-graph (unchanged):
//                          floating stats pill + graph + reset + node drawer.
//   • "Command Center"  — a big-screen business-metrics wall that keeps the live
//                          universe as the centerpiece and frames it with graphs.
// The graph renderer + privacy contract (IDs/counts only, no titles/content) are
// untouched; the Command Center only *reuses* <UniverseGraph>.

import { useCallback, useMemo, useState } from 'react';
import { AdminUniverseTicker } from './AdminUniverseTicker.jsx';
import { UniverseGraph } from './UniverseGraph.jsx';
import { UniverseLegend } from './UniverseLegend.jsx';
import { UniverseArrivals, useArrivals } from './UniverseArrivals.jsx';
import { useUniverseStats } from './useUniverseStream.js';
import { useActivityPulse } from './useActivityPulse.js';
import { AdminCommandCenter } from './AdminCommandCenter.jsx';
import { fmtDateTime } from '../../lib/adminFormat.js';

const KIND_LABELS = {
  user:  'User',
  ws:    'Workspace',
  board: 'Board',
  doc:   'Doc',
  note:  'Note',
  image: 'Image',
  palette: 'Palette',
  link:  'Link',
  card:  'Card',
  url:   'External link',
};

// Cards get their created_at from card_index.created_at, added in migration
// 0254. Rows that predate it were backfilled from updated_at, so anything
// older than the backfill is really "last edited" — say so rather than
// labelling a guess as a creation time.
const CREATED_AT_BACKFILL = Date.parse('2026-08-22T21:44:00Z');

function createdLabel(node) {
  if (node.kind !== 'user' && node.kind !== 'ws' && node.kind !== 'board') {
    const t = Date.parse(node.created_at);
    if (Number.isFinite(t) && t < CREATED_AT_BACKFILL) return 'Created (approx.)';
  }
  return 'Created';
}

function UniverseDrawer({ node, onClose, isolated, onIsolate }) {
  if (!node) return null;
  const canIsolate = !!node.workspace_id;
  return (
    <aside className="universe-drawer surface-frosted">
      <header className="universe-drawer-head">
        <div className="universe-drawer-head-info">
          <div className="universe-drawer-eyebrow">
            <span className="universe-drawer-dot" style={{ background: node.color || '#ffa500' }} />
            <span className="t-eyebrow">{KIND_LABELS[node.kind] || node.kind || 'Node'}</span>
          </div>
          <div className="universe-drawer-id">{node.id || node.node_id}</div>
        </div>
        <button className="universe-drawer-x" onClick={onClose} aria-label="Close">×</button>
      </header>
      <div className="universe-drawer-body">
        {node.kind !== 'user' && (
          <div className="universe-drawer-row">
            <div className="t-eyebrow">{node.kind === 'ws' ? 'Workspace ID' : 'Workspace'}</div>
            <div className="universe-drawer-mono">{node.workspace_id || '—'}</div>
          </div>
        )}
        <div className="universe-drawer-row">
          <div className="t-eyebrow">{createdLabel(node)}</div>
          <div className="t-body">{fmtDateTime(node.created_at) || '—'}</div>
        </div>
        {canIsolate && (
          <button
            type="button"
            className={`universe-drawer-action ${isolated ? 'is-active' : ''}`}
            onClick={() => onIsolate(isolated ? null : node.workspace_id)}
          >
            {isolated ? 'Show the whole universe' : 'Isolate this workspace'}
          </button>
        )}
        <div className="universe-drawer-note t-meta">
          Content and titles are intentionally hidden in this view.
        </div>
      </div>
    </aside>
  );
}

// The original Universe view — unchanged behavior, just extracted so the shell
// can swap it with the Command Center.
// Exported so the dev preview harness renders THIS, not a copy of it.
//
// The harness used to reimplement the view — ticker, graph, legend, reset
// button — which meant every feature added here had to be added there too, and
// the one time that was forgotten the "faithful replica" quietly stopped being
// one. `dataSource` swaps the party endpoints for the synthetic corpus and
// `statsOverride` stands in for the SSE counters the harness has no server for;
// production passes neither.
export function UniverseView({ dataSource = null, statsOverride = null, onPick = null }) {
  const live = useUniverseStats();
  const stats  = statsOverride || live.stats;
  const error  = statsOverride ? null : live.error;
  const status = statsOverride ? 'live' : live.status;
  const [active, setActive] = useState(null);
  // What the renderer actually drew — the only honest source for "how big is
  // the thing on screen". See the note in AdminUniverseTicker.
  const [graph, setGraph] = useState(null);
  // Incrementing this triggers an animated "fit everything" pull-back
  // inside UniverseGraph.
  const [resetSignal, setResetSignal] = useState(0);
  const [hiddenKinds, setHiddenKinds] = useState(() => new Set());
  const [isolateWs, setIsolateWs] = useState(null);
  const [focusRequest, setFocusRequest] = useState(null);
  const [stream, setStream] = useState({ status: 'connecting', lastDeltaAt: null });
  const [arrivals, pushArrival] = useArrivals();

  // What people are DOING, as opposed to what they have made. Creation lands
  // about once every twenty minutes; board-scoped activity is several times an
  // hour, and during a real work session far more than that. Without this layer
  // a correctly-working universe is motionless almost all of the time.
  const pulse = useActivityPulse();

  // Stable identities: UniverseGraph keeps handlers in refs, but an unstable
  // prop would still churn the effect that syncs it on every render.
  const onStats   = useCallback((s) => setGraph(s), []);
  const onSelect  = useCallback((n) => { setActive(n); onPick?.(n); }, [onPick]);
  const onArrival = useCallback((n) => pushArrival(n), []);   // eslint-disable-line react-hooks/exhaustive-deps
  const onStream  = useCallback((s) => setStream(s), []);
  const onFocus   = useCallback((id) => setFocusRequest((p) => ({ id, nonce: (p?.nonce || 0) + 1 })), []);

  const toggleKind = useCallback((key) => {
    setHiddenKinds((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);
  const showAll = useCallback(() => setHiddenKinds(new Set()), []);

  // The counter stream and the delta stream are separate sockets. Either being
  // down means the HUD is not telling the truth, so the worse of the two wins.
  const health = useMemo(
    () => (status === 'reconnecting' || stream.status === 'reconnecting' ? 'reconnecting'
      : status === 'live' ? 'live' : 'connecting'),
    [status, stream.status],
  );

  return (
    <>
      <AdminUniverseTicker stats={stats} graph={graph} error={error} status={health} />
      <UniverseGraph
        dataSource={dataSource}
        onNodeClick={onSelect}
        resetSignal={resetSignal}
        onStats={onStats}
        onArrival={onArrival}
        onStream={onStream}
        focusRequest={focusRequest}
        hiddenKinds={hiddenKinds}
        isolateWorkspaceId={isolateWs}
        selectedId={active?.id || null}
        activity={pulse.recent}
      />
      <UniverseLegend graph={graph} hiddenKinds={hiddenKinds}
                      onToggleKind={toggleKind} onShowAll={showAll} />
      <UniverseArrivals items={arrivals} onFocus={onFocus} streamStatus={health} pulse={pulse} />
      <div className="universe-controls">
        {isolateWs && (
          <button className="universe-reset-btn is-active" onClick={() => setIsolateWs(null)}
                  title="Stop isolating this workspace">
            Isolated · clear
          </button>
        )}
        <button
          className="universe-reset-btn"
          onClick={() => setResetSignal((n) => n + 1)}
          title="Reset view"
          aria-label="Reset view"
        >
          Reset view
        </button>
      </div>
      <UniverseDrawer node={active} onClose={() => setActive(null)}
                      isolated={!!isolateWs && isolateWs === active?.workspace_id}
                      onIsolate={setIsolateWs} />
    </>
  );
}

const SUBTAB_KEY = 'admin.universe.view';

function readInitialView() {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('view');
    if (fromUrl === 'command' || fromUrl === 'universe') return fromUrl;
    const stored = window.localStorage.getItem(SUBTAB_KEY);
    if (stored === 'command' || stored === 'universe') return stored;
  } catch (_) { /* ignore */ }
  return 'universe';
}

export function AdminUniverseTab() {
  const [view, setView] = useState(readInitialView);

  const selectView = (v) => {
    setView(v);
    try {
      window.localStorage.setItem(SUBTAB_KEY, v);
      const url = new URL(window.location.href);
      url.searchParams.set('view', v);
      window.history.replaceState({}, '', url);
    } catch (_) { /* ignore */ }
  };

  return (
    <div className="universe-tab">
      <div className="universe-subtabs" role="tablist" aria-label="Universe views">
        <button
          role="tab"
          aria-selected={view === 'universe'}
          className={`universe-subtab ${view === 'universe' ? 'is-active' : ''}`}
          onClick={() => selectView('universe')}
        >
          Universe
        </button>
        <button
          role="tab"
          aria-selected={view === 'command'}
          className={`universe-subtab ${view === 'command' ? 'is-active' : ''}`}
          onClick={() => selectView('command')}
        >
          Command Center
        </button>
      </div>

      {/* Remount on switch (key) so each view owns a clean UniverseGraph lifecycle. */}
      {view === 'universe'
        ? <UniverseView key="universe" />
        : <AdminCommandCenter key="command" />}
    </div>
  );
}
