// AdminPage — /admin. Visible only to tier='admin'. Tabs:
//   • Universe  — anonymous, real-time graph of every node every user
//                 has created across the platform, with a stats ticker
//   • Overview  — the dashboard: Today / Funnel / Retention / System
//                 (AdminAnalyticsTab). This used to be two tabs, Overview and
//                 Analytics, which both led with total users, signups and MRR
//                 and disagreed about which was authoritative.
//   • Users     — paginated list with tier mutation buttons
//   • Grants    — issue / revoke time-bound paid access
//   • Waitlist  — pending entries with Accept now / Reject / Reschedule
//   • Feedback  — in-app feedback submissions
//   • Errors    — first-party client-side error logs (client_errors)
//   • API       — /api/v1 + MCP traffic: tools, routes, callers, failures
//   • Tagging   — embeddings tagger quality audit
//
// Opens on Overview (fast) and remembers the active tab in the URL
// (?tab=) + localStorage, so a reload / back / shared link returns to the
// operator's tab instead of remounting the heavy WebGL Universe graph.

import { useCallback, useEffect, useRef, useState } from 'react';
import './admin/admin.css';
import { useAuth } from '../auth/AuthGate.jsx';
import { useMyTier } from '../hooks/useMyTier.js';
import { useFeedback } from '../components/AppFeedback.jsx';
import { SoleilWordmark } from '../components/SoleilWordmark.jsx';
import { EmptyState } from '../components/EmptyState.jsx';
import { Lock } from '../lib/icons.js';
import { AdminError } from './admin/AdminStates.jsx';
import { AdminUniverseTab } from './admin/AdminUniverseTab.jsx';
import { AdminAnalyticsTab } from './admin/AdminAnalyticsTab.jsx';
import { AdminUsersTab } from './admin/AdminUsersTab.jsx';
import { AdminGrantsTab } from './admin/AdminGrantsTab.jsx';
import { AdminCampaignTab } from './admin/AdminCampaignTab.jsx';
import { AdminDiscoverTab } from './admin/AdminDiscoverTab.jsx';
import { AdminApprovalsTab } from './admin/AdminApprovalsTab.jsx';
import { AdminTemplatesTab } from './admin/AdminTemplatesTab.jsx';
import { AdminWaitlistTab } from './admin/AdminWaitlistTab.jsx';
import { AdminFeedbackTab } from './admin/AdminFeedbackTab.jsx';
import { AdminErrorsTab } from './admin/AdminErrorsTab.jsx';
import { AdminApiTab } from './admin/AdminApiTab.jsx';
import { AdminScoutTab } from './admin/AdminScoutTab.jsx';
import { AdminEmailsTab } from './admin/AdminEmailsTab.jsx';
import { AdminTaggingTab } from './admin/AdminTaggingTab.jsx';
import { AdminMoreMenu } from './admin/AdminMoreMenu.jsx';
import { FeedbackButton } from '../components/FeedbackButton.jsx';
import { AdminPhoneGate } from './admin/AdminPhoneGate.jsx';
import { useBreakpoint } from '../hooks/useBreakpoint.js';
import { adminPublicBoardSubmissionCounts } from '../lib/boardsApi.js';

// Overview and Analytics were two tabs showing the same numbers: both led with
// total users, signups and MRR, and neither was authoritative. They are one tab
// now, with four question-shaped views inside it (Today / Funnel / Retention /
// System) — see AdminAnalyticsTab.
const TABS = [
  { id: 'overview',  label: 'Overview' },
  { id: 'users',     label: 'Users' },
  { id: 'grants',    label: 'Grants' },
  { id: 'campaign',  label: 'Campaign' },
  { id: 'discover',  label: 'Discover' },
  { id: 'approvals', label: 'Approvals' },
  { id: 'templates', label: 'Templates' },
  { id: 'waitlist',  label: 'Waitlist' },
  { id: 'feedback',  label: 'Feedback' },
  { id: 'errors',    label: 'Errors' },
  { id: 'api',       label: 'API' },
  { id: 'scout',     label: 'Scout' },
  { id: 'emails',    label: 'Emails' },
  { id: 'tagging',   label: 'Tagging' },
  { id: 'universe',  label: 'Universe' },
];
const TAB_IDS = TABS.map((t) => t.id);
const STORAGE_KEY = 'admin.tab';

// The header shows only the daily/frequent sections as pills; the rarely-touched
// long tail folds into a single "More" overflow so the bar isn't 11 items wide.
// PRIMARY_IDS is the one knob — reorder/trim it and the overflow recomputes.
const PRIMARY_IDS = ['overview', 'users', 'approvals', 'waitlist'];
// Overflow order is triage-first, then rare/config, split by a single divider.
const OVERFLOW_IDS = ['discover', 'templates', 'feedback', 'errors', 'api', 'scout', 'emails', 'grants', 'campaign', 'tagging', 'universe'];
const OVERFLOW_SEP_AFTER = 'grants';      // divider between triage and rare-config
const HEAVY_IDS = new Set(['universe']);  // heaviest to mount → flagged in the menu

const labelOf = (id) => TABS.find((t) => t.id === id)?.label || id;
const PRIMARY_TABS = PRIMARY_IDS.map((id) => TABS.find((t) => t.id === id)).filter(Boolean);
const OVERFLOW_ITEMS = OVERFLOW_IDS.map((id) => ({
  id,
  label: labelOf(id),
  heavy: HEAVY_IDS.has(id),
  sepAfter: id === OVERFLOW_SEP_AFTER,
}));

// Tabs that have been merged away. Old deep links and persisted prefs land on
// the tab that absorbed them rather than dead-ending: 'funnel' folded into
// Analytics in an earlier pass, and Analytics has now folded into Overview.
const TAB_ALIASES = { funnel: 'overview', analytics: 'overview' };

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
  // Pending public-board requests, surfaced as a badge on the Approvals tab so
  // an operator notices submissions without opening the tab. Seeded once when
  // tier resolves; the Approvals tab keeps it fresh after each review.
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const { isPhone } = useBreakpoint();
  const tabRefs = useRef([]);
  const moreTriggerRef = useRef(null);

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

  // Rewrite a retired ?tab= deep link to the tab that absorbed it, once on
  // mount, so the URL in the address bar matches what is actually rendered.
  // The sub-view is left alone — AdminAnalyticsTab has its own alias table and
  // knows which of its four views an old ?view= belongs to.
  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      const from = url.searchParams.get('tab');
      const to = from && TAB_ALIASES[from];
      if (!to) return;
      url.searchParams.set('tab', to);
      window.history.replaceState({}, '', url);
      window.localStorage.setItem(STORAGE_KEY, to);
    } catch { /* ignore */ }
  }, []);

  // Seed the Approvals badge once tier resolves to admin (the tab itself keeps
  // it live after each approve/reject via onCountsChange).
  useEffect(() => {
    if (tier !== 'admin') return undefined;
    let cancelled = false;
    adminPublicBoardSubmissionCounts()
      .then((c) => { if (!cancelled) setPendingApprovals(c?.pending ?? 0); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [tier]);

  // Roving focus spans the VISIBLE controls only — the primary pills plus the
  // More trigger at index PRIMARY_TABS.length. Selection follows focus for the
  // real tabs; arrowing onto the More trigger just moves focus (Enter/↓ opens
  // its menu), so we never auto-activate an overflow section from the bar.
  const focusVisible = (i) => {
    if (i < PRIMARY_TABS.length) tabRefs.current[i]?.focus();
    else moreTriggerRef.current?.focus();
  };
  const onTabKeyDown = (e, idx) => {
    const last = PRIMARY_TABS.length; // the More trigger
    let next = null;
    if (e.key === 'ArrowRight') next = idx >= last ? 0 : idx + 1;
    else if (e.key === 'ArrowLeft') next = idx <= 0 ? last : idx - 1;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = last;
    if (next == null) return;
    e.preventDefault();
    if (next < last) selectTab(PRIMARY_TABS[next].id);
    focusVisible(next);
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

  // Where roving focus's tabIndex=0 lives: the active primary pill, or — when
  // the active section is buried in More — the trigger (last visible control).
  const overflowActive = OVERFLOW_IDS.includes(tab);
  const activePrimaryIdx = PRIMARY_TABS.findIndex((t) => t.id === tab);
  const activeVisibleIdx = overflowActive
    ? PRIMARY_TABS.length
    : (activePrimaryIdx >= 0 ? activePrimaryIdx : 0);

  return (
    <div className="admin-screen">
      <header className="admin-header">
        <SoleilWordmark size="block" />
        <div className="admin-tabs" role="tablist" aria-label="Admin sections">
          {PRIMARY_TABS.map((t, i) => (
            <button key={t.id}
                    ref={(el) => { tabRefs.current[i] = el; }}
                    role="tab"
                    aria-selected={tab === t.id}
                    tabIndex={activeVisibleIdx === i ? 0 : -1}
                    className={`admin-tab ${tab === t.id ? 'is-active' : ''}`}
                    onClick={() => selectTab(t.id)}
                    onKeyDown={(e) => onTabKeyDown(e, i)}>
              {t.label}
              {t.id === 'approvals' && pendingApprovals > 0 && (
                <span className="admin-tab-badge" aria-label={`${pendingApprovals} pending`}>{pendingApprovals}</span>
              )}
            </button>
          ))}
          <AdminMoreMenu
            items={OVERFLOW_ITEMS}
            activeId={tab}
            isActive={overflowActive}
            activeLabel={labelOf(tab)}
            onSelect={selectTab}
            rovingTabIndex={activeVisibleIdx === PRIMARY_TABS.length ? 0 : -1}
            onTriggerKeyDown={(e) => onTabKeyDown(e, PRIMARY_TABS.length)}
            triggerRef={moreTriggerRef}
          />
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
        {tab === 'overview'  && <AdminAnalyticsTab />}
        {tab === 'users'     && <AdminUsersTab />}
        {tab === 'grants'    && <AdminGrantsTab />}
        {tab === 'campaign'  && <AdminCampaignTab />}
        {tab === 'discover'  && <AdminDiscoverTab />}
        {tab === 'approvals' && <AdminApprovalsTab onCountsChange={(c) => setPendingApprovals(c?.pending ?? 0)} />}
        {/* A takedown surface, not a queue — so no pending-count badge. */}
        {tab === 'templates' && <AdminTemplatesTab />}
        {tab === 'waitlist'  && <AdminWaitlistTab />}
        {tab === 'feedback'  && <AdminFeedbackTab />}
        {tab === 'scout'     && <AdminScoutTab />}
        {tab === 'errors'    && <AdminErrorsTab />}
        {tab === 'api'       && <AdminApiTab />}
        {tab === 'emails'    && <AdminEmailsTab />}
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
