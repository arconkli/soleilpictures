// useActivityPulse — the platform's heartbeat, live.
//
// The Universe tab had no surface that moves while you watch it, and that is
// arithmetic, not a bug: the platform creates ~61-82 nodes a day, so a new node
// lands roughly once every twenty minutes. analytics_events runs ~20x denser.
// It is admin-RLS'd and already in the supabase_realtime publication, so this
// hook backfills a window ONCE and then never polls again — every subsequent
// update is pushed.
//
// Same shape as useCardPlacements.js (backfill, then subscribe), with three
// differences that matter:
//
//   1. NO event filter. useCardPlacements narrows to event=eq.card_placed;
//      this one wants the whole stream, because "is anything happening" is the
//      question and a landing-page view is an honest yes.
//
//   2. Distinct channel topic. Supabase v2 dedupes channels BY TOPIC and hands
//      back the same object, which then throws on .on() after subscribe — see
//      the note in lib/useInboxLive.js. 'admin:activity' must never collide
//      with 'admin:card-placements'.
//
//   3. The backfill and the live stream meet on a minute boundary, not a
//      wall-clock instant. admin_activity_pulse() returns COMPLETE minutes only
//      and stops one minute short of now; this hook owns the in-progress minute
//      outright. So an event is counted by the aggregate or by the appender,
//      never by both, and no reconciliation is needed. (See the migration
//      header in 0273 for why ending the window at now() cannot work.)
//
// Returns:
//   buckets     — [{ minute, events, actors, live }] oldest→newest, gaps as zeros
//   total       — events across the window
//   perMin      — total / bucket count
//   lastEventAt — ms of the most recent LIVE event (null until one arrives)
//   recent      — newest-first raw rows, for the universe's activity layer
//   status      — 'connecting' | 'live' | 'error'

import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase.js';

const MINUTE = 60_000;
const FLUSH_MS = 500;      // repaint cadence; bursts coalesce instead of thrashing React
const RECENT_CAP = 32;

// Bucket edges must agree with the server's, or a skewed browser clock rolls
// phantom empty minutes onto the right edge of the chart and the panel reads as
// "nothing is happening" — the exact failure this hook exists to rule out.
//
// The backfill's last bucket is date_trunc('minute', server_now) - 1min, which
// pins the server clock to a 60s band. Live events then carry an exact
// server-side occurred_at; network delay makes each estimate an UNDER-estimate,
// so the running max converges on the truth from below (the usual trick).
function makeClock() {
  let skew = 0;
  return {
    now: () => Date.now() + skew,
    seedFromBackfill(lastMinuteMs) {
      if (!Number.isFinite(lastMinuteMs)) return;
      // Server was somewhere in [last+60s, last+120s) when it answered.
      skew = (lastMinuteMs + 1.5 * MINUTE) - Date.now();
    },
    refineFromEvent(occurredAtMs) {
      if (!Number.isFinite(occurredAtMs)) return;
      const est = occurredAtMs - Date.now();
      if (est > skew) skew = est;
    },
  };
}

const floorMinute = (ms) => Math.floor(ms / MINUTE) * MINUTE;

export function useActivityPulse({ minutes = 60 } = {}) {
  const [state, setState] = useState({
    buckets: [], total: 0, perMin: 0, lastEventAt: null, recent: [], status: 'connecting',
  });

  const ref = useRef(null);
  if (ref.current === null) {
    ref.current = {
      buckets: [],            // [{ minute, events, actors, live }]
      recent: [],
      lastEventAt: null,
      status: 'connecting',
      seen: new Set(),        // analytics_events.id — the PK, so dedupe is exact
      clock: makeClock(),
      dirty: false,
      ready: false,           // backfill landed; before that live events queue up
      queued: [],
    };
  }

  useEffect(() => {
    const st = ref.current;
    let alive = true;

    // Roll the window forward to the current minute, filling any minutes that
    // passed with zeros. Called from the flush tick, so a tab that was hidden
    // catches up in one pass rather than animating through the gap.
    const advance = () => {
      const nowMin = floorMinute(st.clock.now());
      if (st.buckets.length === 0) {
        st.buckets.push({ minute: nowMin, events: 0, actors: 0, live: true });
        st.dirty = true;
        return;
      }
      let last = st.buckets[st.buckets.length - 1];
      while (last.minute < nowMin) {
        last.live = false;
        last = { minute: last.minute + MINUTE, events: 0, actors: 0, live: true };
        st.buckets.push(last);
        st.dirty = true;
      }
      // +1 for the in-progress minute this hook owns.
      const cap = minutes + 1;
      if (st.buckets.length > cap) {
        st.buckets.splice(0, st.buckets.length - cap);
        st.dirty = true;
      }
    };

    const applyEvent = (row) => {
      if (!row || !row.id || st.seen.has(row.id)) return;
      st.seen.add(row.id);
      // Bound the dedupe set; ids older than the window can never recur.
      if (st.seen.size > 4000) st.seen = new Set([row.id]);

      const at = row.occurred_at ? Date.parse(row.occurred_at) : NaN;
      st.clock.refineFromEvent(at);
      advance();

      const target = Number.isFinite(at) ? floorMinute(at) : st.buckets[st.buckets.length - 1].minute;
      // Only the buckets this hook owns may be incremented. Anything older is
      // already accounted for by the aggregate — silently dropping it is what
      // keeps the two halves from double-counting.
      const b = st.buckets.find((x) => x.minute === target);
      if (b && b.live) {
        b.events += 1;
        if (row.user_id) {
          (b._actorIds || (b._actorIds = new Set())).add(row.user_id);
          b.actors = b._actorIds.size;
        }
      }
      st.lastEventAt = Number.isFinite(at) ? at : Date.now();
      st.recent = [{
        id: row.id, event: row.event, occurred_at: row.occurred_at,
        user_id: row.user_id, props: parseProps(row.props),
      }, ...st.recent].slice(0, RECENT_CAP);
      st.dirty = true;
    };

    // 1) Subscribe FIRST and queue, so nothing inserted while the backfill is in
    //    flight is lost. The queue drains through the same minute-boundary rule,
    //    so a queued event landing in a backfilled minute is correctly ignored.
    const ch = supabase
      .channel('admin:activity')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'analytics_events' },
        (payload) => {
          if (!alive) return;
          if (!st.ready) { st.queued.push(payload.new); return; }
          applyEvent(payload.new);
        },
      )
      .subscribe((s) => {
        if (!alive) return;
        st.status = s === 'SUBSCRIBED' ? 'live'
          : (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') ? 'error'
          : 'connecting';
        st.dirty = true;
      });

    // 2) Backfill the complete minutes.
    supabase.rpc('admin_activity_pulse', { p_minutes: minutes }).then(
      ({ data, error }) => {
        if (!alive) return;
        if (!error && Array.isArray(data) && data.length) {
          st.buckets = data.map((r) => ({
            minute: Date.parse(r.minute),
            events: Number(r.events) || 0,
            actors: Number(r.actors) || 0,
            live: false,
          })).filter((b) => Number.isFinite(b.minute));
          st.clock.seedFromBackfill(st.buckets[st.buckets.length - 1]?.minute);
        }
        st.ready = true;
        advance();
        for (const row of st.queued) applyEvent(row);
        st.queued = [];
        st.dirty = true;
      },
      () => { if (alive) { st.ready = true; advance(); st.dirty = true; } },
    );

    // 3) One timer: rolls the window and repaints only when something changed.
    const id = setInterval(() => {
      if (!alive) return;
      advance();
      if (!st.dirty) return;
      st.dirty = false;
      const buckets = st.buckets.map((b) => ({
        minute: b.minute, events: b.events, actors: b.actors, live: !!b.live,
      }));
      const total = buckets.reduce((a, b) => a + b.events, 0);
      setState({
        buckets,
        total,
        perMin: buckets.length ? total / buckets.length : 0,
        lastEventAt: st.lastEventAt,
        recent: st.recent,
        status: st.status,
      });
    }, FLUSH_MS);

    return () => {
      alive = false;
      clearInterval(id);
      try { supabase.removeChannel(ch); } catch (_) { /* already gone */ }
    };
  }, [minutes]);

  return state;
}

function parseProps(props) {
  if (!props) return {};
  if (typeof props === 'string') { try { return JSON.parse(props); } catch (_) { return {}; } }
  return props;
}
