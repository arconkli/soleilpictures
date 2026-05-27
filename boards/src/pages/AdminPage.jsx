// AdminPage — /admin. Visible only to tier='admin'. Tabs:
//   • Universe  — anonymous, real-time graph of every node every user
//                 has created across the platform, with a stats ticker
//   • Overview  — KPIs + signups bar + tier-distribution pie + waitlist funnel
//   • Analytics — deeper analytics
//   • Users     — paginated list with tier mutation buttons
//   • Waitlist  — pending entries with Accept now / Reject / Reschedule

import { useState } from 'react';
import { useAuth } from '../auth/AuthGate.jsx';
import { useMyTier } from '../hooks/useMyTier.js';
import { SoleilWordmark } from '../components/SoleilWordmark.jsx';
import { AdminUniverseTab } from './admin/AdminUniverseTab.jsx';
import { AdminOverviewTab } from './admin/AdminOverviewTab.jsx';
import { AdminAnalyticsTab } from './admin/AdminAnalyticsTab.jsx';
import { AdminUsersTab } from './admin/AdminUsersTab.jsx';
import { AdminGrantsTab } from './admin/AdminGrantsTab.jsx';
import { AdminWaitlistTab } from './admin/AdminWaitlistTab.jsx';
import { AdminFeedbackTab } from './admin/AdminFeedbackTab.jsx';
import { FeedbackButton } from '../components/FeedbackButton.jsx';
import { AdminPhoneGate } from './admin/AdminPhoneGate.jsx';
import { useBreakpoint } from '../hooks/useBreakpoint.js';

const TABS = [
  { id: 'universe',  label: 'Universe' },
  { id: 'overview',  label: 'Overview' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'users',     label: 'Users' },
  { id: 'grants',    label: 'Grants' },
  { id: 'waitlist',  label: 'Waitlist' },
  { id: 'feedback',  label: 'Feedback' },
];

export function AdminPage() {
  const { user, signOut } = useAuth();
  const { tier, loading } = useMyTier({ userId: user?.id });
  const [tab, setTab] = useState('universe');
  const { isPhone } = useBreakpoint();

  // Admin is desktop-only on phone. The dashboard's tables, analytics
  // grids, and GPU-instanced Universe graph aren't worth shrinking to
  // 375px — better to redirect than serve a broken experience.
  if (isPhone) return <AdminPhoneGate />;

  if (loading) return <Splash />;
  if (tier !== 'admin') {
    return (
      <div className="welcome-screen">
        <div className="welcome-card welcome-card-tight">
          <SoleilWordmark size="display" />
          <p className="welcome-copy t-body">Admin only.</p>
          <button className="auth-link" onClick={() => { window.location.assign('/'); }}>← Back</button>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-screen">
      <header className="admin-header">
        <SoleilWordmark size="block" />
        <div className="admin-tabs">
          {TABS.map((t) => (
            <button key={t.id}
                    className={`admin-tab ${tab === t.id ? 'is-active' : ''}`}
                    onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="admin-header-right">
          <FeedbackButton as="icon" />
          <button className="auth-link" onClick={() => { window.location.assign('/'); }}>← App</button>
          <button className="auth-link" onClick={signOut}>Sign out</button>
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
