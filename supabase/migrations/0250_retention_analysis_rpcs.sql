-- 0250_retention_analysis_rpcs.sql — read the atoms 0248 fixed.
--
-- 0248 made "active day" able to distinguish work from presence and gave
-- sessions a real identity. Nothing read either yet. These are the three
-- questions the whole exercise exists to answer:
--
--   admin_habit_curve      how many days out of the last 28 do people show up,
--                          and does the shape change when you demand actual work
--   admin_feature_adoption which features do returning users use, versus users
--                          who don't come back
--   admin_session_depth    are sessions getting longer and deeper, or just more
--                          numerous
--
-- Plus p_require_work on admin_return_rate, so the headline D1/D7/D30 tiles can
-- be read either way. Everything here honours the house conventions:
-- _require_admin() first, p_exclude_internal to drop founder/test traffic, and
-- no attempt to hide a small denominator — the caller applies the suppression
-- floors in adminFormat.js.

-- ── 1. The habit curve ─────────────────────────────────────────────────
-- L28: for each user, how many of the last 28 days did they show up? A single
-- retention percentage collapses "everyone visits once" and "a few people live
-- here" into the same number; the distribution keeps them apart.
--
-- p_require_work is the point. Presence and work were the same measurement
-- until 0248, and 54% of active-days had no work in them, so this curve is the
-- first place the difference becomes visible.

create or replace function public.admin_habit_curve(
  p_exclude_internal boolean default true,
  p_require_work     boolean default false,
  p_window_days      integer default 28
)
returns table(active_days integer, users integer, pct numeric)
language plpgsql
stable security definer
set search_path to 'public'
as $$
declare v_window int := least(greatest(coalesce(p_window_days, 28), 1), 365);
begin
  perform public._require_admin();
  -- CTEs, not temp tables: a temp table is a write, and PostgREST runs STABLE
  -- functions inside a READ ONLY transaction on GET. This has to work either way.
  return query
  with hc as (
    select a.user_id, count(*)::int as n
      from public.user_active_day a
     where a.day > current_date - v_window
       and (not p_require_work or a.did_work)
       and (not p_exclude_internal
            or a.user_id not in (select iu.user_id from public._internal_user_ids() iu))
     group by a.user_id
  )
  select hc.n, count(*)::int,
         round(count(*)::numeric / nullif((select count(*) from hc), 0), 4)
    from hc
   group by hc.n
   order by hc.n;
end $$;

revoke all on function public.admin_habit_curve(boolean, boolean, integer) from public, anon;
grant execute on function public.admin_habit_curve(boolean, boolean, integer) to authenticated;

-- ── 2. Feature adoption, with return-rate lift ─────────────────────────
-- The direct answer to "what makes people come back" — with a warning attached.
--
-- This is ASSOCIATION, not causation, and the confound runs the obvious way:
-- people who were going to stick around anyway have more opportunity to try
-- everything. A feature can show a large lift purely by being used late in a
-- long session. Read it to decide what to INVESTIGATE, never as proof that
-- shipping more of a feature will retain anyone.
--
-- Both groups are measured identically: "returned" means active again on a
-- LATER day than their first active day in the window. Comparing feature users
-- against a differently-defined baseline is how this kind of chart usually
-- lies.

create or replace function public.admin_feature_adoption(
  p_days             integer default 90,
  p_exclude_internal boolean default true
)
returns table(
  feature        text,
  users          integer,
  uses           integer,
  reach_pct      numeric,
  returned_pct   numeric,
  baseline_pct   numeric,
  lift_pct       numeric
)
language plpgsql
stable security definer
set search_path to 'public'
as $$
declare
  v_days  int := least(greatest(coalesce(p_days, 90), 1), 400);
  v_since timestamptz := now() - make_interval(days => v_days);
begin
  perform public._require_admin();
  return query
  with
  -- The cohort: everyone with any activity in the window. Marked 'returned'
  -- ONCE, by one rule, so feature users and non-users share a definition.
  cohort as (
    select a.user_id, (count(distinct a.day) > 1) as returned
      from public.user_active_day a
     where a.day > (current_date - v_days)
       and (not p_exclude_internal
            or a.user_id not in (select iu.user_id from public._internal_user_ids() iu))
     group by a.user_id
  ),
  -- Which events constitute which feature. Defined here rather than in the
  -- client so every reader agrees on what "used comments" means.
  featmap(feature, event) as (values
    ('comments',      'comment_create'),
    ('comments',      'comment_resolve'),
    ('collaboration', 'collab_session'),
    ('sharing',       'share_open'),
    ('sharing',       'share_link_copied'),
    ('sharing',       'invite_sent'),
    ('search',        'search_run'),
    ('search',        'search_result_open'),
    ('docs',          'doc_edit'),
    ('arrows',        'arrow_created'),
    ('export',        'export_run'),
    ('remix',         'remix_clone'),
    ('nested_boards', 'onboarding_nest'),
    ('tags',          'tag_manual_apply'),
    ('tags',          'tag_confirm'),
    ('tags',          'tag_merge'),
    ('tags',          'tag_candidate_promote'),
    ('tags',          'tag_set_type')
  ),
  use as (
    select f.feature, e.user_id, count(*)::int as n
      from public.analytics_events e
      join featmap f on f.event = e.event
     where e.occurred_at >= v_since
       and e.user_id is not null
       and coalesce(e.props->>'synthetic', '') <> 'true'
     group by f.feature, e.user_id
  ),
  users_of as (
    select u.feature,
           count(distinct u.user_id)::int as users,
           sum(u.n)::int                  as uses,
           count(distinct u.user_id) filter (where c.returned)::int as returned_users
      from use u
      join cohort c on c.user_id = u.user_id
     group by u.feature
  ),
  -- Baseline per feature: the same return rule over everyone who did NOT use it.
  base as (
    select f.feature,
           count(*) filter (where c.returned)::numeric / nullif(count(*), 0) as rate
      from (select distinct featmap.feature from featmap) f
      cross join cohort c
     where not exists (
       select 1 from use u where u.feature = f.feature and u.user_id = c.user_id
     )
     group by f.feature
  )
  select uo.feature,
         uo.users,
         uo.uses,
         round(uo.users::numeric / nullif((select count(*) from cohort), 0), 4),
         round(uo.returned_users::numeric / nullif(uo.users, 0), 4),
         round(b.rate, 4),
         round(uo.returned_users::numeric / nullif(uo.users, 0) - b.rate, 4)
    from users_of uo
    left join base b on b.feature = uo.feature
   order by uo.users desc;
end $$;

revoke all on function public.admin_feature_adoption(integer, boolean) from public, anon;
grant execute on function public.admin_feature_adoption(integer, boolean) to authenticated;

-- ── 3. Session depth ───────────────────────────────────────────────────
-- "Using the app longer" has two very different shapes — more sessions, or
-- deeper ones — and they call for opposite responses. Until 0248 neither was
-- measurable, because a session was a browser.
--
-- Reads usage_session (real active seconds per surface), so it necessarily
-- starts empty and fills from the deploy date. That is stated rather than
-- papered over: an empty chart here means "not yet measured", not "zero".

create or replace function public.admin_session_depth(
  p_days             integer default 28,
  p_exclude_internal boolean default true
)
returns table(
  week            date,
  users           integer,
  sessions        integer,
  sessions_per_user numeric,
  median_minutes  numeric,
  p90_minutes     numeric,
  surfaces_per_session numeric
)
language plpgsql
stable security definer
set search_path to 'public'
as $$
declare v_days int := least(greatest(coalesce(p_days, 28), 1), 400);
begin
  perform public._require_admin();

  return query
  with s as (
    select us.app_session_id,
           us.user_id,
           date_trunc('week', min(us.started_at))::date as week,
           sum(us.active_seconds)                       as secs,
           count(distinct us.surface)                   as surfaces
      from public.usage_session us
     where us.started_at > now() - make_interval(days => v_days)
       and (not p_exclude_internal
            or us.user_id not in (select iu.user_id from public._internal_user_ids() iu))
     group by us.app_session_id, us.user_id
  )
  select s.week,
         count(distinct s.user_id)::int,
         count(*)::int,
         round(count(*)::numeric / nullif(count(distinct s.user_id), 0), 2),
         round((percentile_cont(0.5) within group (order by s.secs))::numeric / 60, 1),
         round((percentile_cont(0.9) within group (order by s.secs))::numeric / 60, 1),
         round(avg(s.surfaces)::numeric, 2)
    from s
   group by s.week
   order by s.week;
end $$;

revoke all on function public.admin_session_depth(integer, boolean) from public, anon;
grant execute on function public.admin_session_depth(integer, boolean) to authenticated;

-- ── 4. Where the time actually goes ────────────────────────────────────
-- The question profiles.seconds_in_app could never answer.

create or replace function public.admin_surface_time(
  p_days             integer default 28,
  p_exclude_internal boolean default true
)
returns table(surface text, users integer, sessions integer, minutes numeric, pct numeric)
language plpgsql
stable security definer
set search_path to 'public'
as $$
declare v_days int := least(greatest(coalesce(p_days, 28), 1), 400);
begin
  perform public._require_admin();
  return query
  with st as (
    select us.surface, us.user_id, us.app_session_id, us.active_seconds
      from public.usage_session us
     where us.started_at > now() - make_interval(days => v_days)
       and (not p_exclude_internal
            or us.user_id not in (select iu.user_id from public._internal_user_ids() iu))
  )
  select st.surface,
         count(distinct st.user_id)::int,
         count(distinct st.app_session_id)::int,
         round(sum(st.active_seconds)::numeric / 60, 1),
         round(sum(st.active_seconds)::numeric
               / nullif((select sum(s2.active_seconds) from st s2), 0), 4)
    from st
   group by st.surface
   order by 4 desc;
end $$;

revoke all on function public.admin_surface_time(integer, boolean) from public, anon;
grant execute on function public.admin_surface_time(integer, boolean) to authenticated;

-- ── 5. D1/D7/D30, readable either way ──────────────────────────────────
-- Body is 0120's, unchanged except for the p_require_work filter. The old
-- signature is DROPPED rather than left beside the new one: PostgREST resolves
-- overloads by argument name, and two candidates that both accept
-- {p_exclude_internal, p_verified_only} make the call ambiguous and fail.

drop function if exists public.admin_return_rate(boolean, boolean);

create or replace function public.admin_return_rate(
  p_exclude_internal boolean default true,
  p_verified_only    boolean default true,
  p_require_work     boolean default false
)
returns table(day_offset integer, eligible integer, returned_on integer, on_pct numeric,
              returned_within integer, within_pct numeric)
language plpgsql
stable security definer
set search_path to 'public'
as $$
declare v_track_start date;
begin
  perform public._require_admin();
  select min(day) into v_track_start from public.user_active_day;
  v_track_start := coalesce(v_track_start, current_date);
  return query
  with u as (
    select usr.id as user_id, usr.created_at::date as signup_day
      from auth.users usr
     where (not p_verified_only or (usr.email_confirmed_at is not null and usr.last_sign_in_at is not null))
       and (not p_exclude_internal or usr.id not in (select iu.user_id from public._internal_user_ids() iu))
  ),
  offs(day_offset) as (values (1),(7),(30)),
  grid as (
    select u.user_id, o.day_offset, (u.signup_day + o.day_offset) as cal_day
      from u cross join offs o
     where (u.signup_day + o.day_offset) <= current_date
       and (u.signup_day + o.day_offset) >= v_track_start
  ),
  marked as (
    select g.day_offset,
           exists(select 1 from public.user_active_day a
                   where a.user_id = g.user_id and a.day = g.cal_day
                     and (not p_require_work or a.did_work)) as on_day,
           exists(select 1 from public.user_active_day a
                   where a.user_id = g.user_id
                     and a.day >  (g.cal_day - g.day_offset)
                     and a.day <= g.cal_day
                     and (not p_require_work or a.did_work)) as within_w
      from grid g
  )
  select m.day_offset,
         count(*)::int,
         sum(case when m.on_day then 1 else 0 end)::int,
         round(sum(case when m.on_day then 1 else 0 end)::numeric / nullif(count(*), 0), 4),
         sum(case when m.within_w then 1 else 0 end)::int,
         round(sum(case when m.within_w then 1 else 0 end)::numeric / nullif(count(*), 0), 4)
    from marked m
   group by m.day_offset
   order by m.day_offset;
end $$;

revoke all on function public.admin_return_rate(boolean, boolean, boolean) from public, anon;
grant execute on function public.admin_return_rate(boolean, boolean, boolean) to authenticated;

-- ── 6. Make prop-filtered reads survivable ─────────────────────────────
-- analytics_events has indexes on (event, occurred_at), (session_id) and
-- (user_id, occurred_at) but NONE on props, so every prop-keyed query — which
-- is most of the new ones — is a sequential scan. jsonb_path_ops is roughly
-- half the size of the default and covers the @> containment these use.

create index if not exists analytics_events_props_gin
  on public.analytics_events using gin (props jsonb_path_ops);

-- _stamp_first_populated_board and lifecycle_due_reengage_1 both count genuine
-- cards per board on every card write; this stops that being a scan of the
-- board's rows.
create index if not exists card_index_board_updated_idx
  on public.card_index (board_id, updated_at desc);
