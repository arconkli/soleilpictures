// AdminUniverseTab — the admin Universe surface. Two subtabs share the same
// shell:
//   • "Universe"        — the original full-screen 3D force-graph (unchanged):
//                          floating stats pill + graph + reset + node drawer.
//   • "Command Center"  — a big-screen business-metrics wall that keeps the live
//                          universe as the centerpiece and frames it with graphs.
// The graph renderer + privacy contract (IDs/counts only, no titles/content) are
// untouched; the Command Center only *reuses* <UniverseGraph>.

import { useCallback, useState } from 'react';
import { AdminUniverseTicker } from './AdminUniverseTicker.jsx';
import { UniverseGraph } from './UniverseGraph.jsx';
import { UniverseLegend } from './UniverseLegend.jsx';
import { useUniverseStats } from './useUniverseStream.js';
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

function UniverseDrawer({ node, onClose }) {
  if (!node) return null;
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
        <div className="universe-drawer-note t-meta">
          Content and titles are intentionally hidden in this view.
        </div>
      </div>
    </aside>
  );
}

// The original Universe view — unchanged behavior, just extracted so the shell
// can swap it with the Command Center.
function UniverseView() {
  const { stats, error } = useUniverseStats();
  const [active, setActive] = useState(null);
  // What the renderer actually drew — the only honest source for "how big is
  // the thing on screen". See the note in AdminUniverseTicker.
  const [graph, setGraph] = useState(null);
  // Incrementing this triggers an animated "fit everything" pull-back
  // inside UniverseGraph.
  const [resetSignal, setResetSignal] = useState(0);

  // Stable identity: UniverseGraph keeps the handler in a ref, but an unstable
  // prop would still churn the effect that syncs it on every render.
  const onStats = useCallback((s) => setGraph(s), []);

  return (
    <>
      <AdminUniverseTicker stats={stats} graph={graph} error={error} />
      <UniverseGraph onNodeClick={setActive} resetSignal={resetSignal} onStats={onStats} />
      <UniverseLegend graph={graph} />
      <button
        className="universe-reset-btn"
        onClick={() => setResetSignal((n) => n + 1)}
        title="Reset view"
        aria-label="Reset view"
      >
        Reset view
      </button>
      <UniverseDrawer node={active} onClose={() => setActive(null)} />
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
