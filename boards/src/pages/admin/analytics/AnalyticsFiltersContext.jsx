// AnalyticsFiltersContext — shared state for the merged Analytics tab's five
// sub-tabs (Overview / Funnel / Retention / Money / System).
//
// The five views mount lazily and remount by key on switch, so prop-drilling
// the time range / funnel segment filters / internal-traffic toggle into them
// is awkward; the shell provides them here instead. The shell also fetches
// admin_stats (live MRR/ARPU) once for the views that show it, and
// admin_funnel_segments (the segment dropdowns) while the Funnel view is open.
//
// Persistence mirrors the AdminPage ?tab= idiom (history.replaceState, no
// router remount): the time range + segment filters + internal toggle live in
// the URL (shareable, deep-linkable) and — for range + toggle — localStorage
// (survives reload). Internal-traffic exclusion defaults ON: honest by default.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../../lib/supabase.js';
import { isUpdating, snapKey } from '../../../lib/adminKeep.js';
import { useAdminData } from '../useAdminData.js';
import { useAdminUid } from '../useAdminUid.js';

const LS_RANGE    = 'admin.analytics.range';
const LS_INTERNAL = 'admin.analytics.excludeInternal';
const LS_VERIFIED = 'admin.analytics.verifiedOnly';

/**
 * Background refresh cadence, per view.
 *
 * The dashboard keeps itself current rather than waiting to be reloaded, and
 * `useAdminData` pauses every one of these while the tab is hidden, so a
 * dashboard left open on a second monitor overnight costs nothing until it is
 * looked at again.
 *
 * The intervals are not uniform because the views are not: Overview is nine
 * windowed RPCs and is the one people leave open, while System reads storage
 * and coverage figures that move on the order of hours. Polling those as often
 * as Overview would be work nobody asked for and nobody would see.
 *
 * `overview` (then `today`) was 30s, which is a live-ops cadence applied to a view whose inputs
 * are daily rollups. Eleven concurrent RPCs twice a minute was the largest
 * single driver of call volume on the instance; the one genuinely live number
 * (admin_active_now, ~30ms) is cheap enough to poll on its own if it ever
 * needs to be finer than this.
 */
export const POLL_MS = {
  overview: 300_000,
  funnel: 120_000,
  retention: 600_000,
  // Money's reads scan every price event since the first one, and what they
  // count moves a few times a day.
  money: 300_000,
  system: 180_000,
  // The sharing ledger reads every share route since the window opened.
  sharing: 180_000,
  // The tests read (0810) is one call of ~0.3s; a test's numbers move as
  // people sign up, which is minutes apart, and a check going wrong is hours.
  tests: 180_000,
  shell: 60_000,
};

const Ctx = createContext(null);

export function useAnalyticsFilters() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAnalyticsFilters must be used inside <AnalyticsFiltersProvider>');
  return v;
}

// The active view registers its refresh fn + freshness so the shell's single
// persistent toolbar can drive a refresh and show "updated …" without the
// toolbar remounting on every sub-tab switch.
//
// `status` is what the view knows about its own calendar, for the status strip:
// { weeks, partialDays } (complete weeks read, and days of this UTC week so far)
// on Overview, { since } (the UTC day its window starts) on Money, and
// { running, looks } (tests running, and tests whose checks need a look) on Tests.
// The effect is keyed on those values, never on the object. A caller that
// builds the object inline hands over a new one every render, and registering it
// re-renders the provider, which re-renders the caller, without end.
//
// `stream` is the state of a realtime stream the view lives on, as
// useActivityPulse reports it ('connecting' | 'live' | 'error'), or null for a
// view that only polls. While it is 'live' the toolbar says Live instead of when
// the last read was, and the status strip names the poll as the backstop.
export function useRegisterViewRuntime({ refresh, lastUpdated, refreshing, status, stream = null }) {
  const { registerRuntime } = useAnalyticsFilters();
  const weeks = status?.weeks ?? null;
  const partialDays = status?.partialDays ?? null;
  const since = status?.since ?? null;
  const running = status?.running ?? null;
  const looks = status?.looks ?? null;
  useEffect(() => {
    const none = weeks == null && partialDays == null && since == null && running == null && looks == null;
    registerRuntime({
      refresh, lastUpdated, refreshing, stream,
      status: none ? null : { weeks, partialDays, since, running, looks },
    });
  }, [registerRuntime, refresh, lastUpdated, refreshing, stream, weeks, partialDays, since, running, looks]);
}

// A view tells the shell whether it is showing the last visit's numbers (a kept
// read that has not come back yet), so the one toolbar can say "Updating…".
// `on` is a boolean; the view's name keeps two views from clearing each other.
export function useReportUpdating(id, on) {
  const { reportUpdating } = useAnalyticsFilters();
  useEffect(() => {
    reportUpdating(id, !!on);
    return () => reportUpdating(id, false);
  }, [reportUpdating, id, on]);
}

// The views that draw admin_stats. On the others its snapshot is not on screen.
const STATS_VIEWS = ['overview', 'money', 'system'];

function getParam(name) {
  try { return new URLSearchParams(window.location.search).get(name); } catch { return null; }
}
function setParam(name, value) {
  try {
    const url = new URL(window.location.href);
    if (value === '' || value == null) url.searchParams.delete(name);
    else url.searchParams.set(name, value);
    window.history.replaceState({}, '', url);
  } catch { /* ignore */ }
}
function getStored(key) { try { return window.localStorage.getItem(key); } catch { return null; } }
function setStored(key, v) { try { window.localStorage.setItem(key, v); } catch { /* ignore */ } }

function initDays() {
  const u = parseInt(getParam('range'), 10);
  if (u === 7 || u === 30 || u === 90) return u;
  const s = parseInt(getStored(LS_RANGE), 10);
  if (s === 7 || s === 30 || s === 90) return s;
  return 30;
}
function initExcludeInternal() {
  const u = getParam('internal');
  if (u === '0') return false;
  if (u === '1') return true;
  const s = getStored(LS_INTERNAL);
  if (s === '0') return false;
  if (s === '1') return true;
  return true;  // honest by default — founder/test traffic excluded
}
function initVerifiedOnly() {
  const u = getParam('verified');
  if (u === '0') return false;
  if (u === '1') return true;
  const s = getStored(LS_VERIFIED);
  if (s === '0') return false;
  if (s === '1') return true;
  return true;  // honest by default — only email-confirmed + logged-in users count
}

export function AnalyticsFiltersProvider({ view = null, children }) {
  const uid = useAdminUid();
  const [days, setDaysState]                       = useState(initDays);
  const [source, setSourceState]                   = useState(() => getParam('src') || '');
  const [campaign, setCampaignState]               = useState(() => getParam('camp') || '');
  const [content, setContentState]                 = useState(() => getParam('creative') || '');
  const [excludeInternal, setExcludeInternalState] = useState(initExcludeInternal);
  const [verifiedOnly, setVerifiedOnlyState]       = useState(initVerifiedOnly);

  const setDays            = useCallback((d) => { setDaysState(d); setParam('range', String(d)); setStored(LS_RANGE, String(d)); }, []);
  const setSource          = useCallback((v) => { setSourceState(v); setParam('src', v); }, []);
  const setCampaign        = useCallback((v) => { setCampaignState(v); setParam('camp', v); }, []);
  const setContent         = useCallback((v) => { setContentState(v); setParam('creative', v); }, []);
  const setExcludeInternal = useCallback((b) => { setExcludeInternalState(b); setParam('internal', b ? '1' : '0'); setStored(LS_INTERNAL, b ? '1' : '0'); }, []);
  const setVerifiedOnly    = useCallback((b) => { setVerifiedOnlyState(b); setParam('verified', b ? '1' : '0'); setStored(LS_VERIFIED, b ? '1' : '0'); }, []);

  // Shell-level shared fetches. These were ONE call on one poll, and that was
  // the single most expensive thing this database did.
  //
  // admin_funnel_segments scans analytics_events and materialises a CTE holding
  // the whole JSONB props column for every event in the window, then re-scans
  // it. At work_mem=2184kB that spills ~21MB to disk per call. On the shell's
  // 60s poll it wrote 9.9GB of temp files — 54% of every temp byte this
  // database has ever written — to populate three dropdowns whose values move
  // on the order of days. The comment above used to call it "cheap".
  //
  // So the two are split by how fast their data actually moves:
  //   stats    — MRR/ARPU/tier counts. Overview renders these in a hero tile, so
  //              they keep the shell's poll and the focus refetch.
  //   segments — dropdown options only. Fetched once per filter change, never
  //              polled, never refetched on focus, and only while the Funnel
  //              view is open: nothing else draws them.
  // The stats are kept from the last visit (counts and cents, nobody's name),
  // so the hero tiles paint at once. A read that failed is not kept: null
  // would paint as "no figure" on the next visit.
  const shell = useAdminData(async () => {
    const st = await supabase.rpc('admin_stats', { p_verified_only: verifiedOnly });
    return { stats: st.error ? null : st.data };
  }, [verifiedOnly],
     {
       pollIntervalMs: POLL_MS.shell,
       refetchOnFocus: true,
       keep: uid ? {
         uid,
         key: snapKey('analytics.stats', [verifiedOnly]),
         save: (r) => (r?.stats ? r : undefined),
       } : null,
     });

  const segmentsOn = view === 'funnel';
  // The last answer, by its filters: coming back to Funnel with the same ones
  // does not pay for the read again.
  const segmentsHeld = useRef({ key: null, rows: [] });
  const segmentsQuery = useAdminData(async () => {
    if (!segmentsOn) return segmentsHeld.current.rows;
    const key = `${days}|${excludeInternal}`;
    if (segmentsHeld.current.key === key) return segmentsHeld.current.rows;
    const sg = await supabase.rpc('admin_funnel_segments', { p_days: days, p_exclude_internal: excludeInternal });
    if (sg.error) return [];
    segmentsHeld.current = { key, rows: sg.data || [] };
    return segmentsHeld.current.rows;
  }, [days, excludeInternal, segmentsOn]);

  const [runtime, setRuntime] = useState({ refresh: null, lastUpdated: null, refreshing: false, status: null, stream: null });
  const registerRuntime = useCallback((r) => setRuntime(r), []);

  // Which views are showing the last visit's numbers (useReportUpdating).
  const [updatingBy, setUpdatingBy] = useState({});
  const reportUpdating = useCallback((id, on) => {
    setUpdatingBy((m) => (!!m[id] === on ? m : { ...m, [id]: on }));
  }, []);
  const updating = (STATS_VIEWS.includes(view) && isUpdating(shell))
    || Object.values(updatingBy).some(Boolean);

  const value = useMemo(() => ({
    days, setDays,
    source, setSource, campaign, setCampaign, content, setContent,
    excludeInternal, setExcludeInternal,
    verifiedOnly, setVerifiedOnly,
    segments: segmentsQuery.data || [],
    stats: shell.data?.stats || null,
    refreshShell: shell.refresh,
    runtime, registerRuntime,
    updating, reportUpdating,
  }), [days, setDays, source, setSource, campaign, setCampaign, content, setContent,
       excludeInternal, setExcludeInternal, verifiedOnly, setVerifiedOnly,
       shell.data, shell.refresh, segmentsQuery.data, runtime, registerRuntime,
       updating, reportUpdating]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
