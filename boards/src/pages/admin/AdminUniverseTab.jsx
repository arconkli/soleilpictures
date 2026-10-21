// AdminUniverseTab — the admin Universe surface. Two subtabs share the same
// shell:
//   • "Universe"        — the original full-screen 3D force-graph (unchanged):
//                          floating stats pill + graph + reset + node drawer.
//   • "Command Center"  — a big-screen business-metrics wall that keeps the live
//                          universe as the centerpiece and frames it with graphs.
// The graph renderer + privacy contract (IDs/counts only, no titles/content) are
// untouched; the Command Center only *reuses* <UniverseGraph>.

import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { AdminUniverseTicker } from './AdminUniverseTicker.jsx';
import { UniverseGraph } from './UniverseGraph.jsx';
import { UniverseLegend } from './UniverseLegend.jsx';
import { useUniverseStats } from './useUniverseStream.js';
import { useActivityPulse } from './useActivityPulse.js';
// Lazy, and for one specific reason: the Command Center is the last consumer of
// Recharts in the app. Every other chart on the admin surface is now plain SVG,
// so a static import here would keep ~136KB gzipped of charting library in the
// admin bundle to serve one wall display that is opened deliberately. This
// splits it into its own chunk that loads when someone asks for it.
//
// The Command Center itself is untouched — it is a different design language on
// purpose and the owner likes it as it is.
const AdminCommandCenter = lazy(() =>
  import('./AdminCommandCenter.jsx').then((m) => ({ default: m.AdminCommandCenter })));
import { fmtDateTime } from '../../lib/adminFormat.js';
import { directorText } from '../../lib/universeMoments.js';

const KIND_LABELS = {
  user:  'User',
  ws:    'Workspace',
  board: 'Cluster',
  doc:   'Doc',
  note:  'Note',
  image: 'Image',
  palette: 'Palette',
  link:  'Link',
  grid:  'Grid',
  boardlink: 'Linked cluster',
  card:  'Card',
  url:   'External link',
};

// What the picked thing is, in the interface's words. A card is named by its
// own kind (it used to read "Card" whatever it was), a workspace's top-level
// cluster is its Studio, and a nested cluster's card is not the cluster.
function kindLabel(node) {
  if (node.kind === 'board') return node.studio ? 'Studio' : 'Cluster';
  if (node.cardKind === 'board') return 'Cluster card';
  return KIND_LABELS[node.cardKind] || KIND_LABELS[node.kind] || node.cardKind || node.kind || 'Node';
}

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
            <span className="t-eyebrow">{kindLabel(node)}</span>
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

// ── Live: the director, its caption, and the key to the light ────────────
// The owner's pick (2026-10-21): B, "a director", which is A (the wide view,
// with every moment lit where it happens) plus a camera that goes to each
// moment and says what it was. The switch takes the director away and leaves
// exactly A. It is remembered per browser, on by default.
const DIRECTOR_KEY = 'admin.universe.director';

function readDirector() {
  try { if (window.localStorage.getItem(DIRECTOR_KEY) === '0') return false; } catch (_) { /* ignore */ }
  return true;
}

function UniverseDirector({ on, status, onToggle, onResume }) {
  const available = status?.available !== false;
  const pausedUntil = status?.pausedUntil || 0;
  const [now, setNow] = useState(() => performance.now());
  // The countdown in "back in 42 s" moves once a second, and only while it shows.
  useEffect(() => {
    setNow(performance.now());
    if (!on || !Number.isFinite(pausedUntil) || pausedUntil <= performance.now()) return undefined;
    const id = setInterval(() => setNow(performance.now()), 1000);
    return () => clearInterval(id);
  }, [on, pausedUntil, status]);
  const paused = on && available && pausedUntil > now;
  const text = directorText({ mode: 'wide', label: '', pausedUntil: 0, ...status, on, available }, now);
  const live = on && available && !paused;
  return (
    <div className="universe-dir">
      <span className={`universe-dir-dot${live ? ' is-on' : ''}`} aria-hidden="true" />
      <span className="universe-dir-text">{text}</span>
      {paused && (
        <button type="button" className="universe-dir-resume" onClick={onResume}>Resume</button>
      )}
      <button
        type="button"
        role="switch"
        aria-checked={on && available}
        aria-label="Director"
        disabled={!available}
        className="universe-dir-switch"
        onClick={onToggle}
        title={!available
          ? 'Your system asks for reduced motion, so the camera stays still. Every moment still lights up where it happens.'
          : on ? 'Turn the director off: the same moments, in the wide view'
            : 'Turn the director on: the camera goes to each moment and says what it was'}
      >
        <span className="universe-dir-knob" aria-hidden="true" />
      </button>
    </div>
  );
}

// The caption keeps its last words while it fades out, so it never empties
// before it has gone.
function UniverseCaption({ caption }) {
  const [shown, setShown] = useState(caption);
  useEffect(() => { if (caption) setShown(caption); }, [caption]);
  return (
    <div className={`universe-cap${caption ? ' is-on' : ''}`} aria-live="polite" aria-atomic="true">
      {shown && (
        <>
          <span className="universe-cap-e">{shown.e}</span>
          <span className="universe-cap-l">{shown.l}</span>
          <span className="universe-cap-m">{shown.m}</span>
        </>
      )}
    </div>
  );
}

// The key to the moments' light, drawn as each one is drawn in the scene.
const MOMENT_KEY = [
  {
    label: 'Making', small: "in the card's colour",
    icon: (
      <>
        <circle cx="9" cy="9" r="2.4" fill="#a48cf0" />
        <circle cx="9" cy="9" r="6.5" fill="none" stroke="#a48cf0" strokeWidth="1.2" opacity=".7" />
        <path d="M9 0.5v2.4M9 15.1v2.4M0.5 9h2.4M15.1 9h2.4" stroke="#ff9a7d" strokeWidth="1.2" strokeLinecap="round" />
      </>
    ),
  },
  {
    label: 'Here now',
    icon: (
      <>
        <circle cx="9" cy="9" r="7.5" fill="#fff4d8" opacity=".16" />
        <circle cx="9" cy="9" r="4.2" fill="#fff4d8" opacity=".3" />
        <circle cx="9" cy="9" r="1.6" fill="#fff4d8" />
      </>
    ),
  },
  {
    label: 'New account',
    icon: <path d="M9 1.2L10.1 7.9L16.8 9L10.1 10.1L9 16.8L7.9 10.1L1.2 9L7.9 7.9Z" fill="#ffd06b" />,
  },
  {
    label: 'Together', small: 'invites, shared work',
    icon: (
      <>
        <path d="M2 14C4 4 14 4 16 14" fill="none" stroke="#bfe3ff" strokeWidth="1.3" strokeLinecap="round" />
        <circle cx="2" cy="14" r="1.8" fill="#bfe3ff" />
        <circle cx="16" cy="14" r="1.8" fill="#bfe3ff" />
      </>
    ),
  },
  {
    label: 'Visiting', small: 'public pages',
    icon: (
      <>
        <path d="M1.5 3.5L13 12.5" stroke="#a9c2ee" strokeWidth="1.3" strokeLinecap="round" opacity=".55" />
        <circle cx="13.5" cy="13" r="2" fill="#dbe7ff" />
      </>
    ),
  },
];

function UniverseMomentsKey() {
  return (
    <div className="universe-key" role="list" aria-label="What the light means">
      {MOMENT_KEY.map((k) => (
        <span className="universe-key-item" role="listitem" key={k.label}>
          <svg viewBox="0 0 18 18" aria-hidden="true">{k.icon}</svg>
          {k.label}
          {k.small && <small>{k.small}</small>}
        </span>
      ))}
    </div>
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
  // Legend row under the pointer — that kind renders its true hue.
  const [hueKind, setHueKind] = useState(null);
  const [isolateWs, setIsolateWs] = useState(null);
  const [stream, setStream] = useState({ status: 'connecting', lastDeltaAt: null });
  const [director, setDirector] = useState(readDirector);
  const [directorStatus, setDirectorStatus] = useState(null);
  const [resumeSignal, setResumeSignal] = useState(0);

  // What people are DOING, as opposed to what they have made. Creation lands
  // about once every twenty minutes; board-scoped activity is several times an
  // hour, and during a real work session far more than that. Without this layer
  // a correctly-working universe is motionless almost all of the time.
  //
  // Feeds the in-scene moments (universeMomentEngine.js). There was briefly a
  // floating panel listing recent arrivals here too; it spent almost all of its
  // time saying nothing had happened, which is a lot of screen furniture to
  // spend on a non-event. Moments announce themselves in the scene instead, and
  // the director, when it is on, says in words what each one was.
  const pulse = useActivityPulse();

  // Stable identities: UniverseGraph keeps handlers in refs, but an unstable
  // prop would still churn the effect that syncs it on every render.
  const onStats   = useCallback((s) => setGraph(s), []);
  const onSelect  = useCallback((n) => { setActive(n); onPick?.(n); }, [onPick]);
  const onStream  = useCallback((s) => setStream(s), []);
  const onDirector = useCallback((s) => setDirectorStatus(s), []);
  const toggleDirector = useCallback(() => {
    const next = !director;
    setDirector(next);
    try { window.localStorage.setItem(DIRECTOR_KEY, next ? '1' : '0'); } catch (_) { /* ignore */ }
  }, [director]);
  const resumeDirector = useCallback(() => setResumeSignal((n) => n + 1), []);

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
        onStream={onStream}
        hiddenKinds={hiddenKinds}
        hueKind={hueKind}
        isolateWorkspaceId={isolateWs}
        selectedId={active?.id || null}
        activity={pulse.recent}
        moments
        director={director}
        onDirector={onDirector}
        resumeSignal={resumeSignal}
      />
      <UniverseLegend graph={graph} hiddenKinds={hiddenKinds} onHoverKind={setHueKind}
                      onToggleKind={toggleKind} onShowAll={showAll} />
      <UniverseMomentsKey />
      {director && <UniverseCaption caption={directorStatus?.caption || null} />}
      <UniverseDirector on={director} status={directorStatus}
                        onToggle={toggleDirector} onResume={resumeDirector} />
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
        : (
          <Suspense fallback={<div className="admin-empty">Loading Command Center…</div>}>
            <AdminCommandCenter key="command" />
          </Suspense>
        )}
    </div>
  );
}
