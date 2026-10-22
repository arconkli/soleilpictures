// useOverviewLive — Analytics › Overview, kept current while you watch it.
//
// The view's nine reads still run every five minutes (POLL_MS.overview), and
// that stays as the backstop. On top of it, the realtime stream the console
// already holds open says when something happened, and only then does this
// re-read the few figures an event can move: the seven-day counts, the totals,
// the newest signups, the stalled list, who is here, and this week's row of
// the long-run band. Together they are about a tenth of a second of database
// time. The heatmap and the weekly strips are not among them: a month folded
// onto a week, and complete weeks, do not move while you watch.
//
//   trigger    a pushed event from someone signed in, other than the viewer.
//              A signed-out page view moves none of these figures.
//   coalesce   the read runs 3s after the first event of a burst, and never
//              sooner than 15s after the last one, so a busy minute is a few
//              reads, not one per event.
//   settle     one more read 25s after a burst. card_index is written when a
//              cluster's snapshot saves, a few seconds after card_placed is
//              pushed, so the first read can land before the card does.
//   heartbeat  admin_active_now on its own every minute (under a millisecond),
//              so "here now" counts down as people leave, which no event says.
//   hidden     nothing runs while the tab is hidden; an event that arrived
//              meanwhile is read once when it is shown again.
//
// Every field comes back stamped with when its read began, and the view keeps,
// field by field, whichever of this and the backstop began later. A filter
// change throws the live figures away rather than mixing populations.

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../../../lib/supabase.js';

const COALESCE_MS = 3_000;
const FLOOR_MS = 15_000;
const SETTLE_MS = 25_000;
const HEARTBEAT_MS = 60_000;

const hidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';

export function useOverviewLive({ pulse, excludeInternal, verifiedOnly, viewerId = null, enabled = true }) {
  // { [field]: { at, value } }
  const [live, setLive] = useState({});
  const st = useRef(null);
  if (st.current === null) {
    st.current = {
      gen: 0, seen: new Set(), timer: null, settle: null,
      inFlight: false, again: false, lastReadAt: 0, dirty: false,
    };
  }

  const put = useCallback((gen, at, fields) => {
    if (gen !== st.current.gen) return;
    setLive((prev) => {
      const next = { ...prev };
      for (const [k, v] of Object.entries(fields)) {
        if (v === undefined) continue;
        if (!next[k] || next[k].at < at) next[k] = { at, value: v };
      }
      return next;
    });
  }, []);

  const readFigures = useCallback(async () => {
    const gen = st.current.gen;
    const at = Date.now();
    const [kpi, life, users, dorm, here, growth] = await Promise.allSettled([
      supabase.rpc('admin_kpi_summary', { p_days: 7, p_exclude_internal: excludeInternal, p_verified_only: verifiedOnly }),
      supabase.rpc('admin_lifetime_totals', { p_exclude_internal: excludeInternal, p_verified_only: verifiedOnly }),
      supabase.rpc('admin_recent_signups', { p_limit: 20, p_exclude_internal: excludeInternal, p_verified_only: verifiedOnly }),
      supabase.rpc('admin_user_dormancy', { p_exclude_internal: excludeInternal, p_verified_only: verifiedOnly }),
      supabase.rpc('admin_active_now', { p_window_minutes: 5, p_exclude_internal: excludeInternal }),
      // Last week and this one. Its running totals are computed over all of
      // history, so this week's row is the band's row, not a two-week slice.
      supabase.rpc('admin_growth_series', { p_weeks: 2, p_exclude_internal: excludeInternal, p_verified_only: verifiedOnly }),
    ]);
    // A failed call leaves its field as it was: never a zero for a miss.
    const val = (r) => (r.status === 'fulfilled' && !r.value.error ? r.value.data : undefined);
    put(gen, at, {
      kpi: val(kpi) ?? undefined,
      lifetime: val(life) ?? undefined,
      users: val(users) ?? undefined,
      dormancy: val(dorm) ?? undefined,
      activeNow: val(here),
      growth: Array.isArray(val(growth)) ? val(growth) : undefined,
    });
  }, [excludeInternal, verifiedOnly, put]);

  const readHere = useCallback(async () => {
    const gen = st.current.gen;
    const at = Date.now();
    const r = await supabase.rpc('admin_active_now', { p_window_minutes: 5, p_exclude_internal: excludeInternal });
    if (!r.error) put(gen, at, { activeNow: r.data });
  }, [excludeInternal, put]);

  // The read itself, and what follows it. Kept in a ref so the timers always
  // call the one for the current filters.
  const fireRef = useRef(null);
  fireRef.current = async (settling) => {
    const s = st.current;
    if (settling) s.settle = null; else s.timer = null;
    if (hidden()) { s.dirty = true; return; }
    if (s.inFlight) { s.again = true; return; }
    s.inFlight = true;
    s.lastReadAt = Date.now();
    const gen = s.gen;
    try { await readFigures(); } finally { s.inFlight = false; }
    if (gen !== s.gen) return;
    if (s.again) { s.again = false; schedule(); return; }
    if (!settling) {
      if (s.settle) clearTimeout(s.settle);
      s.settle = setTimeout(() => fireRef.current(true), SETTLE_MS);
    }
  };

  function schedule() {
    const s = st.current;
    if (hidden()) { s.dirty = true; return; }
    if (s.timer) return;   // the burst's read is already booked
    const wait = Math.max(COALESCE_MS, s.lastReadAt + FLOOR_MS - Date.now());
    s.timer = setTimeout(() => fireRef.current(false), wait);
  }

  // A filter change starts over: new population, no figures from the old one.
  useEffect(() => {
    const s = st.current;
    s.gen += 1;
    s.again = false;
    s.dirty = false;
    if (s.timer) { clearTimeout(s.timer); s.timer = null; }
    if (s.settle) { clearTimeout(s.settle); s.settle = null; }
    setLive({});
    return () => {
      if (s.timer) { clearTimeout(s.timer); s.timer = null; }
      if (s.settle) { clearTimeout(s.settle); s.settle = null; }
    };
  }, [excludeInternal, verifiedOnly]);

  // Events. `recent` is newest first and holds only what was pushed since the
  // stream opened, so every id not seen before is something that just happened.
  useEffect(() => {
    if (!enabled) return;
    const s = st.current;
    let hit = false;
    for (const r of pulse?.recent || []) {
      if (!r?.id || s.seen.has(r.id)) continue;
      s.seen.add(r.id);
      if (r.user_id && r.user_id !== viewerId) hit = true;
    }
    if (s.seen.size > 4000) s.seen = new Set((pulse?.recent || []).map((r) => r?.id));
    if (hit) schedule();
  }, [pulse?.recent, viewerId, enabled]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Who is here: once a minute, on its own.
  useEffect(() => {
    if (!enabled) return undefined;
    const id = setInterval(() => { if (!hidden()) readHere(); }, HEARTBEAT_MS);
    return () => clearInterval(id);
  }, [readHere, enabled]);

  // Back from hidden: read once if something happened meanwhile.
  useEffect(() => {
    if (!enabled) return undefined;
    const onVis = () => {
      const s = st.current;
      if (hidden() || !s.dirty) return;
      s.dirty = false;
      schedule();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [enabled]);   // eslint-disable-line react-hooks/exhaustive-deps

  return live;
}

/**
 * The newer of a live field and the backstop's, by when each read began.
 * `backstopAt` is the backstop read's own start; `live[key]` is
 * { at, value } or missing.
 */
export function fresher(live, key, backstopValue, backstopAt) {
  const L = live?.[key];
  if (!L || L.value === undefined) return backstopValue;
  if (backstopAt != null && L.at <= backstopAt) return backstopValue;
  return L.value;
}

/**
 * This week's row of the long-run band, from the live read, put over the
 * backstop's series by week_start. A week the backstop has not seen yet (the
 * Monday after it last read) is appended, so the band never draws a week that
 * the live read has already moved past as the current one.
 */
export function mergeWeeks(rows, liveRows) {
  if (!Array.isArray(rows) || !Array.isArray(liveRows) || !liveRows.length) return rows;
  const byWeek = new Map(liveRows.filter((r) => r && typeof r.week_start === 'string').map((r) => [r.week_start, r]));
  const out = rows.map((r) => (r && byWeek.has(r.week_start) ? byWeek.get(r.week_start) : r));
  const have = new Set(rows.map((r) => r?.week_start));
  for (const [w, r] of byWeek) if (!have.has(w)) out.push(r);
  return out.sort((a, b) => (a.week_start < b.week_start ? -1 : a.week_start > b.week_start ? 1 : 0));
}
