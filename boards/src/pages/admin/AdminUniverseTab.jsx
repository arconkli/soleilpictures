// AdminUniverseTab — top-level admin landing surface. Floating
// stats pill at the top; 3D force-graph (same renderer as the
// per-workspace HomeGraph) fills the viewport. Clicking a node
// opens a minimal drawer with IDs + counts only (no titles or
// content — privacy contract is enforced by the snapshot RPC).

import { useState } from 'react';
import { AdminUniverseTicker } from './AdminUniverseTicker.jsx';
import { UniverseGraph } from './UniverseGraph.jsx';
import { useUniverseStats } from './useUniverseStream.js';

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

function shortTs(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString();
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
          <div className="t-eyebrow">Created</div>
          <div className="t-body">{shortTs(node.created_at)}</div>
        </div>
        <div className="universe-drawer-note t-meta">
          Content and titles are intentionally hidden in this view.
        </div>
      </div>
    </aside>
  );
}

export function AdminUniverseTab() {
  const { stats, error } = useUniverseStats();
  const [active, setActive] = useState(null);
  // Incrementing this triggers an animated "fit everything" pull-back
  // inside UniverseGraph. Lives here so the button is part of the tab
  // shell rather than the renderer.
  const [resetSignal, setResetSignal] = useState(0);

  return (
    <div className="universe-tab">
      <AdminUniverseTicker stats={stats} error={error} />
      <UniverseGraph onNodeClick={setActive} resetSignal={resetSignal} />
      <button
        className="universe-reset-btn"
        onClick={() => setResetSignal((n) => n + 1)}
        title="Reset view"
        aria-label="Reset view"
      >
        Reset view
      </button>
      <UniverseDrawer node={active} onClose={() => setActive(null)} />
    </div>
  );
}
