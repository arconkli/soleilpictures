-- 0876_admin_return_reports_lighter.sql
--
-- admin_return_fixed_horizon (0322) and admin_built_return (0363) wrote about
-- a hundred megabytes to temp files on every call. Both find each person's
-- usual device on day one with mode() over their day-one analytics_events, and
-- the planner sorted those events by person carrying each whole props
-- document along, so the sort spilled to disk.
--
-- Each now takes just (user_id, device) for those events first, in a
-- MATERIALIZED CTE (dev_rows), and runs the same mode() over that narrow list.
-- The events read, the filter and the aggregate are unchanged, so every dim
-- comes out the same. Nothing else in either body moves, and around them
-- everything is kept: the signatures and defaults, plpgsql, stable, security
-- definer, search_path public, _require_admin(), the comments, and the grants
-- (create or replace keeps them: authenticated and service_role, never anon),
-- which the block at the end proves.
--
-- admin_activity_heatmap was looked at and left alone: its rows are already
-- three narrow columns, its small spill is the count(distinct) sort, and its
-- time goes to reading the window's events, which a rewrite would not change.
--
-- Checked on production before writing, as an admin (never committed): old
-- and new returned identical rows for the defaults and for a second set of
-- arguments each. With the defaults the temp written for the fixed-horizon
-- read fell from about fifteen thousand blocks to well under a thousand, and
-- both reads answered faster.

begin;

create or replace function public.admin_return_fixed_horizon(
  p_since date default '2026-06-16',
  p_horizon_days int default 7,
  p_exclude_internal boolean default true,
  p_verified_only boolean default true,
  p_merge_hours int default 2,
  p_weeks int default 12
)
returns table (
  dim text,
  n int,
  returned int,
  pct numeric
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
#variable_conflict use_column
declare
  v_since date := coalesce(p_since, '2026-06-16'::date);
  v_h int      := least(greatest(coalesce(p_horizon_days, 7), 1), 90);
  v_merge int  := least(greatest(coalesce(p_merge_hours, 2), 0), 12);
  v_weeks int  := least(greatest(coalesce(p_weeks, 12), 1), 52);
begin
  perform public._require_admin();

  return query
  with v as (
    select * from public._admin_visits(v_since, p_exclude_internal, p_verified_only, v_merge)
  ),
  -- At risk: the first visit is at least the horizon old, so everyone counted
  -- has had the full window. Returned: visit two BEGAN inside the window.
  ret as (
    select f.user_id, f.first_at, f.day,
           exists (
             select 1 from v v2
              where v2.user_id = f.user_id and v2.k = 2
                and v2.first_at <= f.first_at + make_interval(days => v_h)
           ) as returned
      from v f
     where f.k = 1
       and f.day <= current_date - v_h
  ),
  -- Day-one depth: genuine card_placed rows in the first 24 hours (the seed's
  -- cards carry a non-user actor and are excluded).
  d1 as (
    select r.user_id, count(e.id)::int as cards
      from ret r
      join auth.users usr on usr.id = r.user_id
      left join public.analytics_events e
        on e.user_id = r.user_id
       and e.event = 'card_placed'
       and coalesce(e.props->>'actor', 'user') not in ('seed', 'template', 'system')
       and e.occurred_at < usr.created_at + interval '24 hours'
     group by r.user_id
  ),
  -- Device: the most common device_type the client stamped on day one.
  -- auth_session_ready is too sparse to use for this. 0876: the device alone
  -- is taken first, so the mode() sort no longer carries each props document.
  dev_rows as materialized (
    select r.user_id, e.props->>'device_type' as device
      from ret r
      join auth.users usr on usr.id = r.user_id
      join public.analytics_events e
        on e.user_id = r.user_id
       and e.props ? 'device_type'
       and e.occurred_at < usr.created_at + interval '24 hours'
  ),
  dev as (
    select dr.user_id, mode() within group (order by dr.device) as device
      from dev_rows dr
     group by dr.user_id
  ),
  -- First source, from the first-touch attribution stamped at sign-in.
  src as (
    select r.user_id,
           case
             when p.first_source->>'referrer_host' ilike '%chatgpt%'
               or p.first_source->>'utm_source' in ('chatgpt.com', 'openai')          then 'chatgpt'
             when p.first_source->>'share_token' is not null
               or p.first_source->>'utm_source' in ('share_link', 'public_board')
               or p.first_source->>'landing_path' like '/share/%'                    then 'share'
             when p.first_source->>'landing_path' like '/vs/%'
               or p.first_source->>'landing_path' like '/best/%'
               or p.first_source->>'landing_path' like '/tools/%'                    then 'seo'
             when p.first_source->>'referrer_host' ilike '%google.%'                then 'google'
             when p.first_source->>'referrer_host' ilike '%reddit%'                 then 'reddit'
             when coalesce(p.first_source->>'referrer_host', '') = ''               then 'direct'
             else 'other'
           end as source
      from ret r
      left join public.profiles p on p.user_id = r.user_id
  ),
  rows_ as (
    select 'all'::text as dim, r.returned from ret r
    union all
    select 'device:' || coalesce(d.device, 'unknown'), r.returned
      from ret r left join dev d on d.user_id = r.user_id
    union all
    select 'source:' || s.source, r.returned
      from ret r join src s on s.user_id = r.user_id
    union all
    select 'band:' || case
             when c.cards = 0 then '0' when c.cards <= 2 then '1-2'
             when c.cards <= 5 then '3-5' when c.cards <= 12 then '6-12' else '13+' end,
           r.returned
      from ret r join d1 c on c.user_id = r.user_id
    union all
    select 'week:' || to_char(date_trunc('week', r.day), 'YYYY-MM-DD'), r.returned
      from ret r
     where r.day >= current_date - (7 * v_weeks)
  )
  select x.dim,
         count(*)::int,
         sum(x.returned::int)::int,
         round(sum(x.returned::int)::numeric / nullif(count(*), 0), 4)
    from rows_ x
   group by x.dim
   order by x.dim;
end $$;

create or replace function public.admin_built_return(
  p_since date default '2026-08-17',
  p_horizon_days int default 7,
  p_exclude_internal boolean default true,
  p_verified_only boolean default true,
  p_merge_hours int default 2,
  p_weeks int default 12
)
returns table (
  dim text,
  n int,
  returned int,
  pct numeric
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
#variable_conflict use_column
declare
  v_since date := coalesce(p_since, '2026-08-17'::date);
  v_h int      := least(greatest(coalesce(p_horizon_days, 7), 1), 90);
  v_merge int  := least(greatest(coalesce(p_merge_hours, 2), 0), 12);
  v_weeks int  := least(greatest(coalesce(p_weeks, 12), 1), 52);
begin
  perform public._require_admin();

  return query
  with v as (
    select * from public._admin_engaged_visits(v_since, p_exclude_internal, p_verified_only, v_merge)
  ),
  ret as (
    select f.user_id, f.first_at, f.day,
           exists (
             select 1 from v v2
              where v2.user_id = f.user_id and v2.k >= 2 and v2.worked
                and v2.first_at <= f.first_at + make_interval(days => v_h)
           ) as returned
      from v f
     where f.k = 1
       and f.day <= current_date - v_h
  ),
  d1 as (
    select r.user_id,
           coalesce(sum(case when e.id is null then 0
                             when e.props->>'n' ~ '^[0-9]{1,6}$' then (e.props->>'n')::int
                             else 1 end), 0)::int as cards
      from ret r
      join auth.users usr on usr.id = r.user_id
      left join public.analytics_events e
        on e.user_id = r.user_id
       and e.event = 'card_placed'
       and coalesce(e.props->>'actor', 'user') not in ('seed', 'template', 'system')
       and e.occurred_at < usr.created_at + interval '24 hours'
     group by r.user_id
  ),
  -- 0876: the device alone first, so the mode() sort stays in memory.
  dev_rows as materialized (
    select r.user_id, e.props->>'device_type' as device
      from ret r
      join auth.users usr on usr.id = r.user_id
      join public.analytics_events e
        on e.user_id = r.user_id
       and e.props ? 'device_type'
       and e.occurred_at < usr.created_at + interval '24 hours'
  ),
  dev as (
    select dr.user_id, mode() within group (order by dr.device) as device
      from dev_rows dr
     group by dr.user_id
  ),
  src as (
    select r.user_id,
           case
             when p.first_source->>'referrer_host' ilike '%chatgpt%'
               or p.first_source->>'utm_source' in ('chatgpt.com', 'openai')          then 'chatgpt'
             when p.first_source->>'share_token' is not null
               or p.first_source->>'utm_source' in ('share_link', 'public_board')
               or p.first_source->>'landing_path' like '/share/%'                    then 'share'
             when p.first_source->>'landing_path' like '/vs/%'
               or p.first_source->>'landing_path' like '/best/%'
               or p.first_source->>'landing_path' like '/tools/%'                    then 'seo'
             when p.first_source->>'referrer_host' ilike '%google.%'                then 'google'
             when p.first_source->>'referrer_host' ilike '%reddit%'                 then 'reddit'
             when coalesce(p.first_source->>'referrer_host', '') = ''               then 'direct'
             else 'other'
           end as source
      from ret r
      left join public.profiles p on p.user_id = r.user_id
  ),
  rows_ as (
    select 'all'::text as dim, r.returned from ret r
    union all
    select 'device:' || coalesce(d.device, 'unknown'), r.returned
      from ret r left join dev d on d.user_id = r.user_id
    union all
    select 'source:' || s.source, r.returned
      from ret r join src s on s.user_id = r.user_id
    union all
    select 'band:' || case
             when c.cards = 0 then '0' when c.cards <= 2 then '1-2'
             when c.cards <= 5 then '3-5' when c.cards <= 12 then '6-12' else '13+' end,
           r.returned
      from ret r join d1 c on c.user_id = r.user_id
    union all
    select 'week:' || to_char(date_trunc('week', r.day), 'YYYY-MM-DD'), r.returned
      from ret r
     where r.day >= current_date - (7 * v_weeks)
  )
  select x.dim,
         count(*)::int,
         sum(x.returned::int)::int,
         round(sum(x.returned::int)::numeric / nullif(count(*), 0), 4)
    from rows_ x
   group by x.dim
   order by x.dim;
end $$;

do $proof$
declare
  f text;
begin
  foreach f in array array['public.admin_return_fixed_horizon(date, integer, boolean, boolean, integer, integer)',
                           'public.admin_built_return(date, integer, boolean, boolean, integer, integer)'] loop
    if has_function_privilege('anon', f, 'execute') then raise exception '0876: % is executable by anon', f; end if;
    if not has_function_privilege('authenticated', f, 'execute') then raise exception '0876: % is not executable by authenticated', f; end if;
    if not exists (select 1 from pg_proc where oid = f::regprocedure and prosecdef) then
      raise exception '0876: % lost security definer', f;
    end if;
  end loop;
end $proof$;

commit;
