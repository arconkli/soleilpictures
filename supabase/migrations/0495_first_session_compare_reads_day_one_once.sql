-- 0495 — Retention's first-session table reads each person's first day once.
--
-- admin_first_session_compare (Analytics › Retention, under the return
-- predictors) set every share row against a materialised list of everyone's
-- signup-day events: for each metric and each person, an EXISTS probe into
-- that list. A fresh plan hashes the probe, but a pooled connection moves a
-- PL/pgSQL query onto its generic plan after five calls, and the generic plan
-- probed row by row. From the sixth call on, the read took time in the square
-- of the population: measured on the live data on 2026-10-21, a population
-- 4.7 times larger took 17 times as long, and at the default arguments a call
-- ran for seconds where its first had taken a fraction of one. It also
-- grouped the whole of analytics_events to learn when five events were first
-- seen, and carried every day-one event's props through a hash that spilled
-- to disk.
--
-- Now:
--   * each person's signup day is read once, as an instant range on
--     events_user_time (which is what occurred_at::date = signup means in the
--     session's time zone), and folded into one row per person carrying the
--     medians' inputs and the list of tracked events seen that day;
--   * a share asks whether its event is in that list, so nothing is probed
--     per person per metric;
--   * when an event was first seen is one probe of events_event_time per
--     metric, not a pass over every event.
-- Measured the same way, time grows in step with the population, and the
-- sixth call costs what the first did.
--
-- The rows are the same. Before this was applied, the old and new
-- definitions ran side by side on the live data for nine argument sets
-- (both toggles each way, early and late p_since, p_min_age_days from 0 to
-- 365, including one nobody is old enough for) and returned identical rows.
-- The header (arguments, defaults, return type and attributes, work_mem
-- included) and everything outside the day-one read are the live
-- pg_get_functiondef, which carries 0461's predicates. CREATE OR REPLACE
-- keeps the ACL; the grants are restated and proved anyway (0311).

begin;

set local lock_timeout = '3s';

create or replace function public.admin_first_session_compare(
  p_since date default '2026-06-16'::date,
  p_min_age_days integer default 14,
  p_exclude_internal boolean default true,
  p_verified_only boolean default true
)
 returns table(metric text, kind text, ord integer, measured_from date, returned_n integer, returned_val numeric, oneshot_n integer, oneshot_val numeric)
 language plpgsql
 stable security definer
 set search_path to 'public'
 set work_mem to '24MB'
as $function$
#variable_conflict use_column
declare
  v_age int := least(greatest(coalesce(p_min_age_days, 14), 0), 365);
  v_since date := coalesce(p_since, '2026-06-16'::date);
begin
  perform public._require_admin();

  return query
  with u as (
    select usr.id as user_id, usr.created_at::date as signup
      from auth.users usr
     where usr.created_at >= v_since
       and usr.created_at < now() - (v_age || ' days')::interval
       and (not p_verified_only
            or (usr.id in (select ec.entered_id from public._admin_entered_code() ec)))
       and (not p_exclude_internal
            or usr.id not in (select iu.user_id from public._internal_user_ids() iu))
  ),
  outcome as (
    select u.user_id, u.signup,
           count(distinct a.day) as days,
           (count(distinct a.day) > 1) as returned
      from u
      left join public.user_active_day a on a.user_id = u.user_id
     group by u.user_id, u.signup
  ),
  pop as (select o.user_id, o.signup, o.returned from outcome o where o.days > 0),
  share_defs(metric, ord, src) as (
    values ('Got stuck placing a card',        10, 'card_create_stuck'),
           ('Opened the share panel',          11, 'share_open'),
           ('Edited a document',               12, 'doc_edit'),
           ('Was shown the empty-board panel', 13, 'empty_board_shown'),
           ('Saw the add-more dock',           14, 'depth_dock_shown')
  ),
  -- One row per person: the signup day's ps_ events folded into the medians'
  -- inputs, and which of the tracked events that day saw. The day is an
  -- instant range so events_user_time can bound it.
  day1 as (
    select p.user_id, p.returned, p.signup,
           extract(epoch from (max(e.occurred_at) filter (where e.event like 'ps\_%')
                             - min(e.occurred_at) filter (where e.event like 'ps\_%'))) / 60.0 as minutes,
           count(*) filter (where e.event like 'ps\_%') as events_n,
           coalesce(max((e.props->>'gcards')::int) filter (where e.event like 'ps\_%'), 0) as gcards,
           coalesce(max((e.props->>'boards')::int) filter (where e.event like 'ps\_%'), 0) as boards,
           coalesce(array_agg(distinct e.event) filter (where e.event = any(t.srcs)), '{}') as seen
      from pop p
      cross join (select array_agg(d.src) as srcs from share_defs d) t
      left join public.analytics_events e
        on e.user_id = p.user_id
       and e.occurred_at >= p.signup::timestamptz
       and e.occurred_at <  (p.signup + 1)::timestamptz
     group by p.user_id, p.returned, p.signup
  ),
  medians as (
    select x.metric, x.ord,
           count(*) filter (where sp.returned)::int as rn,
           percentile_cont(0.5) within group (order by case when sp.returned then x.v end)::numeric as rv,
           count(*) filter (where not sp.returned)::int as sn,
           percentile_cont(0.5) within group (order by case when not sp.returned then x.v end)::numeric as sv
      from day1 sp
      cross join lateral (values
        ('Minutes in the first session', 1, sp.minutes),
        ('Events recorded in it',        2, sp.events_n::numeric),
        ('Cards on the board by the end',3, sp.gcards::numeric),
        ('Clusters open',                4, sp.boards::numeric)
      ) as x(metric, ord, v)
     group by x.metric, x.ord
  ),
  shares as (
    select d.metric, d.ord,
           coalesce(ep.first_seen, v_since) as mfrom,
           count(*) filter (where p.user_id is not null and p.returned)::int as rn,
           round(100.0 * count(*) filter (where p.user_id is not null and p.returned and d.src = any(p.seen))
                 / nullif(count(*) filter (where p.user_id is not null and p.returned), 0), 0)::numeric as rv,
           count(*) filter (where p.user_id is not null and not p.returned)::int as sn,
           round(100.0 * count(*) filter (where p.user_id is not null and not p.returned and d.src = any(p.seen))
                 / nullif(count(*) filter (where p.user_id is not null and not p.returned), 0), 0)::numeric as sv
      from share_defs d
      -- When the event was first seen by anyone: one probe of events_event_time.
      left join lateral (
        select min(e.occurred_at)::date as first_seen
          from public.analytics_events e
         where e.event = d.src
      ) ep on true
      -- OUTER, so a metric whose signal postdates every aged user still returns
      -- a row rather than disappearing from the panel entirely.
      left join day1 p on p.signup >= coalesce(ep.first_seen, v_since)
     group by d.metric, d.ord, coalesce(ep.first_seen, v_since)
  ),
  err_share as (
    select 'Hit an error'::text as metric, 15 as ord,
           count(*) filter (where p.returned)::int as rn,
           round(100.0 * count(*) filter (where p.returned and h.found)
                 / nullif(count(*) filter (where p.returned), 0), 0)::numeric as rv,
           count(*) filter (where not p.returned)::int as sn,
           round(100.0 * count(*) filter (where not p.returned and h.found)
                 / nullif(count(*) filter (where not p.returned), 0), 0)::numeric as sv
      from pop p
      cross join lateral (
        select exists (
          select 1 from public.client_errors c
           where c.user_id = p.user_id and c.occurred_at::date = p.signup
        ) as found
      ) h
  )
  select m.metric, 'median'::text, m.ord, null::date, m.rn, round(m.rv, 1), m.sn, round(m.sv, 1)
    from medians m
  union all
  select s.metric, 'share', s.ord, s.mfrom, s.rn, s.rv, s.sn, s.sv from shares s
  union all
  select e.metric, 'share', e.ord, null::date, e.rn, e.rv, e.sn, e.sv from err_share e
   order by 3;
end $function$;

revoke execute on function public.admin_first_session_compare(date, integer, boolean, boolean) from public, anon;
grant execute on function public.admin_first_session_compare(date, integer, boolean, boolean) to authenticated, service_role;

do $proof$
declare
  v_sig constant text := 'public.admin_first_session_compare(date,integer,boolean,boolean)';
  v_def text;
begin
  if to_regprocedure(v_sig) is null then
    raise exception '0495: % is missing', v_sig;
  end if;
  if has_function_privilege('anon', v_sig, 'execute') then
    raise exception '0495: % is reachable signed out', v_sig;
  end if;
  if not has_function_privilege('authenticated', v_sig, 'execute')
     or not has_function_privilege('service_role', v_sig, 'execute') then
    raise exception '0495: % lost its grant', v_sig;
  end if;
  if (select count(*) from pg_proc p
       where p.pronamespace = 'public'::regnamespace
         and p.proname = 'admin_first_session_compare') <> 1 then
    raise exception '0495: an overload sits beside admin_first_session_compare';
  end if;
  v_def := pg_get_functiondef(v_sig::regprocedure);
  if v_def not like '%perform public._require_admin();%'
     or v_def not like '%public._admin_entered_code()%'
     or v_def not like '%public._internal_user_ids()%' then
    raise exception '0495: % lost its gate or the people it counts', v_sig;
  end if;
  if v_def like '%from ev x%' or v_def like '%group by e.event%' then
    raise exception '0495: % still probes per person or groups every event', v_sig;
  end if;
  if not (select p.prosecdef and p.proconfig @> array['search_path=public', 'work_mem=24MB']
            from pg_proc p where p.oid = v_sig::regprocedure) then
    raise exception '0495: % lost an attribute', v_sig;
  end if;
end $proof$;

commit;
