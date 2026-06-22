// AdminAnalyticsTab — the merged Analytics tab. Hosts five thematic sub-tabs
// (Overview / Acquisition / Engagement / Revenue / System) using the same
// pattern as AdminUniverseTab (localStorage + ?view= + key-prop remount),
// generalized to five views with arrow-key nav. The shell owns the shared,
// persistent toolbar (time range + funnel segment filters + internal-traffic
// toggle) above the keyed view content, so it never remounts on a sub-tab
// switch; each view registers its own refresh/freshness with the context so the
// single toolbar can drive it. Per-view lazy fetch (only the mounted view runs
// its RPCs) replaces the old 14-RPC-on-mount firehose.

import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import { AdminToolbar } from './AdminStates.jsx';
import { AdminTimeRange } from './AdminTimeRange.jsx';
import { AnalyticsFiltersProvider, useAnalyticsFilters } from './analytics/AnalyticsFiltersContext.jsx';
import { SegmentSelect } from './analytics/widgets/SegmentSelect.jsx';
import { OverviewView } from './analytics/views/OverviewView.jsx';
import { AcquisitionView } from './analytics/views/AcquisitionView.jsx';
import { EngagementView } from './analytics/views/EngagementView.jsx';
import { RevenueView } from './analytics/views/RevenueView.jsx';
import { SystemView } from './analytics/views/SystemView.jsx';

const VIEWS = [
  { id: 'overview',    label: 'Overview' },
  { id: 'acquisition', label: 'Acquisition' },
  { id: 'engagement',  label: 'Engagement' },
  { id: 'revenue',     label: 'Revenue' },
  { id: 'system',      label: 'System' },
];
const VIEW_IDS = VIEWS.map((v) => v.id);
const SUBTAB_KEY = 'admin.analytics.view';

function readInitialView() {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('view');
    if (fromUrl && VIEW_IDS.includes(fromUrl)) return fromUrl;
    const stored = window.localStorage.getItem(SUBTAB_KEY);
    if (stored && VIEW_IDS.includes(stored)) return stored;
  } catch { /* ignore */ }
  return 'overview';
}

function InternalToggle() {
  const f = useAnalyticsFilters();
  return (
    <button
      type="button"
      className={`admin-toggle ${f.excludeInternal ? 'is-on' : ''}`}
      role="switch"
      aria-checked={f.excludeInternal}
      onClick={() => f.setExcludeInternal(!f.excludeInternal)}
      title="Exclude or include internal / admin / test traffic in the metrics"
    >
      <span className="admin-toggle-dot" aria-hidden="true" />
      {f.excludeInternal ? 'Internal: excluded' : 'Internal: included'}
    </button>
  );
}

function VerifiedToggle() {
  const f = useAnalyticsFilters();
  return (
    <button
      type="button"
      className={`admin-toggle ${f.verifiedOnly ? 'is-on' : ''}`}
      role="switch"
      aria-checked={f.verifiedOnly}
      onClick={() => f.setVerifiedOnly(!f.verifiedOnly)}
      title="Count only verified users (email confirmed + signed in at least once), or everyone including unverified signups"
    >
      <span className="admin-toggle-dot" aria-hidden="true" />
      {f.verifiedOnly ? 'Verified only' : 'All users'}
    </button>
  );
}

function AnalyticsToolbar({ view }) {
  const f = useAnalyticsFilters();
  const showSegments = view === 'overview' || view === 'acquisition';
  const opts = (dim) => f.segments.filter((s) => s.dim === dim);
  const onRefresh = () => { f.runtime.refresh?.(); f.refreshShell?.(); };
  return (
    <AdminToolbar
      onRefresh={f.runtime.refresh ? onRefresh : null}
      refreshing={f.runtime.refreshing}
      lastUpdated={f.runtime.lastUpdated}
    >
      <AdminTimeRange value={f.days} onChange={f.setDays} />
      {showSegments && (
        <>
          <SegmentSelect label="Source"   value={f.source}   onChange={f.setSource}   options={opts('source')} />
          <SegmentSelect label="Campaign" value={f.campaign} onChange={f.setCampaign} options={opts('campaign')} />
          <SegmentSelect label="Creative" value={f.content}  onChange={f.setContent}  options={opts('content')} />
        </>
      )}
      <InternalToggle />
      <VerifiedToggle />
    </AdminToolbar>
  );
}

export function AdminAnalyticsTab() {
  const [view, setView] = useState(readInitialView);
  const tabRefs = useRef([]);

  // Seed/refresh today's snapshot once so KPI deltas have a current datapoint.
  useEffect(() => { supabase.rpc('admin_capture_metrics_now').then(() => {}, () => {}); }, []);

  const selectView = (v) => {
    setView(v);
    try {
      window.localStorage.setItem(SUBTAB_KEY, v);
      const url = new URL(window.location.href);
      url.searchParams.set('view', v);
      window.history.replaceState({}, '', url);
    } catch { /* ignore */ }
  };

  const onKey = (e, idx) => {
    let next = null;
    if (e.key === 'ArrowRight') next = (idx + 1) % VIEWS.length;
    else if (e.key === 'ArrowLeft') next = (idx - 1 + VIEWS.length) % VIEWS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = VIEWS.length - 1;
    if (next == null) return;
    e.preventDefault();
    selectView(VIEWS[next].id);
    tabRefs.current[next]?.focus();
  };

  return (
    <AnalyticsFiltersProvider>
      <div className="admin-analytics">
        <div className="admin-subtabs" role="tablist" aria-label="Analytics views">
          {VIEWS.map((v, i) => (
            <button
              key={v.id}
              ref={(el) => { tabRefs.current[i] = el; }}
              role="tab"
              aria-selected={view === v.id}
              tabIndex={view === v.id ? 0 : -1}
              className={`admin-subtab ${view === v.id ? 'is-active' : ''}`}
              onClick={() => selectView(v.id)}
              onKeyDown={(e) => onKey(e, i)}
            >
              {v.label}
            </button>
          ))}
        </div>

        <AnalyticsToolbar view={view} />

        {/* Remount by key so each view owns a clean useAdminData lifecycle and
            only the mounted view runs its RPCs. */}
        {view === 'overview'    && <OverviewView    key="overview" />}
        {view === 'acquisition' && <AcquisitionView key="acquisition" />}
        {view === 'engagement'  && <EngagementView  key="engagement" />}
        {view === 'revenue'     && <RevenueView     key="revenue" />}
        {view === 'system'      && <SystemView      key="system" />}
      </div>
    </AnalyticsFiltersProvider>
  );
}
