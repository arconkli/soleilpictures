// AdminAnalyticsTab — the merged Analytics tab. Hosts seven question-shaped
// sub-tabs (Overview / Funnel / Sharing / Retention / Money / Tests / System)
// using the same pattern as AdminUniverseTab (localStorage + ?view= + key-prop
// remount), generalized to every view with arrow-key nav. The shell owns the shared,
// persistent toolbar (time range + funnel segment filters + internal-traffic
// toggle) above the keyed view content, so it never remounts on a sub-tab
// switch; each view registers its own refresh/freshness with the context so the
// single toolbar can drive it. Per-view lazy fetch (only the mounted view runs
// its RPCs) replaces the old 14-RPC-on-mount firehose.

import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import { WEEKS_FETCHED } from '../../lib/trendStats.js';
import { AdminToolbar } from './AdminStates.jsx';
import { AdminTimeRange } from './AdminTimeRange.jsx';
import { AnalyticsFiltersProvider, useAnalyticsFilters, POLL_MS } from './analytics/AnalyticsFiltersContext.jsx';
import { SegmentSelect } from './analytics/widgets/SegmentSelect.jsx';
import { OverviewView } from './analytics/views/OverviewView.jsx';
import { FunnelView } from './analytics/views/FunnelView.jsx';
import { SharingView } from './analytics/views/SharingView.jsx';
import { RetentionView } from './analytics/views/RetentionView.jsx';
import { MoneyView } from './analytics/views/MoneyView.jsx';
import { SystemView } from './analytics/views/SystemView.jsx';
import { TestsView } from './analytics/views/TestsView.jsx';
import { md } from '../../lib/moneyView.js';

// Seven views, each answering one question.
//
// Tests came on 2026-10-29: every test, how its test side compares to the
// default, and whether it is really running. It reads its own fixed population
// (the team, service and banned accounts left out), so the range control and
// the two population toggles are hidden on it.
//
// Money came back on 2026-10-20. It had no view while no subscription had ever
// existed, because a screen of structural zeros reads as a measurement rather
// than as an absence. The page it came back as is about people first: who sees
// a price, where they stop, and who hits the cap, which are real counts whatever
// the revenue is, and its money figures say plainly when they are zero.
const VIEWS = [
  { id: 'overview',  label: 'Overview' },
  { id: 'funnel',    label: 'Funnel' },
  { id: 'sharing',   label: 'Sharing' },
  { id: 'retention', label: 'Retention' },
  { id: 'money',     label: 'Money' },
  { id: 'tests',     label: 'Tests' },
  { id: 'system',    label: 'System' },
];
const VIEW_IDS = VIEWS.map((v) => v.id);
const SUBTAB_KEY = 'admin.analytics.view';

// Old sub-tab ids. Bookmarks and persisted prefs land somewhere sensible rather
// than silently resetting to the default: 'today' is what Overview was called
// until 2026-10-20, and the rest are from when the views were Overview /
// Acquisition / Engagement / Revenue / System. 'overview' itself went
// overview → today → overview, and is a real id again. Revenue's link went to
// Funnel while there was no money view, and goes to Money now.
const VIEW_ALIASES = {
  today: 'overview',
  acquisition: 'funnel',
  engagement: 'retention',
  revenue: 'money',
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
      title="On: count an account once its owner has entered the emailed sign-in code. Off: also count addresses that asked for a code and never entered it."
    >
      <span className="admin-toggle-dot" aria-hidden="true" />
      {f.verifiedOnly ? 'Entered the code' : 'All accounts'}
    </button>
  );
}

/**
 * The deck's operating conditions, on one line.
 *
 * Not decoration — this is the Command Center rule ("every panel states its
 * population and window") paid once for the whole screen instead of a line per
 * panel. Which window, which people are counted, and how often the page
 * re-reads itself are the three things that change what every number below
 * means, and none of them were stated anywhere: they lived as the state of
 * three toolbar controls you had to look up and interpret.
 *
 * The refresh cadence in particular was invisible. A number that silently
 * updates itself is worse than a stale one if you cannot tell which it is.
 */
function DeckStatus({ view }) {
  const f = useAnalyticsFilters();
  const cadence = POLL_MS[view] ?? POLL_MS.shell;
  const overview = view === 'overview';
  const money = view === 'money';
  if (view === 'tests') return <TestsStatus f={f} cadence={cadence} />;
  // What Overview registered about its own calendar. Read on Overview only: for the
  // render after a switch the previous view's runtime is still the registered one.
  const st = overview ? f.runtime.status : null;
  // Money reads from the first price ever shown, whatever the range control says.
  const since = money ? f.runtime.status?.since : null;
  // The weeks are claimed only once the weekly read has come back. While it loads,
  // and when it failed, WINDOW is the seven days alone and there is no WEEKS item.
  const weekly = st?.weeks != null;
  const weeksRead = weekly
    ? ` · ${WEEKS_FETCHED - 1} wk UTC${st.partialDays != null ? ` · ${st.partialDays} of 7 days` : ''}`
    : '';

  const items = [
    ['MODE', view.toUpperCase()],
    // Overview is a fixed seven-day window by definition, plus the complete UTC
    // weeks its trends read and how far into this one we are; the others
    // follow the range control, which is why the range control is hidden on
    // Overview, and on Money, which counts from the first price shown.
    ['WINDOW', overview ? `7d${weeksRead}`
      : money ? (since ? `since ${md(since)} · first price shown` : 'since the first price shown')
        : `${f.days}d`],
    ['POP', f.verifiedOnly ? 'entered the code' : 'all accounts'],
    ['INTERNAL', f.excludeInternal ? 'excluded' : 'counted'],
    // A view on a realtime stream is current as things happen, and its poll is
    // only the backstop under it. Said so, because "300s" alone would read as
    // five-minute-old figures on a page that is not.
    ['SYNC', overview && f.runtime.stream === 'live'
      ? `live · ${Math.round(cadence / 1000)}s backstop`
      : `${Math.round(cadence / 1000)}s`],
  ];
  if (weekly) items.push(['WEEKS', `${st.weeks} complete`]);
  // Revenue is what Stripe charges every account, the team's included; the
  // toggles above move only the counts of people.
  if (money) items.push(['MONEY', 'from Stripe, all accounts']);

  return <StatusStrip items={items} />;
}

// Tests has no window and no toggle: each test counts from its own start, with
// the team, service and banned accounts always left out. What it can state is
// how many tests are running and how many need a look. Read once the view has
// registered them: for the render after a switch the previous view's runtime is
// still the registered one, and its status carries neither.
function TestsStatus({ f, cadence }) {
  const st = f.runtime.status;
  const items = [
    ['MODE', 'TESTS'],
    ['RUNNING', st?.running != null ? String(st.running) : '…'],
    ['NEEDS A LOOK', st?.looks != null ? String(st.looks) : '…'],
    ['INTERNAL', 'left out'],
    ['READ', 'as assigned, whatever they did next'],
    ['SYNC', `${Math.round(cadence / 1000)}s`],
  ];
  return <StatusStrip items={items} />;
}

function StatusStrip({ items }) {
  return (
    <div className="adm-status" role="note" aria-label="Current measurement conditions">
      {items.map(([k, v]) => (
        <span className="adm-status-item" key={k}>
          <span className="adm-status-k">{k}</span>
          <span className="adm-status-v">{v}</span>
        </span>
      ))}
    </div>
  );
}

function AnalyticsToolbar({ view }) {
  const f = useAnalyticsFilters();
  // Segment dropdowns only mean something where a funnel is on screen.
  const showSegments = view === 'funnel';
  // Overview is a fixed seven-day window by definition — its own heading says so —
  // and Money counts from the first price shown. A range selector that silently
  // does nothing is worse than no selector.
  // Tests counts each test from its own start, always without the team.
  const showRange = view !== 'overview' && view !== 'money' && view !== 'tests';
  const showPopulation = view !== 'tests';
  const opts = (dim) => f.segments.filter((s) => s.dim === dim);
  const onRefresh = () => { f.runtime.refresh?.(); f.refreshShell?.(); };
  return (
    <AdminToolbar
      onRefresh={f.runtime.refresh ? onRefresh : null}
      refreshing={f.runtime.refreshing}
      lastUpdated={f.runtime.lastUpdated}
      live
      // Read on Overview only, as DeckStatus does: for the render after a switch
      // the previous view's runtime is still the registered one.
      stream={view === 'overview' ? f.runtime.stream : null}
    >
      {showRange && <AdminTimeRange value={f.days} onChange={f.setDays} />}
      {showSegments && (
        <>
          <SegmentSelect label="Source"   value={f.source}   onChange={f.setSource}   options={opts('source')} />
          <SegmentSelect label="Campaign" value={f.campaign} onChange={f.setCampaign} options={opts('campaign')} />
          <SegmentSelect label="Creative" value={f.content}  onChange={f.setContent}  options={opts('content')} />
        </>
      )}
      {showPopulation && (
        <>
          <InternalToggle />
          <VerifiedToggle />
        </>
      )}
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

  // Another view's link to this one ("moved to Sharing →").
  useEffect(() => {
    const go = (e) => { const v = resolveView(e.detail); if (v) selectView(v); };
    window.addEventListener('admin:analytics-view', go);
    return () => window.removeEventListener('admin:analytics-view', go);
  }, []);

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
        <DeckStatus view={view} />

        {/* Remount by key so each view owns a clean useAdminData lifecycle and
            only the mounted view runs its RPCs. */}
        {view === 'overview'  && <OverviewView  key="overview" />}
        {view === 'funnel'    && <FunnelView    key="funnel" />}
        {view === 'sharing'   && <SharingView   key="sharing" />}
        {view === 'retention' && <RetentionView key="retention" />}
        {view === 'money'     && <MoneyView     key="money" />}
        {view === 'tests'     && <TestsView     key="tests" />}
        {view === 'system'    && <SystemView    key="system" />}
      </div>
    </AnalyticsFiltersProvider>
  );
}
