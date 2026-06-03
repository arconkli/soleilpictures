// AdminPage — /admin. Visible only to tier='admin'. Tabs:
//   • Universe  — anonymous, real-time graph of every node every user
//                 has created across the platform, with a stats ticker
//   • Overview  — KPIs + signups bar + tier-distribution pie + waitlist funnel
//   • Analytics — deeper analytics
//   • Users     — paginated list with tier mutation buttons
//   • Grants    — issue / revoke time-bound paid access
//   • Waitlist  — pending entries with Accept now / Reject / Reschedule
//   • Feedback  — in-app feedback submissions
//   • Errors    — first-party client-side error logs (client_errors)
//   • Tagging   — embeddings tagger quality audit
//
// Opens on Overview (fast) and remembers the active tab in the URL
// (?tab=) + localStorage, so a reload / back / shared link returns to the
// operator's tab instead of remounting the heavy WebGL Universe graph.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthGate.jsx';
import { useMyTier } from '../hooks/useMyTier.js';
import { useFeedback } from '../components/AppFeedback.jsx';
import { SoleilWordmark } from '../components/SoleilWordmark.jsx';
import { EmptyState } from '../components/EmptyState.jsx';
import { Lock } from '../lib/icons.js';
import { AdminError } from './admin/AdminStates.jsx';
import { AdminUniverseTab } from './admin/AdminUniverseTab.jsx';
import { AdminOverviewTab } from './admin/AdminOverviewTab.jsx';
import { AdminAnalyticsTab } from './admin/AdminAnalyticsTab.jsx';
import { AdminUsersTab } from './admin/AdminUsersTab.jsx';
import { AdminGrantsTab } from './admin/AdminGrantsTab.jsx';
import { AdminWaitlistTab } from './admin/AdminWaitlistTab.jsx';
import { AdminFeedbackTab } from './admin/AdminFeedbackTab.jsx';
import { AdminErrorsTab } from './admin/AdminErrorsTab.jsx';
import { AdminTaggingTab } from './admin/AdminTaggingTab.jsx';
import { FeedbackButton } from '../components/FeedbackButton.jsx';
import { AdminPhoneGate } from './admin/AdminPhoneGate.jsx';
import { useBreakpoint } from '../hooks/useBreakpoint.js';

const TABS = [
  { id: 'overview',  label: 'Overview' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'users',     label: 'Users' },
  { id: 'grants',    label: 'Grants' },
  { id: 'waitlist',  label: 'Waitlist' },
  { id: 'feedback',  label: 'Feedback' },
  { id: 'errors',    label: 'Errors' },
  { id: 'tagging',   label: 'Tagging' },
  { id: 'universe',  label: 'Universe' },
];
const TAB_IDS = TABS.map((t) => t.id);
const STORAGE_KEY = 'admin.tab';

// The 'funnel' tab was merged into Analytics (now the Overview sub-tab). Old
// deep links and persisted prefs alias to 'analytics' so they don't dead-end.
const TAB_ALIASES = { funnel: 'analytics' };

// Restore the last tab from ?tab= (preferred — survives deep links), then
// localStorage, then default to the fast Overview tab.
function initialTab() {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('tab');
    if (fromUrl && TAB_ALIASES[fromUrl]) return TAB_ALIASES[fromUrl];
    if (fromUrl && TAB_IDS.includes(fromUrl)) return fromUrl;
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored && TAB_ALIASES[stored]) return TAB_ALIASES[stored];
    if (stored && TAB_IDS.includes(stored)) return stored;
  } catch { /* ignore */ }
  return 'overview';
}

export function AdminPage() {
  const { user, signOut } = useAuth();
  const { tier, loading, error, refetch } = useMyTier({ userId: user?.id });
  const feedback = useFeedback();
  const [tab, setTab] = useState(initialTab);
  const [signingOut, setSigningOut] = useState(false);
  const { isPhone } = useBreakpoint();
  const tabRefs = useRef([]);

  // Persist tab to ?tab= (path stays /admin, so TierRouter does not
  // remount) + localStorage.
  const selectTab = useCallback((id) => {
    setTab(id);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('tab', id);
      window.history.replaceState({}, '', url);
      window.localStorage.setItem(STORAGE_KEY, id);
    } catch { /* ignore */ }
  }, []);

  // Rewrite an old ?tab=funnel deep link to the merged tab + its hero sub-tab
  // (the funnel now lives on Analytics → Overview), once on mount.
  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.get('tab') === 'funnel') {
        url.searchParams.set('tab', 'analytics');
        url.searchParams.set('view', 'overview');
        window.history.replaceState({}, '', url);
        window.localStorage.setItem(STORAGE_KEY, 'analytics');
      }
    } catch { /* ignore */ }
  }, []);

  const onTabKeyDown = (e, idx) => {
    let next = null;
    if (e.key === 'ArrowRight') next = (idx + 1) % TABS.length;
    else if (e.key === 'ArrowLeft') next = (idx - 1 + TABS.length) % TABS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = TABS.length - 1;
    if (next == null) return;
    e.preventDefault();
    selectTab(TABS[next].id);
    tabRefs.current[next]?.focus();
  };

  const onSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await signOut();
      // Success unmounts/navigates away; no need to reset state.
    } catch (e) {
      feedback.toast({ type: 'error', message: 'Sign out failed: ' + (e?.message || e) });
      setSigningOut(false);
    }
  };

  // Admin is desktop-only on phone. The dashboard's tables, analytics
  // grids, and GPU-instanced Universe graph aren't worth shrinking to
  // 375px — better to redirect than serve a broken experience.
  if (isPhone) return <AdminPhoneGate />;

  if (loading) return <Splash />;

  // tier !== 'admin' splits two ways: a genuine non-admin, or a transient
  // get_my_tier failure that left tier null. The latter must offer Retry —
  // never tell an admin "Admin only." because of a network blip.
  if (tier !== 'admin') {
    if (error) {
      return (
        <div className="welcome-screen">
          <AdminError error={error} onRetry={refetch} />
        </div>
      );
    }
    return (
      <div className="welcome-screen">
        <EmptyState
          icon={Lock}
          title="Admin only"
          body="This page is restricted to administrators."
          action={{ label: '← Back to Clusters', onClick: () => window.location.assign('/') }}
        />
      </div>
    );
  }

  return (
    <div className="admin-screen">
      <header className="admin-header">
        <SoleilWordmark size="block" />
        <div className="admin-tabs" role="tablist" aria-label="Admin sections">
          {TABS.map((t, i) => (
            <button key={t.id}
                    ref={(el) => { tabRefs.current[i] = el; }}
                    role="tab"
                    aria-selected={tab === t.id}
                    tabIndex={tab === t.id ? 0 : -1}
                    className={`admin-tab ${tab === t.id ? 'is-active' : ''}`}
                    onClick={() => selectTab(t.id)}
                    onKeyDown={(e) => onTabKeyDown(e, i)}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="admin-header-right">
          <FeedbackButton as="icon" />
          <button className="auth-link" onClick={() => { window.location.assign('/'); }}>← App</button>
          <button className="auth-link" onClick={onSignOut} disabled={signingOut}>
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      </header>

      <main className={`admin-body ${tab === 'universe' ? 'admin-body-flush' : ''}`}>
        {tab === 'universe'  && <AdminUniverseTab />}
        {tab === 'overview'  && <AdminOverviewTab />}
        {tab === 'analytics' && <AdminAnalyticsTab />}
        {tab === 'users'     && <AdminUsersTab />}
        {tab === 'grants'    && <AdminGrantsTab />}
        {tab === 'waitlist'  && <AdminWaitlistTab />}
        {tab === 'feedback'  && <AdminFeedbackTab />}
        {tab === 'errors'    && <AdminErrorsTab />}
        {tab === 'tagging'   && <AdminTaggingTab />}
      </main>
    </div>
  );
}

function Splash() {
  return (
    <div className="welcome-screen">
      <div className="welcome-card welcome-card-tight">
        <p className="welcome-copy t-body">Loading…</p>
      </div>
    </div>
  );
}
