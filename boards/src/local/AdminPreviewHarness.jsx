// Dev-only admin preview harness (?adminpreview=1 in a DEV build — see
// isAdminPreviewMode() in ../lib/localMode.js). Renders the REAL admin tab
// components with fixture data and no auth, inside a faithful replica of the
// admin chrome (same .admin-* classes the real AdminPage uses), so the admin UI
// can be screenshotted and iterated on visually. Dynamically imported only when
// the gate is on, so it never ships to production.
//
// Universe renders the REAL <UniverseGraph> over a synthetic corpus
// (see universeQaData.js) — no realtime, no auth, any node count via
// ?n=. This is the scale test bench: ?adminpreview=1&tab=universe&
// n=200000 drives the exact production pipeline (snapshot paging,
// worker layout, disc/halo/sphere rendering) at sizes the live
// corpus hasn't reached yet.

import { useState } from 'react';
// The harness renders the tab components directly rather than through
// AdminPage, so it has to pull the admin stylesheet in itself.
import '../pages/admin/admin.css';
import { supabase } from '../lib/supabase.js';
import { installAdminPreviewMocks } from './adminFixtures.js';
import { UniverseView } from '../pages/admin/AdminUniverseTab.jsx';
import { AdminCommandCenter } from '../pages/admin/AdminCommandCenter.jsx';
import { makeSyntheticDataSource } from './universeQaData.js';
import { SoleilWordmark } from '../components/SoleilWordmark.jsx';
import { AdminAnalyticsTab } from '../pages/admin/AdminAnalyticsTab.jsx';
import { AdminUsersTab } from '../pages/admin/AdminUsersTab.jsx';
import { AdminGrantsTab } from '../pages/admin/AdminGrantsTab.jsx';
import { AdminWaitlistTab } from '../pages/admin/AdminWaitlistTab.jsx';
import { AdminFeedbackTab } from '../pages/admin/AdminFeedbackTab.jsx';
import { AdminErrorsTab } from '../pages/admin/AdminErrorsTab.jsx';
import { AdminApiTab } from '../pages/admin/AdminApiTab.jsx';
import { AdminTaggingTab } from '../pages/admin/AdminTaggingTab.jsx';

// Install the fixture shim before any tab mounts + fetches.
const MOCKS_OK = installAdminPreviewMocks(supabase);

function readQaNodeTarget() {
  try {
    const n = parseInt(new URLSearchParams(window.location.search).get('n'), 10);
    if (Number.isFinite(n)) return Math.max(100, Math.min(n, 2_000_000));
  } catch (_) { /* ignore */ }
  return 20000;
}

// Synthetic counters shaped like admin_universe_stats. The real numbers arrive
// over SSE from PartyKit, which the harness has no server for — without this
// the HUD would render zeros and the ticker couldn't be reviewed at all.
const FIXTURE_UNIVERSE_STATS = {
  total_users: 1284, total_workspaces: 640, total_boards: 1810, total_cards: 18420,
  total_links: 2140, nodes_created_24h: 96, total_seconds_in_app: 40_000_000,
  today: { users: 7, workspaces: 4, boards: 12, cards: 138, tags: 22, links: 0 },
};

// The REAL <UniverseView>, over the synthetic corpus.
//
// This used to be a hand-copied replica of that view — its own ticker, graph,
// legend and reset button. Every feature added to the real one then had to be
// added here as well, and the first time that was missed the harness stopped
// being the faithful preview it advertises itself as while still looking
// plausible. Rendering the real component is the only version of this that
// cannot drift.
function UniverseQaTab() {
  const [ds] = useState(() => {
    const source = makeSyntheticDataSource({ nodeTarget: readQaNodeTarget() });
    window.__universeQaExpected = source.totals;
    return source;
  });
  const [picked, setPicked] = useState(null);
  return (
    <div className="universe-tab">
      <UniverseView dataSource={ds} statsOverride={FIXTURE_UNIVERSE_STATS} onPick={setPicked} />
      {picked && (
        <div className="universe-qa-picked" data-testid="universe-qa-picked">
          {picked.kind} · {picked.id}
        </div>
      )}
    </div>
  );
}

// The real Command Center over fixture RPCs. Its universe backdrop is the
// synthetic corpus; the SSE-fed bottom cells stay 0 (no party server), which
// is a useful check of the null path — the renderer-fed Nodes/Connections
// cells beside them still fill in.
function CommandCenterQaTab() {
  const [ds] = useState(() => makeSyntheticDataSource({ nodeTarget: readQaNodeTarget() }));
  return (
    <div className="universe-tab">
      <AdminCommandCenter dataSource={ds} />
    </div>
  );
}

const TABS = [
  // One dashboard tab now — its four views live behind ?view= inside it.
  { id: 'overview',  label: 'Overview',  Component: AdminAnalyticsTab },
  { id: 'users',     label: 'Users',     Component: AdminUsersTab },
  { id: 'grants',    label: 'Grants',    Component: AdminGrantsTab },
  { id: 'waitlist',  label: 'Waitlist',  Component: AdminWaitlistTab },
  { id: 'feedback',  label: 'Feedback',  Component: AdminFeedbackTab },
  { id: 'errors',    label: 'Errors',    Component: AdminErrorsTab },
  { id: 'api',       label: 'API',       Component: AdminApiTab },
  { id: 'tagging',   label: 'Tagging',   Component: AdminTaggingTab },
  { id: 'universe',  label: 'Universe',  Component: UniverseQaTab },
  { id: 'command',   label: 'Command',   Component: CommandCenterQaTab },
];

function initialTab() {
  try {
    const t = new URLSearchParams(window.location.search).get('tab');
    if (t && TABS.some((x) => x.id === t)) return t;
  } catch (_) { /* ignore */ }
  return 'overview';
}

export function AdminPreviewHarness() {
  const [tab, setTab] = useState(initialTab);
  const [light, setLight] = useState(false);

  const toggleTheme = () => {
    setLight((v) => {
      const next = !v;
      try { document.documentElement.dataset.theme = next ? 'light' : ''; } catch (_) {}
      return next;
    });
  };

  const active = TABS.find((t) => t.id === tab);
  const Component = active?.Component;

  if (!MOCKS_OK) {
    return (
      <div style={{ padding: 40, font: '500 14px/1.6 system-ui', color: '#ddd', background: '#0a0a0c', minHeight: '100vh' }}>
        <strong style={{ color: '#ffa500' }}>Admin preview unavailable.</strong>
        <p>The Supabase client is null — set <code>VITE_SUPABASE_URL</code> + a publishable/anon key in <code>boards/.env</code> so the harness has a client instance to mock, then reload <code>?adminpreview=1</code>.</p>
      </div>
    );
  }

  return (
    <div className="admin-screen">
      <header className="admin-header">
        <SoleilWordmark size="block" />
        <div className="admin-tabs" role="tablist" aria-label="Admin sections">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              className={`admin-tab ${tab === t.id ? 'is-active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="admin-header-right">
          <span className="t-meta" style={{ color: 'var(--ink-3)' }}>preview · fixtures</span>
          <button className="auth-link" onClick={toggleTheme}>{light ? 'Dark' : 'Light'}</button>
        </div>
      </header>

      <main className={`admin-body ${tab === 'universe' || tab === 'command' ? 'admin-body-flush' : ''}`}>
        {Component ? <Component /> : null}
      </main>
    </div>
  );
}
