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
import { TodayView } from './analytics/views/TodayView.jsx';
import { FunnelView } from './analytics/views/FunnelView.jsx';
import { RetentionView } from './analytics/views/RetentionView.jsx';
import { SystemView } from './analytics/views/SystemView.jsx';

// Four views, each answering one question, down from five that overlapped.
//
// Money has no view of its own while zero subscriptions have ever existed: a
// whole screen of structural zeros reads as a measurement rather than as an
// absence. The pricing path lives inside Funnel, where it is one branch of a
// real flow. Bring the view back when admin_stats.sub_counts is non-empty.
const VIEWS = [
  { id: 'today',     label: 'Today' },
  { id: 'funnel',    label: 'Funnel' },
  { id: 'retention', label: 'Retention' },
  { id: 'system',    label: 'System' },
];
const VIEW_IDS = VIEWS.map((v) => v.id);
const SUBTAB_KEY = 'admin.analytics.view';

// Old sub-tab ids, from when this was Overview / Acquisition / Engagement /
// Revenue / System. Bookmarks and persisted prefs land somewhere sensible
// rather than silently resetting to the default.
const VIEW_ALIASES = {
  overview: 'today',
  acquisition: 'funnel',
  engagement: 'retention',
  revenue: 'funnel',
};

function resolveView(id) {
  if (!id) return null;
  if (VIEW_IDS.includes(id)) return id;
  return VIEW_ALIASES[id] || null;
}

function readInitialView() {
  try {
    const fromUrl = resolveView(new URLSearchParams(window.location.search).get('view'));
    if (fromUrl) return fromUrl;
    const stored = resolveView(window.localStorage.getItem(SUBTAB_KEY));
    if (stored) return stored;
  } catch { /* ignore */ }
  return 'today';
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
  // Segment dropdowns only mean something where a funnel is on screen.
  const showSegments = view === 'funnel';
  // Today is a fixed seven-day window by definition — its own heading says so.
  // A range selector that silently does nothing is worse than no selector.
  const showRange = view !== 'today';
  const opts = (dim) => f.segments.filter((s) => s.dim === dim);
  const onRefresh = () => { f.runtime.refresh?.(); f.refreshShell?.(); };
  return (
    <AdminToolbar
      onRefresh={f.runtime.refresh ? onRefresh : null}
      refreshing={f.runtime.refreshing}
      lastUpdated={f.runtime.lastUpdated}
    >
      {showRange && <AdminTimeRange value={f.days} onChange={f.setDays} />}
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
        {view === 'today'     && <TodayView     key="today" />}
        {view === 'funnel'    && <FunnelView    key="funnel" />}
        {view === 'retention' && <RetentionView key="retention" />}
        {view === 'system'    && <SystemView    key="system" />}
      </div>
    </AnalyticsFiltersProvider>
  );
}
