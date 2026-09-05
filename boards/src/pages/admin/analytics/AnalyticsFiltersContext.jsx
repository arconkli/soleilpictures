// AnalyticsFiltersContext — shared state for the merged Analytics tab's five
// sub-tabs (Overview / Acquisition / Engagement / Revenue / System).
//
// The five views mount lazily and remount by key on switch, so prop-drilling
// the time range / funnel segment filters / internal-traffic toggle into them
// is awkward; the shell provides them here instead. The shell also fetches the
// two cheap, filter-light RPCs every view wants — admin_funnel_segments (to
// populate the segment dropdowns) and admin_stats (live MRR/ARPU) — once, so
// views don't each refetch them.
//
// Persistence mirrors the AdminPage ?tab= idiom (history.replaceState, no
// router remount): the time range + segment filters + internal toggle live in
// the URL (shareable, deep-linkable) and — for range + toggle — localStorage
// (survives reload). Internal-traffic exclusion defaults ON: honest by default.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabase.js';
import { useAdminData } from '../useAdminData.js';

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
 * The intervals are not uniform because the views are not: Today is eleven
 * windowed RPCs and is the one people leave open, while System reads storage
 * and coverage figures that move on the order of hours. Polling those as often
 * as Today would be work nobody asked for and nobody would see.
 *
 * `today` was 30s, which is a live-ops cadence applied to a view whose inputs
 * are daily rollups. Eleven concurrent RPCs twice a minute was the largest
 * single driver of call volume on the instance; the one genuinely live number
 * (admin_active_now, ~30ms) is cheap enough to poll on its own if it ever
 * needs to be finer than this.
 */
export const POLL_MS = {
  today: 300_000,
  funnel: 120_000,
  retention: 120_000,
  system: 180_000,
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
export function useRegisterViewRuntime({ refresh, lastUpdated, refreshing }) {
  const { registerRuntime } = useAnalyticsFilters();
  useEffect(() => {
    registerRuntime({ refresh, lastUpdated, refreshing });
  }, [registerRuntime, refresh, lastUpdated, refreshing]);
}

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

export function AnalyticsFiltersProvider({ children }) {
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
  //   stats    — MRR/ARPU/tier counts. Today renders these in a hero tile, so
  //              they keep the shell's poll and the focus refetch.
  //   segments — dropdown options only. Fetched once per filter change, never
  //              polled, never refetched on focus.
  const shell = useAdminData(async () => {
    const st = await supabase.rpc('admin_stats', { p_verified_only: verifiedOnly });
    return { stats: st.error ? null : st.data };
  }, [verifiedOnly],
     { pollIntervalMs: POLL_MS.shell, refetchOnFocus: true });

  const segmentsQuery = useAdminData(async () => {
    const sg = await supabase.rpc('admin_funnel_segments', { p_days: days, p_exclude_internal: excludeInternal });
    return sg.error ? [] : (sg.data || []);
  }, [days, excludeInternal]);

  const [runtime, setRuntime] = useState({ refresh: null, lastUpdated: null, refreshing: false });
  const registerRuntime = useCallback((r) => setRuntime(r), []);

  const value = useMemo(() => ({
    days, setDays,
    source, setSource, campaign, setCampaign, content, setContent,
    excludeInternal, setExcludeInternal,
    verifiedOnly, setVerifiedOnly,
    segments: segmentsQuery.data || [],
    stats: shell.data?.stats || null,
    refreshShell: shell.refresh,
    runtime, registerRuntime,
  }), [days, setDays, source, setSource, campaign, setCampaign, content, setContent,
       excludeInternal, setExcludeInternal, verifiedOnly, setVerifiedOnly,
       shell.data, shell.refresh, segmentsQuery.data, runtime, registerRuntime]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
