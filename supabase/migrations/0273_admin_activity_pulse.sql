-- 0273_admin_activity_pulse.sql
-- A per-minute heartbeat for the admin Command Center.
--
-- Why this exists: the wall had no panel that moves while you watch it. The
-- universe's own liveness is bounded by CREATION, and creation is rare — the
-- platform makes ~61-82 nodes a day, i.e. one new node every ~20 minutes. Stare
-- at the Universe tab for five minutes and, correctly, nothing happens.
--
-- analytics_events runs ~20x denser (~265/hour). It is already admin-RLS'd and
-- already in the supabase_realtime publication, so the client can backfill the
-- window from here once and then append live INSERTs over Realtime without ever
-- polling. That is the whole design: this RPC exists to seed a window, not to be
-- called on a timer.
--
-- Deliberately NOT split by event name. The panel answers "is anything happening
-- on the platform right now", and the breakdown already lives in
-- admin_event_breakdown. Splitting here would put a dozen sub-1/min series in a
-- 280px rail, which is the shape the Content-mix panel already learned not to be.
--
-- `actors` counts DISTINCT non-null user_id. Signed-out landing traffic carries a
-- null user_id and is real activity, so it counts toward `events` but cannot
-- count toward `actors` — the two columns genuinely measure different
-- populations, and the panel says so rather than implying they match.

------------------------------------------------------------------
-- Index — the window predicate is a plain range scan on occurred_at.
--
-- analytics_events already carries (event, occurred_at desc) and a partial
-- (user_id, occurred_at desc), but neither leads on the timestamp, so neither
-- can serve "every event in the last hour" — that scans all 62k rows today and
-- the log only ever grows.
------------------------------------------------------------------
create index if not exists analytics_events_occurred_at_idx
  on public.analytics_events (occurred_at desc);

------------------------------------------------------------------
-- admin_activity_pulse — one row per COMPLETE minute, oldest first, gaps filled.
--
-- The generate_series left join is what makes a quiet minute render as a zero
-- rather than vanishing: a chart that silently drops empty buckets compresses
-- its own x-axis and turns a dead half-hour into a continuous line.
--
-- The window deliberately STOPS at the last complete minute and never includes
-- the one in progress. That single choice is what lets a caller backfill here
-- and then append live Realtime INSERTs without reconciling anything: the
-- boundary is a minute edge both sides agree on, so an event can be counted by
-- the aggregate or by the appender but never by both. Ending at now() instead
-- would leave a race — every event inserted between this snapshot and the
-- client's subscribe lands in the returned aggregate AND arrives live.
--
-- Cost of the choice: a fresh mount shows a 0 for the in-progress minute until
-- live events fill it, so the panel can under-report by up to 59 seconds of
-- activity. That error is bounded, self-correcting within a minute, and always
-- conservative — which is the right direction for a number on a wall.
------------------------------------------------------------------
create or replace function public.admin_activity_pulse(p_minutes int default 60)
returns table(minute timestamptz, events int, actors int)
language plpgsql stable security definer set search_path = public as $$
declare
  v_start timestamptz;
  v_end   timestamptz;
begin
  perform public._require_admin();
  -- 360 ceiling mirrors the clamp style in 0246: the caller asks, SQL decides.
  p_minutes := greatest(1, least(p_minutes, 360));
  v_end   := date_trunc('minute', now()) - interval '1 minute';
  v_start := v_end - make_interval(mins => p_minutes - 1);

  return query
  select g.minute,
         coalesce(e.n, 0)::int      as events,
         coalesce(e.actors, 0)::int as actors
  from generate_series(v_start, v_end, interval '1 minute') as g(minute)
  left join (
    select date_trunc('minute', a.occurred_at) as minute,
           count(*)::int                       as n,
           count(distinct a.user_id)::int      as actors
      from public.analytics_events a
     where a.occurred_at >= v_start
       and a.occurred_at <  v_end + interval '1 minute'
     group by 1
  ) e on e.minute = g.minute
  order by g.minute asc;
end;
$$;
revoke all on function public.admin_activity_pulse(int) from public;
grant execute on function public.admin_activity_pulse(int) to authenticated;
