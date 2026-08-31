-- 0276 — admin_activity_heatmap: when people actually use the product.
--
-- The dashboard could say how MANY events happened and how many people were
-- here, but never WHEN. At 6-17 daily actives the daily totals are too small to
-- show a shape; folded onto a weekday × hour grid the same events accumulate
-- into something with real structure — which hours are dead, whether weekends
-- exist, whether the product is used during a workday or at night.
--
-- 168 rows maximum. The scan rides the (occurred_at desc) index added in 0273,
-- and every bucket is generated whether or not it has events, because a
-- heatmap that omits its empty cells is a lie about the shape of the week.
--
-- p_tz matters. Bucketing in UTC would smear a US-hours product across the
-- grid diagonally and make "nobody works at 3am" read as "3am is busy". The
-- caller passes its own zone; an unknown zone falls back to UTC rather than
-- raising, because a broken heatmap is better than a broken page.

create or replace function public.admin_activity_heatmap(
  p_days int default 30,
  p_tz   text default 'UTC',
  p_exclude_internal boolean default true
)
returns table (dow int, hour int, events bigint, actors bigint)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_days int := least(greatest(coalesce(p_days, 30), 1), 365);
  v_tz   text := coalesce(p_tz, 'UTC');
begin
  perform public._require_admin();

  -- Validate the zone by using it; fall back rather than error out.
  begin
    perform now() at time zone v_tz;
  exception when others then
    v_tz := 'UTC';
  end;

  return query
  with grid as (
    select d.dow, h.hour
      from generate_series(1, 7)  as d(dow)
     cross join generate_series(0, 23) as h(hour)
  ),
  ev as (
    select
      extract(isodow from e.occurred_at at time zone v_tz)::int as dow,
      extract(hour   from e.occurred_at at time zone v_tz)::int as hour,
      e.user_id
    from public.analytics_events e
    where e.occurred_at > now() - make_interval(days => v_days)
      and (not p_exclude_internal
           or e.session_id is null
           or e.session_id not in (select s.session_id from public._internal_session_ids() s))
  ),
  agg as (
    select ev.dow, ev.hour,
           count(*)::bigint                                             as events,
           count(distinct ev.user_id) filter (where ev.user_id is not null)::bigint as actors
      from ev group by ev.dow, ev.hour
  )
  select g.dow, g.hour,
         coalesce(a.events, 0)::bigint,
         coalesce(a.actors, 0)::bigint
    from grid g
    left join agg a on a.dow = g.dow and a.hour = g.hour
   order by g.dow, g.hour;
end $$;

revoke all on function public.admin_activity_heatmap(int, text, boolean) from public, anon;
grant execute on function public.admin_activity_heatmap(int, text, boolean) to authenticated;

comment on function public.admin_activity_heatmap(int, text, boolean) is
  'Weekday x hour activity grid from analytics_events, in the caller''s timezone. '
  'Always returns all 168 buckets, zero-filled — omitting empty cells would '
  'misrepresent the shape of the week. Admin only.';
