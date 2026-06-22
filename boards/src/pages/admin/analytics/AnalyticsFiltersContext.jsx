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

  // Shell-level shared fetch: segment options (for the dropdowns) + live stats
  // (MRR/ARPU + tier/sub counts, reused by Overview & Revenue). Cheap and
  // filter-light, so it runs once at shell level rather than per view.
  const shell = useAdminData(async () => {
    const [sg, st] = await Promise.allSettled([
      supabase.rpc('admin_funnel_segments', { p_days: days, p_exclude_internal: excludeInternal }),
      supabase.rpc('admin_stats', { p_verified_only: verifiedOnly }),
    ]);
    const val = (r) => (r.status === 'fulfilled' && !r.value.error ? r.value.data : null);
    return { segments: val(sg) || [], stats: val(st) };
  }, [days, excludeInternal, verifiedOnly]);

  const [runtime, setRuntime] = useState({ refresh: null, lastUpdated: null, refreshing: false });
  const registerRuntime = useCallback((r) => setRuntime(r), []);

  const value = useMemo(() => ({
    days, setDays,
    source, setSource, campaign, setCampaign, content, setContent,
    excludeInternal, setExcludeInternal,
    verifiedOnly, setVerifiedOnly,
    segments: shell.data?.segments || [],
    stats: shell.data?.stats || null,
    refreshShell: shell.refresh,
    runtime, registerRuntime,
  }), [days, setDays, source, setSource, campaign, setCampaign, content, setContent,
       excludeInternal, setExcludeInternal, verifiedOnly, setVerifiedOnly,
       shell.data, shell.refresh, runtime, registerRuntime]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
