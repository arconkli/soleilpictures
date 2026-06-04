// Dev-only admin preview harness (?adminpreview=1 in a DEV build — see
// isAdminPreviewMode() in ../lib/localMode.js). Renders the REAL admin tab
// components with fixture data and no auth, inside a faithful replica of the
// admin chrome (same .admin-* classes the real AdminPage uses), so the admin UI
// can be screenshotted and iterated on visually. Dynamically imported only when
// the gate is on, so it never ships to production.
//
// Universe is intentionally a placeholder here (it needs realtime + WebGL and
// is out of scope for the visual rework).

import { useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { installAdminPreviewMocks } from './adminFixtures.js';
import { SoleilWordmark } from '../components/SoleilWordmark.jsx';
import { AdminOverviewTab } from '../pages/admin/AdminOverviewTab.jsx';
import { AdminAnalyticsTab } from '../pages/admin/AdminAnalyticsTab.jsx';
import { AdminUsersTab } from '../pages/admin/AdminUsersTab.jsx';
import { AdminGrantsTab } from '../pages/admin/AdminGrantsTab.jsx';
import { AdminWaitlistTab } from '../pages/admin/AdminWaitlistTab.jsx';
import { AdminFeedbackTab } from '../pages/admin/AdminFeedbackTab.jsx';
import { AdminErrorsTab } from '../pages/admin/AdminErrorsTab.jsx';
import { AdminTaggingTab } from '../pages/admin/AdminTaggingTab.jsx';

// Install the fixture shim before any tab mounts + fetches.
const MOCKS_OK = installAdminPreviewMocks(supabase);

const TABS = [
  { id: 'overview',  label: 'Overview',  Component: AdminOverviewTab },
  { id: 'analytics', label: 'Analytics', Component: AdminAnalyticsTab },
  { id: 'users',     label: 'Users',     Component: AdminUsersTab },
  { id: 'grants',    label: 'Grants',    Component: AdminGrantsTab },
  { id: 'waitlist',  label: 'Waitlist',  Component: AdminWaitlistTab },
  { id: 'feedback',  label: 'Feedback',  Component: AdminFeedbackTab },
  { id: 'errors',    label: 'Errors',    Component: AdminErrorsTab },
  { id: 'tagging',   label: 'Tagging',   Component: AdminTaggingTab },
  { id: 'universe',  label: 'Universe',  Component: null },
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

      <main className="admin-body">
        {Component ? (
          <Component />
        ) : (
          <div className="admin-empty">Universe isn’t previewed here (realtime + WebGL). It’s unchanged by the rework.</div>
        )}
      </main>
    </div>
  );
}
